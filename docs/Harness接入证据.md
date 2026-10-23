# Harness 接入证据

版本：0.5，2026-10-21。0.4 完成隔离宿主与 mock 闭环；0.5 补充真实 desktop profile 热加载、完整重启后的复验结果。未调用真实模型。

## 1 来源与结论层级

| 来源 | 可采用结论 | 边界 |
|---|---|---|
| 此前本会话直接检查桌面 app.asar | headless 0.2.1-rc.2 有 session-id 接口与接管限制；占用不自动排队 | 静态核查，不是运行通过 |
| 用户转交 DS 的四份源码报告 | agent-team 持久成员、公开服务、Lead 绑定、任务板与投影机制 | 本会话未独立复核，未运行验收 |
| 用户本轮明确的最新核查 | 消息无幂等、无自动重发、不去重、无跨目标顺序；工具层不回传 messageId | 作为当前适配约束；不与服务内部可能存在的标识混淆 |
| 用户提供的新存储线索 | 原生 roster/task 事件追加 Lead 日志，flush 后返回，由投影和缓存重建 | 不证明自定义 scheduler/* 事件也能可靠权威回放 |

原始 DS 附件位于本机 Codex attachments 下，ID 分别为 `9922c7b5-27a2-4197-a271-40b6dac9ce61`、`8c0c8862-13b8-4ea1-aca5-d65e496c2ac7`、`64fdb3f3-011d-4529-9f5e-db618f038f3e`、`af9b1398-33c8-46a7-9a63-f5df42bb5787`。最新三项纠正与存储探针要求来自本聊天用户消息。旧报告的双板建议已被否决。

## 2 首版采用的边界

- Team 绑定 Lead，非 Lead 无法承担 spawn/interrupt；首版一个调度会话，不设计跨会话接管。
- 每次委托使用插件自身 dispatchId、attemptId、permitId；执行者回执，未知结果人工对账，不依赖宿主 messageId。
- 复用公开成员与通信服务，自建任务状态。原生任务板的 CAS、DAG 和投影有价值，但验收、许可、attempt、资源占用语义不匹配，因此不采用。
- 同进程可并发，但共享 checkout 的 writeScopes 不是强制文件隔离。实际并发与回传量未实测。
- 公开工具注册可提供合法 live Agent caller 的报告，尚需确认调用生命周期；不能推定后台任意时刻都有合法 caller。

## 3 版本记录与待核查

此前核查归档：`D:\deepseek-harness\desktop\resources\app.asar`，182794869 字节，SHA256：

`47874618BF5B3011FCAAC10CD4C85F69DA333E70D4F99B921207C78D0999512A`

归档内 headless 为 0.2.1-rc.2；profiles/node_modules 旧链接包为 0.1.0-rc.6。当前 profile 的实际解析已在第 6 节用运行中的桌面宿主和隔离 profile 复核。新 profile 不等于完全隔离；sessions、storage 之外的附件、设置和全局 patch 仍须列明。配置导出命令未在本轮执行。

后续核查版本、公开调用入口、隔离写入位置和命令输出敏感性。新 profile 不等于完全隔离；sessions、storage 之外的附件、设置和全局 patch 仍须列明。配置导出命令未在本轮执行。

## 4 T-002b 存储探针

T-003 比较独立文件、ctx.storage、Lead 日志 scheduler/* 事件加投影三个选项。默认基线仍是单写者文件；第三项不预定通过。

探针必须证明：自定义事件可权威回放；压缩和检查点后关键状态仍可重建；日志增长与上下文、回放成本可接受。不能把 ignorable 兼容机制直接等同于可靠存储，也不能把原生事件的 flush 保证直接套到未验证的外部事件。

若选用日志，它承载插件自己的调度语义，不意味着复用原生任务板。若不通过，保留文件方案，不新增双权威同步。

## 5 headless 历史备选

既往静态检查发现 preset、子／派生关系、cwd 和写入占用限制；原报告中的任意 GUI 会话接管、同会话自动排队和每回合一次请求均不能采用。headless 不再是首版前置，详细旧核查保留在 Git 历史。

本节调查当时没有模型调用或运行验收。后续探针按明确范围安排，不使用真实旧会话作为默认试验对象。按2026-10-22决定，用量只记录，不要求预算上限；保留无进展停止、未知投递不重发等防循环规则。

## 2026-10-20 本次直接静态复核

读取`D:\deepseek-harness\desktop\resources\app.asar`中的实际JS，不启动DSH、不解析用户凭据。核对包内agent-team版本0.2.1-rc.2及以下源码：

- `dsh/node_modules/@deepseek-ai/dsh-experimental-tool-agent-team/lib/index.js`：通过`defineTool`注册，执行签名为`execute(args, exec)`，caller来自`exec.agent`；消息工具仅返回`{sent:true}`。
- `dsh/node_modules/@deepseek-ai/dsh-experimental-agent-team/lib/index.js`：tryMembership返回root、name、role；caller须为当前agents服务中的live对象；spawn/interrupt要求Lead；send和spawn接收signal。
- `dsh/node_modules/@deepseek-ai/dsh-experimental-agent-team-profile/cordis.patch.yml`：列出agent-team、tool-agent-team、ui-agent-team及spawn/fork provider。

这纠正了将工具执行签名误记成上下文优先的可能性。实现采用真实签名；新成员使用fresh上下文。每个root对应不同团队，因此适配层明确限定leadSessionId。

本地adapter模拟验证工具注册、Lead委托、成员领取、提交、连续领取和拒绝跨团队调用。模拟不加载真实defineTool/schema，不代表真实宿主加载通过。

未核实：当前profile最终包解析、无活跃turn的后台调用、真实成员恢复、Lead轨迹回灌、自定义日志权威回放、宿主UI挂载。旧的“本轮未重查”描述仅对应此前文档轮次，以本节更新为准。

## 6 实际宿主加载与隔离闭环（0.5）

### 6.1 运行版本与入口

直接读取运行中的桌面宿主进程命令行：进程以 `D:\deepseek-harness\desktop\resources\app.asar\dsh` 为 checkout，加载 `@deepseek-ai/dsh-desktop-host` 并传入 `C:\Users\唐思勉\.dsh\profiles\desktop`。`resources\runtime\primary-runtime\runtime.json` 的 `desktopVersion` 为 `0.2.1-rc.2`，Node 24.21.0。

从安装内 `app.asar/dsh/node_modules` 核对的版本：

| 包 | 版本 | 用途 |
|---|---|---|
| @deepseek-ai/dsh | 0.2.1-rc.2 | CLI/宿主 |
| @deepseek-ai/dsh-base | 0.2.1-rc.2 | profile 基础 bundle |
| @deepseek-ai/dsh-tools | 0.2.1-rc.2 | defineTool 与工具注册 |
| @deepseek-ai/dsh-experimental-agent-team | 0.2.1-rc.2 | 成员与消息服务 |
| @deepseek-ai/schemastery | 3.18.5 | Config 与宿主内部 schema |

`profiles\desktop\package.json` 的 bundles 为 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 和两个皮肤；**不含 agent-team**。共享的 `profiles\node_modules\@deepseek-ai` 是 0.1.0-rc.6 旧 CLI 树。桌面 bundle 解析安装优先；插件层 `routeScoped` 只沿 profile 目录内的 node_modules 查找，`profiles\node_modules` 在该 localPrefix 之外会被停止遍历，然后回落到安装内 0.2.1-rc.2。仓库里额外把真实共享树挂到隔离 home 复测，基本探针仍通过；不要以旧树版本推断插件导入版本。

### 6.2 插件入口与依赖解析

插件入口必须是一个安装进 profile 的包：`package.json` 声明 `dsh.bundle.patch`，patch 插入 `name` 指向包内 `index.mjs`。实测：

- profile 的 `node_modules\dynamic-task-scheduler` 为普通目录或 junction（指向仓库 `harness\bundle`）时，`import '@deepseek-ai/schemastery'` 与 `'@deepseek-ai/dsh-tools'` 都由安装内 0.2.1-rc.2 解析，四个工具可注册。
- 直接把 patch 的 `name` 写成 profile 外的绝对 `file:///.../harness/bundle/index.mjs` 时，导入失败：`ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/schemastery'`。因此入口不能放在 profile 外裸加载；必须作为 profile 包安装（复制或链接均可）。
- `harness\bundle\dist` 由 `npm run build` 从 `dist` 复制；未构建时包内缺少核心模块。
- 把 bundle 加入 `dsh.profile.bundles` 后，bundle 自带的 `disabled: true` 行出现在合成树里；profile patch 用 `- id: dynamic-task-scheduler` + `disabled: false` + `config` 覆盖可启用。覆盖时不能写 `name`：bundle 行的 `./index.mjs` 已解析为绝对文件 URL，写 `dynamic-task-scheduler` 会报 `name mismatch ... skipping`。隔离 profile 已按“bundle 行 + 无 name 覆盖”复测通过。

### 6.3 接口不匹配与修正

用真实 0.2.1-rc.2 的 `defineTool` 验证，旧适配器有两处会直接失败：

1. `output.schema` 用了 `z.object({ result: z.string() })`。真实接口要求值 schema DSL；报错 `JsonSchemaError: unsupported JSON schema: schema must be a value schema object`。已改为普通对象 `{ type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } }`。
2. 可选参数写成 `required: false`。真实编译器只允许省略或 `true`；报错 `parameters.x.required must be true when present`。已改为可选参数不写 `required`。

其余签名与 0.2.1-rc.2 一致：`tryMembership(agent)` 返回 `{root, role, name}` 且要求 `agents.get(agent.id) === agent`；`spawnTeammate(caller, {name, description, prompt, context, provider, signal})`；`sendMessage(caller, {target, content, signal})`；`agent/created`、`agent/disposed` 与 `agent.ctx.tools.register` 的用法和官方 tool-agent-team 相同。模型侧消息前缀实测为 `Team message from lead:`，回执工具不依赖宿主 messageId。

### 6.4 隔离宿主结果

隔离 home 为仓库内 `.harness-isolated/home`，profile 为 `scheduler-test`（无模型）和 `scheduler-loop`（本地 OpenAI 兼容 mock）。两者都只加载 `dsh-base` + 显式插入的 `agent-team` 服务 + 本插件，未挂 `tool-agent-team`，因此没有原生 team_task_* 工具。

基本探针 `npm run test:host` 的结果：

- 真实宿主启动并加载插件；四个工具注册到真实 Lead Agent；
- `scheduler_status` 执行成功（5 个任务，revision 0）；`pause`/`resume` 写入 revision 1/2；
- 绑定 Lead 后新建的第二个 root 没有调度工具，直接用其身份执行被拒绝；
- 释放 Lead 后工具消失；根上下文释放后状态文件可重新打开（说明 store 已关闭）。

闭环探针 `npm run test:host:loop` 的结果：

- Lead 调 `scheduler_manage spawn developer`，再 `dispatch` A1；
- developer 首轮 `scheduler_next` 返回 `waiting`，收到派发后确认；提交 A1（含 `api` 产物）后继续 `scheduler_next` 领取 A2，再提交 A2；
- 状态历史为 `dispatch, acknowledge, completed, dispatch, acknowledge, completed`，runs 均为 finished；团队成员为 lead + developer；
- 释放 Agent 与根上下文后状态文件可重新打开。
- 该探针的模型端点是 `tests/host/mock-llm.mjs`，**没有真实模型调用或费用**；它验证协议与工具闭环，不验证真实模型行为。

### 6.4.1 真实 desktop profile（用户批准后）

用户批准后执行了真实安装；没有调用真实模型：

- `plugin_manager install_bundle` 安装 `harness/bundle`，返回 `application: applied`；`profiles/desktop/package.json` 的 bundles 增加 `dynamic-task-scheduler`，`node_modules/dynamic-task-scheduler` 为指向仓库 bundle 的 junction。
- 安装前备份 `cordis.patch.yml` 到 `C:\Users\唐思勉\.dsh\profiles\desktop\cordis.patch.yml.bak-before-scheduler-20261020-2338`。随后追加 agent-team 服务 insert，以及 `dynamic-task-scheduler` 的 `disabled: false` + 配置覆盖（不写 `name`）。
- HMR 随即生效：当前 GUI 会话的工具表出现四个 `scheduler_*` 工具。真实调用 `scheduler_status` 返回 revision 0、A1 ready；`pause`/`resume` 返回 revision 1/2；以 Lead 身份调用 `scheduler_next` 被拒绝并返回“Lead 请使用 scheduler_manage 派发”。`agent-team` 的 Config 行处于 active/schema 状态。
- 用真实 profile 的 package.json + patch 复制出 `desktop-cold` 做冷组合 `--dump-config`：bundle 行解析为包内绝对入口，`disabled: false` 与配置生效，agent-team 行存在。
- **2026-10-21 完整重启后复验**：用户完全退出并重启 Desktop，GUI 端口从 3521 变为 11999，确认是新宿主进程。指定调度会话中 `Tool.listTools` 仍列出四个 `scheduler_*` 工具；`scheduler_status` 返回 revision 2、A1 ready，说明 pause/resume 写入的状态在重启后保留；随后 `scheduler_next` 返回“Lead 请使用 scheduler_manage 派发”，确认当前会话是已绑定的 Lead，而不是普通成员。017 的“重启后仍可用”验收完成。
- **未执行**：真实模型 spawn/协作。真实专项成员尚未创建。

### 6.5 未验证

- 真实 DeepSeek 模型的协作质量、失败重试和成本；
- 真实会话重启后的成员恢复、Lead 轨迹回灌、投递 unknown 的人工对账；
- 现有 profile 是否已有其他原生任务板入口；本插件自身不挂 tool-agent-team。

### 6.6 复现

```powershell
npm ci
npm run build
npm test            # 14 项离线检查
npm run test:host   # 真实宿主加载、注册、身份、关闭；无模型请求
npm run test:host:loop  # 真实 agent-team 闭环 + 本地 mock
```

隔离报告落盘在 `.harness-isolated/`，不写入真实 profile；`mock-llm.log` 记录 mock 收到的请求决策。真实 profile 安装步骤见[使用与接入](使用与接入.md)。
## 2026-10-21 可选只读图入口

图使用独立可选view-bundle导出HTML，并沿用宿主Files／Document Preview；准确源码入口和开关依据见[只读图接入](只读图接入.md)。隔离真实宿主已验证加载、导出、随revision更新和释放清理，不创建Agent、没有模型请求；未安装到真实desktop profile。

独立浏览器双视图与搜索／缩放／选中保留、503后保留旧图已验证。原生Document Preview的文件变更刷新、双视图及交互开关仍须GUI验证，不能由隔离导出结果代替。
