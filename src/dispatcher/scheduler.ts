import { randomUUID } from "node:crypto";
import { FileStore } from "../store/file-store.js";
import { canOwn, diagnose, held, plan, reasons } from "../core/planner.js";
import { normalize, type Run, type State } from "../core/model.js";

export type Receipt = Pick<Run, "dispatchId" | "attemptId" | "permitId">;
export interface Delivery extends Receipt {
  taskId: string; agentId: string; title: string;
  segment: string[]; checkpoints: unknown[]; stop: string;
  instructions: string;
}
export type Transport = (delivery: Delivery) => Promise<void>;
function event(s: State, action: string, taskId?: string, detail?: string) {
  s.history.push({ at: new Date().toISOString(), action, taskId, detail });
}
function active(s: State, agentId: string, ids: Receipt): Run {
  const run = s.runs.find(r => r.dispatchId === ids.dispatchId && r.attemptId === ids.attemptId && r.permitId === ids.permitId);
  if (!run || run.agentId !== agentId) throw new Error("委托不属于当前执行者或已更换");
  return run;
}
export class Scheduler {
  constructor(readonly store: FileStore, readonly receiptTimeoutMs = 120_000) {}
  snapshot() { return this.store.snapshot(); }
  plan(agentId?: string) {
    const s = this.snapshot();
    if (agentId !== undefined) s.project.agents = s.project.agents.filter(agent => agent.id === agentId);
    return plan(s);
  }

  // 先保存占用，再投递；不等待模型回执，也不自动重发。
  async dispatch(agentId: string, send: Transport): Promise<Delivery> {
    const delivery = await this.store.change(s => {
      // 指定执行者领取时，不让另一个空闲执行者的全局建议占走它可做的任务。
      const p = plan({ ...s, project: { ...s.project, agents: s.project.agents.filter(agent => agent.id === agentId) } });
      if (p.diagnostics.length) throw new Error(p.diagnostics.join("\n"));
      const segment = p.segments.find(x => x.agentId === agentId);
      if (!segment) throw new Error(`执行者 ${agentId} 暂无可启动任务`);
      const task = s.project.tasks.find(t => t.id === segment.tasks[0])!;
      const run: Run = {
        taskId: task.id, agentId, dispatchId: randomUUID(), attemptId: randomUUID(), permitId: randomUUID(),
        phase: "awaiting", startedAt: Date.now()
      };
      s.runs.push(run); s.progress[task.id].status = "running";
      event(s, "dispatch", task.id, run.dispatchId);
      return {
        ...run, title: task.title, segment: segment.tasks, checkpoints: segment.checkpoints, stop: segment.stop,
        instructions: "先回执再执行当前 taskId。segment 后续项仅为计划，完成后查询下一项。提前交付可用产物；报告只写摘要和引用。"
      };
    });
    // 超时包括宿主调用悬挂；只有确认未发送的错误也统一保守保留待对账。
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        send(delivery),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("投递响应超时")), this.receiptTimeoutMs); })
      ]);
    } catch (e) {
      await this.store.change(s => {
        const run = active(s, agentId, delivery);
        if (run.phase === "awaiting") run.phase = "unknown";
        event(s, "delivery-uncertain", run.taskId, String(e));
      });
    } finally { clearTimeout(timer); }
    return delivery;
  }
  async acknowledge(agentId: string, ids: Receipt): Promise<void> {
    await this.store.change(s => {
      const run = active(s, agentId, ids);
      if (run.phase === "finished") throw new Error("此轮已结束，不可再次执行");
      run.phase = "active";
      event(s, "acknowledge", run.taskId);
    });
  }
  async expire(now = Date.now()): Promise<void> {
    const expired = this.snapshot().runs.some(r => r.phase === "awaiting" && now - r.startedAt >= this.receiptTimeoutMs);
    if (!expired) return;
    await this.store.change(s => {
      for (const r of s.runs) if (r.phase === "awaiting" && now - r.startedAt >= this.receiptTimeoutMs) {
        r.phase = "unknown"; event(s, "receipt-timeout", r.taskId);
      }
    });
  }
  async report(agentId: string, ids: Receipt, report: {
    status: "completed" | "blocked" | "failed" | "checkpoint";
    summary: string; outputs?: Record<string, string>;
  }): Promise<void> {
    await this.store.change(s => {
      const run = active(s, agentId, ids);
      if (run.phase !== "active") throw new Error("请先确认当前委托，结束或未知的运行不能提交");
      if (!["completed", "blocked", "failed", "checkpoint"].includes(report.status)) throw new Error("未知结果状态");
      const task = s.project.tasks.find(t => t.id === run.taskId)!, progress = s.progress[task.id];
      for (const [name, reference] of Object.entries(report.outputs ?? {})) {
        if (!task.outputs.includes(name)) throw new Error(`未声明产物：${name}`);
        progress.outputs[name] = { accepted: !task.review, reference };
      }
      if (report.status === "completed" && task.outputs.some(o => !progress.outputs[o])) {
        throw new Error("请补齐声明产物的引用");
      }
      progress.summary = report.summary; run.summary = report.summary;
      if (report.status !== "checkpoint") {
        progress.status = report.status === "completed" && task.review ? "review" : report.status;
        run.phase = "finished";
      }
      event(s, report.status, task.id, report.summary);
    });
  }
  async accept(taskId: string, output?: string): Promise<void> {
    await this.store.change(s => {
      const p = s.progress[taskId];
      if (!p) throw new Error("未知任务");
      if (output) {
        if (!p.outputs[output] || !["running", "review"].includes(p.status)) throw new Error("无待验收产物");
        p.outputs[output].accepted = true;
      } else {
        if (p.status !== "review") throw new Error("任务未进入验收");
        p.status = "completed";
        Object.values(p.outputs).forEach(o => { o.accepted = true; });
      }
      event(s, "accept", taskId, output);
    });
  }
  async control(action: "pause" | "resume" | "approve" | "retry" | "resolve-stopped", taskId?: string): Promise<void> {
    await this.store.change(s => {
      if (action === "pause" || action === "resume") s.paused = action === "pause";
      else {
        const p = taskId ? s.progress[taskId] : undefined;
        if (!p) throw new Error("需要有效 taskId");
        if (action === "approve") p.approved = true;
        else if (action === "resolve-stopped") {
          const run = held(s).find(r => r.taskId === taskId);
          if (!run) throw new Error("没有待对账运行");
          run.phase = "finished"; p.status = "blocked";
        } else {
          if (!["failed", "blocked"].includes(p.status) || held(s).some(r => r.taskId === taskId)) throw new Error("任务仍在执行或不需要重试");
          // 已有下游消费的产物不静默撤销，修订应创建新的任务。
          if (Object.values(p.outputs).some(o => o.accepted)) throw new Error("已有交付被接受，请新增修订任务");
          p.status = "pending"; p.outputs = {};
        }
      }
      event(s, action, taskId);
    });
  }
  async addTasks(tasks: unknown[]): Promise<void> {
    await this.store.change(s => {
      const project = normalize({ ...s.project, tasks: [...s.project.tasks, ...tasks] });
      const errors = diagnose(project);
      if (errors.length) throw new Error(errors.join("\n"));
      for (const t of project.tasks) if (!s.progress[t.id]) s.progress[t.id] = { status: "pending", approved: !t.approval, outputs: {} };
      s.project = project;
      event(s, "add-tasks", undefined, String(tasks.length));
    });
  }
}
