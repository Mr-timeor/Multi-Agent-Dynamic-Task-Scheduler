import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initial, normalize } from "../dist/core/model.js";
import { startViewExport } from "../dist/ui/export-view.js";

test("宿主图导出跟随原子替换，双视图读取同revision，关闭后不再写入", async t => {
  const dir = await mkdtemp(join(tmpdir(), "scheduler-view-export-"));
  const stateFile = join(dir, "state.json"), graphFile = join(dir, "flow.html");
  const state = initial(normalize({ agents: [], tasks: [{ id: "a" }] }));
  await writeFile(stateFile, JSON.stringify(state));
  const exporter = await startViewExport({ stateFile, graphFile });
  t.after(async () => { await exporter.close(); await rm(dir, { recursive: true, force: true }); });
  const original = await readFile(stateFile, "utf8");
  assert.match(await readFile(graphFile, "utf8"), /revision 0/);
  assert.equal(await readFile(stateFile, "utf8"), original);
  state.revision = 3; state.progress.a.status = "completed";
  await writeFile(stateFile + ".tmp", JSON.stringify(state)); await rename(stateFile + ".tmp", stateFile);
  const until = Date.now() + 3000;
  while (!(await readFile(graphFile, "utf8")).includes("revision 3")) {
    if (Date.now() > until) assert.fail("文件监听没有更新导出图");
    await new Promise(r => setTimeout(r, 30));
  }
  const views = await Promise.all([readFile(graphFile, "utf8"), readFile(graphFile, "utf8")]);
  assert.equal(views[0], views[1]); assert.match(views[0], /已完成/);
  await writeFile(stateFile, "broken");
  await assert.rejects(exporter.refresh());
  assert.equal(await readFile(graphFile, "utf8"), views[0]);
  await exporter.close();
  state.revision = 4; await writeFile(stateFile, JSON.stringify(state)); await exporter.refresh();
  assert.equal(await readFile(graphFile, "utf8"), views[0]);
});

test("图输出不能覆盖权威状态", async t => {
  const dir = await mkdtemp(join(tmpdir(), "scheduler-view-path-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(startViewExport({ stateFile: join(dir, "state.json"), graphFile: join(dir, "state.json") }), /不能覆盖/);
});
