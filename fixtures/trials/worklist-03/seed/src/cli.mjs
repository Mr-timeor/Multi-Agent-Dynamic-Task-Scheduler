import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { selectTasks } from "./worklist.mjs";

// 旧CLI仅接受位置文件名并输出JSON；由CLI执行者升级。
export async function main(args = process.argv.slice(2)) {
  const tasks = JSON.parse(await readFile(args[0], "utf8"));
  console.log(JSON.stringify(selectTasks(tasks)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
