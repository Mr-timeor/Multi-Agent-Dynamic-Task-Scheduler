// 只复制试用起点，不改DSH配置、不启动模型、不创建调度运行状态。
import { cp, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const source = dirname(fileURLToPath(import.meta.url));
const root = resolve(source, "../../..");
const runtime = join(root, ".scheduler/trials/worklist-03");

try {
  await mkdir(dirname(runtime), { recursive: true });
  // 不覆盖旧轮次；中途失败也保留已复制内容，不能用重新准备抹掉证据。
  await mkdir(runtime);
  await cp(join(source, "seed"), join(runtime, "app"), { recursive: true });
  for (const folder of ["notes", "evidence/initial", "evidence/final"]) {
    await mkdir(join(runtime, folder), { recursive: true });
  }
  await cp(join(source, "结果记录模板.md"), join(runtime, "result.md"));
  const result = {
    preparedAt: new Date().toISOString(), node: process.version,
    projectFile: join(source, "tasks.json"), runtime,
    app: join(runtime, "app"), stateFile: join(runtime, "state.json"),
    graphFile: join(runtime, "flow.html"), modelStarted: false
  };
  await writeFile(join(runtime, "preparation.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.code === "EEXIST"
    ? `试用目录已存在，保留原记录，不覆盖：${runtime}` : String(error));
  process.exitCode = 1;
}
