// 隔离宿主运行器：在独立 DSH_HOME 中真正启动 profile。
// basic：真实 tools 注册 + 真实 Agent 身份，不发模型请求。
// loop ：额外启动本地 OpenAI 兼容 mock，跑通 spawn/派发/领取/提交/继续领取。
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runProfile } from "file:///D:/deepseek-harness/desktop/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/lib/profile-boot.js";
import { loadLayeredEnv } from "file:///D:/deepseek-harness/desktop/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js";
import { FileStore } from "../../dist/store/file-store.js";
import { startMockLlm } from "./mock-llm.mjs";
import { saveProbeReport } from "./probe-result.mjs";

const loop = process.env.SCHEDULER_PROBE_MODE === "loop";
const wake = process.env.SCHEDULER_PROBE_MODE === "wake";
const profile = wake ? "scheduler-wake" : loop ? "scheduler-loop" : "scheduler-test";
const stateFile = process.env.SCHEDULER_PROBE_STATE
  ?? fileURLToPath(new URL(wake ? "../../.harness-isolated/state-wake.json" : loop ? "../../.harness-isolated/state-loop.json" : "../../.harness-isolated/state.json", import.meta.url));
const patchFile = fileURLToPath(new URL(`../../.harness-isolated/home/profiles/${profile}/cordis.patch.yml`, import.meta.url));

let mock;
let booted;
let result = { steps: [], errors: [] };
let reopened = false;
const cleanupErrors = [];
const runId = process.env.SCHEDULER_HOST_RUN_ID || randomUUID();
const reportFile = process.env.SCHEDULER_HOST_REPORT
  || fileURLToPath(new URL(`../../.scheduler/host-reports/${runId}/report.json`, import.meta.url));
const output = dirname(reportFile);
const logFile = fileURLToPath(new URL(wake ? "../../.harness-isolated/mock-wake.log" : "../../.harness-isolated/mock-llm.log", import.meta.url));
await mkdir(output, { recursive: true });
try {
  if (loop || wake) {
    await writeFile(logFile, "", "utf8");
    mock = await startMockLlm(logFile, { wake });
    const patch = await readFile(patchFile, "utf8");
    await writeFile(patchFile, patch.replace("__MOCK_BASE_URL__", mock.url), "utf8");
    process.env.MOCK_API_KEY = "mock";
  }

  booted = await runProfile({
    environment: loadLayeredEnv("dsh"),
    profile,
    patchFiles: [],
    args: []
  });
  const probe = wake ? globalThis.__schedulerWakeProbe : loop ? globalThis.__schedulerLoopProbe : globalThis.__schedulerProbe;
  if (!probe) throw new Error("探针未加载");
  result = await probe;
} catch (error) {
  console.error("HOST_PROBE_FAILED", error?.stack ?? error);
  result.errors.push(String(error?.stack ?? error));
}
// 先保存现场，再做释放/复开检查。失败run可能在FileStore.open时转unknown。
try { await copyFile(stateFile, join(output, "state-at-result.json")); }
catch (error) { cleanupErrors.push(`状态快照：${String(error)}`); }
try { await booted?.ctx.fiber.dispose(); }
catch (error) { cleanupErrors.push(`宿主清理：${String(error)}`); }
try { await mock?.close(); }
catch (error) { cleanupErrors.push(`mock清理：${String(error)}`); }
if (loop || wake) {
  try { await copyFile(logFile, join(output, "mock.jsonl")); }
  catch (error) { cleanupErrors.push(`mock快照：${String(error)}`); }
}
try { const store = await FileStore.open(stateFile); reopened = true; await store.close(); }
catch (error) { cleanupErrors.push(`状态复开：${String(error)}`); }
const report = await saveProbeReport(reportFile, {
  runId, mode: wake ? "wake" : loop ? "loop" : "basic", result, reopened, cleanupErrors,
  sourceBundle: process.env.SCHEDULER_BUNDLE_DIR || "harness/bundle",
  node: process.version, reportFile
});
console.log(JSON.stringify(report, null, 2));
process.exit(report.passed ? 0 : 1);
