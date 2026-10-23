// 闭环探针：真实 DSH + 真实 agent-team + 本地 OpenAI 兼容 mock（无真实模型费用）。
export const name = "scheduler-loop-probe";
export const inject = ["agents", "agentTeams", "tools"];

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const waitFor = async (fn, timeoutMs, label) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`等待超时：${label}`);
};

const createAgent = async (ctx, options) => {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try { return await ctx.agents.create(options); }
    catch (error) {
      if (!String(error?.message ?? error).includes("no agent factory registered")) throw error;
      await sleep(100);
    }
  }
  throw new Error("agent-loop 未在 10 秒内注册 factory");
};

export function apply(ctx) {
  const stateFile = process.env.SCHEDULER_PROBE_STATE;
  globalThis.__schedulerLoopProbe = (async () => {
    const result = { steps: [], errors: [] };
    const step = (name, detail) => result.steps.push({ name, ...detail });
    let leadHandle, teammate;
    try {
      leadHandle = await createAgent(ctx, {
        sessionId: `session-loop-lead-${randomUUID()}`,
        agentOptions: { provider: "mock", model: "mock-model" }
      });
      const lead = leadHandle.agent;
      step("lead-created", { id: lead.id });
      const tools = await waitFor(() => ctx.tools.get("scheduler_manage", lead) ? ctx.tools.schemas(lead).filter(t => t.name.startsWith("scheduler_")).map(t => t.name) : undefined, 5000, "Lead 工具注册");
      step("lead-tools", { names: tools });

      lead.followup({ content: [{ type: "text", text: "开始调度闭环测试" }], source: { kind: "user" } });
      await lead.whenIdle();
      step("lead-idle", { at: Date.now() });

      teammate = await waitFor(() => {
        const agent = ctx.agents.list().find(a => a.session.header.parentSession === lead.id);
        return agent;
      }, 10000, "专项成员创建");
      step("teammate-created", { id: teammate.id });

      await waitFor(async () => {
        try {
          const state = JSON.parse(await readFile(stateFile, "utf8"));
          return state.progress?.A1?.status === "completed" && state.progress?.A2?.status === "completed";
        } catch { return false; }
      }, 60000, "A1/A2 完成");
      await teammate.whenIdle();

      const state = JSON.parse(await readFile(stateFile, "utf8"));
      const actions = state.history.map(e => e.action);
      const members = ctx.agentTeams.listMembers(lead).map(m => ({ name: m.name, role: m.role }));
      step("state", {
        A1: state.progress.A1.status, A2: state.progress.A2.status,
        actions, runs: state.runs.map(r => ({ taskId: r.taskId, agentId: r.agentId, phase: r.phase })),
        members
      });
      if (!actions.includes("dispatch") || !actions.includes("acknowledge") || !actions.includes("completed")) {
        throw new Error(`闭环事件不完整：${actions.join(",")}`);
      }
      if (!members.some(m => m.name === "developer" && m.role === "teammate")) throw new Error("developer 未成为团队成员");

      await leadHandle.dispose();
      leadHandle = undefined;
      step("agents-disposed", {});
    } catch (error) {
      result.errors.push(String(error?.stack ?? error));
      try { await leadHandle?.dispose(); } catch {}
    }
    return result;
  })();
}
