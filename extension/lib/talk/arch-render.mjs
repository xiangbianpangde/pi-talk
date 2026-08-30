#!/usr/bin/env node
/**
 * talk arch renderer — bridges /talk style "arch" to local Archify
 * (tt-a1i/archify, based on Cocoon-AI/architecture-diagram-generator).
 *
 * Input modes (auto-detected from --input file contents):
 *   1. Full HTML document        → copy/serve as-is (Cocoon-style hand HTML ok)
 *   2. Archify JSON IR           → node archify.mjs render <type> ...
 *   3. Mermaid source            → wrap as lightweight mermaid viewer (fallback)
 *   4. Plain text description    → emit starter JSON scaffold HTML error with tips
 *
 * stdout: JSON { ok, htmlPath, type, engine, message }
 */
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ARCHIFY_CANDIDATES = [
	process.env.ARCHIFY_ROOT,
	join(homedir(), ".claude/skills/archify"),
	join(homedir(), ".agents/skills/archify"),
	join(homedir(), ".pi/agent/skills/archify"),
	join(homedir(), "Projects/archify/archify"),
	join(homedir(), "skills/archify"),
].filter(Boolean);

function findArchify() {
	for (const root of ARCHIFY_CANDIDATES) {
		const bin = join(root, "bin/archify.mjs");
		if (existsSync(bin)) return { root, bin };
	}
	return null;
}

function parseArgs(argv) {
	const out = { input: "", title: "Architecture", out: "", type: "", open: false };
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		const next = argv[i + 1];
		if (a === "--input" && next) {
			out.input = next;
			i++;
		} else if (a === "--title" && next) {
			out.title = next;
			i++;
		} else if (a === "--out" && next) {
			out.out = next;
			i++;
		} else if (a === "--type" && next) {
			out.type = next;
			i++;
		} else if (a === "--open") {
			out.open = true;
		} else if (a === "--help" || a === "-h") {
			out.help = true;
		}
	}
	return out;
}

function isHtml(text) {
	const h = text.trim().slice(0, 200).toLowerCase();
	return h.startsWith("<!doctype") || h.startsWith("<html");
}

function tryParseJson(text) {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function detectType(json, forced) {
	if (forced) return forced;
	if (json && typeof json.diagram_type === "string") return json.diagram_type;
	if (json?.components || json?.boundaries) return "architecture";
	if (json?.lanes && json?.nodes) return "workflow";
	if (json?.participants || json?.messages) return "sequence";
	if (json?.datasets || json?.flows) return "dataflow";
	if (json?.states || json?.transitions) return "lifecycle";
	return "architecture";
}

function looksLikeMermaid(text) {
	const t = text.trim();
	return /^(flowchart|graph|sequenceDiagram|stateDiagram|erDiagram|classDiagram|gantt|pie|journey)\b/m.test(
		t,
	);
}

function wrapMermaid(title, source) {
	const safeSource = escapeHtml(source);
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<script defer src="https://cdn.jsdelivr.net/npm/mermaid@11.16.1/dist/mermaid.min.js" integrity="sha384-aBQXj4hK6Jm05i7aQAsUV3bLdSUrHX1BGYfMB0166TtWt/RRaw+h0Eelme9OCOvy" crossorigin="anonymous"></script>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#020617; color:#e2e8f0; font-family: ui-sans-serif, system-ui, sans-serif; }
  header { padding:16px 20px; border-bottom:1px solid #1e293b; display:flex; justify-content:space-between; gap:12px; align-items:center; }
  header h1 { margin:0; font-size:16px; letter-spacing:-.2px; }
  header span { color:#64748b; font-size:12px; font-family: ui-monospace, monospace; }
  main { padding:24px; overflow:auto; }
  .box { background:rgba(15,23,42,.7); border:1px solid #1e293b; border-radius:14px; padding:20px; }
  .mermaid { display:flex; justify-content:center; white-space:pre-wrap; }
  .hint { margin-top:14px; color:#64748b; font-size:12px; }
  button { appearance:none; background:#0f172a; border:1px solid #334155; color:#e2e8f0; border-radius:8px; padding:6px 10px; cursor:pointer; font:inherit; }
  button:hover { border-color:#22d3ee; color:#22d3ee; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <div style="display:flex;gap:8px;align-items:center">
    <button data-talk-event="arch-mode" data-talk-value="archify-json" type="button">改用 Archify JSON</button>
    <span>talk / arch · mermaid fallback</span>
  </div>
</header>
<main>
  <div class="box">
    <pre class="mermaid" id="mmd">${safeSource}</pre>
    <p class="hint" id="mmd-status">Mermaid 为轻量回退。结构化 IR 请用 Archify JSON（architecture/workflow/sequence/dataflow/lifecycle）。</p>
  </div>
</main>
<script>
  window.addEventListener('DOMContentLoaded', async () => {
    const node = document.getElementById('mmd');
    const status = document.getElementById('mmd-status');
    const original = node.textContent;
    if (!window.mermaid) {
      status.textContent = 'Mermaid 未加载，已保留可读源码。';
      return;
    }
    try {
      mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict', flowchart: { htmlLabels: false } });
      await mermaid.run({ nodes: [node], suppressErrors: true });
    } catch (_) {
      node.textContent = original;
      status.textContent = 'Mermaid 渲染失败，已保留可读源码。';
    }
  }, { once: true });
</script>
</body>
</html>`;
}

function escapeHtml(s) {
	return String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function scaffoldHelpHtml(title, raw) {
	return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"/><title>${escapeHtml(title)}</title>
<style>
body{margin:0;background:#020617;color:#e2e8f0;font-family:ui-sans-serif,system-ui,sans-serif;padding:28px;line-height:1.55}
.card{max-width:820px;margin:0 auto;background:#0f172a;border:1px solid #1e293b;border-radius:14px;padding:22px}
h1{margin:0 0 8px;font-size:20px} code,pre{font-family:ui-monospace,monospace;font-size:12px}
pre{background:#020617;border:1px solid #1e293b;border-radius:10px;padding:12px;overflow:auto;white-space:pre-wrap}
.muted{color:#94a3b8;font-size:13px}
.ok{color:#34d399}.warn{color:#fbbf24}
</style></head>
<body><div class="card">
<h1>Arch 模式需要结构化输入</h1>
<p class="muted">当前 content 不是 HTML / Archify JSON / Mermaid。请让 Agent 输出 Archify IR 后重试。</p>
<p><span class="ok">推荐</span>：<code>diagram_type: architecture|workflow|sequence|dataflow|lifecycle</code> 的 JSON。</p>
<pre>${escapeHtml(raw.slice(0, 2000))}</pre>
<p class="warn">参考：tt-a1i/archify · Cocoon-AI/architecture-diagram-generator</p>
</div></body></html>`;
}

const graphScript = `
<script data-talk-arch-graph>
/* graph 交互层：Archify 组件漫游（talk/arch 集成）。v2.13+ 组件包裹在 <g data-node-id>（稳定语义钩子），拖拽整组 translate；旧版输出回退 rect 启发式。 */
(function(){
  if (window.__talkArchGraph) return; window.__talkArchGraph = 1;
  var TYPES = ['frontend','backend','database','cloud','security','messagebus','external'];
  var svg = document.querySelector('svg');
  if (!svg) return;
  var view = (svg.getAttribute('viewBox')||'').split(/[\s,]+/).map(Number);
  var vw = view[2] || svg.clientWidth, vh = view[3] || svg.clientHeight;
  function pt(e){ var r = svg.getBoundingClientRect(); return [(e.clientX-r.left)/r.width*vw, (e.clientY-r.top)/r.height*vh]; }
  function legacyComps(){ return Array.prototype.slice.call(svg.querySelectorAll('rect[class*="c-"]')).filter(function(r){
    var c = r.getAttribute('class')||''; if (!TYPES.some(function(t){ return c.indexOf('c-'+t) >= 0; })) return false;
    if ((r.getAttribute('stroke-width')||'') === '') return false;
    // 排除图例色块等小元素（真实组件 rect 宽高 >= 40）
    var w = Number(r.getAttribute('width'))||0, h = Number(r.getAttribute('height'))||0;
    return w >= 40 && h >= 24;
  }); }
  function comps(){ var g=Array.prototype.slice.call(svg.querySelectorAll('g[data-node-id]')); return g.length?g:legacyComps(); }
  function isGroup(u){ return u && (u.tagName==='g'||u.tagName==='G'); }
  function fillRectOf(u){ if (!isGroup(u)) return u;
    return u.querySelector('rect[stroke-width]') || u.querySelector('rect'); }
  function labelOf(u){ var l=u.getAttribute('data-node-label'); if (l) return l.trim();
    var rect=fillRectOf(u); if (!rect) return '组件';
    var x=Number(rect.getAttribute('x'))+Number(rect.getAttribute('width'))/2, y=Number(rect.getAttribute('y'));
    var best=null, bd=1e9;
    Array.prototype.slice.call(svg.querySelectorAll('text.t-primary')).forEach(function(t){
      var tx=Number(t.getAttribute('x')), ty=Number(t.getAttribute('y'));
      var d=Math.abs(tx-x)+Math.abs(ty-(y+Number(rect.getAttribute('height'))/2));
      if (d<bd){ bd=d; best=t; } });
    return best? (best.textContent||'').trim() : (rect.getAttribute('data-label')||'组件'); }
  function typeOf(u){ var k=u.getAttribute('data-node-kind'); if (k) return k;
    var rect=fillRectOf(u); var c=((rect||u).getAttribute('class')||'');
    for (var i=0;i<TYPES.length;i++){ if (c.indexOf('c-'+TYPES[i])>=0) return TYPES[i]; } return ''; }
  function unitFromEvent(e){ var t=e.target; if (!t) return null;
    if (t.closest){ var g=t.closest('g[data-node-id]'); if (g && svg.contains(g)) return g; }
    if (t.tagName==='rect' && (t.getAttribute('class')||'').indexOf('c-')>=0 && typeOf(t)) return t;
    return null; }
  var offsets=(typeof WeakMap!=='undefined')?new WeakMap():{get:function(){},set:function(){}}; // group → 累计 translate
  function offsetOf(u){ return offsets.get(u)||{dx:0,dy:0}; }
  // 在组件父坐标系中取点（兼容上游 viewer 的缩放/平移变换）
  function parentPt(u,e){ var pn=u.parentNode; var m=pn&&pn.getScreenCTM?pn.getScreenCTM():null;
    if (!m || typeof DOMPoint==='undefined') return pt(e);
    var p=new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse()); return [p.x,p.y]; }
  var sel = new Set(), drag=null, shift=false, boxDrag=null;
  var bar = document.createElement('div');
  bar.setAttribute('data-talk-graph-ui','');
  bar.style.cssText='position:fixed;right:12px;top:12px;z-index:9999;display:flex;flex-direction:column;gap:6px;align-items:flex-end;font:12px/1.4 ui-sans-serif,system-ui,sans-serif';
  bar.innerHTML='<div style="background:rgba(2,6,23,.88);border:1px solid #334155;border-radius:10px;padding:7px 10px;color:#e2e8f0">🖱 单击=选中 · 双击=详情 · 拖拽=移动 · Shift+拖=框选<br><span id="tag-expl" style="color:#94a3b8">'+(comps().length||0)+' 个组件</span></div>';
  var filterRow=document.createElement('div'); filterRow.style.cssText='display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end';
  var filters={}; TYPES.forEach(function(t){
    var chip=document.createElement('button'); chip.textContent=t; chip.dataset.t=t;
    chip.style.cssText='all:unset;cursor:pointer;padding:2px 8px;border-radius:999px;border:1px solid #334155;color:#94a3b8;background:rgba(2,6,23,.7)';
    filters[t]=true;
    chip.onclick=function(){ filters[t]=!filters[t]; chip.style.opacity=filters[t]?1:.35; chip.style.borderColor=filters[t]?'#334155':'#1e293b';
      comps().forEach(function(r){ var on=filters[typeOf(r)]; r.style.opacity=on?1:.1; }); };
    filterRow.appendChild(chip); });
  bar.appendChild(filterRow);
  var explain=document.createElement('button');
  explain.style.cssText='display:none;all:unset;cursor:pointer;padding:4px 10px;border-radius:999px;background:#4f5ef0;color:#fff';
  explain.textContent='只解释这块 (0)';
  explain.onclick=function(){ var labels=[]; sel.forEach(function(r){ labels.push(labelOf(r)); });
    if (window.talkSend) window.talkSend('graph.explain',{nodes:labels,count:sel.size}); sel.clear(); paint(); explain.style.display='none'; };
  bar.appendChild(explain);
  document.body.appendChild(bar);
  function paint(){ comps().forEach(function(u){ var r=fillRectOf(u); if(!r) return; var on=sel.has(u); r.style.stroke=on?'#f59e0b':''; r.style.strokeWidth=on?3:''; }); }
  svg.addEventListener('pointerdown',function(e){
    var u=unitFromEvent(e);
    if (u){ var r=fillRectOf(u);
      if (isGroup(u)){ var p=parentPt(u,e); drag={unit:u,sx:p[0],sy:p[1],base:offsetOf(u),origT:u.getAttribute('transform')||''}; }
      else if (r){ var p2=pt(e); drag={unit:u,rect:r,ox:p2[0]-Number(r.getAttribute('x')),oy:p2[1]-Number(r.getAttribute('y'))}; }
      if (drag){ e.preventDefault(); return; } }
    if (e.shiftKey){ boxDrag={x0:e.clientX,y0:e.clientY}; e.preventDefault(); } });
  svg.addEventListener('pointermove',function(e){
    if (drag){
      if (isGroup(drag.unit)){ var p=parentPt(drag.unit,e);
        var dx=drag.base.dx+(p[0]-drag.sx), dy=drag.base.dy+(p[1]-drag.sy);
        drag.unit.setAttribute('transform',(drag.origT?drag.origT+' ':'')+'translate('+dx+' '+dy+')');
        offsets.set(drag.unit,{dx:dx,dy:dy}); }
      else if (drag.rect){ var p2=pt(e); drag.rect.setAttribute('x',p2[0]-drag.ox); drag.rect.setAttribute('y',p2[1]-drag.oy); }
      return; }
    if (boxDrag){ boxDrag.x1=e.clientX; boxDrag.y1=e.clientY; } });
  svg.addEventListener('pointerup',function(e){
    if (drag){ drag=null; return; }
    if (boxDrag){ var b=boxDrag; boxDrag=null;
      // 屏幕坐标框选，天然兼容 viewer 缩放/平移
      var x1=Math.min(b.x0,b.x1),x2=Math.max(b.x0,b.x1),y1=Math.min(b.y0,b.y1),y2=Math.max(b.y0,b.y1);
      sel.clear();
      comps().forEach(function(u){ var r=u.getBoundingClientRect();
        if (r.left<x2&&r.right>x1&&r.top<y2&&r.bottom>y1) sel.add(u); });
      paint(); explain.style.display=sel.size?'':'none'; if (sel.size) explain.textContent='只解释这块 ('+sel.size+')';
      if (sel.size && window.talkSend) window.talkSend('graph.select',{nodes:sel.size}); } });
  svg.addEventListener('dblclick',function(e){
    var u=unitFromEvent(e); if (!u) return;
    var label=labelOf(u), type=typeOf(u), ub=u.getBoundingClientRect();
    var related=[]; comps().forEach(function(o){ if (o!==u){ var ob=o.getBoundingClientRect(); var d=Math.abs(ob.left-ub.left)+Math.abs(ob.top-ub.top); if (d<260) related.push(labelOf(o)); } });
    if (window.talkSend) window.talkSend('graph.detail',{node:label,type:type,relations:related});
    var d=document.createElement('div'); d.style.cssText='position:fixed;right:12px;bottom:64px;z-index:9999;background:rgba(2,6,23,.94);border:1px solid #334155;border-radius:12px;padding:12px 14px;color:#e2e8f0;max-width:260px;font:12px/1.5 ui-sans-serif,system-ui,sans-serif';
    d.innerHTML='<b style="color:#fff">'+label+'</b> <span style="color:#94a3b8">· '+type+'</span><div style="color:#94a3b8;margin-top:4px">关联：'+(related.join('、')||'—')+'</div><div style="margin-top:6px;color:#64748b">talkSend(graph.detail) 已回传</div>';
    document.body.appendChild(d); setTimeout(function(){ d.remove(); }, 3600);
  });
  svg.addEventListener('click',function(e){
    var u=unitFromEvent(e); if (!u) return;
    if (!e.shiftKey){ sel.clear(); }
    sel.has(u)?sel.delete(u):sel.add(u); paint();
    explain.style.display=sel.size?'':'none'; if (sel.size) explain.textContent='只解释这块 ('+sel.size+')';
    if (window.talkSend) window.talkSend('graph.select',{node:labelOf(u),type:typeOf(u)});
  });
})();
</script>
`;

function injectTalkChrome(html, title) {
	if (html.includes("data-talk-arch-chrome")) return html;
	const bar = `
<div data-talk-arch-chrome style="position:fixed;left:12px;bottom:12px;z-index:9999;display:flex;gap:8px;align-items:center;background:rgba(2,6,23,.88);border:1px solid #334155;border-radius:999px;padding:8px 12px;color:#e2e8f0;font:12px/1 ui-sans-serif,system-ui,sans-serif;backdrop-filter:blur(8px)">
  <span style="opacity:.7">talk/arch</span>
  <strong style="font-weight:600">${escapeHtml(title).slice(0, 40)}</strong>
  <button data-talk-event="arch-feedback" data-talk-value="good" style="all:unset;cursor:pointer;padding:4px 8px;border-radius:999px;border:1px solid #334155">好看</button>
  <button data-talk-event="arch-feedback" data-talk-value="simplify" style="all:unset;cursor:pointer;padding:4px 8px;border-radius:999px;border:1px solid #334155">简化</button>
  <button data-talk-event="arch-feedback" data-talk-value="add-edge" style="all:unset;cursor:pointer;padding:4px 8px;border-radius:999px;border:1px solid #334155">补关系</button>
</div>`;
	if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${bar}${graphScript}\n</body>`);
	return html + bar + graphScript;
}

function main() {
	const args = parseArgs(process.argv);
	if (args.help || !args.input) {
		console.log(`Usage: arch-render.mjs --input <file> [--out <html>] [--title t] [--type architecture|...]`);
		process.exit(args.help ? 0 : 2);
	}

	const inputPath = resolve(args.input);
	if (!existsSync(inputPath)) {
		emit({ ok: false, message: `input not found: ${inputPath}` });
		process.exit(1);
	}

	const raw = readFileSync(inputPath, "utf8");
	const outPath =
		args.out ||
		join(dirname(inputPath), `${basename(inputPath).replace(/\.[^.]+$/, "") || "arch"}.html`);
	mkdirSync(dirname(outPath), { recursive: true });

	// 1) Full HTML (Cocoon hand-authored or prior archify output)
	if (isHtml(raw)) {
		const html = injectTalkChrome(raw, args.title);
		writeFileSync(outPath, html);
		emit({ ok: true, htmlPath: outPath, type: "html", engine: "passthrough", message: "served HTML diagram" });
		return;
	}

	// 2) JSON IR → Archify
	const json = tryParseJson(raw);
	if (json && typeof json === "object") {
		const archify = findArchify();
		if (!archify) {
			emit({
				ok: false,
				message:
					"Archify not found. Install: npx skills add tt-a1i/archify -g  (or clone to ~/.claude/skills/archify)",
			});
			process.exit(1);
		}
		const type = detectType(json, args.type);
		// Ensure diagram_type present for validators that expect it
		if (!json.diagram_type) {
			json.diagram_type = type;
			writeFileSync(inputPath, JSON.stringify(json, null, 2));
		}
		if (args.title && json.meta && !json.meta.title) {
			json.meta.title = args.title;
			writeFileSync(inputPath, JSON.stringify(json, null, 2));
		}

		const result = spawnSync(process.execPath, [archify.bin, "render", type, inputPath, outPath], {
			encoding: "utf8",
		});
		if (result.status !== 0) {
			emit({
				ok: false,
				type,
				engine: "archify",
				message: (result.stderr || result.stdout || "archify render failed").trim(),
				htmlPath: existsSync(outPath) ? outPath : undefined,
			});
			process.exit(result.status || 1);
		}
		if (existsSync(outPath)) {
			const html = injectTalkChrome(readFileSync(outPath, "utf8"), args.title || json.meta?.title || type);
			writeFileSync(outPath, html);
		}
		emit({
			ok: true,
			htmlPath: outPath,
			type,
			engine: "archify",
			archifyRoot: archify.root,
			message: `archify render ${type} → ${outPath}`,
		});
		return;
	}

	// 3) Mermaid fallback
	if (looksLikeMermaid(raw)) {
		writeFileSync(outPath, injectTalkChrome(wrapMermaid(args.title, raw.trim()), args.title));
		emit({ ok: true, htmlPath: outPath, type: "mermaid", engine: "mermaid-fallback", message: "mermaid viewer" });
		return;
	}

	// 4) Help page
	writeFileSync(outPath, scaffoldHelpHtml(args.title, raw));
	emit({
		ok: false,
		htmlPath: outPath,
		type: "help",
		engine: "none",
		message: "content is not HTML/JSON/Mermaid — wrote guidance page",
	});
	process.exit(1);
}

function emit(obj) {
	process.stdout.write(JSON.stringify(obj) + "\n");
}

try {
	main();
} catch (err) {
	emit({ ok: false, message: err instanceof Error ? err.message : String(err) });
	process.exit(1);
}
