// 隔离宿主探针：只在 isolated DSH_HOME 的 scheduler-test profile 中加载。
// 不调用模型：创建 idle Agent，直接通过真实 tools 注册表取定义并执行。
export const name = "scheduler-probe";
export const inject = ["agents", "tools"];

import { randomUUID } from "node:crypto";

const waitFor = async (fn, timeoutMs = 5000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = fn();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("等待超时");
};

const createAgent = async (ctx, options) => {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try { return await ctx.agents.create(options); }
    catch (error) {
      if (!String(error?.message ?? error).includes("no agent factory registered")) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error("agent-loop 未在 10 秒内注册 factory");
};

export function apply(ctx) {
  globalThis.__schedulerProbe = (async () => {
    const result = { steps: [], errors: [] };
    const step = (name, detail) => result.steps.push({ name, ...detail });
    let leadHandle, otherHandle;
    try {
      leadHandle = await createAgent(ctx, {
        sessionId: `session-probe-lead-${randomUUID()}`,
        agentOptions: { provider: "deepseek", model: "deepseek-flash" }
      });
      const lead = leadHandle.agent;
      step("lead-created", { id: lead.id });

      const status = await waitFor(() => ctx.tools.get("scheduler_status", lead));
      const manage = ctx.tools.get("scheduler_manage", lead);
      const next = ctx.tools.get("scheduler_next", lead);
      const report = ctx.tools.get("scheduler_report", lead);
      if (!manage || !next || !report) throw new Error("四个工具未全部注册");
      step("tools-registered", { names: ctx.tools.schemas(lead).map(t => t.name).filter(n => n.startsWith("scheduler_")) });

      const signal = new AbortController().signal;
      const raw = await status.execute({}, { agent: lead, signal });
      const parsed = JSON.parse(raw.result);
      step("status-executed", { revision: parsed.revision, ready: parsed.ready?.length ?? 0, tasks: Object.keys(parsed.tasks ?? {}).length });
      if (typeof parsed.revision !== "number") throw new Error("status 未返回 revision");
      if (!parsed.tasks || Object.keys(parsed.tasks).length === 0) throw new Error("status 未返回任务状态");

      const paused = await manage.execute({ action: "pause" }, { agent: lead, signal });
      step("paused", { revision: JSON.parse(paused.result).revision });
      const afterPause = JSON.parse((await status.execute({}, { agent: lead, signal })).result);
      if (!Object.values(afterPause.blocked ?? {}).some(reasons => reasons.includes("调度已暂停"))) throw new Error("暂停未反映到计划");
      const resumed = await manage.execute({ action: "resume" }, { agent: lead, signal });
      step("resumed", { revision: JSON.parse(resumed.result).revision });

      otherHandle = await createAgent(ctx, {
        sessionId: `session-probe-other-${randomUUID()}`,
        agentOptions: { provider: "deepseek", model: "deepseek-flash" }
      });
      const other = otherHandle.agent;
      step("other-created", { id: other.id });
      if (ctx.tools.get("scheduler_status", other) !== undefined) throw new Error("绑定后其他 root 仍注册了调度工具");
      step("other-has-no-tools", {});
      let rejected = false;
      try { await status.execute({}, { agent: other, signal }); }
      catch (error) { rejected = /另一个 Lead|仅供调度团队/.test(String(error?.message ?? error)); }
      if (!rejected) throw new Error("非绑定 Lead 调用未被拒绝");
      step("identity-rejected", { other: other.id });

      await leadHandle.dispose();
      leadHandle = undefined;
      await otherHandle.dispose();
      otherHandle = undefined;
      let removed = false;
      try { removed = ctx.tools.get("scheduler_status", lead) === undefined; } catch { removed = true; }
      if (!removed) throw new Error("Agent 释放后工具仍可见");
      step("agent-disposed-tools-removed", {});
    } catch (error) {
      result.errors.push(String(error?.stack ?? error));
      try { await leadHandle?.dispose(); } catch {}
      try { await otherHandle?.dispose(); } catch {}
    }
    return result;
  })();
}
