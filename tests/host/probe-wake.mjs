// 020：允许成员自然卸载/恢复、Lead接收通知，但不由Lead模型决定派发。
export const name = "scheduler-wake-probe";
export const inject = ["agents", "agentTeams", "tools"];
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

function deadline(promise, ms, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`唤醒探针超时：${label}`)), ms);
  })]).finally(() => clearTimeout(timer));
}

function waitFor(fn, timeout = 10000, label = "等待条件") {
  return deadline((async () => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const value = await fn();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`唤醒探针超时：${label}`);
  })(), timeout, label);
}

export function apply(ctx) {
  globalThis.__schedulerWakeProbe = (async () => {
    const result = { steps: [], errors: [] }, activations = [];
    let handle;
    const off = [];
    try {
      handle = await waitFor(async () => {
        try { return await ctx.agents.create({ sessionId: `session-wake-lead-${randomUUID()}`,
          agentOptions: { provider: "mock", model: "mock-model" } }); }
        catch (error) { if (String(error).includes("no agent factory registered")) return; throw error; }
      });
      const lead = handle.agent, signal = new AbortController().signal;
      for (const [event, type] of [["agent/created", "created"], ["agent/disposed", "disposed"]]) {
        off.push(ctx.on(event, ({ agent }) => {
          if (agent.session.header.parentSession === lead.id) activations.push({ type, id: String(agent.id), at: new Date().toISOString() });
        }));
      }
      const status = await waitFor(() => ctx.tools.get("scheduler_status", lead));
      const call = async (tool, args) => JSON.parse((await ctx.tools.get(tool, lead).execute(args, { agent: lead, signal })).result);
      const first = JSON.parse((await status.execute({}, { agent: lead, signal })).result);
      if (!first.autoDispatch || first.ready.join() !== "A1") throw new Error("autoDispatch未启用或初始状态错误");
      await deadline(call("scheduler_manage", { action: "spawn", target: "tester" }), 10000, "tester启动");
      const tester = ctx.agentTeams.listMembers(lead).find(member => member.name === "tester");
      if (!tester) throw new Error("tester持久成员未注册");
      await waitFor(async () => {
        const s = await call("scheduler_status", {});
        return [...(s.waitingAgents ?? []), ...(s.inactiveWaitingAgents ?? [])].includes("tester");
      }, 10000, "tester登记等待");
      await waitFor(() => !ctx.agents.list().some(agent => String(agent.id) === String(tester.id)), 10000, "tester自然卸载");
      const unloaded = await call("scheduler_status", {});
      if (unloaded.waitingAgents.includes("tester") || !unloaded.inactiveWaitingAgents.includes("tester")) {
        throw new Error("tester卸载后的live/非活跃等待展示不正确");
      }
      result.steps.push({ name: "tester-waited-and-unloaded", memberId: String(tester.id) });
      await deadline(call("scheduler_manage", { action: "spawn", target: "developer" }), 10000, "developer启动");
      const stateFile = process.env.SCHEDULER_PROBE_STATE;
      const state = await waitFor(async () => {
        const s = JSON.parse(await readFile(stateFile, "utf8"));
        return ["A1", "Q1", "A2"].every(id => s.progress[id].status === "completed") ? s : undefined;
      }, 60000, "A1→Q1→A2完成");
      if (state.runs.length !== 3 || state.runs.some(run => run.phase !== "finished")) throw new Error("运行重复或未结束");
      const sameSessionActivations = activations.filter(event => event.type === "created" && event.id === String(tester.id));
      if (sameSessionActivations.length < 2) throw new Error("未观察到tester在原session上恢复");
      const messages = (await readFile(fileURLToPath(new URL("../../.harness-isolated/mock-wake.log", import.meta.url)), "utf8"))
        .trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
      const leadMessages = messages.filter(row => row.actor === "lead");
      if (leadMessages.some(row => row.action?.tool)) throw new Error("Lead模型参与了不应由其决定的调度操作");
      const intervals = state.runs.map(run => ({
        taskId: run.taskId, startedAt: run.startedAt,
        completedAt: state.history.find(e => e.taskId === run.taskId && e.action === "completed").at
      }));
      result.steps.push({ name: "auto-cross-member-chain-complete", intervals, activations,
        observedLeadModelCalls: leadMessages.length, leadSchedulingToolCalls: 0, manualDispatches: 0, realModelCalls: 0,
        actions: state.history.map(e => ({ at: e.at, action: e.action, taskId: e.taskId })) });
    } catch (error) {
      result.errors.push(String(error?.stack ?? error));
    } finally {
      for (const dispose of off) dispose();
      if (handle) {
        try { await deadline(handle.dispose(), 5000, "释放Lead"); result.steps.push({ name: "disposed" }); }
        catch (error) { result.errors.push(`清理失败：${String(error)}`); }
      }
    }
    return result;
  })();
}
