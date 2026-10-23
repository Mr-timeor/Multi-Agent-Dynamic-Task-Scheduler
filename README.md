# Multi-Agent Dynamic Task Scheduler

面向 DeepSeek Harness 的开发、测试协作插件。一个 Lead 调度会话协调多个专项会话，核心可供其他平台复用。

**本地首版交付完成，012已关闭。32项本地检查、分发目录迁移运行，以及分发副本在Desktop 0.2.1-rc.2上的基础加载、mock协作闭环、只读图三项隔离验证通过。真实desktop已安装并完成重启和原生图预览验收；duration-01真实协作四项任务完成，B2测试8/8通过，011已关闭。用量只记录，不设预算门槛；保留防循环规则。尚未公开发布或证明真实效率提升。**

2026-10-24：**020已关闭**。隔离Wake及worklist-03通过：9项完成、两轮123/123、Lead手动dispatch0；6次消息唤醒及D1/Q2连续领取，同口径四段间隔合计4.954秒。配置恢复后完整重启，一次status确认原development/host-state正常、autoDispatch:false，保留新版安装，见[worklist-03评审](docs/worklist-03评审.md)。无真实产品修复，不作因果效率结论；不加轮询或预算门禁，首轮失败与原始证据保留。

## 现在可以做什么

- 输入任务 JSON，诊断循环和缺失前置，生成就绪任务、执行段、中间交付点及等待原因。
- 按依赖和文件／目录占用安排开发与测试；普通任务提交即完成，仅 `review: true` 等待验收。
- 保存项目状态、结果与重试记录；未知投递留待对账，不自动重复派发。
- 导出带类别泳道、执行者、执行段与交付点的只读流程图；支持搜索、缩放与详情。
- Harness 适配层提供 4 个工具：查询、领取／回执、提交、Lead 管理。模拟调用闭环已通过。

不使用原生任务板；agent-team 只提供成员和消息。执行段是连续工作建议，后续任务仍按实际前置启动。

## 本地使用

需要 Node.js 22 或更新版本。

```powershell
npm ci
npm test
npm run package:local # 独立目录编译，不更新已安装的两个插件
npm run demo
npm run benchmark     # 七场景、四策略的公平合成比较
npm run test:view:host # 可选图插件的隔离宿主验证
npm run test:host       # 隔离宿主：无模型请求
npm run test:host:loop  # 隔离宿主 + agent-team + 本地 mock 闭环
```

演示读取 `fixtures/development.json`，输出 `.scheduler/flow.html`，直接用浏览器打开即可。演示只生成计划，不假装完成真实开发工作。

```powershell
node dist/cli.js plan fixtures/development.json
node dist/cli.js graph fixtures/development.json .scheduler/flow.html
node dist/cli.js init fixtures/development.json .scheduler/state.json
node dist/cli.js status .scheduler/state.json
node dist/cli.js export .scheduler/state.json .scheduler/current.html
```

`init` 拒绝覆盖已有状态。运行状态放在 `.scheduler/`，不提交 Git。普通导出是快照；可选只读图插件可随状态自动导出，沿用宿主文档预览，真实Desktop原生预览验收已完成。

七组合成场景、四种策略的28次模拟均完成，约束违规为0；不同场景各有胜负，不表示真实开发效率已经提升。

duration-01技术闭环通过：[评审](docs/duration-01评审.md)。78次已记录响应超过当轮原定50次的事实保留；2026-10-22起取消请求数、token、费用和总时长的预算验收门槛，取消018预算闸门待办。继续记录可见用量，没有就绪任务则等待，不自动重发未知委托或无限重试。后续真实试用另行安排，不自动开启第二轮。

## 文档

- [自动派发与唤醒](docs/自动派发与唤醒.md)：020本地机制、隔离宿主命令及worklist-03试用接入。
- [调度算法](docs/调度算法.md)：就绪集、优先级/后代数量排序、资源约束贪心分配、连续链融合与事件驱动执行。
- [worklist-02评审](docs/worklist-02评审.md)、[准备材料](docs/worklist-02准备.md)：9任务真实执行完成，两轮88/88通过，验证了等待后的再次派发；配置恢复及重启确认完成，019关闭。没有真实缺陷修复，不据此声称效率提升。
- [本地分发与验收](docs/本地分发与验收.md)、[回归结果](docs/本地分发回归.md)、[接入结果](docs/本地分发接入结果.md)：独立目录打包、迁移使用及012验收证据。
- [离线评测](docs/离线评测.md)、[只读图接入](docs/只读图接入.md)：公平基线、可选图插件与剩余验收。
- [使用与接入](docs/使用与接入.md)：输入格式、程序接口和插件接入边界。
- [设计方案](docs/设计方案.md)、[实施方案](docs/实施方案.md)：职责与实现选择。
- [接口与数据契约](docs/接口与数据契约.md)：当前最小接口。
- [阶段验收与评测](docs/阶段验收与评测.md)：实际验证范围。
- [Harness接入证据](docs/Harness接入证据.md)：宿主源码依据和待验证项。
- [任务清单](docs/任务清单.md)、[任务集](.pi/task_set.json)、[项目记录](docs/项目记录.md)。

项目许可证及远程发布方式待用户决定。当前没有引入参考调度项目代码。核心无运行时依赖；构建依赖与许可见使用文档。
