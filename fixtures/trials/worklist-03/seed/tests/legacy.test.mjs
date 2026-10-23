import test from "node:test";
import assert from "node:assert/strict";
import { selectTasks } from "../src/worklist.mjs";

test("旧版基线：汇总三个状态", () => {
  const result = selectTasks([
    { id: "W1", title: "接口", status: "done", priority: 1 },
    { id: "W2", title: "实现", status: "doing", priority: 2 },
    { id: "W3", title: "测试", status: "todo", priority: 2 }
  ]);
  assert.deepEqual(result.summary, { total: 3, todo: 1, doing: 1, done: 1 });
});
