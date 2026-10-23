import { mkdir, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Windows沙箱的系统临时目录可能拒绝rename，文件用例在项目内独立临时目录运行。
const temp = join(root, ".scheduler", "tests-tmp");
await mkdir(temp, { recursive: true });
const tests = (await readdir(join(root, "tests"))).filter(p => p.endsWith(".test.mjs")).sort().map(p => join(root, "tests", p));
const child = spawn(process.execPath, ["--test", ...tests], {
  cwd: root, stdio: "inherit", env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp }
});
child.on("error", error => { console.error(error); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
