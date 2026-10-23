# worklist-02评审

2026-10-22。结论：**技术验收通过，配置恢复及重启确认完成，019关闭。** 两轮88/88与七条CLI smoke均通过；没有真实缺陷或代码修复，不能宣称覆盖修复后复测。用量unknown不阻塞验收。

## 核对结果

复用已生成的测试证据，不重跑被测程序。只读核对state、测试输出／退出码、七条smoke、实现及测试文件，补充`.scheduler/trials/worklist-02/gpt-review-evidence.json`，填写runtime/result.md；保留Lead原始记录和initial/final证据。

- state revision 28，九项completed，每项一个run，九个run均finished；任务开始前的前置已完成，未发现提前解锁。
- initial和final各自node --test为tests88/pass88/fail0、exit0、stderr0字节；各七条CLI smoke退出码为0/0/0/0/2/2/0，两个2为预期错误路径。两轮CLI stdout/stderr逐字节相同，JSON结果的顺序、matched和summary口径符合要求。
- 核心和CLI实现静态阅读未发现阻塞本轮验收的问题。旧版legacy测试保留，新增测试覆盖核心规则及CLI子进程；不以88项推断全部可能输入已覆盖。
- D2/C2仅交付“无需修改”记录，没有真实修复；初测失败后处理、最终失败阻断、unknown与retry本轮均未实际发生。
- Q1实际额外运行了52项核心单测，不只是编写文件；成员报告未读实现源码、未提前运行CLI集成。记录这一执行偏差，不把计划中“仅编写测试”当成实际事实。

## 状态与时间口径

1. Lead查询的runs=[]表示没有未结束运行。持久state仍有九条历史run，不应删除或写成历史为空。
2. 每阶段共八条命令：一条全量测试加七条CLI smoke；八个退出码中第一个属于测试命令。
3. 状态历史有九个dispatch事件：八次Lead派发，加一次D1的next连续领取。Lead所述七次等待后唤醒包括C1/Q1首次任务的启动；按“第一次业务派发”计为P1/C1/Q1三次，后续重新派发五次。不要把状态事件数等同于Lead工具调用数。
4. D1存在两次ack，全部共十次ack，仍只有九个run、九次完成，无重复任务运行。

按dispatch到completed定义调度占用区间，D1/C1/Q1三者交集10.103秒，D2/C2交集27.314秒；不将19:01—19:05整段算成三线同时工作。任务窗口18:59:54.766—19:17:05.207，共17分10.441秒，不等于全部模型计量窗口。

| 下游阶段 | 前置全部完成到派发 |
|---|---:|
| Q2 | 102.879秒 |
| D2/C2阶段的首次派发D2 | 135.988秒 |
| Q3 | 162.600秒 |
| C3 | 137.233秒 |

四段共538.700秒，约8分59秒。它包含Lead察觉通知、核对证据和派发的间隔，不能全部归因调度算法或视为可直接消除的浪费。它提示下一步优先观察依赖解除后的及时派发，而不是扩大并行数。本轮没有同条件基线，不宣称效率或压缩收益。

## 配置恢复与最后确认

肥鱼已交付runtime/notes/config-restore.md：两个插件路径恢复为development.json、host-state.json及live-flow.html，其他配置行保持；试用九个run均finished，成员停止。view于20:06:16重新生成host-state图。20:13补充的重启后记录确认scheduler也已回到原项目：新宿主进程仅一次scheduler_status返回revision4、ready A1、五项pending、无未结束run，依赖和建议段与host-state一致。项目名/maxSegment不在工具返回中，通过恢复配置的projectFile与host-state核对，不声称由status直接返回。

恢复记录同时确认host-state和worklist-02状态文件未因查询写入，没有创建成员、派发任务或重跑试用。GPT读取该记录后关闭019，从未完成任务集中移除，未重复查询或测试。早先gpt-review-evidence.json保留当时“待配置恢复”的审查快照，最终恢复状态以config-restore.md的新节和本评审为准。没有真实修复、宿主精确版本／模型推理设置／压缩次数unknown等边界继续保留；运行阶段无人工介入来自Lead记录，配置切换和重启不在该窗口内。
