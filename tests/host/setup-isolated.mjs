// 创建隔离 DSH_HOME（不触碰真实 profile），用于真实宿主加载与闭环验证。
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const isolated = join(root, ".harness-isolated");
const home = join(isolated, "home");
const probeUrl = mode => pathToFileURL(join(root, "tests", "host", `probe${mode}.mjs`)).href;

async function createProfile(name, { loop, wake = false }) {
  const profile = join(home, "profiles", name);
  const modules = join(profile, "node_modules");
  const projectFile = join(isolated, wake ? "project-wake.json" : loop ? "project-loop.json" : "project.json");
  const stateFile = join(isolated, wake ? "state-wake.json" : loop ? "state-loop.json" : "state.json");
  await rm(profile, { recursive: true, force: true });
  await mkdir(modules, { recursive: true });
  const bundleSource = process.env.SCHEDULER_BUNDLE_DIR || join(root, "harness", "bundle");
  await cp(bundleSource, join(modules, "dynamic-task-scheduler"), { recursive: true });
  await cp(join(root, "fixtures", wake ? "wakeup.json" : "development.json"), projectFile);
  await rm(stateFile, { force: true });

  await writeFile(join(profile, "package.json"), JSON.stringify({
    name: `dsh-profile-${name}`,
    private: true,
    dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "dynamic-task-scheduler"] } }
  }, null, 2) + "\n", "utf8");
  await writeFile(join(profile, "cordis.yml"), "[]\n", "utf8");

  const rows = [];
  if (loop) {
    rows.push(`- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      mock:
        displayName: Mock
        api: openai-completions
        baseURL: '__MOCK_BASE_URL__'
        apiKeyEnv: MOCK_API_KEY
        models:
          - id: mock-model
            name: Mock
            contextWindow: 128000
            maxTokens: 4096
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: mock
    model: mock-model
`);
  }
  rows.push(`- insert:
    - id: agent-team
      name: '@deepseek-ai/dsh-experimental-agent-team'
      config:
        maxMembers: 8
        maxTasks: 256
        maxMessageBytes: 65536
        disposalTimeoutMs: 5000
    - id: scheduler-probe
      name: '${probeUrl(wake ? "-wake" : loop ? "-loop" : "")}'
- id: dynamic-task-scheduler
  disabled: false
  config:
    leadSessionId: auto
    autoDispatch: ${wake}
    projectFile: '${projectFile.replaceAll("\\", "/")}'
    stateFile: '${stateFile.replaceAll("\\", "/")}'
`);
  await writeFile(join(profile, "cordis.patch.yml"), rows.join(""), "utf8");
  return { profile, projectFile, stateFile };
}

const normal = await createProfile("scheduler-test", { loop: false });
const loop = await createProfile("scheduler-loop", { loop: true });
const wake = process.env.SCHEDULER_WAKE_TEST === "1"
  ? await createProfile("scheduler-wake", { loop: true, wake: true }) : undefined;
console.log(JSON.stringify({ home, normal, loop, ...(wake ? { wake } : {}) }, null, 2));
