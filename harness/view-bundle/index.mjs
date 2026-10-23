import z from "@deepseek-ai/schemastery";
import { startViewExport } from "./dist/ui/export-view.js";

export const name = "dynamic-task-scheduler-view";
export const Config = z.object({
  stateFile: z.string(),
  projectFile: z.string(),
  graphFile: z.string()
});

export function apply(ctx, config) {
  // 此bundle独立启用，不修改现有调度器工具或Lead身份。
  ctx.effect(() => {
    const started = startViewExport({ ...config, onError: error => console.error("scheduler view:", error) });
    started.catch(error => console.error("scheduler view unavailable:", error));
    return async () => { try { await (await started).close(); } catch { /* startup error already reported */ } };
  }, "scheduler.view-export");
}
