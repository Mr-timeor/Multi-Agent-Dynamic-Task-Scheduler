// 试用起点：旧版只汇总，不具备新需求中的校验、筛选、排序和分页能力。
export function selectTasks(tasks) {
  return {
    items: [...tasks],
    matched: tasks.length,
    summary: {
      total: tasks.length,
      todo: tasks.filter(task => task.status === "todo").length,
      doing: tasks.filter(task => task.status === "doing").length,
      done: tasks.filter(task => task.status === "done").length
    }
  };
}
