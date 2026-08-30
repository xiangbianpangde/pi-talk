/**
 * Lightweight local talk surface server.
 *
 * - Serves the current HTML document at /
 * - Live-reloads via SSE at /events/stream
 * - Accepts interaction events at POST /api/event  (from page JS talkSend)
 * - Health at /health
 *
 * Bound to 127.0.0.1 only. No auth beyond loopback — do not put secrets in HTML.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { parse as parseHtml, parseFragment, serialize } from "../../../npm/node_modules/parse5/dist/index.js";
import { getTalkHome } from "./paths";
import type { TalkEvent } from "./types";

export interface TalkServerState {
	title: string;
	html: string;
	styleId: string;
	kind: string;
	updatedAt: number;
	contentSecurityPolicy?: string;
	/** Author content fragment (for markdown export). */
	fragment?: string;
}

export interface TalkServer {
	port: number;
	url: string;
	getState(surfaceId?: string): TalkServerState | undefined;
	listSurfaces(): Array<{ id: string; title: string; styleId: string; kind: string; updatedAt: number }>;
	setDocument(doc: { title?: string; html: string; styleId: string; kind: string; contentSecurityPolicy?: string; fragment?: string }, surfaceId?: string): void;
	applyPatch(patch: { selector: string; html?: string; method?: string; surface?: string }): { ok: boolean; error?: string; persisted?: boolean; html?: string; warning?: string };
	/** Persistence hook: called for every accepted event. */
	onEvent?: (event: TalkEvent) => void;
	pushEvent(
		event: Omit<TalkEvent, "id" | "ts"> & { id?: string; ts?: number },
		opts?: { persist?: boolean; broadcast?: boolean },
	): TalkEvent;
	drainEvents(afterId?: string): TalkEvent[];
	listEvents(): TalkEvent[];
	close(): Promise<void>;
}

const BRIDGE_SOURCE = `
(() => {
  const SOURCE = "talk-bridge";
  const surfaceId = (() => {
    try { return document.body && document.body.getAttribute("data-talk-surface") || null; } catch (_) { return null; }
  })();
  function talkSend(type, payload) {
    const body = JSON.stringify({
      type: typeof type === "string" ? type : "event",
      payload: payload === undefined ? (typeof type === "object" ? type : null) : payload,
      source: SOURCE,
      surface: surfaceId,
    });
    return fetch("/api/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }
  window.talkSend = talkSend;
  window.talkEmit = talkSend;
  // Live reload + incremental DOM patches
  try {
    const es = new EventSource("/events/stream");
    es.addEventListener("reload", (ev) => {
      try {
        const d = JSON.parse(ev.data || "{}");
        if (d.surfaceId && d.surfaceId !== surfaceId) return; // other surface changed
        location.reload();
      } catch (_) { location.reload(); }
    });
    es.addEventListener("patch", (ev) => {
      let d = {};
      try { d = JSON.parse(ev.data || "{}"); } catch (_) {}
      if (d.surfaceId && d.surfaceId !== surfaceId) return;
      if (!d.selector) return;
      const el = document.querySelector(d.selector);
      if (!el) return;
      const html = typeof d.html === "string" ? d.html : "";
      switch (d.method || "inner") {
        case "remove": el.remove(); break;
        case "outer": el.outerHTML = html; break;
        case "append": el.insertAdjacentHTML("beforeend", html); break;
        case "prepend": el.insertAdjacentHTML("afterbegin", html); break;
        default: el.innerHTML = html;
      }
      window.dispatchEvent(new CustomEvent("talk:patched", { detail: d }));
    });
    es.onerror = () => { /* browser retries */ };
  } catch (_) {}
  // Click delegation helper: elements with data-talk-event
  document.addEventListener("click", (ev) => {
    const el = ev.target && ev.target.closest ? ev.target.closest("[data-talk-event]") : null;
    if (!el) return;
    const type = el.getAttribute("data-talk-event") || "click";
    const payload = {
      id: el.id || null,
      text: (el.innerText || "").trim().slice(0, 200),
      value: el.getAttribute("data-talk-value"),
      href: el.getAttribute("href"),
    };
    talkSend(type, payload);
  }, true);
  // Form submission: any form with [data-talk-form] serializes and sends
  document.addEventListener("submit", (ev) => {
    const form = ev.target && ev.target.closest ? ev.target.closest("[data-talk-form]") : null;
    if (!form) return;
    ev.preventDefault();
    const type = form.getAttribute("data-talk-form") || "form";
    const fd = new FormData(form);
    const values = {};
    for (const [k, v] of fd.entries()) {
      if (k in values) {
        if (!Array.isArray(values[k])) values[k] = [values[k]];
        values[k].push(v);
      } else values[k] = v;
    }
    talkSend(type, {
      id: form.id || null,
      name: form.getAttribute("name"),
      values,
      action: form.getAttribute("action"),
    });
  }, true);
  // Debounced input events: elements with [data-talk-input]
  const inputTimers = {};
  document.addEventListener("input", (ev) => {
    const el = ev.target && ev.target.closest ? ev.target.closest("[data-talk-input]") : null;
    if (!el) return;
    const type = el.getAttribute("data-talk-input") || "input";
    clearTimeout(inputTimers[el]);
    inputTimers[el] = setTimeout(() => {
      const payload = {
        id: el.id || null,
        name: el.getAttribute("name") || el.getAttribute("data-name"),
        value: el.value ?? null,
        checked: el.checked ?? null,
        tag: el.tagName,
      };
      const host = el.form && el.form.closest ? el.form.closest("[data-talk-form]") : null;
      if (host) payload.form = host.getAttribute("data-talk-form") || "form";
      talkSend(type, payload);
    }, 350);
  }, true);
})();
`.trim();

const BRIDGE_SCRIPT = `<script id="talk-bridge" data-talk-bridge="v2">${BRIDGE_SOURCE}</script>`;

function htmlNodes(root: any): any[] {
	const out: any[] = [];
	const stack: any[] = [root];
	while (stack.length) {
		const node = stack.pop();
		if (!node) continue;
		out.push(node);
		const children = [...(node.childNodes ?? [])];
		if (node.content) children.push(node.content);
		for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
	}
	return out;
}

function nodeAttrs(node: any): Map<string, string> {
	return new Map((node?.attrs ?? []).map((attribute: { name: string; value: string }) => [attribute.name.toLowerCase(), attribute.value]));
}

function nodeText(node: any): string {
	return htmlNodes(node)
		.filter((current) => current?.nodeName === "#text")
		.map((current) => String(current.value ?? ""))
		.join("");
}

function insertBeforeTrustedEndTag(html: string, tagName: "head" | "body" | "html", insertion: string): string | undefined {
	const document = parseHtml(html, { sourceCodeLocationInfo: true }) as any;
	const element = htmlNodes(document).find((node) => node?.tagName === tagName && node?.sourceCodeLocation?.endTag);
	const offset = element?.sourceCodeLocation?.endTag?.startOffset;
	if (!Number.isInteger(offset)) return undefined;
	return `${html.slice(0, offset)}${insertion}\n${html.slice(offset)}`;
}

export function injectBridge(html: string, opts?: { interactive?: boolean }): string {
	if (!opts?.interactive) return html;
	const document = parseHtml(html, { sourceCodeLocationInfo: true }) as any;
	const hasTrustedBridge = htmlNodes(document).some((node) => {
		if (node?.tagName !== "script") return false;
		const attrs = nodeAttrs(node);
		return attrs.get("id") === "talk-bridge"
			&& attrs.get("data-talk-bridge") === "v2"
			&& nodeText(node) === BRIDGE_SOURCE;
	});
	if (hasTrustedBridge) return html;
	return insertBeforeTrustedEndTag(html, "body", BRIDGE_SCRIPT)
		?? insertBeforeTrustedEndTag(html, "html", BRIDGE_SCRIPT)
		?? `${html}\n${BRIDGE_SCRIPT}`;
}

export function getBridgeVersion(html: string): number {
	const document = parseHtml(html, { sourceCodeLocationInfo: true }) as any;
	for (const node of htmlNodes(document)) {
		if (node?.tagName !== "script") continue;
		const attrs = nodeAttrs(node);
		if (attrs.get("id") === "talk-bridge" && attrs.get("data-talk-bridge")) {
			return Number(attrs.get("data-talk-bridge").replace(/^v/, "")) || 1;
		}
	}
	return 0;
}

interface CompoundSelector {
	tag?: string;
	id?: string;
	classes: string[];
}

/**
 * Compile a single compound selector (tag / #id / .class combinations, or `*`).
 * Combinators, lists, pseudo-classes and attribute selectors are intentionally
 * unsupported — callers fall back to broadcast-only patching for those.
 */
export function compileCompoundSelector(raw: string): CompoundSelector | undefined {
	const s = raw.trim();
	if (!s || /[\s,>+~\[({"':]/.test(s)) return undefined;
	let tag: string | undefined;
	let id: string | undefined;
	const classes: string[] = [];
	let i = 0;
	if (s[0] !== "#" && s[0] !== ".") {
		const m = /^(\*|[a-zA-Z][a-zA-Z0-9-]*)/.exec(s);
		if (!m) return undefined;
		tag = m[1]!.toLowerCase();
		i = m[1]!.length;
	}
	while (i < s.length) {
		if (s[i] === "#") {
			const m = /^#([\w-]+)/.exec(s.slice(i));
			if (!m || id !== undefined) return undefined;
			id = m[1]!;
			i += m[0].length;
		} else if (s[i] === ".") {
			const m = /^\.([\w-]+)/.exec(s.slice(i));
			if (!m) return undefined;
			classes.push(m[1]!);
			i += m[0].length;
		} else {
			return undefined;
		}
	}
	if (i === 0 && !classes.length && id === undefined) return undefined;
	return { tag, id, classes };
}

function nodeMatchesCompound(node: any, sel: CompoundSelector): boolean {
	if (!node?.tagName) return false;
	if (sel.tag && sel.tag !== "*" && String(node.tagName).toLowerCase() !== sel.tag) return false;
	const attrs = nodeAttrs(node);
	if (sel.id && attrs.get("id") !== sel.id) return false;
	if (sel.classes.length) {
		const cls = new Set((attrs.get("class") ?? "").split(/\s+/).filter(Boolean));
		for (const c of sel.classes) if (!cls.has(c)) return false;
	}
	return true;
}

/**
 * Apply a DOM patch to an HTML string server-side so the stored document stays
 * authoritative (survives reload, resume and export). Returns undefined when
 * the selector is unsupported or matched nothing — callers should then keep
 * the live-browser broadcast only and warn that a reload loses the patch.
 */
export function applyPatchToHtml(
	html: string,
	patch: { selector: string; html?: string; method?: string },
	opts?: { fragment?: boolean },
): string | undefined {
	const sel = compileCompoundSelector(patch.selector);
	if (!sel) return undefined;
	const method = patch.method ?? "inner";
	if (method !== "remove" && typeof patch.html !== "string") return undefined;
	const parsed = opts?.fragment ? (parseFragment(html) as any) : (parseHtml(html) as any);
	// htmlNodes walks in document order — same as querySelector picking the first match
	const target = htmlNodes(parsed).find((node: any) => nodeMatchesCompound(node, sel));
	if (!target) return undefined;
	if (method === "remove") {
		const parent = target.parentNode;
		if (!parent) return undefined;
		const idx = parent.childNodes.indexOf(target);
		if (idx < 0) return undefined;
		parent.childNodes.splice(idx, 1);
	} else {
		const nodes = [...(parseFragment(patch.html ?? "") as any).childNodes];
		for (const n of nodes) n.parentNode = target.parentNode;
		if (method === "inner") {
			target.childNodes = [...nodes];
			for (const n of nodes) n.parentNode = target;
		} else if (method === "outer") {
			const parent = target.parentNode;
			if (!parent) return undefined;
			const idx = parent.childNodes.indexOf(target);
			if (idx < 0) return undefined;
			parent.childNodes.splice(idx, 1, ...nodes);
		} else if (method === "append") {
			target.childNodes.push(...nodes);
		} else if (method === "prepend") {
			target.childNodes.unshift(...nodes);
		} else {
			return undefined;
		}
	}
	return serialize(parsed);
}

export function injectContentSecurityPolicyMeta(html: string, policy: string, styleNonce?: string): string {
	const metaPolicy = policy
		.split(";")
		.map((directive) => directive.trim())
		.filter((directive) => directive && !directive.startsWith("frame-ancestors"))
		.join("; ");
	const tag = `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(metaPolicy)}">`;
	const nonceTag = styleNonce ? `\n<meta name="report-style-nonce" content="${escapeHtml(styleNonce)}">` : "";
	return insertBeforeTrustedEndTag(html, "head", `${tag}${nonceTag}`) ?? html;
}

function cspHash(source: string, algorithm: "sha256" | "sha384" | "sha512" = "sha256"): string {
	return `'${algorithm}-${createHash(algorithm).update(source).digest("base64")}'`;
}

/**
 * Build a strict report-only CSP from the trusted style template, never from
 * author content. External scripts must carry an integrity hash that is also in
 * script-src; inline execution is limited to the trusted report runtime/bridge.
 */
export function buildReportContentSecurityPolicy(
	template: string,
	interactive = true,
	options?: { styleNonce?: string },
): string {
	const scriptSources = new Set<string>();
	const styleSources = new Set<string>();
	const runtime = template.match(/<script\b(?=[^>]*\bid\s*=\s*(["'])report-runtime\1)[^>]*>([\s\S]*?)<\/script>/i);
	if (runtime?.[2] !== undefined) scriptSources.add(cspHash(runtime[2]));
	for (const match of template.matchAll(/\b(?:integrity|data-sri)\s*=\s*(["'])((?:sha256|sha384|sha512)-[A-Za-z0-9+/=]+)\1/gi)) {
		scriptSources.add(`'${match[2]}'`);
	}
	if (interactive) scriptSources.add(cspHash(BRIDGE_SOURCE));
	for (const match of template.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
		styleSources.add(cspHash(match[1] ?? ""));
	}
	const scripts = scriptSources.size ? [...scriptSources].join(" ") : "'none'";
	const nonce = options?.styleNonce && /^[A-Za-z0-9+/_=-]+$/.test(options.styleNonce)
		? `'nonce-${options.styleNonce}'`
		: undefined;
	const styles = [...styleSources, ...(nonce ? [nonce] : [])];
	const styleElements = styles.length ? styles.join(" ") : "'none'";
	return [
		"default-src 'none'",
		`script-src ${scripts}`,
		"script-src-attr 'none'",
		"style-src 'none'",
		`style-src-elem ${styleElements}`,
		"style-src-attr 'unsafe-inline'",
		"img-src 'self' data: https:",
		"font-src 'self' data: https:",
		"connect-src 'self'",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
		"frame-src 'none'",
		"frame-ancestors 'none'",
		"worker-src 'none'",
	].join("; ");
}

export function wrapFragmentAsDocument(opts: {
	title: string;
	bodyHtml: string;
	interactive?: boolean;
}): string {
	const safeTitle = escapeHtml(opts.title || "Talk");
	const doc = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #0f1419;
      --fg: #e7ecf1;
      --muted: #8b9aab;
      --accent: #6cb6ff;
      --card: #1a2332;
      --border: #2a3544;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f6f8fa;
        --fg: #1f2328;
        --muted: #656d76;
        --accent: #0969da;
        --card: #ffffff;
        --border: #d0d7de;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.5;
      padding: 24px;
    }
    .talk-shell { max-width: 960px; margin: 0 auto; }
    .talk-banner {
      display: flex; justify-content: space-between; align-items: baseline;
      gap: 12px; margin-bottom: 16px; color: var(--muted); font-size: 12px;
    }
    .talk-banner strong { color: var(--accent); font-size: 14px; }
    .talk-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
    }
    button, .talk-btn {
      appearance: none;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--fg);
      border-radius: 8px;
      padding: 8px 12px;
      cursor: pointer;
      font: inherit;
    }
    button:hover, .talk-btn:hover { border-color: var(--accent); color: var(--accent); }
    a { color: var(--accent); }
    pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    pre { overflow: auto; padding: 12px; background: rgba(127,127,127,.08); border-radius: 8px; }
  </style>
</head>
<body>
  <div class="talk-shell">
    <div class="talk-banner">
      <strong>pi /talk</strong>
      <span>${safeTitle}</span>
    </div>
    <div class="talk-card" id="talk-root">
      ${opts.bodyHtml}
    </div>
  </div>
</body>
</html>`;
	return injectBridge(doc, { interactive: opts.interactive });
}

export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (c: Buffer) => {
			size += c.length;
			if (size > limit) {
				reject(new Error("body too large"));
				req.destroy();
				return;
			}
			chunks.push(c);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

const SECURITY_HEADERS = {
	"x-content-type-options": "nosniff",
	"x-frame-options": "DENY",
	"referrer-policy": "no-referrer",
	"permissions-policy": "camera=(), microphone=(), geolocation=()",
} as const;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
	const data = JSON.stringify(body);
	res.writeHead(status, {
		...SECURITY_HEADERS,
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(data),
		"cache-control": "no-store",
	});
	res.end(data);
}

function sendText(
	res: ServerResponse,
	status: number,
	body: string,
	type: string,
	extraHeaders?: Record<string, string>,
): void {
	res.writeHead(status, {
		...SECURITY_HEADERS,
		...extraHeaders,
		"content-type": type,
		"content-length": Buffer.byteLength(body),
		"cache-control": "no-store",
	});
	res.end(body);
}

function acceptsRequestOrigin(req: IncomingMessage): boolean {
	const origin = req.headers.origin;
	if (!origin) return true;
	const host = req.headers.host;
	return Boolean(host && origin === `http://${host}`);
}

/**
 * DNS-rebinding guard: a rebound page reaches 127.0.0.1 with its own hostname
 * in the Host header, so only the literal loopback hosts may be addressed.
 * The port is random per server, which keeps this tight without a token.
 */
function isLoopbackHostHeader(req: IncomingMessage, port: number): boolean {
	const host = req.headers.host;
	if (!host) return false;
	const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
	const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, `::1:${port}`]);
	return allowed.has(host.toLowerCase()) || allowed.has(normalized);
}

let eventSeq = 0;
export function nextEventId(prefix = "evt"): string {
	eventSeq += 1;
	return `${prefix}_${Date.now().toString(36)}_${eventSeq}`;
}

const COMPONENTS_DIR = join(getTalkHome(), "components");

function surfaceIdOk(id: string): boolean {
	return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id);
}

function stampSurfaceBody(html: string, surfaceId: string): string {
	if (!html || html.includes(`data-talk-surface="${surfaceId}"`)) return html;
	return html.replace(/<body\b([^>]*)>/i, (m, attrs: string) => {
		if (/\bdata-talk-surface\s*=/.test(attrs)) return m;
		return `<body${attrs} data-talk-surface="${surfaceId}">`;
	});
}

export async function startTalkServer(opts?: {
	host?: string;
	port?: number;
}): Promise<TalkServer> {
	const host = opts?.host ?? "127.0.0.1";
	const defaultDoc = (title: string): TalkServerState => ({
		title,
		html: wrapFragmentAsDocument({
			title,
			bodyHtml: "<p>Waiting for the agent to render…</p><p style=\"color:var(--muted)\">Use <code>talk_render</code>.</p>",
			interactive: true,
		}),
		styleId: "html-interactive",
		kind: "html-js",
		updatedAt: Date.now(),
	});
	const surfaces = new Map<string, TalkServerState>([["main", defaultDoc("Talk")]]);
	let activeSurface = "main";
	const events: TalkEvent[] = [];
	const sseClients = new Set<ServerResponse>();
	let onEvent: ((event: TalkEvent) => void) | undefined;

	let boundPort = 0;
	const server: Server = createServer(async (req, res) => {
		const url = new URL(req.url || "/", `http://${host}`);
		try {
			if (boundPort === 0 || !isLoopbackHostHeader(req, boundPort)) {
				sendJson(res, 403, { ok: false, error: "host header not allowed (loopback only)" });
				return;
			}
			if (req.method === "GET" && url.pathname === "/favicon.ico") {
				res.writeHead(204, { ...SECURITY_HEADERS, "cache-control": "public, max-age=86400" });
				res.end();
				return;
			}
			if (req.method === "GET" && url.pathname === "/health") {
				const active = surfaces.get(activeSurface)!;
				sendJson(res, 200, { ok: true, updatedAt: active.updatedAt, styleId: active.styleId, surface: activeSurface });
				return;
			}
			if (req.method === "GET" && url.pathname === "/api/components/tokens.css") {
				const file = join(COMPONENTS_DIR, "tokens.css");
				try {
					const css = readFileSync(file, "utf8");
					sendText(res, 200, css, "text/css; charset=utf-8", { "cache-control": "public, max-age=60" });
				} catch {
					sendJson(res, 404, { ok: false, error: "components/tokens.css not found" });
				}
				return;
			}
			// Surface routes: /s/<id> serves that surface; / serves the active one
			let surfaceId: string | undefined;
			if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
				surfaceId = activeSurface;
			} else if (req.method === "GET") {
				const m = /^\/s\/([a-z0-9][a-z0-9_-]{0,63})\/?$/i.exec(url.pathname);
				if (m) surfaceId = m[1];
			}
			if (surfaceId) {
				const state = surfaces.get(surfaceId);
				if (!state) {
					sendJson(res, 404, { ok: false, error: `surface ${surfaceId} not found` });
					return;
				}
				sendText(
					res,
					200,
					stampSurfaceBody(state.html, surfaceId),
					"text/html; charset=utf-8",
					state.contentSecurityPolicy ? { "content-security-policy": state.contentSecurityPolicy } : undefined,
				);
				return;
			}
			if (req.method === "GET" && url.pathname === "/api/state") {
				const active = surfaces.get(activeSurface)!;
				sendJson(res, 200, {
					title: active.title,
					styleId: active.styleId,
					kind: active.kind,
					updatedAt: active.updatedAt,
					eventCount: events.length,
					surface: activeSurface,
					surfaces: [...surfaces.entries()].map(([id, s]) => ({ id, title: s.title, styleId: s.styleId, kind: s.kind, updatedAt: s.updatedAt })),
				});
				return;
			}
			if (req.method === "GET" && url.pathname === "/api/surfaces") {
				sendJson(res, 200, {
					active: activeSurface,
					surfaces: [...surfaces.entries()].map(([id, s]) => ({ id, title: s.title, styleId: s.styleId, kind: s.kind, updatedAt: s.updatedAt })),
				});
				return;
			}
			if (req.method === "GET" && url.pathname === "/api/events") {
				const after = url.searchParams.get("after") || undefined;
				sendJson(res, 200, { events: drain(after) });
				return;
			}
			if (req.method === "GET" && url.pathname === "/events/stream") {
				res.writeHead(200, {
					...SECURITY_HEADERS,
					"content-type": "text/event-stream; charset=utf-8",
					"cache-control": "no-cache, no-transform",
					connection: "keep-alive",
				});
				res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, surface: activeSurface })}\n\n`);
				sseClients.add(res);
				req.on("close", () => sseClients.delete(res));
				return;
			}
			if (req.method === "POST" && url.pathname === "/api/event") {
				if (!acceptsRequestOrigin(req)) {
					sendJson(res, 403, { ok: false, error: "cross-origin event rejected" });
					return;
				}
				if (!String(req.headers["content-type"] ?? "").toLowerCase().includes("application/json")) {
					sendJson(res, 415, { ok: false, error: "application/json required" });
					return;
				}
				const raw = await readBody(req);
				let parsed: any = {};
				try {
					parsed = raw ? JSON.parse(raw) : {};
				} catch {
					sendJson(res, 400, { ok: false, error: "invalid json" });
					return;
				}
				const type = typeof parsed.type === "string" && parsed.type.trim() ? parsed.type.trim() : "event";
				const surface =
					typeof parsed.surface === "string" && surfaceIdOk(parsed.surface)
						? parsed.surface
						: undefined;
				const evt = push({
					type,
					payload: parsed.payload,
					source: typeof parsed.source === "string" ? parsed.source : "browser",
					surface,
				});
				sendJson(res, 200, { ok: true, id: evt.id });
				return;
			}
			if (req.method === "OPTIONS") {
				if (!acceptsRequestOrigin(req)) {
					sendJson(res, 403, { ok: false, error: "cross-origin preflight rejected" });
					return;
				}
				res.writeHead(204, {
					...SECURITY_HEADERS,
					"access-control-allow-methods": "GET,POST,OPTIONS",
					"access-control-allow-headers": "content-type",
				});
				res.end();
				return;
			}
			sendJson(res, 404, { ok: false, error: "not found" });
		} catch (error) {
			sendJson(res, 500, {
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	});

	function broadcast(eventName: string, data: unknown): void {
		const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
		for (const client of sseClients) {
			try {
				client.write(payload);
			} catch {
				sseClients.delete(client);
			}
		}
	}

	function push(
		partial: Omit<TalkEvent, "id" | "ts"> & { id?: string; ts?: number },
		pushOpts?: { persist?: boolean; broadcast?: boolean },
	): TalkEvent {
		const evt: TalkEvent = {
			id: partial.id ?? nextEventId(),
			ts: partial.ts ?? Date.now(),
			type: partial.type,
			payload: partial.payload,
			source: partial.source,
			surface: partial.surface,
		};
		events.push(evt);
		// Cap memory
		if (events.length > 500) events.splice(0, events.length - 500);
		if (pushOpts?.broadcast !== false) broadcast("talk-event", evt);
		if (pushOpts?.persist === false) return evt;
		try {
			onEvent?.(evt);
		} catch {
			/* persistence is best-effort */
		}
		return evt;
	}

	function drain(afterId?: string): TalkEvent[] {
		if (!afterId) return [...events];
		const idx = events.findIndex((e) => e.id === afterId);
		if (idx < 0) return [...events];
		return events.slice(idx + 1);
	}

	const port = await new Promise<number>((resolve, reject) => {
		const onError = (err: Error) => reject(err);
		server.once("error", onError);
		server.listen(opts?.port ?? 0, host, () => {
			server.off("error", onError);
			const addr = server.address();
			if (addr && typeof addr === "object") {
				boundPort = addr.port;
				resolve(addr.port);
			} else reject(new Error("failed to bind talk server"));
		});
	});

	return {
		port,
		url: `http://${host}:${port}/`,
		getState: (surfaceId) => {
			const id = surfaceId && surfaceIdOk(surfaceId) ? surfaceId : activeSurface;
			const s = surfaces.get(id);
			return s ? { ...s } : undefined;
		},
		listSurfaces: () =>
			[...surfaces.entries()].map(([id, s]) => ({ id, title: s.title, styleId: s.styleId, kind: s.kind, updatedAt: s.updatedAt })),
		setDocument(doc, surfaceId) {
			const id = surfaceId && surfaceIdOk(surfaceId) ? surfaceId : activeSurface;
			const prev = surfaces.get(id);
			const next: TalkServerState = {
				title: doc.title || prev?.title || "Talk",
				html: doc.html,
				styleId: doc.styleId,
				kind: doc.kind,
				updatedAt: Date.now(),
				contentSecurityPolicy: doc.contentSecurityPolicy,
				fragment: doc.fragment ?? prev?.fragment,
			};
			surfaces.set(id, next);
			activeSurface = id;
			broadcast("reload", { updatedAt: next.updatedAt, styleId: next.styleId, surfaceId: id });
		},
		applyPatch(patch) {
			if (!patch.selector || typeof patch.selector !== "string") {
				return { ok: false, error: "patch.selector is required" };
			}
			const id = patch.surface && surfaceIdOk(patch.surface) ? patch.surface : activeSurface;
			const state = surfaces.get(id);
			if (!state) return { ok: false, error: `surface ${id} not found` };
			const method = patch.method ?? "inner";
			if (!["inner", "outer", "append", "prepend", "remove"].includes(method)) {
				return { ok: false, error: `unknown patch method: ${method}` };
			}
			if (method !== "remove" && typeof patch.html !== "string") {
				return { ok: false, error: "patch.html is required unless method=remove" };
			}
			// Keep the stored document authoritative: apply the same patch
			// server-side so reload/resume/export see it. Unsupported selectors
			// still broadcast to live pages but are flagged as not persisted.
			let patchedHtml: string | undefined;
			let patchedFragment: string | undefined;
			try {
				patchedHtml = applyPatchToHtml(state.html, patch);
				if (state.fragment !== undefined) {
					patchedFragment = applyPatchToHtml(state.fragment, patch, { fragment: true });
				}
			} catch {
				patchedHtml = undefined;
			}
			if (patchedHtml !== undefined) {
				state.html = patchedHtml;
				if (patchedFragment !== undefined) state.fragment = patchedFragment;
				state.updatedAt = Date.now();
			}
			broadcast("patch", {
				surfaceId: id,
				selector: patch.selector,
				html: patch.html,
				method,
			});
			return patchedHtml === undefined
				? {
						ok: true,
						persisted: false,
						warning:
							"patch broadcast to live pages only (selector unsupported or no server-side match); a reload will lose it",
					}
				: { ok: true, persisted: true, html: patchedHtml };
		},
		set onEvent(handler) {
			onEvent = handler;
		},
		get onEvent() {
			return onEvent;
		},
		pushEvent: push,
		drainEvents: drain,
		listEvents: () => [...events],
		close: () =>
			new Promise((resolve) => {
				for (const client of sseClients) {
					try {
						client.end();
					} catch {
						/* ignore */
					}
				}
				sseClients.clear();
				surfaces.clear();
				server.close(() => resolve());
				// Ensure close even if no connections
				setTimeout(() => resolve(), 200).unref?.();
			}),
	};
}
