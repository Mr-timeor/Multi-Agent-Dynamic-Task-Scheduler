#!/usr/bin/env node
import { readFile, writeFile, mkdir, open } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { normalize, initial } from "./core/model.js";
import { diagnose, plan } from "./core/planner.js";
import { renderGraph } from "./ui/graph.js";

const [command = "help", input, output] = process.argv.slice(2);
try {
  if (command === "plan" || command === "graph" || command === "demo") {
    const path = resolve(input ?? "fixtures/development.json");
    const project = normalize(JSON.parse(await readFile(path, "utf8")));
    const errors = diagnose(project);
    if (errors.length) throw new Error(errors.join("\n"));
    const state = initial(project);
    if (command === "plan") console.log(JSON.stringify(plan(state), null, 2));
    else {
      const out = resolve(output ?? ".scheduler/flow.html");
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, renderGraph(state));
      console.log(`流程图：${out}`);
      if (command === "demo") {
        // 演示只生成方案与图，不伪造真实开发结果。
        console.log(JSON.stringify(plan(state), null, 2));
      }
    }
  } else if (command === "init") {
    if (!input || !output) throw new Error("用法：init <任务JSON> <新状态文件>");
    const project = normalize(JSON.parse(await readFile(input, "utf8")));
    const errors = diagnose(project);
    if (errors.length) throw new Error(errors.join("\n"));
    // init 不应悄悄采用或覆盖已有项目。
    await mkdir(dirname(resolve(output)), { recursive: true });
    const handle = await open(output, "wx");
    try { await handle.writeFile(JSON.stringify(initial(project), null, 2)); await handle.sync(); }
    finally { await handle.close(); }
    console.log(`已初始化 ${resolve(output)}`);
  } else if (command === "status" || command === "export") {
    if (!input) throw new Error("需要状态文件");
    // 查询不打开写者，也不改变重启状态。
    const state = JSON.parse(await readFile(input, "utf8"));
    if (command === "status") console.log(JSON.stringify(plan(state), null, 2));
    else {
      const out = resolve(output ?? ".scheduler/flow.html");
      await mkdir(dirname(out), { recursive: true }); await writeFile(out, renderGraph(state)); console.log(out);
    }
  } else console.log("命令：plan <任务JSON> | graph <任务JSON> [HTML] | demo | init <任务JSON> <状态JSON> | status <状态JSON> | export <状态JSON> [HTML]");
} catch (error) { console.error(String(error)); process.exitCode = 1; }
