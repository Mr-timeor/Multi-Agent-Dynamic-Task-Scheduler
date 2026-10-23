import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideWake } from "./host/mock-llm.mjs";
import { probePassed, saveProbeReport } from "./host/probe-result.mjs";

test("Lead完成通知可产生文字回合，但mock不让Lead调用调度工具", () => {
  const decision = decideWake([{ role: "user", content: "Background subagent tester finished" }]);
  assert.equal(decision.tool, undefined);
  assert.equal(typeof decision.text, "string");
  const member = decideWake([{ role: "user", content: "你是专项执行者。" }]);
  assert.equal(member.tool, "scheduler_next");
});

test("探针以本次JSON与清理结果判定；errors非空不能被退出码0掩盖", async t => {
  const folder = await mkdtemp(join(tmpdir(), "wake-report-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const ok = { runId: "one", reopened: true, cleanupErrors: [], result: { steps: [{ name: "complete" }], errors: [] } };
  assert.equal(probePassed(ok), true);
  assert.equal(probePassed({ ...ok, result: { steps: [], errors: [] } }), false);
  assert.equal(probePassed({ ...ok, cleanupErrors: ["释放失败"] }), false);
  const failure = await saveProbeReport(join(folder, "report.json"), { ...ok, result: { steps: [], errors: ["唤醒失败"] } });
  assert.equal(failure.passed, false);
  assert.equal(JSON.parse(await readFile(join(folder, "report.json"), "utf8")).passed, false);
  await assert.rejects(saveProbeReport(join(folder, "report.json"), ok), /EEXIST/);
});
