import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initial, normalize } from "../dist/core/model.js";
import { readViewState } from "../dist/ui/snapshot.js";
import { FileStore } from "../dist/store/file-store.js";

test("图读取可与调配器同时使用，不改变运行或revision", async t => {
  const dir = await mkdtemp(join(tmpdir(), "scheduler-view-"));
  const path = join(dir, "state.json");
  const seed = initial(normalize({ agents: [{ id: "dev" }], tasks: [{ id: "a" }] }));
  seed.runs.push({ taskId: "a", agentId: "dev", phase: "active", startedAt: 1,
    attemptId: "a", dispatchId: "d", permitId: "p" });
  const store = await FileStore.open(path, seed);
  t.after(async () => { await store.close(); await rm(dir, { recursive: true, force: true }); });
  const before = await readFile(path, "utf8");
  const [a, b] = await Promise.all([readViewState(path), readViewState(path)]);
  assert.deepEqual(a, b);
  assert.equal(a.runs[0].phase, "active");
  assert.equal(await readFile(path, "utf8"), before);
});

test("未开始项目可只读预览，坏状态不会被输入文件掩盖", async t => {
  const dir = await mkdtemp(join(tmpdir(), "scheduler-view-preview-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const projectFile = join(dir, "project.json"), stateFile = join(dir, "state.json");
  await writeFile(projectFile, JSON.stringify({ agents: [], tasks: [{ id: "a" }] }));
  assert.equal((await readViewState(stateFile, projectFile)).revision, 0);
  await assert.rejects(readFile(stateFile), { code: "ENOENT" });
  await writeFile(stateFile, "bad state");
  await assert.rejects(readViewState(stateFile, projectFile));
});
