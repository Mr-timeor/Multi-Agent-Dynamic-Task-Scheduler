import { plan } from "../core/planner.js";
import type { State } from "../core/model.js";

export interface GraphOptions { refreshUrl?: string; refreshIntervalMs?: number }
const escape = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const json = (value: unknown) => JSON.stringify(value).replaceAll("<", "\\u003c");
const labels: Record<string, string> = { pending: "待执行", running: "执行中", review: "待验收", completed: "已完成", failed: "失败", blocked: "阻塞", awaiting: "待回执", active: "执行中", unknown: "待对账", finished: "本轮已结束" };

export function renderGraph(state: State, options: GraphOptions = {}): string {
  const p = plan(state), levels = new Map<string, number>();
  function level(id: string, visiting = new Set<string>()): number {
    if (levels.has(id)) return levels.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const task = state.project.tasks.find(t => t.id === id);
    const n = task?.dependsOn.length ? 1 + Math.max(...task.dependsOn.map(d => level(d.taskId, new Set(visiting)))) : 0;
    levels.set(id, n); return n;
  }
  const positions = new Map<string, { x: number; y: number }>();
  const categories = [...new Set(state.project.tasks.map(t => t.category))];
  let laneY = 18;
  const lanes = categories.map(category => {
    const columns = new Map<number, number>(), top = laneY;
    for (const t of state.project.tasks.filter(t => t.category === category)) {
      const column = level(t.id), row = columns.get(column) ?? 0;
      columns.set(column, row + 1);
      positions.set(t.id, { x: 32 + column * 290, y: top + 42 + row * 126 });
    }
    const height = 54 + Math.max(1, ...columns.values()) * 126;
    laneY += height + 14;
    return { category, top, height };
  });
  const width = Math.max(900, ...[...positions.values()].map(v => v.x + 270));
  const height = Math.max(350, laneY);
  const colors: Record<string, string> = { pending: "#334155", running: "#126f96", review: "#956900", completed: "#177353", failed: "#a63745", blocked: "#704c92" };
  const segmentFor = new Map(p.segments.flatMap((s, i) => s.tasks.map(id => [id, i + 1] as const)));
  const short = (s: string, max: number) => s.length > max ? s.slice(0, max) + "…" : s;
  function status(id: string): string {
    const progress = state.progress[id], run = [...state.runs].reverse().find(r => r.taskId === id);
    if (progress.status === "running" && run) return labels[run.phase];
    if (progress.status !== "pending") return labels[progress.status];
    const reasons = p.blocked[id] ?? [];
    return reasons.some(r => r.includes("授权")) ? "等待授权" : reasons.some(r => r.includes("资源")) ? "资源等待"
      : reasons.some(r => r.startsWith("等待")) ? "等待前置" : state.paused ? "调度已暂停" : p.ready.includes(id) ? "可领取" : "待分配";
  }
  const details = Object.fromEntries(state.project.tasks.map(t => {
    const progress = state.progress[t.id], run = [...state.runs].reverse().find(r => r.taskId === t.id);
    const checkpoint = p.segments.flatMap(s => s.checkpoints).filter(c => c.taskId === t.id);
    const reasons = (p.blocked[t.id] ?? []).filter(r => !r.startsWith("状态："));
    const next = progress.status === "completed" ? "本任务已完成" : progress.status === "review" ? "等待指定验收"
      : progress.status === "failed" ? "查看失败原因后安排重试" : run?.phase === "unknown" ? "确认执行情况后对账"
      : progress.status === "running" ? "等待执行者提交结果或中间产物" : reasons.join("；") || (p.ready.includes(t.id) ? "已就绪，等待调配" : "等待分配执行者");
    return [t.id, [
      `${t.id} · ${t.title}`, `类别：${t.category}`, `状态：${status(t.id)}`,
      `执行者：${run?.agentId ?? t.owner ?? p.segments.find(s => s.tasks.includes(t.id))?.agentId ?? "待分配"}`,
      `前置：${t.dependsOn.map(d => d.taskId + (d.output ? "/" + d.output : "")).join("、") || "无"}`,
      `资源：${t.resources.map(r => r.path + (r.mode === "read" ? "（读取）" : "（写入）")).join("、") || "未声明"}`,
      ...(checkpoint.length ? [`中间交付：${checkpoint.map(c => `${c.taskId}${c.output ? "/" + c.output : " 完成"} → ${c.consumers.join("、")}`).join("；")}`] : []),
      `下一步：${next}`, `结果：${progress.summary ?? "尚未提交"}`,
      `产物：${Object.entries(progress.outputs).map(([name, o]) => `${name}：${o.reference}（${o.accepted ? "已接受" : "待验收"}）`).join("；") || "无"}`
    ].join("\n\n")];
  }));
  const edges = state.project.tasks.flatMap(t => t.dependsOn.map(d => {
    const a = positions.get(d.taskId), b = positions.get(t.id);
    return a && b ? `<path d="M${a.x + 242},${a.y + 52} C${a.x + 266},${a.y + 52} ${b.x - 22},${b.y + 52} ${b.x},${b.y + 52}" marker-end="url(#arrow)"><title>${escape(d.taskId)} → ${escape(t.id)}${d.output ? "/" + escape(d.output) : ""}</title></path>${d.output ? `<text class="edge-label" x="${b.x - 36}" y="${b.y + 40}">${escape(short(d.output, 9))}</text>` : ""}` : "";
  })).join("");
  const nodes = state.project.tasks.map(t => {
    const pos = positions.get(t.id)!, progress = state.progress[t.id];
    const run = [...state.runs].reverse().find(r => r.taskId === t.id);
    const executor = run?.agentId ?? t.owner ?? p.segments.find(s => s.tasks.includes(t.id))?.agentId ?? "待分配";
    const display = status(t.id), segment = segmentFor.get(t.id);
    return `<g class="node" data-id="${escape(t.id)}" tabindex="0" role="button" aria-label="${escape(t.id + " " + t.title + "，" + display)}" transform="translate(${pos.x},${pos.y})">
      <title>${escape(t.title)} · ${escape(executor)}</title><rect width="242" height="108" rx="12" fill="${colors[progress.status]}"/>
      <text x="12" y="23" class="node-id">${escape(t.id)}${segment ? ` · 建议段 ${segment}` : ""}</text>
      <text x="12" y="48">${escape(short(t.title, 18))}</text><text x="12" y="72">${escape(display)}</text>
      <text x="12" y="94" class="node-id">${escape(short(executor, 28))}</text></g>`;
  }).join("");
  const interval = options.refreshIntervalMs;
  const refresh = options.refreshUrl ? { url: options.refreshUrl, interval: Number.isFinite(interval) ? Math.max(500, interval!) : 2000 } : null;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escape(state.project.name)}</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#101825;color:#e5edf7;font:15px system-ui}header,footer{padding:20px 28px}h1{margin:0 0 8px;font-size:24px}p{line-height:1.6}
button,input{padding:9px 12px;border:1px solid #62738c;border-radius:7px;background:#1d2a40;color:inherit;margin:5px 6px 5px 0}button{cursor:pointer}button:disabled{opacity:.5;cursor:wait}input{width:min(360px,100%)}.muted{color:#a6b7cd}.toolbar{margin-top:10px;display:flex;flex-wrap:wrap;align-items:center;gap:0 6px}#refresh-status{font-size:13px;margin:8px 0}.error{color:#ffb3bb}
main{display:grid;grid-template-columns:minmax(0,1fr) 330px}#canvas{overflow:auto;min-height:440px;border-block:1px solid #334155}aside{padding:18px;overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.6 system-ui}
svg text{fill:#e5edf7;font:13px system-ui}svg path{stroke:#8196b0;fill:none;stroke-width:1.6}.lane{fill:#172131;stroke:#293b50}.lane-label{font-weight:600;fill:#a6b7cd}.edge-label{font-size:11px;paint-order:stroke;stroke:#101825;stroke-width:4px}.node-id{fill:#c2d4e8;font-size:11px}.node{cursor:pointer}.node:focus rect,.node:hover rect,.node.selected rect{stroke:#eaf5ff;stroke-width:2}.dim{opacity:.18}li{margin-bottom:12px;line-height:1.6}.segment-title{font-weight:600}.legend{font-size:12px;margin-top:8px}@media(max-width:800px){main{grid-template-columns:1fr}header,footer{padding:18px}aside{border-bottom:1px solid #334155}}
</style></head><body><header><h1>${escape(state.project.name)}</h1>
<div id="overview" data-scheduler-revision="${state.revision}">${refresh ? "只读实时视图" : "只读快照"} · revision ${state.revision} · ${state.paused ? "已暂停" : "可调度"} · ${state.project.tasks.length} 个任务 · ${p.ready.length} 个就绪</div>
<div class="toolbar"><input id="search" type="search" aria-label="搜索任务、类别或执行者" placeholder="搜索任务、类别或执行者"><button id="minus" aria-label="缩小流程图">−</button><button id="plus" aria-label="放大流程图">＋</button>${refresh ? '<button id="refresh">刷新状态</button>' : ""}</div>
<div id="refresh-status" class="muted" role="status">${refresh ? "等待首次更新；刷新只读取状态。" : "静态快照；重新导出后刷新浏览器查看。"}</div>
<div class="legend muted">灰：待执行　蓝：执行中／待回执　绿：完成　黄：待验收　紫：阻塞　红：失败</div></header>
<main><div id="canvas"><svg id="graph" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6" fill="#8196b0"/></marker></defs>
${lanes.map(l => `<rect class="lane" x="12" y="${l.top}" width="${width - 24}" height="${l.height}" rx="12"/><text class="lane-label" x="32" y="${l.top + 27}">${escape(l.category)}</text>`).join("")}${edges}${nodes}
${nodes ? "" : '<text x="32" y="60">尚无任务</text>'}</svg></div>
<aside><b>任务详情</b><pre id="detail">选择一个节点查看前置、占用和结果。</pre></aside></main>
<footer><section id="segments"><b>当前建议执行段（后续任务尚未启动）</b><ul>${p.segments.map((s, i) => `<li><span class="segment-title">段 ${i + 1} · ${escape(s.agentId)}</span>：${s.tasks.map(escape).join(" → ")}<br><span class="muted">停止：${escape(s.stop)}</span>${s.checkpoints.length ? `<br>中间交付：${s.checkpoints.map(c => `${escape(c.taskId)}${c.output ? "/" + escape(c.output) : " 完成"} → ${c.consumers.map(escape).join("、")}`).join("；")}` : ""}</li>`).join("") || "<li>暂无执行段</li>"}</ul></section>
<section id="diagnostics">${p.diagnostics.map(d => `<p class="error">${escape(d)}</p>`).join("")}</section><p class="muted">流程图从调度状态派生。建议段中的任务须依次满足前置；本页只能查看。</p></footer>
<script id="scheduler-data" type="application/json">${json({ revision: state.revision, details })}</script>
<script>
const refreshConfig=${json(refresh)};
let snapshot=JSON.parse(document.getElementById('scheduler-data').textContent);
let graph=document.getElementById('graph'),zoom=1,selected=null,refreshing=false,lastSuccess=null;
const canvas=document.getElementById('canvas'),search=document.getElementById('search'),detail=document.getElementById('detail'),refreshStatus=document.getElementById('refresh-status');
function applyInteraction(){
  const query=search.value.toLocaleLowerCase().trim();
  graph.querySelectorAll('.node').forEach(n=>{n.classList.toggle('dim',!snapshot.details[n.dataset.id].toLocaleLowerCase().includes(query));n.classList.toggle('selected',n.dataset.id===selected)});
  detail.textContent=selected&&snapshot.details[selected]||'选择一个节点查看前置、占用和结果。';
  const box=graph.getAttribute('viewBox').split(' ').map(Number);graph.setAttribute('width',box[2]*zoom);graph.setAttribute('height',box[3]*zoom);
}
function select(event){const n=event.target.closest('.node');if(n&&graph.contains(n)){selected=n.dataset.id;applyInteraction()}}
canvas.addEventListener('click',select);canvas.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){if(e.target.closest('.node')){e.preventDefault();select(e)}}});
search.addEventListener('input',applyInteraction);
function scale(v){zoom=Math.max(.3,Math.min(3,zoom*v));applyInteraction()}
document.getElementById('plus').onclick=()=>scale(1.2);document.getElementById('minus').onclick=()=>scale(1/1.2);
zoom=Math.max(.3,Math.min(1,canvas.clientWidth/Number(graph.getAttribute('viewBox').split(' ')[2])));applyInteraction();
function updateStatus(message,error=false){refreshStatus.textContent=message;refreshStatus.classList.toggle('error',error)}
function successLabel(){return lastSuccess?'上次成功：'+lastSuccess:'尚未成功更新'}
// 宿主可直接传入新的派生HTML，不必通过HTTP，也不会执行其中的脚本。
function applySnapshotHtml(html){
  const doc=new DOMParser().parseFromString(html,'text/html'),dataElement=doc.getElementById('scheduler-data');
  const incoming=dataElement&&JSON.parse(dataElement.textContent);
  if(!incoming||!Number.isInteger(incoming.revision)||!incoming.details||typeof incoming.details!=='object'||Array.isArray(incoming.details)||Object.values(incoming.details).some(v=>typeof v!=='string'))throw new Error('返回内容不是有效流程图');
  const ids=['graph','overview','segments','diagnostics'];
  if(ids.some(id=>!doc.getElementById(id))||doc.getElementById('overview').dataset.schedulerRevision!==String(incoming.revision))throw new Error('返回内容缺少流程图');
  const nextGraph=doc.getElementById('graph'),viewBox=nextGraph.getAttribute('viewBox');
  if(!viewBox||viewBox.split(' ').length!==4||viewBox.split(' ').some(v=>!Number.isFinite(Number(v)))||[...nextGraph.querySelectorAll('.node')].some(n=>!(n.dataset.id in incoming.details)))throw new Error('返回内容缺少任务详情');
  if(incoming.revision<snapshot.revision){updateStatus('已忽略旧版本；'+successLabel(),true);return {applied:false,revision:snapshot.revision}}
  const changed=incoming.revision>snapshot.revision;
  if(changed){
    const left=canvas.scrollLeft,top=canvas.scrollTop;
    for(const id of ids){const replacement=document.importNode(doc.getElementById(id),true);document.getElementById(id).replaceWith(replacement)}
    snapshot=incoming;graph=document.getElementById('graph');if(selected&&!snapshot.details[selected])selected=null;
    applyInteraction();canvas.scrollLeft=left;canvas.scrollTop=top;
  }
  lastSuccess=new Date().toLocaleTimeString('zh-CN');updateStatus('已更新至 revision '+snapshot.revision+' · '+successLabel());
  return {applied:changed,revision:snapshot.revision};
}
window.schedulerApplyHtml=function(html){
  try{return applySnapshotHtml(html)}catch(error){updateStatus('更新失败，保留当前视图 · '+successLabel()+' · '+error.message,true);throw error}
};
async function refreshGraph(){
  if(!refreshConfig||refreshing)return;refreshing=true;const button=document.getElementById('refresh');button.disabled=true;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
  try{
    const url=new URL(refreshConfig.url,location.href);
    if(url.origin!==location.origin||!['http:','https:'].includes(url.protocol))throw new Error('刷新地址必须是同源网页');
    const response=await fetch(url,{method:'GET',cache:'no-store',signal:controller.signal});
    if(!response.ok)throw new Error('读取失败（'+response.status+'）');
    window.schedulerApplyHtml(await response.text());
  }catch(error){updateStatus('更新失败，保留当前视图 · '+successLabel()+' · '+(error.name==='AbortError'?'读取超时':error.message),true)}
  finally{clearTimeout(timeout);refreshing=false;button.disabled=false}
}
if(refreshConfig){document.getElementById('refresh').onclick=refreshGraph;setInterval(()=>{if(!document.hidden)refreshGraph()},refreshConfig.interval);refreshGraph()}
</script></body></html>`;
}
