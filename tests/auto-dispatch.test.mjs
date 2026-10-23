import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { install } from "../harness/adapter.mjs";

async function setup(t, tasks, names = ["dev", "qa"], autoDispatch = true) {
  const folder = await mkdtemp(join(tmpdir(), "scheduler-wake-"));
  const tools = new Map(), listeners = new Map(), members = new Map(), sent = [];
  const agent = id => {
    const table = new Map(); tools.set(id, table);
    return { id, ctx: { tools: { register(definition) {
      table.set(definition.name, definition); return () => table.delete(definition.name);
    } } } };
  };
  const lead = agent("lead");
  for (const name of names) members.set(name, agent(name));
  const live = [lead, ...members.values()];
  let sendHook;
  const ctx = {
    agents: { list: () => live },
    agentTeams: {
      tryMembership: a => !live.includes(a) ? undefined : a === lead ? { root: lead, role: "lead", name: "lead" }
        : members.get(a.id) === a ? { root: lead, role: "teammate", name: a.id } : undefined,
      listMembers: caller => {
        assert.equal(caller, lead);
        return [...members].map(([name, a]) => ({ id: a.id, name, role: "teammate", status: "inactive" }));
      },
      sendMessage: async (caller, message) => {
        assert.equal(caller, lead);
        sent.push({ ...JSON.parse(message.content[0].text), target: message.target });
        await sendHook?.(message);
      }
    },
    on: (name, callback) => { listeners.set(name, callback); return () => listeners.delete(name); }
  };
  const projectFile = join(folder, "project.json");
  await writeFile(projectFile, JSON.stringify({ agents: names.map(id => ({ id })), tasks }));
  const dispose = install(ctx, { projectFile, stateFile: join(folder, "state.json"), leadSessionId: "lead", autoDispatch }, { defineTool: value => value });
  const call = async (name, tool, args = {}) => JSON.parse((await tools.get(name).get(tool).execute(args, {
    agent: name === "lead" ? lead : members.get(name), signal: new AbortController().signal
  })).result);
  const next = name => call(name, "scheduler_next");
  const report = (name, run, status = "completed", outputs) => call(name, "scheduler_report", {
    dispatchId: run.dispatchId, status, summary: `${run.taskId}/${status}`,
    ...(outputs ? { outputs: JSON.stringify(outputs) } : {})
  });
  const manage = args => call("lead", "scheduler_manage", args);
  const status = () => call("lead", "scheduler_status");
  const snapshot = async () => JSON.parse(await (await import("node:fs/promises")).readFile(join(folder, "state.json"), "utf8"));
  t.after(async () => { await dispose(); await rm(folder, { recursive: true, force: true }); });
  return { call, next, report, manage, status, snapshot, sent, lead, live,
    unload: name => {
      const a = members.get(name); live.splice(live.indexOf(a), 1);
      listeners.get("agent/disposed")?.({ agent: a });
    },
    resume: name => {
      const a = agent(name); members.set(name, a); live.push(a);
      listeners.get("agent/created")?.({ agent: a });
    },
    removeMember: name => members.delete(name),
    sendHook: value => { sendHook = value; }, dispose };
}
const task = (id, owner, dependsOn = [], rest = {}) => ({ id, owner, dependsOn, ...rest });

test("交付直接唤醒：三线分叉/汇合/处置/复测无需Lead逐阶段派发", async t => {
  const h = await setup(t, [
    task("P1", "dev"), task("D1", "dev", ["P1"]), task("C1", "cli", ["P1"]), task("Q1", "qa", ["P1"]),
    task("Q2", "qa", ["D1", "C1", "Q1"]), task("D2", "dev", ["Q2"]), task("C2", "cli", ["Q2"]),
    task("Q3", "qa", ["D2", "C2"]), task("C3", "cli", ["Q3"])
  ], ["dev", "cli", "qa"]);
  assert.equal((await h.next("cli")).waiting, true);
  assert.equal((await h.next("qa")).waiting, true);
  await h.manage({ action: "dispatch", target: "dev" });
  await h.report("dev", await h.next("dev"));
  assert.deepEqual(h.sent.map(row => row.taskId).sort(), ["P1", "C1", "Q1"].sort());
  const d1 = await h.next("dev"), c1 = await h.next("cli"), q1 = await h.next("qa");
  await h.report("qa", q1); assert.equal((await h.next("qa")).waiting, true);
  await h.report("dev", d1); assert.equal((await h.next("dev")).waiting, true);
  assert.ok(!h.sent.some(row => row.taskId === "Q2"));
  await h.report("cli", c1); assert.equal((await h.next("cli")).waiting, true);
  const q2 = await h.next("qa"); assert.equal(q2.taskId, "Q2");
  await h.report("qa", q2); assert.equal((await h.next("qa")).waiting, true);
  const d2 = await h.next("dev"), c2 = await h.next("cli");
  assert.equal(d2.taskId, "D2"); assert.equal(c2.taskId, "C2");
  await Promise.all([h.report("dev", d2), h.report("cli", c2)]);
  assert.equal((await h.next("cli")).waiting, true);
  const q3 = await h.next("qa"); assert.equal(q3.taskId, "Q3");
  await h.report("qa", q3);
  const c3 = await h.next("cli"); assert.equal(c3.taskId, "C3");
  await h.report("cli", c3);
  const state = await h.snapshot();
  assert.equal(state.runs.length, 9);
  assert.ok(Object.values(state.progress).every(row => row.status === "completed"));
  assert.ok(state.runs.every(row => row.phase === "finished"));
  assert.equal(h.sent.length, 8); // 仍有委托消息，减少的是Lead逐阶段工具往返。
  assert.equal(h.sent.filter(row => row.taskId === "Q3").length, 1);
});

test("默认手动：未启用时首次与跨执行者派发仍由Lead完成", async t => {
  const h = await setup(t, [task("A", "dev"), task("B", "qa", ["A"])], ["dev", "qa"], false);
  assert.equal((await h.next("qa")).waiting, true);
  await h.manage({ action: "dispatch", target: "dev" });
  await h.report("dev", await h.next("dev"));
  assert.equal(h.sent.length, 1);
  assert.equal((await h.next("qa")).waiting, true);
  assert.equal((await h.status()).autoDispatch, false);
});

test("通用执行者：非等待成员的全局建议不阻塞已等待成员领取无owner任务", async t => {
  const h = await setup(t, [task("A", "dev"), { id: "B", dependsOn: ["A"] }]);
  const a = await h.next("dev"); await h.next("qa");
  await h.report("dev", a);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].target, "qa");
  assert.equal((await h.next("qa")).taskId, "B");
});

test("晚登记成员：自动模式首次next可领取现已就绪任务，不需要补发通知", async t => {
  const h = await setup(t, [task("A", "dev"), task("B", "qa", ["A"])]);
  await h.report("dev", await h.next("dev"));
  assert.equal(h.sent.length, 0);
  const b = await h.next("qa"); assert.equal(b.taskId, "B");
  assert.equal(h.sent.length, 0);
  assert.equal((await h.snapshot()).runs.length, 2);
});

test("暂停/授权/验收保留：resume后才发送已接受产物与已授权任务", async t => {
  const h = await setup(t, [
    task("A", "dev", [], { review: true, outputs: ["api"] }),
    task("B", "qa", [{ taskId: "A", output: "api" }]),
    task("C", "cli", [], { approval: true })
  ], ["dev", "qa", "cli"]);
  const a = await h.next("dev");
  await h.next("qa"); await h.next("cli");
  await h.report("dev", a, "checkpoint", { api: "api.md" });
  assert.equal(h.sent.length, 0);
  await h.manage({ action: "pause" });
  await h.manage({ action: "accept", target: "A", output: "api" });
  await h.manage({ action: "approve", target: "C" });
  assert.equal(h.sent.length, 0);
  await h.manage({ action: "resume" });
  assert.deepEqual(h.sent.map(row => row.taskId).sort(), ["B", "C"]);
});

test("资源释放唤醒其他成员，但失败任务不自动重试", async t => {
  const h = await setup(t, [task("A", "dev", [], { resources: ["src"] }), task("B", "qa", [], { resources: ["src/file.js"] })]);
  const a = await h.next("dev");
  assert.equal((await h.next("qa")).waiting, true);
  assert.equal(h.sent.length, 0);
  await h.report("dev", a, "failed");
  assert.equal(h.sent[0].taskId, "B");
  await h.manage({ action: "resume" });
  const state = await h.snapshot();
  assert.equal(state.progress.A.status, "failed");
  assert.equal(state.runs.filter(row => row.taskId === "A").length, 1);
});

test("发送unknown不重发，上游已完成不会因唤醒失败被改成失败", async t => {
  const h = await setup(t, [task("A", "dev"), task("B", "qa", ["A"])]);
  const a = await h.next("dev"); await h.next("qa");
  h.sendHook(async () => { throw new Error("网络结果未知"); });
  const completed = await h.report("dev", a);
  assert.equal(completed.state.status, "completed");
  assert.equal(completed.wakeups.dispatched[0].phase, "unknown");
  await h.status(); await h.manage({ action: "resume" });
  assert.equal(h.sent.length, 1);
  assert.equal((await h.snapshot()).runs.find(row => row.taskId === "B").phase, "unknown");
});

test("交付唤醒与next同时发生只保留一个下游run", async t => {
  const h = await setup(t, [task("A", "dev"), task("B", "qa", ["A"])]);
  const a = await h.next("dev"); await h.next("qa");
  await Promise.all([h.report("dev", a), h.next("qa")]);
  const b = await h.next("qa"); assert.equal(b.taskId, "B");
  const state = await h.snapshot();
  assert.equal(state.runs.filter(row => row.taskId === "B").length, 1);
  assert.ok(h.sent.length <= 1);
});

test("等待成员卸载：live等待清理，通过持久名恢复同一session继续，不spawn", async t => {
  const h = await setup(t, [task("A", "dev"), task("B", "qa", ["A"])]);
  const a = await h.next("dev"); await h.next("qa");
  h.unload("qa");
  const idle = await h.status();
  assert.deepEqual(idle.waitingAgents, []);
  assert.deepEqual(idle.inactiveWaitingAgents, ["qa"]);
  h.sendHook(async message => { if (message.target === "qa") h.resume("qa"); });
  await h.report("dev", a);
  assert.equal(h.sent.length, 1);
  const b = await h.next("qa"); assert.equal(b.taskId, "B");
  await h.report("qa", b);
  assert.equal((await h.snapshot()).runs.length, 2);
  assert.deepEqual((await h.status()).inactiveWaitingAgents, []);
});

test("原持久成员已失效时明确报告，不伪造发送或创建替代session", async t => {
  const h = await setup(t, [task("A", "dev"), task("B", "qa", ["A"])]);
  const a = await h.next("dev"); await h.next("qa");
  h.unload("qa"); h.removeMember("qa");
  const result = await h.report("dev", a);
  assert.equal(result.state.status, "completed");
  assert.equal(result.wakeups.errors.length, 1);
  assert.equal(h.sent.length, 0);
  assert.equal((await h.snapshot()).progress.B.status, "pending");
});

test("Lead不再存活时不以旧对象自动派发，释放后不留后台唤醒任务", async t => {
  const h = await setup(t, [task("A", "dev"), task("B", "qa", ["A"])]);
  const a = await h.next("dev"); await h.next("qa");
  h.live.splice(h.live.indexOf(h.lead), 1);
  await h.report("dev", a);
  assert.equal(h.sent.length, 0);
  assert.equal((await h.snapshot()).progress.B.status, "pending");
  await h.dispose();
  assert.equal(h.sent.length, 0);
});
