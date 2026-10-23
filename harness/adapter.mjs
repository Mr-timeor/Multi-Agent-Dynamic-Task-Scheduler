import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalize, initial } from "../dist/core/model.js";
import { diagnose } from "../dist/core/planner.js";
import { FileStore } from "../dist/store/file-store.js";
import { Scheduler } from "../dist/dispatcher/scheduler.js";

// 仅这一层认识宿主 Agent；核心可以由其他平台复用。
//
// 与 DSH 0.2.1-rc.2 的实际接口对齐：
// - defineTool 的 output.schema 是值 schema DSL（普通对象），不是 schemastery 实例；
// - 可选参数必须省略 required，写成 required:false 会被拒绝；
// - tryMembership 要求传入 agents 服务中的同一个 live Agent 对象。
export function install(ctx, config, { defineTool, z }) {
  if (!config.projectFile || !config.stateFile) {
    throw new Error("需要 projectFile 和 stateFile");
  }
  const explicitLead = config.leadSessionId && config.leadSessionId !== "auto"
    ? String(config.leadSessionId) : undefined;
  let boundLeadId = explicitLead;
  const installed = new Map();
  // 逻辑等待属于持久成员/session；live Agent只是当前回合的载体。
  const waiting = new Map();
  const memberNames = new WeakMap();
  const wakeJobs = new Set();
  const shutdown = new AbortController();
  let disposed = false;
  let servicePromise;
  const service = () => servicePromise ??= (async () => {
    const project = normalize(JSON.parse(await readFile(resolve(config.projectFile), "utf8")));
    const errors = diagnose(project);
    if (errors.length) throw new Error(errors.join("\n"));
    return new Scheduler(await FileStore.open(resolve(config.stateFile), initial(project)), config.receiptTimeoutMs ?? 120000);
  })();

  function liveLead(root) {
    return !disposed && ctx.agents.list().includes(root)
      && ctx.agentTeams.tryMembership(root)?.role === "lead" && String(root.id) === boundLeadId;
  }

  function send(root, signal, delivery) {
    return ctx.agentTeams.sendMessage(root, {
      target: delivery.agentId, content: [{ type: "text", text: JSON.stringify(delivery) }], signal
    });
  }

  function waitForMember(m, agent) {
    memberNames.set(agent, m.name);
    waiting.set(m.name, { id: String(agent.id), agent });
  }

  function waitingStatus() {
    const result = { waitingAgents: [], inactiveWaitingAgents: [] };
    for (const [name, entry] of waiting) {
      if (entry.agent && !ctx.agents.list().includes(entry.agent)) entry.agent = undefined;
      (entry.agent ? result.waitingAgents : result.inactiveWaitingAgents).push(name);
    }
    return result;
  }

  // 只响应当前工具中的真实状态变更；不轮询、不创建成员、不自动重试。
  function wakeReady(root, signal) {
    if (!config.autoDispatch || !liveLead(root)) return Promise.resolve(undefined);
    const job = (async () => {
      const s = await service(), result = { dispatched: [], errors: [] };
      const candidates = s.snapshot().project.agents.filter(agent => waiting.has(agent.id))
        .flatMap(agent => s.plan(agent.id).segments);
      await Promise.all(candidates.map(async ({ agentId }) => {
        if (!liveLead(root)) return;
        const entry = waiting.get(agentId);
        if (!entry) return;
        // inactive不是成员消失：原生消息服务会恢复同一个持久Session。
        let target;
        try {
          target = ctx.agentTeams.listMembers(root).find(member =>
            member.name === agentId && String(member.id) === entry.id);
        } catch (error) {
          result.errors.push({ agentId, error: `无法核对持久成员：${String(error?.message ?? error)}` });
          return;
        }
        if (!target || !["running", "inactive"].includes(target.status)) {
          waiting.delete(agentId);
          result.errors.push({ agentId, error: "原持久成员不可发送；未创建替代会话，请Lead核对" });
          return;
        }
        // 先移除等待标记，避免两个同时交付事件重复派发同一成员。
        if (waiting.get(agentId) !== entry || !waiting.delete(agentId)) return;
        try {
          const delivery = await s.dispatch(agentId, d => send(root,
            AbortSignal.any([signal ?? shutdown.signal, shutdown.signal]), d));
          const phase = s.snapshot().runs.find(run => run.dispatchId === delivery.dispatchId)?.phase;
          result.dispatched.push({ agentId, taskId: delivery.taskId, dispatchId: delivery.dispatchId, phase });
        } catch (error) {
          // 上游交付已经提交；唤醒失败不能把它报成失败或诱使模型重复提交。
          result.errors.push({ agentId, error: String(error?.message ?? error) });
          if (!disposed && !s.snapshot().runs.some(run => run.agentId === agentId && run.phase !== "finished")) {
            waiting.set(agentId, entry); // 尚未占用/发送时，保留等待，留给后续真实事件或手动派发。
          }
        }
      }));
      return result;
    })();
    wakeJobs.add(job);
    job.finally(() => wakeJobs.delete(job)).catch(() => {});
    return job;
  }

  // 只接受本调度团队的 live 调用者；auto 模式由第一次合法调用确定唯一 Lead。
  function member(agent, leadOnly = false) {
    const m = ctx.agentTeams.tryMembership(agent);
    if (!m) throw new Error("此工具仅供调度团队使用");
    if (boundLeadId === undefined) bindLead(String(m.root.id));
    if (String(m.root.id) !== boundLeadId) throw new Error("此调度器已绑定另一个 Lead");
    if (leadOnly && m.role !== "lead") throw new Error("此动作仅限 Lead");
    if (m.role === "teammate") memberNames.set(agent, m.name);
    return m;
  }

  // 绑定后只保留该团队的工具；其他 root 已注册的工具一并撤回。
  function bindLead(rootId) {
    boundLeadId = rootId;
    for (const [agent, disposers] of installed) {
      const m = ctx.agentTeams.tryMembership(agent);
      if (m && String(m.root.id) === boundLeadId) continue;
      for (const dispose of disposers) dispose();
      installed.delete(agent);
    }
    for (const a of ctx.agents.list()) attach(a);
  }

  const textParam = (description, required = false) => ({
    type: "string", description, ...(required ? { required: true } : {})
  });

  function tool(name, description, parameters, execute) {
    return defineTool({
      name, description, parameters,
      output: {
        schema: {
          type: "object", additionalProperties: false,
          properties: { result: { type: "string", required: true } }
        },
        render: (_args, value) => [{ type: "text", text: value.result }]
      },
      async execute(args, exec) { return { result: JSON.stringify(await execute(args, exec)) }; }
    });
  }

  const definitions = [
    tool("scheduler_status", "查看当前任务、执行段与等待原因；只返回紧凑状态。", {}, async (_args, exec) => {
      member(exec.agent); const s = await service(); await s.expire();
      const state = s.snapshot();
      return { revision: state.revision, ...s.plan(), tasks: state.progress,
        autoDispatch: config.autoDispatch === true, ...waitingStatus(),
        runs: state.runs.filter(r => r.phase !== "finished") };
    }),
    tool("scheduler_next", "专项执行者领取下一任务。收到委托可传 dispatchId 确认；当前项完成后空参领取下一项。", {
      dispatchId: textParam("收到的委托 ID")
    }, async (args, exec) => {
      const m = member(exec.agent);
      if (m.role !== "teammate") throw new Error("Lead 请使用 scheduler_manage 派发");
      const s = await service(); await s.expire();
      const state = s.snapshot();
      const run = state.runs.find(r => r.agentId === m.name && r.phase !== "finished");
      if (run) {
        if (args.dispatchId && args.dispatchId !== run.dispatchId) throw new Error("dispatchId 与当前委托不匹配");
        waiting.delete(m.name);
        await s.acknowledge(m.name, run);
        return { ...run, phase: "active", task: state.project.tasks.find(t => t.id === run.taskId) };
      }
      if (args.dispatchId) throw new Error("旧委托已结束，不再执行");
      const worked = state.runs.some(r => r.agentId === m.name && r.phase === "finished");
      if (!worked && !config.autoDispatch) {
        waitForMember(m, exec.agent);
        return { waiting: true, reason: "等待 Lead 派发第一个任务" };
      }
      const p = s.plan(m.name);
      if (p.diagnostics.length) throw new Error(p.diagnostics.join("\n"));
      if (!p.segments.some(x => x.agentId === m.name)) {
        waitForMember(m, exec.agent);
        return { waiting: true, reason: "暂无属于你的连续任务" };
      }
      waiting.delete(m.name);
      let delivery;
      try { delivery = await s.dispatch(m.name, async () => {}); }
      catch (error) {
        // 交付唤醒与成员自行领取同时发生时，采用已分配的同一run。
        delivery = s.snapshot().runs.find(r => r.agentId === m.name && r.phase !== "finished");
        if (!delivery) throw error;
      }
      await s.acknowledge(m.name, delivery);
      return delivery;
    }),
    tool("scheduler_report", "报告当前委托结果。普通任务直接完成；声明 review 的任务等待检查点验收。", {
      dispatchId: textParam("当前委托 ID", true),
      summary: textParam("简短结果与检查依据", true),
      status: textParam("completed（默认）、checkpoint、blocked 或 failed"),
      outputs: textParam('产物引用 JSON，如 {"api":"docs/api.md"}')
    }, async (args, exec) => {
      const m = member(exec.agent), s = await service();
      const run = s.snapshot().runs.find(r => r.dispatchId === args.dispatchId && r.agentId === m.name);
      if (!run || m.role !== "teammate") throw new Error("没有属于你的委托");
      await s.report(m.name, run, {
        summary: args.summary, status: args.status ?? "completed",
        outputs: args.outputs ? JSON.parse(args.outputs) : undefined
      });
      const wakeups = await wakeReady(m.root, exec.signal);
      return { taskId: run.taskId, state: s.snapshot().progress[run.taskId], ...(wakeups ? { wakeups } : {}) };
    }),
    tool("scheduler_manage", "Lead 管理：spawn、dispatch、accept、approve、pause、resume、retry、resolve-stopped。停止对账前先确认执行者已停止。", {
      action: textParam("管理动作", true), target: textParam("执行者名称或任务 ID"),
      output: textParam("仅验收指定中间产物时填写")
    }, async (args, exec) => {
      const m = member(exec.agent, true); const s = await service();
      if (args.action === "spawn") {
        const a = s.snapshot().project.agents.find(a => a.id === args.target);
        if (!a) throw new Error("执行者须先在项目中声明");
        await ctx.agentTeams.spawnTeammate(exec.agent, {
          name: a.id, description: `专项执行者：${a.categories.join("、") || "通用"}`,
          prompt: [{ type: "text", text: config.autoDispatch
            ? "你是专项执行者。先用scheduler_next领取或确认当前任务；使用scheduler_report提交简短摘要与产物引用，随后next继续。waiting即结束回合，依赖满足后插件会发送委托唤醒，不要轮询。只执行当前taskId，未知委托不重复执行。"
            : "你是专项执行者。等待 Lead 派发；收到任务后用 scheduler_next 确认委托，只执行当前任务，使用 scheduler_report 提交简短摘要与产物引用。首个任务完成后可继续领取下一项，暂无任务则停止等待。" }],
          context: "fresh", provider: config.provider ?? "spawn", signal: exec.signal
        });
        return { spawned: a.id };
      }
      if (args.action === "dispatch") {
        if (!args.target) throw new Error("dispatch 需要执行者名称");
        waiting.delete(args.target);
        return s.dispatch(args.target, delivery => send(exec.agent, exec.signal, delivery));
      }
      if (args.action === "accept") await s.accept(args.target, args.output);
      else if (["approve", "pause", "resume", "retry", "resolve-stopped"].includes(args.action)) await s.control(args.action, args.target);
      else throw new Error("未知管理动作");
      const wakeups = await wakeReady(m.root, exec.signal);
      return { revision: s.snapshot().revision, ...(wakeups ? { wakeups } : {}) };
    })
  ];

  function attach(agent) {
    if (installed.has(agent)) return;
    const m = ctx.agentTeams.tryMembership(agent);
    if (!m) return;
    if (boundLeadId !== undefined) {
      if (String(m.root.id) !== boundLeadId) return;
    } else if (m.role !== "lead") {
      return;
    }
    if (m.role === "teammate") memberNames.set(agent, m.name);
    installed.set(agent, definitions.map(t => agent.ctx.tools.register(t)));
  }
  for (const a of ctx.agents.list()) attach(a);
  const off = [
    ctx.on("agent/created", ({ agent }) => attach(agent)),
    ctx.on("agent/disposed", ({ agent }) => {
      // 此时agents可能已经注销，不能再用tryMembership解析身份。
      const name = memberNames.get(agent), entry = waiting.get(name);
      if (entry?.agent === agent) entry.agent = undefined;
      for (const dispose of installed.get(agent) ?? []) dispose();
      installed.delete(agent);
    })
  ];
  return async () => {
    disposed = true;
    shutdown.abort();
    waiting.clear();
    for (const dispose of off) if (typeof dispose === "function") dispose();
    for (const disposers of installed.values()) for (const dispose of disposers) dispose();
    installed.clear();
    await Promise.allSettled([...wakeJobs]);
    if (servicePromise) await (await servicePromise).store.close();
  };
}
