import { readFile } from "node:fs/promises";
import { join } from "node:path";

// 开发入口位于harness/，发布副本才放入可被宿主安装的bundle目录。
export async function adapterSource(root) {
  return (await readFile(join(root, "harness/adapter.mjs"), "utf8"))
    .replaceAll('from "../dist/', 'from "./dist/');
}
