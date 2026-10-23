// 本地 OpenAI-compatible mock：只验证协议与工具闭环，不连接真实模型、不产生费用。
import http from "node:http";
import { appendFile } from "node:fs/promises";

const textOf = content => typeof content === "string" ? content
  : Array.isArray(content) ? content.filter(x => x?.type === "text").map(x => x.text).join("") : "";

const parseJson = text => {
  try { return JSON.parse(text); } catch { return undefined; }
};

const callsOf = messages => messages.flatMap(m =>
  m.role === "assistant" && Array.isArray(m.tool_calls)
    ? m.tool_calls.map(c => ({ name: c?.function?.name, args: parseJson(c?.function?.arguments) ?? {} })).filter(c => c.name)
    : []);

const toolCall = messages => callsOf(messages).at(-1);
const countCalls = (messages, name) => callsOf(messages).filter(c => c.name === name).length;

function decide(messages) {
  const allText = messages.map(m => textOf(m.content)).join("\n");
  const teammate = allText.includes("你是专项执行者");
  const calls = callsOf(messages);
  const last = messages.at(-1);
  if (!teammate) {
    if (last?.role === "user") {
      if (!calls.some(c => c.name === "scheduler_manage" && c.args?.action === "spawn")) {
        return { tool: "scheduler_manage", args: { action: "spawn", target: "developer" } };
      }
      return { text: "等待专项成员提交。" };
    }
    if (last?.role === "tool") {
      const call = toolCall(messages);
      if (call?.name === "scheduler_manage" && call.args?.action === "spawn") {
        if (!calls.some(c => c.name === "scheduler_manage" && c.args?.action === "dispatch")) {
          return { tool: "scheduler_manage", args: { action: "dispatch", target: "developer" } };
        }
      }
      return { text: "已派发，等待专项成员提交。" };
    }
    return { text: "mock: 无匹配脚本，结束。" };
  }
  if (last?.role === "user") {
    if (calls.length === 0) return { tool: "scheduler_next", args: {} };
    const match = textOf(last.content).match(/Team message from lead:\s*(\{[\s\S]*\})/);
    if (match) {
      const delivery = parseJson(match[1]);
      if (delivery?.dispatchId) return { tool: "scheduler_next", args: { dispatchId: delivery.dispatchId } };
    }
    return { text: "等待 Lead 派发。" };
  }
  if (last?.role === "tool") {
    const result = parseJson(textOf(last.content)) ?? {};
    const call = toolCall(messages);
    if (call?.name === "scheduler_next") {
      if (result.waiting) return { text: "等待 Lead 派发。" };
      if (result.taskId) return {
        tool: "scheduler_report",
        args: {
          dispatchId: result.dispatchId, summary: `${result.taskId} 完成`,
          ...(result.taskId === "A1" ? { outputs: '{"api":"docs/api.md"}' } : {})
        }
      };
    }
    if (call?.name === "scheduler_report") {
      if (countCalls(messages, "scheduler_report") >= 2) return { text: "本轮任务完成。" };
      return { tool: "scheduler_next", args: {} };
    }
  }
  return { text: "mock: 无匹配脚本，结束。" };
}

function chunk(delta, finish = null) {
  return {
    id: "chatcmpl-mock", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000),
    model: "mock-model", choices: [{ index: 0, delta, finish_reason: finish }]
  };
}

export function decideWake(messages) {
  if (!messages.some(message => textOf(message.content).includes("你是专项执行者"))) {
    return { text: "已收到成员通知；常规派发由插件处理，本回合不调用调度工具。" };
  }
  const last = messages.at(-1), call = toolCall(messages);
  if (last?.role === "user") return { tool: "scheduler_next", args: {} };
  if (last?.role === "tool") {
    const result = parseJson(textOf(last.content)) ?? {};
    if (call?.name === "scheduler_next") {
      if (result.waiting) return { text: "等待下一条委托，结束本回合。" };
      if (result.taskId) return { tool: "scheduler_report", args: {
        dispatchId: result.dispatchId, summary: `${result.taskId} mock完成`,
        ...(result.taskId === "A1" ? { outputs: '{"api":"mock-api.md"}' } : {})
      } };
    }
    if (call?.name === "scheduler_report") return { tool: "scheduler_next", args: {} };
  }
  return { text: "mock: 无匹配脚本，结束。" };
}

export async function startMockLlm(logFile, { wake = false } = {}) {
  let sequence = 0;
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    for await (const part of req) body += part;
    let request;
    try { request = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
    const action = wake ? decideWake(request.messages ?? []) : decide(request.messages ?? []);
    if (logFile) {
      const messages = request.messages ?? [];
      await appendFile(logFile, JSON.stringify({
        at: new Date().toISOString(), action,
        ...(wake ? { actor: messages.some(m => textOf(m.content).includes("你是专项执行者")) ? "teammate" : "lead" } : {}),
        lastRole: messages.at(-1)?.role,
        count: messages.length,
        firstUser: textOf(messages.find(m => m.role === "user")?.content).slice(0, 200),
        last: textOf(messages.at(-1)?.content).slice(0, 300)
      }) + "\n").catch(() => {});
    }
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });
    const send = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
    send(chunk({ role: "assistant" }));
    if (action.tool) {
      const id = `call_mock_${++sequence}`;
      send(chunk({
        tool_calls: [{
          index: 0, id, type: "function",
          function: { name: action.tool, arguments: JSON.stringify(action.args) }
        }]
      }));
      send(chunk({}, "tool_calls"));
    } else {
      send(chunk({ content: action.text ?? "" }));
      send(chunk({}, "stop"));
    }
    send({ id: "chatcmpl-mock", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "mock-model", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    res.write("data: [DONE]\n\n");
    res.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise(resolve => server.close(resolve))
  };
}
