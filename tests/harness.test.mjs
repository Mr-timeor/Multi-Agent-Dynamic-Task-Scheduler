import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { install } from "../harness/adapter.mjs";
import { FileStore } from "../dist/store/file-store.js";

function host() {
  const tools = new Map(), listeners = new Map(), sent = [];
  function agent(id) {
    const registrations = new Map(); tools.set(id, registrations);
    return { id, ctx: { tools: { register(tool) {
      registrations.set(tool.name, tool); return () => registrations.delete(tool.name);
    } } } };
  }
  const lead = agent("lead-session"), dev = agent("dev-session"), outsider = agent("other-session");
  const ctx = {
    agents: { list: () => [lead, dev, outsider] },
    agentTeams: {
      tryMembership: a => a === lead ? { root: lead, role: "lead", name: "lead" }
        : a === dev ? { root: lead, role: "teammate", name: "dev" } : { root: outsider, role: "lead", name: "lead" },
      sendMessage: async (caller, message) => { assert.equal(caller, lead); sent.push(message); },
      spawnTeammate: async () => { throw new Error("本场景没有启动模型"); }
    },
    on: (name, fn) => { listeners.set(name, fn); return () => listeners.delete(name); }
  };
  return { tools, listeners, sent, ctx, lead, dev, outsider, agent };
}

const mockHost = () => ({ defineTool: t => t, z: { object: t => t, string: () => "string" } });

test("模拟宿主：单Lead派发、专项回执与结果提交；其他团队和越权管理拒绝", async t => {
  const dir = await mkdtemp(join(tmpdir(), "scheduler-adapter-"));
  const h = host();
  const projectFile = join(dir, "project.json");
  await writeFile(projectFile, JSON.stringify({ agents: [{ id: "dev" }], tasks: [{ id: "a" }, { id: "b", dependsOn: ["a"] }] }));
  const dispose = install(h.ctx, { leadSessionId: h.lead.id, projectFile, stateFile: join(dir, "state.json") }, mockHost());
  const call = async (a, name, args = {}) => JSON.parse((await h.tools.get(a.id).get(name).execute(args, { agent: a, signal: new AbortController().signal })).result);
  t.after(async () => { await dispose(); await rm(dir, { recursive: true, force: true }); });

  assert.equal(h.tools.get(h.outsider.id).size, 0);
  await assert.rejects(call(h.dev, "scheduler_manage", { action: "pause" }), /仅限 Lead/);
  const d = await call(h.lead, "scheduler_manage", { action: "dispatch", target: "dev" });
  assert.equal(h.sent.length, 1);
  assert.ok(d.attemptId && d.permitId && d.dispatchId);
  await assert.rejects(call(h.dev, "scheduler_next", { dispatchId: "wrong" }), /不匹配/);
  const a = await call(h.dev, "scheduler_next");
  assert.equal(a.taskId, "a");
  assert.equal(a.phase, "active");
  await call(h.dev, "scheduler_report", { dispatchId: d.dispatchId, summary: "a完成" });
  const b = await call(h.dev, "scheduler_next");
  assert.equal(b.taskId, "b");
  await call(h.dev, "scheduler_report", { dispatchId: b.dispatchId, summary: "b完成" });
  const status = await call(h.lead, "scheduler_status");
  assert.equal(status.tasks.b.status, "completed");
  await assert.rejects(call(h.dev, "scheduler_next", { dispatchId: d.dispatchId }), /旧委托/);
  await assert.rejects(h.tools.get(h.lead.id).get("scheduler_manage").execute({ action: "pause" }, { agent: h.outsider }), /另一个 Lead/);

  await dispose();
  assert.equal(h.tools.get(h.lead.id).size, 0);
  assert.equal(h.tools.get(h.dev.id).size, 0);
  const reopened = await FileStore.open(join(dir, "state.json"));
  await reopened.close();
});

test("自动绑定：首个Lead绑定后其他root不可见，成员首轮只等待派发", async t => {
  const dir = await mkdtemp(join(tmpdir(), "scheduler-auto-"));
  const h = host();
  const projectFile = join(dir, "project.json");
  await writeFile(projectFile, JSON.stringify({ agents: [{ id: "dev" }], tasks: [{ id: "a" }] }));
  const dispose = install(h.ctx, { leadSessionId: "auto", projectFile, stateFile: join(dir, "state.json") }, mockHost());
  const call = async (a, name, args = {}) => JSON.parse((await h.tools.get(a.id).get(name).execute(args, { agent: a, signal: new AbortController().signal })).result);
  t.after(async () => { await dispose(); await rm(dir, { recursive: true, force: true }); });

  // auto 未绑定时四个工具只注册在 lead 角色上（含 outsider），成员不注册。
  assert.equal(h.tools.get(h.dev.id).size, 0);
  assert.equal(h.tools.get(h.outsider.id).size, 4);
  const first = await call(h.lead, "scheduler_status");
  assert.equal(first.revision, 0);
  assert.equal(h.tools.get(h.dev.id).size, 4);
  assert.equal(h.tools.get(h.outsider.id).size, 0);
  const waiting = await call(h.dev, "scheduler_next");
  assert.equal(waiting.waiting, true);
  assert.equal(h.tools.get(h.outsider.id).size, 0);
});
