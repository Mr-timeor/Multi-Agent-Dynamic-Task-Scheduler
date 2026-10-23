# worklist-03评审

2026-10-24更新。技术验收及配置恢复重启确认均通过，**020已关闭**。审查快照见[证据核对](../.scheduler/trials/worklist-03/gpt-review-evidence.json)；该快照保留审查当时的待恢复状态，最终恢复以[恢复记录](../.scheduler/trials/worklist-03/notes/config-restore.md)及本评审为准。保留[Lead摘要](../.scheduler/trials/worklist-03/lead-summary.md)和两阶段原始报告，不直接修改其中的历史表述。

## 验收结果

读取state、Q2/Q3原始stdout/stderr/exit-code、smoke、两份处置记录及当前源码/测试。九项completed，持久state的九个run全部finished；工具返回runs:[]只表示无未结束run。历史有九次dispatch、十次ack、九次completed；Q2重复ack没有产生额外run或重复执行。没有失败、unknown或retry记录。

两轮实际node --test均123/123、exit0、stderr0字节，没有skipped/cancelled。每轮四条CLI smoke的exit为0/0/0/2，错误路径2符合契约；首轮以attempt-3为权威，和final的十二个stdout/stderr/exit-code文件逐字节一致。Q2先前两次采集失败保留原样，属于采集脚本/PowerShell包装问题，不能写成产品测试失败，也不能写成本轮所有命令首次即成功。initial的字节/字符笔误以final更正为准。

final前后七个源码、测试及输入文件哈希一致，当前文件也与该记录一致。首轮没有产品缺陷，D2/C2仅据证据交付无需修改，没有实际产品代码修复；本轮不能证明缺陷修复、失败恢复或unknown对账已在真实模型流程覆盖。未重新运行产品测试，复用两轮已有有效结果。

## 派发与唤醒计数更正

本轮最重要的结论成立：**Lead手动dispatch为0，六次跨会话等待后消息唤醒成功，两次同回合连续领取成功。**

Lead原摘要把Q2计为第七次卸载后唤醒。只读解码本轮四个持久会话，按scheduler工具调用/结果与委托消息核对后，应区分：

| 来源 | 次数 | 任务 |
|---|---:|---|
| 首次next直接领取 | 1 | P1 |
| 同回合next连续领取 | 2 | D1、Q2 |
| report触发跨成员消息唤醒 | 6 | C1、Q1、D2、C2、Q3、C3 |
| Lead手动dispatch | 0 | 无 |

六次wakeups.dispatched各有对应目标会话委托消息，原成员ID保持；会话恢复记录与waiting后继续的轨迹对应。Lead确有五次status及三次spawn，没有dispatch调用。

Q2的直接证据在QA会话：Q1报告结果seq157的wakeups为空；同一turn2中，seq168的空参scheduler_next领取Q2，seq174再次确认同一dispatchId；该会话只收到Q1、Q3两条任务委托，没有Q2委托。因此“八次后续推进”可以保留，但不能全部计为发送委托，也不能把Q2的4.930秒归为卸载恢复耗时。这一更正不影响零手动派发与自动推进验收。

## 时间观察

由state.history和实际前置重算：

| 下游阶段 | 前置齐备到dispatch |
|---|---:|
| C1 / Q1 | 0.022 / 0.044秒 |
| D1连续领取 | 2.443秒 |
| Q2连续领取 | 4.930秒 |
| D2 / C2 | 0.011 / 0.017秒 |
| Q3 | 0.006秒 |
| C3 | 0.007秒 |

与02同口径的四段（Q2、D2/C2最早、Q3、C3）合计4.954秒，其中最大的Q2间隔包含QA提交后发摘要、再调用next的时间。上轮538.700秒仅作观察参照，不将两次不同运行直接转换成因果收益或提升百分比。

任务窗口20:10:40.294—20:18:21.459，共461.165秒；三线调度占用区间交集29.333秒，D2/C2交集34.301秒。dispatch到completed是调度占用，不能等同于模型持续计算时间。六次消息唤醒的dispatch到ack为1.284—2.126秒，也包含消息、恢复和模型响应。

## 证据范围与最后一步

原始会话的模型标签均为deepseek-flash；这不是实际后端版本或推理设置的证明。请求总数、费用、上下文压缩次数未在本次审查计量，保持unknown。Lead接收摘要、未收到完整子会话工具轨迹按其记录；不据此推断上下文或计费收益。

肥鱼已按更正计数填写[result](../.scheduler/trials/worklist-03/result.md)，并交付[恢复记录](../.scheduler/trials/worklist-03/notes/config-restore.md)：九个run均finished，成员停止；两插件路径恢复development/host-state/live-flow，autoDispatch键恢复省略，其他配置行保持。新版安装副本保留，未重打包或回退。view已于10月23日20:39:17重新生成host-state图；scheduler的Lead绑定是进程内状态，不能仅凭profile落盘认定生效。

恢复记录已于10月24日00:58补齐完整重启后的确认：仅一次scheduler_status返回revision4、五项原development任务、仅A1 ready、autoDispatch:false，两类waiting名单及未结束runs均为空，与原host-state一致。项目身份结合恢复配置和development/state文件核对，不声称工具直接返回项目名。没有再查status或重跑试用，03现场保留。

GPT读取该恢复记录与接入结果后关闭020，从未完成任务集中移除。保留已验证新版安装，原项目仍为默认手动派发；原失败证据、用量unknown及未发生产品修复等边界不变。015机器档案待办继续保留，P3按需，不自动扩展工作。
