import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { simulate, scenario, policies, auditTrace } = await import(pathToFileURL(resolve(process.env.SCHEDULER_TEST_DIST ?? "dist", "benchmark/simulate.js")).href);
const specs = await Promise.all((await readdir("fixtures/benchmarks")).filter(f => f.endsWith(".json")).sort().map(async file =>
  scenario(JSON.parse(await readFile(resolve("fixtures/benchmarks", file), "utf8")))));
const get = name => specs.find(s => s.project.name === name);

test("合成基线：四策略同一事件输入、全部交付，容量账与轨迹可复现", () => {
  for (const spec of specs) for (const policy of policies) {
    const actual = simulate(spec, policy);
    assert.deepEqual(actual, simulate(spec, policy), `${spec.name}/${policy} 不可复现`);
    assert.equal(actual.completed, true); assert.deepEqual(actual.violations, []);
    assert.equal(actual.deliveries, spec.project.tasks.length);
    assert.equal(actual.outputDeliveries, spec.project.tasks.reduce((sum, task) => sum + task.outputs.length, 0));
    assert.ok(Math.abs(actual.work + actual.overhead + actual.idle - actual.elapsed * spec.project.agents.length) < 1e-8);
    assert.ok(actual.blocked <= actual.idle);
    const sizes = new Map();
    for (const row of actual.trace.filter(e => e.event === "start")) sizes.set(row.batch, (sizes.get(row.batch) ?? 0) + 1);
    assert.ok([...sizes.values()].every(size => size <= spec.project.maxSegment));
  }
});
test("串行链：融合只减少新委托，领取和实际工作均不消失；零开销收益消失", () => {
  const spec = get("chain"), segment = simulate(spec, "segments"), single = simulate(spec, "per-task");
  assert.equal(segment.dispatches, 1); assert.equal(single.dispatches, 3);
  assert.equal(segment.claims, single.claims); assert.equal(segment.work, single.work);
  assert.ok(Math.abs(segment.makespan - 10.2) < 1e-8); assert.equal(single.makespan, 12);
  const zero = { ...spec, dispatchOverhead: 0, continuationOverhead: 0 };
  assert.deepEqual(policies.map(p => simulate(zero, p).makespan), [9, 9, 9, 9]);
});
test("中间交付：每种策略在接口验收后启动下游，无需等待整任务", () => {
  const spec = get("checkpoint");
  for (const policy of policies) {
    const rows = simulate(spec, policy).trace;
    const start = rows.find(e => e.event === "start" && e.taskId === "Q1");
    const accepted = rows.find(e => e.event === "accept-output" && e.taskId === "A1");
    const completed = rows.find(e => e.event === "completed" && e.taskId === "A1");
    assert.equal(accepted.at, 4); assert.equal(start.at, accepted.at); assert.ok(start.at < completed.at);
  }
});
test("授权与失败：每条基线等同一授权事件，失败和重试代价保留", () => {
  for (const policy of policies) {
    const actual = simulate(get("approval-failure"), policy);
    assert.equal(actual.failures, 1); assert.equal(actual.rework, 2); assert.equal(actual.claims, 4);
    assert.equal(actual.trace.find(row => row.event === "start").at, 4);
    const failed = actual.trace.find(row => row.event === "failed"), retry = actual.trace.find(row => row.event === "retry");
    assert.equal(retry.at - failed.at, 2);
  }
});
test("类别整包遇到同一执行者的跨类别依赖会让出，不能靠挂住任务制造劣势", () => {
  const spec = scenario({ name: "单执行者跨类别", project: {
    agents: [{ id: "one" }], tasks: [
      { id: "A1", category: "a" }, { id: "A2", category: "a", dependsOn: ["B1"] },
      { id: "B1", category: "b", dependsOn: ["A1"] }
    ] }, timing: { A1: { duration: 1 }, A2: { duration: 1 }, B1: { duration: 1 } } });
  assert.equal(simulate(spec, "category").completed, true);
});
test("独立轨迹审计抓住提前消费、未授权、资源/容量重叠", () => {
  const spec = get("approval-failure");
  const trace = [
    { at: 0, event: "start", taskId: "A1", agentId: "dev" },
    { at: 0, event: "start", taskId: "A2", agentId: "dev" }
  ];
  const faults = auditTrace(spec, trace).join("；");
  assert.match(faults, /未授权/); assert.match(faults, /提前消费/); assert.match(faults, /容量|重叠/);
  const resource = get("resources");
  assert.match(auditTrace(resource, [
    { at: 0, event: "start", taskId: "A1", agentId: "dev" },
    { at: 0, event: "start", taskId: "Q1", agentId: "qa" }
  ]).join("；"), /资源重叠/);
});
test("输入没有合成耗时或失败同时提前交付时明确拒绝，不补零秒或吞掉返工", () => {
  assert.throws(() => scenario({ project: { tasks: [{ id: "a" }], agents: [] } }), /缺少合成耗时/);
  const spec = structuredClone(get("checkpoint")); spec.timing.A1.failedAttempts = [1];
  assert.throws(() => scenario(spec), /失败任务暂不支持提前交付/);
});
test("解锁排序收益可与委托开销分开；缺少执行者时保留未完成而非记成零时长", () => {
  const spec = { ...get("unlock-order"), dispatchOverhead: 0, continuationOverhead: 0 };
  assert.ok(simulate(spec, "segments").makespan < simulate(spec, "topological").makespan);
  const unavailable = scenario({ ...get("chain"), project: { ...get("chain").project, agents: [] } });
  const result = simulate(unavailable, "segments");
  assert.equal(result.completed, false); assert.equal(result.makespan, null); assert.equal(result.unfinished.length, 3);
});
