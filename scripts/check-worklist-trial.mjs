// 材料检查只在内存推演计划，不向运行state写入任何完成事实。
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalize, initial } from "../dist/core/model.js";
import { diagnose, plan } from "../dist/core/planner.js";
import { renderGraph } from "../dist/ui/graph.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trial = process.argv[2] ?? "worklist-02";
if (!["worklist-02", "worklist-03"].includes(trial)) throw new Error("未知试用材料");
const project = normalize(JSON.parse(await readFile(join(root, `fixtures/trials/${trial}/tasks.json`), "utf8")));
assert.deepEqual(diagnose(project), []);
assert.equal(project.tasks.length, 9);
assert.equal(project.agents.length, 3);
const state = initial(project), checks = [];
const expected = (name, ready) => {
  const p = plan(state);
  assert.deepEqual([...p.ready].sort(), [...ready].sort(), name);
  checks.push({ name, ready: p.ready, segments: p.segments });
  return p;
};
const complete = id => {
  state.progress[id].status = "completed";
  for (const name of project.tasks.find(task => task.id === id).outputs) {
    state.progress[id].outputs[name] = { accepted: true, reference: "仅内存推演，不是实际交付" };
  }
};
const first = expected("initial", ["P1"]);
complete("P1");
const fork = expected("contract-delivered", ["D1", "C1", "Q1"]);
assert.equal(fork.segments.length, 3, "三条线资源应可同时推进");
complete("D1"); complete("C1");
expected("tests-not-ready", ["Q1"]);
complete("Q1");
expected("first-regression", ["Q2"]);
state.progress.Q2.status = "failed";
expected("report-not-delivered", []);
complete("Q2");
const repair = expected("report-delivered-not-product-pass", ["D2", "C2"]);
assert.equal(repair.segments.length, 2);
complete("D2");
expected("cli-fix-not-ready", ["C2"]);
complete("C2");
expected("final-regression", ["Q3"]);
state.progress.Q3.status = "failed";
expected("final-failure-blocks-readme", []);
complete("Q3");
expected("final-success-unlocks-readme", ["C3"]);
complete("C3");
expected("finished", []);
for (const task of project.tasks) for (const resource of task.resources) {
  if (resource.mode === "write") assert.ok(resource.path.startsWith(`.scheduler/trials/${trial}/`));
}
assert.deepEqual(plan(initial(project)), first, "推演不能改变输入或初始状态");
await mkdir(join(root, ".scheduler"), { recursive: true });
const report = {
  checkedAt: new Date().toISOString(), kind: "material-only-virtual-plan",
  actualTrialStarted: false, tasks: 9, agents: 3, diagnostics: [], checks
};
await writeFile(join(root, `.scheduler/${trial}-material-check.json`), JSON.stringify(report, null, 2) + "\n");
await writeFile(join(root, `.scheduler/${trial}-plan.html`), renderGraph(initial(project)));
console.log(JSON.stringify({ tasks: 9, agents: 3, checks: checks.length, actualTrialStarted: false,
  report: `.scheduler/${trial}-material-check.json`, graph: `.scheduler/${trial}-plan.html` }, null, 2));
