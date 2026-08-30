/**
 * Talk session runtime (process-local singleton via globalThis).
 * Survives accidental double-imports during tests; cleaned on session_shutdown.
 */

import { randomBytes } from "node:crypto";
import {
	existsSync,
	appendFileSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getDrawScript, getSessionDir, getTalkRuntimeFile, getTalkSessionsDir } from "./paths";
import {
	formatStyleList,
	getDefaultStyleId,
	getStyleById,
	loadStyleRegistry,
} from "./registry";
import { DEFAULT_TALK_STYLE_ID } from "./types";
import { auditAssembledReportDocument, auditReportContent, formatReportAudit, type ReportAuditResult } from "./report-audit";
import {
	buildReportContentSecurityPolicy,
	escapeHtml,
	injectBridge,
	injectContentSecurityPolicyMeta,
	startTalkServer,
	type TalkServer,
	wrapFragmentAsDocument,
} from "./server";
import { lintHtmlFragment } from "./lint";
import { verifySurface } from "./verify";
import type {
	TalkEvent,
	TalkPatch,
	TalkRenderInput,
	TalkRenderResult,
	TalkSessionRecord,
	TalkSessionState,
	TalkStyle,
	TalkSurface,
} from "./types";

const GLOBAL_KEY = "pi.talk.runtime.v1";

const EXT_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..", ".."); // ~/.pi/agent/extensions

export interface TalkRuntime {
	styles: TalkStyle[];
	active: boolean;
	styleId: string;
	startedAt: number;
	lastRenderAt?: number;
	title?: string;
	url?: string;
	file?: string;
	renderCount: number;
	server?: TalkServer;
	/** In-flight server start (dedupes concurrent ensureServer calls). */
	serverPromise?: Promise<TalkServer>;
	chatLog: Array<{ role: "assistant" | "user" | "system"; text: string; ts: number }>;
	lastEventId?: string;
	pendingOpen: boolean;
	/** Persistent session id (dir under sessions/). */
	sessionId?: string;
	/** Active surface id (multi-surface workbench). */
	activeSurface: string;
	/** Per-surface bookkeeping (file/version counts). */
	surfaces: Map<string, TalkSurface>;
	/** Total rendered versions across surfaces (session history). */
	versionCount: number;
}

/** Formal-report governance is declarative via manifest `governance: "report"`. */
export function governedAsReport(style: TalkStyle | undefined): boolean {
	return Boolean(style && (style.governance === "report" || style.id === "report"));
}

function emptyRuntime(): TalkRuntime {
	const styles = loadStyleRegistry();
	return {
		styles,
		active: false,
		styleId: getDefaultStyleId(styles),
		startedAt: 0,
		renderCount: 0,
		chatLog: [],
		pendingOpen: true,
		activeSurface: "main",
		surfaces: new Map(),
		versionCount: 0,
	};
}

function surfaceIdOk(id: string): boolean {
	return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id);
}

function newSessionId(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	const rand = Math.floor(Math.random() * 0xffff).toString(36).padStart(4, "0");
	return `s-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${d.getMilliseconds()}${rand}`;
}

function sessionRecord(runtime: TalkRuntime): TalkSessionRecord {
	return {
		id: runtime.sessionId ?? "",
		styleId: runtime.styleId,
		title: runtime.title,
		startedAt: runtime.startedAt,
		lastRenderAt: runtime.lastRenderAt,
		renderCount: runtime.renderCount,
		versionCount: runtime.versionCount,
		eventCount: runtime.server?.listEvents().length ?? 0,
		surfaces: [...runtime.surfaces.keys()],
		activeSurface: runtime.activeSurface,
	};
}

export function writeSessionMeta(runtime: TalkRuntime): void {
	if (!runtime.sessionId) return;
	try {
		const dir = getSessionDir(runtime.sessionId);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "meta.json"), JSON.stringify(sessionRecord(runtime), null, 2));
	} catch {
		/* best-effort */
	}
}

export function appendSessionEvent(runtime: TalkRuntime, event: TalkEvent): void {
	if (!runtime.sessionId) return;
	try {
		const dir = getSessionDir(runtime.sessionId);
		mkdirSync(dir, { recursive: true });
		appendFileSync(join(dir, "events.jsonl"), `${JSON.stringify(event)}\n`);
	} catch {
		/* best-effort */
	}
}

export function getRuntime(): TalkRuntime {
	const g = globalThis as Record<string, unknown>;
	let rt = g[GLOBAL_KEY] as TalkRuntime | undefined;
	if (!rt) {
		rt = emptyRuntime();
		g[GLOBAL_KEY] = rt;
	}
	// Field backfill: a runtime object created by an older extension version
	// (pre /reload) may lack the v2 fields — patch in place so the existing
	// session and server keep working.
	if (!rt.styles || rt.styles.length === 0) rt.styles = loadStyleRegistry();
	if (!rt.surfaces) rt.surfaces = new Map();
	if (typeof rt.activeSurface !== "string") rt.activeSurface = "main";
	if (typeof rt.versionCount !== "number") rt.versionCount = 0;
	if (!Array.isArray(rt.chatLog)) rt.chatLog = [];
	// A pre-v2 server object lacks applyPatch/listSurfaces — close it and let
	// ensureServer build a v2 one on next use.
	const srv = rt.server as Partial<TalkServer> | undefined;
	if (srv && (typeof srv.applyPatch !== "function" || typeof srv.listSurfaces !== "function")) {
		try {
			void srv.close?.();
		} catch {
			/* ignore */
		}
		rt.server = undefined;
		rt.url = undefined;
	}
	return rt;
}

export function reloadStyles(runtime = getRuntime()): TalkStyle[] {
	runtime.styles = loadStyleRegistry();
	// If idle, snap back to base/default style after pack reload
	if (!runtime.active) {
		runtime.styleId = getDefaultStyleId(runtime.styles);
	} else if (!getStyleById(runtime.styles, runtime.styleId)) {
		runtime.styleId = getDefaultStyleId(runtime.styles);
	}
	return runtime.styles;
}

export function getSessionState(runtime = getRuntime()): TalkSessionState {
	return {
		active: runtime.active,
		sessionId: runtime.sessionId,
		styleId: runtime.styleId,
		startedAt: runtime.startedAt,
		lastRenderAt: runtime.lastRenderAt,
		title: runtime.title,
		url: runtime.url,
		file: runtime.file,
		renderCount: runtime.renderCount,
		versionCount: runtime.versionCount,
		eventCount: runtime.server?.listEvents().length ?? 0,
		port: runtime.server?.port,
		activeSurface: runtime.activeSurface,
		surfaces: [...runtime.surfaces.values()].map((s) => ({
			id: s.id,
			styleId: s.styleId,
			title: s.title,
			versionCount: s.versionCount,
		})),
	};
}

export async function ensureServer(runtime = getRuntime()): Promise<TalkServer> {
	if (runtime.server) return runtime.server;
	if (!runtime.serverPromise) {
		runtime.serverPromise = startTalkServer()
			.then((server) => {
				runtime.server = server;
				runtime.serverPromise = undefined;
				server.onEvent = (event) => appendSessionEvent(runtime, event);
				runtime.url = server.url;
				persistRuntime(runtime);
				return server;
			})
			.catch((error) => {
				runtime.serverPromise = undefined;
				throw error;
			});
	}
	return runtime.serverPromise;
}

export async function startSession(
	styleId: string,
	opts?: { title?: string },
	runtime = getRuntime(),
): Promise<TalkSessionState> {
	const style =
		getStyleById(runtime.styles, styleId) ??
		getStyleById(runtime.styles, getDefaultStyleId(runtime.styles)) ??
		getStyleById(runtime.styles, DEFAULT_TALK_STYLE_ID);
	if (!style) throw new Error("No talk styles available");
	runtime.active = true;
	runtime.styleId = style.id;
	runtime.startedAt = Date.now();
	runtime.title = opts?.title || `Talk / ${style.name}`;
	runtime.renderCount = 0;
	runtime.chatLog = [];
	runtime.lastEventId = undefined;
	runtime.pendingOpen = true;
	runtime.sessionId = newSessionId();
	runtime.activeSurface = "main";
	runtime.surfaces.clear();
	runtime.versionCount = 0;

	if (style.kind === "html" || style.kind === "html-js" || style.kind === "command") {
		const server = await ensureServer(runtime);
		const placeholder = wrapFragmentAsDocument({
			title: runtime.title,
			bodyHtml: `<p>Talk session started in <strong>${escapeHtml(style.name)}</strong>.</p>
<p style="color:var(--muted)">The agent can call <code>talk_render</code> to update this surface.</p>`,
			interactive: style.kind === "html-js",
		});
		server.setDocument({
			title: runtime.title,
			html: placeholder,
			styleId: style.id,
			kind: style.kind,
		});
		runtime.url = server.url;
	}

	writeSessionMeta(runtime);
	persistRuntime(runtime);
	return getSessionState(runtime);
}

export async function stopSession(runtime = getRuntime()): Promise<void> {
	runtime.active = false;
	runtime.pendingOpen = false;
	if (runtime.server) {
		const s = runtime.server;
		runtime.server = undefined;
		await s.close();
	}
	runtime.url = undefined;
	if (runtime.sessionId) {
		try {
			const dir = getSessionDir(runtime.sessionId);
			const metaPath = join(dir, "meta.json");
			const meta = existsSync(metaPath)
				? JSON.parse(readFileSync(metaPath, "utf8"))
				: sessionRecord(runtime);
			meta.endedAt = Date.now();
			meta.lastRenderAt = runtime.lastRenderAt;
			meta.renderCount = runtime.renderCount;
			meta.versionCount = runtime.versionCount;
			meta.surfaces = [...runtime.surfaces.keys()];
			writeFileSync(metaPath, JSON.stringify(meta, null, 2));
		} catch {
			/* best-effort */
		}
	}
	persistRuntime(runtime);
}

export function setStyle(styleId: string, runtime = getRuntime()): TalkStyle {
	const style = getStyleById(runtime.styles, styleId);
	if (!style) throw new Error(`Unknown talk style: ${styleId}`);
	runtime.styleId = style.id;
	persistRuntime(runtime);
	return style;
}

export function persistRuntime(runtime = getRuntime()): void {
	try {
		const file = getTalkRuntimeFile();
		mkdirSync(join(file, ".."), { recursive: true });
		writeFileSync(
			file,
			JSON.stringify(
				{
					active: runtime.active,
					sessionId: runtime.sessionId,
					styleId: runtime.styleId,
					startedAt: runtime.startedAt,
					lastRenderAt: runtime.lastRenderAt,
					title: runtime.title,
					url: runtime.url,
					file: runtime.file,
					renderCount: runtime.renderCount,
					versionCount: runtime.versionCount,
					activeSurface: runtime.activeSurface,
					port: runtime.server?.port,
					updatedAt: Date.now(),
				},
				null,
				2,
			),
		);
	} catch {
		/* best-effort */
	}
}

/**
 * Crash recovery for the write-only runtime.json: on load, if it claims an
 * active session, probe the recorded port. Dead port → the process died
 * without session_shutdown, so stamp the session meta with endedAt and
 * deactivate the runtime file. Live port → a same-host /talk process owns it;
 * leave everything alone.
 */
export async function recoverOrphanRuntimeFile(): Promise<string | undefined> {
	try {
		const file = getTalkRuntimeFile();
		if (!existsSync(file)) return undefined;
		const data = JSON.parse(readFileSync(file, "utf8")) as {
			active?: boolean;
			sessionId?: string;
			port?: number;
		};
		if (!data.active || !data.sessionId) return undefined;
		if (typeof data.port === "number" && data.port > 0) {
			try {
				const probe = await fetch(`http://127.0.0.1:${data.port}/health`, {
					signal: AbortSignal.timeout(400),
					headers: { host: `127.0.0.1:${data.port}` },
				});
				if (probe.ok) return undefined; // still alive elsewhere
			} catch {
				/* dead port → recover below */
			}
		}
		const metaPath = join(getSessionDir(data.sessionId), "meta.json");
		if (existsSync(metaPath)) {
			try {
				const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
				if (!meta.endedAt) {
					meta.endedAt = Date.now();
					meta.crashRecovered = true;
					writeFileSync(metaPath, JSON.stringify(meta, null, 2));
				}
			} catch {
				/* best-effort */
			}
		}
		writeFileSync(
			file,
			JSON.stringify({ ...data, active: false, url: undefined, port: undefined, updatedAt: Date.now() }, null, 2),
		);
		return data.sessionId;
	} catch {
		return undefined;
	}
}

export function openUrl(url: string): void {
	const platform = process.platform;
	const cmd = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
	const args = platform === "win32" ? ["/c", "start", "", url] : [url];
	try {
		const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
		child.unref();
	} catch {
		/* ignore */
	}
}

function chatTranscriptBody(runtime: TalkRuntime): string {
	return runtime.chatLog
		.map((e) => `### ${e.role}${e.ts ? ` @ ${new Date(e.ts).toISOString()}` : ""}\n\n${e.text}\n`)
		.join("\n");
}

function persistChatTranscript(runtime: TalkRuntime): void {
	try {
		const dir = getTalkSessionsDir();
		mkdirSync(dir, { recursive: true });
		const file = join(dir, "chat-latest.md");
		writeFileSync(file, `# ${runtime.title ?? "Talk"}\n\n${chatTranscriptBody(runtime)}`);
		runtime.file = file;
		if (runtime.sessionId) {
			const sdir = getSessionDir(runtime.sessionId);
			mkdirSync(sdir, { recursive: true });
			writeFileSync(join(sdir, "chat.md"), `# ${runtime.title ?? "Talk"}\n\n${chatTranscriptBody(runtime)}`);
		}
	} catch {
		/* ignore */
	}
}

/** Record a user/system turn in the chat-style transcript (agent turns go through talk_render). */
export function appendChatEntry(
	runtime: TalkRuntime,
	role: "user" | "system",
	text: string,
): void {
	if (!runtime.active) return;
	runtime.chatLog.push({ role, text, ts: Date.now() });
	persistChatTranscript(runtime);
}

/**
 * Durable version snapshot for a surface document (full render or a persisted
 * patch). Keeps per-surface bookkeeping and prunes beyond 200 versions.
 */
function writeVersionSnapshot(
	runtime: TalkRuntime,
	surface: string,
	html: string,
	styleId: string,
	kind: string,
	fragment?: string,
): { version: number; file: string } | undefined {
	try {
		const dir = getSessionDir(runtime.sessionId ?? "_");
		mkdirSync(dir, { recursive: true });
		const vdir = join(dir, "versions");
		mkdirSync(vdir, { recursive: true });
		runtime.versionCount += 1;
		const vfile = join(vdir, `${String(runtime.versionCount).padStart(4, "0")}-${surface}.html`);
		writeFileSync(vfile, html);
		const prev = runtime.surfaces.get(surface);
		runtime.surfaces.set(surface, {
			id: surface,
			title: runtime.title || styleId,
			styleId,
			kind,
			file: vfile,
			updatedAt: Date.now(),
			versionCount: (prev?.versionCount ?? 0) + 1,
			fragment,
		});
		try {
			const files = readdirSync(vdir).filter((f) => f.endsWith(".html")).sort();
			for (const f of files.slice(0, Math.max(0, files.length - 200))) {
				unlinkSync(join(vdir, f));
			}
		} catch {
			/* ignore */
		}
		// Offline snapshot, kept inside the session dir (not the sessions root)
		const legacy = join(dir, `latest-${styleId}.html`);
		writeFileSync(legacy, html);
		runtime.file = vfile;
		return { version: runtime.versionCount, file: vfile };
	} catch {
		return undefined;
	}
}

function isFullHtmlDocument(content: string): boolean {
	const head = content.trim().slice(0, 200).toLowerCase();
	return head.startsWith("<!doctype") || head.startsWith("<html");
}

function guessInputExt(content: string): string {
	const t = content.trim();
	if (isFullHtmlDocument(t)) return ".html";
	if (t.startsWith("{") || t.startsWith("[")) {
		try {
			JSON.parse(t);
			return ".json";
		} catch {
			/* fallthrough */
		}
	}
	if (/^(flowchart|graph|sequenceDiagram|stateDiagram)\b/m.test(t)) return ".mmd";
	return ".txt";
}

function applyTemplate(template: string, vars: Record<string, string>): string {
	return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

/** Template injects {{content}} (or {{body}}) raw inside a JSON script block. */
const JSON_SCRIPT_PLACEHOLDER =
	/<script\b[^>]*type\s*=\s*["']application\/(?:ld\+)?json["'][^>]*>\s*(?:\{\{content\}\}|\{\{body\}\})\s*<\/script>/i;

/**
 * Make a JSON payload safe for embedding inside <script type="application/json">.
 * `\/` is a valid JSON escape, so JSON.parse still yields the original text.
 */
export function escapeJsonScriptPayload(content: string): string {
	return content.replace(/<\//g, "<\\/");
}

/** Token-lean audit for tool-result details — the full normalizedHtml stays out of the transcript. */
function summarizeReportAudit(audit: ReportAuditResult) {
	return {
		version: audit.version,
		valid: audit.valid,
		errors: audit.errors,
		warnings: audit.warnings,
		stats: audit.stats,
	};
}

/** Flatten talk_render meta + defaults into template {{vars}}. */
export function buildTemplateVars(opts: {
	content: string;
	title: string;
	styleId: string;
	meta?: Record<string, unknown>;
}): Record<string, string> {
	const meta = opts.meta ?? {};
	const str = (key: string, fallback = ""): string => {
		const v = meta[key];
		if (v === undefined || v === null) return fallback;
		return typeof v === "string" ? v : String(v);
	};
	const rawTitle = opts.title || str("title") || opts.styleId;
	const reportText = (value: string): string => opts.styleId === "report" ? escapeHtml(value) : value;
	// Defaults tuned for the academic report pack; harmless for other templates.
	const rawMark = str("mark", rawTitle.slice(0, 1) || "报");
	const rawBrand = str("brand", rawTitle);
	const rawSubtitle = str("subtitle", "通用汇报");
	const metaHtml = str("meta", str("metaHtml", ""));
	const nav = str("nav", str("navHtml", ""));
	const vars: Record<string, string> = {
		content: opts.content,
		body: opts.content,
		title: reportText(rawTitle),
		styleId: opts.styleId,
		mark: reportText(rawMark),
		brand: reportText(rawBrand),
		subtitle: reportText(rawSubtitle),
		meta: metaHtml,
		nav,
	};
	// Pass through any other string/number meta keys as {{key}}
	for (const [k, v] of Object.entries(meta)) {
		if (vars[k] !== undefined) continue;
		if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
			vars[k] = String(v);
		}
	}
	return vars;
}

function loadTemplate(style: TalkStyle): string | undefined {
	if (!style.entryPath || !existsSync(style.entryPath)) return undefined;
	try {
		return readFileSync(style.entryPath, "utf8");
	} catch {
		return undefined;
	}
}

async function runDraw(content: string, meta?: Record<string, unknown>): Promise<{ message: string; details: Record<string, unknown> }> {
	const script = getDrawScript();
	if (!existsSync(script)) {
		return {
			message: "draw skill script not found at ~/.pi/agent/skills/draw/draw.sh",
			details: { error: "missing_draw_script" },
		};
	}

	const ops: string[] = [];
	// content can be multiline instructions: ensure\nrect label x y\n...
	const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	if (lines.length === 0) lines.push("ensure");
	if (!lines.some((l) => l === "ensure" || l.startsWith("ensure "))) {
		lines.unshift("ensure");
	}

	const results: Array<{ cmd: string; ok: boolean; out: string }> = [];
	for (const line of lines) {
		if (line.startsWith("#")) continue;
		const args = tokenize(line);
		if (args.length === 0) continue;
		const out = await runCommand("sh", [script, ...args], 30_000);
		results.push({ cmd: args.join(" "), ok: out.code === 0, out: out.stdout || out.stderr });
		ops.push(args[0]!);
	}

	// Optional snapshot
	let snapshot: string | undefined;
	if (meta?.snapshot !== false) {
		const snap = await runCommand("sh", [script, "snapshot", "talk"], 60_000);
		if (snap.code === 0) snapshot = snap.stdout.trim();
	}

	return {
		message: `draw ops: ${ops.join(", ")}${snapshot ? `; snapshot: ${snapshot}` : ""}`,
		details: { results, snapshot },
	};
}

function tokenize(line: string): string[] {
	const out: string[] = [];
	const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(line))) {
		out.push(m[1] ?? m[2] ?? m[3] ?? "");
	}
	return out;
}

export function runCommand(
	cmd: string,
	args: string[],
	timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
		}, timeoutMs);
		child.stdout.on("data", (d) => {
			stdout += String(d);
		});
		child.stderr.on("data", (d) => {
			stderr += String(d);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code: code ?? 1, stdout, stderr });
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			resolve({ code: 1, stdout, stderr: err.message });
		});
	});
}

export async function renderTalk(
	input: TalkRenderInput,
	runtime = getRuntime(),
): Promise<TalkRenderResult> {
	if (!runtime.active) {
		await startSession(
			input.styleId || runtime.styleId || getDefaultStyleId(runtime.styles),
			{ title: input.title },
			runtime,
		);
	}
	const styleId = input.styleId || runtime.styleId || getDefaultStyleId(runtime.styles);
	const style = getStyleById(runtime.styles, styleId);
	if (!style) {
		return {
			ok: false,
			styleId,
			kind: "html-js",
			message: `Unknown style: ${styleId}. Available:\n${formatStyleList(runtime.styles)}`,
		};
	}
	const targetSurface =
		input.surface && surfaceIdOk(input.surface)
			? input.surface
			: typeof input.meta?.surface === "string" && surfaceIdOk(input.meta.surface)
				? input.meta.surface
				: runtime.activeSurface;

	// Incremental DOM patch: bypasses full-document render (no audit, no new version)
	const patch: TalkPatch | undefined =
		input.patch ??
		(typeof input.meta?.patch === "object" && input.meta.patch !== null
			? (input.meta.patch as TalkPatch)
			: undefined);
	if (patch) {
		const server = await ensureServer(runtime);
		const result = server.applyPatch({
			selector: patch.selector,
			html: patch.html,
			method: patch.method,
			surface: patch.surface || targetSurface,
		});
		if (!result.ok) {
			return {
				ok: false,
				styleId: style.id,
				kind: style.kind,
				message: `Patch failed: ${result.error}`,
				details: { patch: true },
			};
		}
		// Server-side persistence succeeded → durable version snapshot so
		// reload/resume/export see the patched document.
		let versionNote = "";
		if (result.persisted && result.html) {
			const snap = writeVersionSnapshot(runtime, patch.surface || targetSurface, result.html, style.id, style.kind);
			if (snap) versionNote = ` · persisted as v${snap.version}`;
			writeSessionMeta(runtime);
		}
		const warn = result.warning ? ` ⚠ ${result.warning}` : "";
		return {
			ok: true,
			styleId: style.id,
			kind: style.kind,
			message: `Patched ${patch.selector} (${patch.method ?? "inner"}) on surface ${patch.surface || targetSurface}${versionNote}${warn}`,
			details: {
				patch: true,
				selector: patch.selector,
				method: patch.method ?? "inner",
				persisted: result.persisted ?? false,
				version: result.persisted ? runtime.versionCount : undefined,
			},
		};
	}

	let renderContent = input.content;
	let renderMeta = input.meta ? { ...input.meta } : undefined;
	const governed = governedAsReport(style);
	const reportAudit = governed ? auditReportContent(input.content) : undefined;
	if (reportAudit) {
		renderContent = reportAudit.normalizedHtml;
		// Only these report variables are inserted as HTML. title/mark/brand/subtitle
		// are escaped text in buildTemplateVars and do not need fragment semantics.
		const rawHtmlMetaKeys = ["meta", "metaHtml", "nav", "navHtml", "footer"];
		for (const key of rawHtmlMetaKeys) {
			const source = input.meta?.[key];
			if (typeof source !== "string") continue;
			const supplement = auditReportContent(source, { requireStructure: false });
			if (!renderMeta) renderMeta = {};
			renderMeta[key] = supplement.normalizedHtml;
			for (const issue of [...supplement.errors, ...supplement.warnings]) {
				// Custom nav links legitimately target IDs in the body, outside this
				// individually parsed metadata fragment; assembled audit resolves them.
				if (issue.code === "broken-anchor") continue;
				const target = issue.severity === "error" ? reportAudit.errors : reportAudit.warnings;
				if (!target.some((existing) => existing.code === issue.code && existing.message === issue.message)) target.push(issue);
			}
		}
		reportAudit.valid = reportAudit.errors.length === 0;
	}
	if (reportAudit && !reportAudit.valid) {
		return {
			ok: false,
			styleId: style.id,
			kind: style.kind,
			message: `Report content rejected by the design-system safety gate. ${formatReportAudit(reportAudit)}`,
			details: { audit: reportAudit },
		};
	}
	runtime.styleId = style.id;
	runtime.title = input.title || runtime.title || style.name;
	runtime.lastRenderAt = Date.now();
	runtime.renderCount += 1;

	const shouldOpen = input.open ?? runtime.pendingOpen;
	runtime.pendingOpen = false;

	if (style.kind === "chat") {
		runtime.chatLog.push({ role: "assistant", text: input.content, ts: Date.now() });
		persistChatTranscript(runtime);
		writeSessionMeta(runtime);
		persistRuntime(runtime);
		return {
			ok: true,
			styleId: style.id,
			kind: style.kind,
			message: `chat updated (${runtime.chatLog.length} entries). Show via /talk widget or talk_status.`,
			file: runtime.file,
			details: { entries: runtime.chatLog.length },
		};
	}

	if (style.kind === "draw") {
		const drawResult = await runDraw(input.content, input.meta);
		persistRuntime(runtime);
		return {
			ok: !drawResult.details.error,
			styleId: style.id,
			kind: style.kind,
			message: drawResult.message,
			details: drawResult.details,
		};
	}

	if (style.kind === "html" || style.kind === "html-js") {
		const server = await ensureServer(runtime);
		const interactive = style.kind === "html-js";
		let html: string;
		const template = loadTemplate(style);
		const reportStyleNonce = governed ? randomBytes(18).toString("base64") : undefined;
		const contentSecurityPolicy = governed && template
			? buildReportContentSecurityPolicy(template, interactive, { styleNonce: reportStyleNonce })
			: undefined;
		// Report bridge placement is resolved against the trusted shell before any
		// untrusted slot is interpolated. General injectBridge is HTML5-parser based.
		const renderTemplate = governed && template ? injectBridge(template, { interactive }) : template;
		if (renderTemplate && (renderTemplate.includes("{{content}}") || renderTemplate.includes("{{ body }}") || renderTemplate.includes("{{body}}"))) {
			// JSON-driven packs embed {{content}} inside <script type="application/json">:
			// escape `</` so payload text (e.g. diffed HTML) cannot terminate the block.
			const jsonInScript = JSON_SCRIPT_PLACEHOLDER.test(renderTemplate);
			html = applyTemplate(
				renderTemplate,
				buildTemplateVars({
					content: jsonInScript ? escapeJsonScriptPayload(renderContent) : renderContent,
					title: runtime.title || style.name,
					styleId: style.id,
					meta: renderMeta,
				}),
			);
			if (!isFullHtmlDocument(html)) {
				html = wrapFragmentAsDocument({
					title: runtime.title || style.name,
					bodyHtml: html,
					interactive,
				});
			} else {
				html = injectBridge(html, { interactive });
			}
		} else if (isFullHtmlDocument(input.content)) {
			html = injectBridge(input.content, { interactive });
		} else if (renderTemplate && isFullHtmlDocument(renderTemplate) && !input.content.trim()) {
			html = injectBridge(renderTemplate, { interactive });
		} else {
			// Prefer content as body; if template is a shell without placeholders, append content into a default shell
			html = wrapFragmentAsDocument({
				title: runtime.title || style.name,
				bodyHtml: input.content,
				interactive,
			});
		}

		if (governed && contentSecurityPolicy && reportAudit) {
			html = injectContentSecurityPolicyMeta(html, contentSecurityPolicy, reportStyleNonce);
			const assembledAudit = auditAssembledReportDocument(html);
			for (const issue of [...assembledAudit.errors, ...assembledAudit.warnings]) {
				const target = issue.severity === "error" ? reportAudit.errors : reportAudit.warnings;
				if (!target.some((existing) => existing.code === issue.code && existing.message === issue.message)) target.push(issue);
			}
			reportAudit.valid = reportAudit.errors.length === 0;
			if (!reportAudit.valid) {
				return {
					ok: false,
					styleId: style.id,
					kind: style.kind,
					message: `Assembled report rejected before publishing. ${formatReportAudit(reportAudit)}`,
					details: { audit: reportAudit, assembledAudit },
				};
			}
		}

		// Component dependency injection (styles declaring dependencies: ["components"])
		if (style.dependencies?.includes("components") && html.includes("</head>")) {
			html = html.replace(
				"</head>",
				`<link rel="stylesheet" href="/api/components/tokens.css">\n</head>`,
			);
		}

		// Lightweight structure/security lint for non-report html styles (advisory)
		let lint: Array<{ severity: string; code: string; message: string }> | undefined;
		if (!governed) {
			const fullDocument =
				isFullHtmlDocument(input.content) ||
				Boolean(renderTemplate && isFullHtmlDocument(renderTemplate) && !input.content.trim());
			lint = lintHtmlFragment(input.content, { fullDocument });
		}

		server.setDocument(
			{
				title: runtime.title || style.name,
				html,
				styleId: style.id,
				kind: style.kind,
				contentSecurityPolicy,
				fragment: governed ? renderContent : undefined,
			},
			targetSurface,
		);
		runtime.activeSurface = targetSurface;
		runtime.url = server.url;

		// Durable version snapshot + per-surface bookkeeping
		writeVersionSnapshot(runtime, targetSurface, html, style.id, style.kind, governed ? renderContent : undefined);

		if (shouldOpen && runtime.url) openUrl(runtime.url);

		// Visual self-check (screenshot + console) when requested
		let verifyResult: Record<string, unknown> | undefined;
		if (input.verify || input.meta?.verify === true) {
			try {
				verifyResult = await verifySurface(runtime, {
					screenshot: true,
					console: true,
					surface: targetSurface,
				});
			} catch (error) {
				verifyResult = { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		}

		writeSessionMeta(runtime);
		persistRuntime(runtime);
		return {
			ok: true,
			styleId: style.id,
			kind: style.kind,
			message: `Rendered ${style.id}@${targetSurface} at ${runtime.url}${reportAudit ? ` · ${formatReportAudit(reportAudit)}` : ""}${verifyResult ? ` · verify: ${verifyResult.ok ? "ok" : "failed"}` : ""}`,
			url: runtime.url,
			file: runtime.file,
			details: {
				interactive,
				bytes: html.length,
				surface: targetSurface,
				version: runtime.versionCount,
				sessionId: runtime.sessionId,
				...(reportAudit ? { audit: summarizeReportAudit(reportAudit) } : {}),
				...(lint?.length ? { lint } : {}),
				...(verifyResult ? { verify: verifyResult } : {}),
			},
		};
	}

	if (style.kind === "command") {
		if (!style.command) {
			return { ok: false, styleId: style.id, kind: style.kind, message: "Style missing command" };
		}
		// Write content to a temp file inside the session dir (keeps the sessions
		// root clean); keep extension hints for JSON/HTML/mmd.
		const dir = join(getSessionDir(runtime.sessionId ?? "_"), "cmd");
		mkdirSync(dir, { recursive: true });
		const stamp = Date.now();
		const inExt = guessInputExt(input.content);
		const file = join(dir, `input-${stamp}${inExt}`);
		writeFileSync(file, input.content);
		const outExt = style.outExt || ".html";
		const outFile = join(dir, `out-${stamp}${outExt}`);
		runtime.file = file;
		const cmd = applyTemplate(style.command, {
			content: input.content,
			title: runtime.title || style.name,
			url: runtime.url || "",
			file,
			out: outFile,
			extDir: EXT_DIR,
		});
		const result = await runCommand("sh", ["-lc", cmd], 120_000);

		// Prefer structured JSON stdout from render helpers (e.g. arch-render.mjs)
		let helper: { ok?: boolean; htmlPath?: string; message?: string; type?: string; engine?: string } | null =
			null;
		try {
			const line = result.stdout
				.trim()
				.split(/\r?\n/)
				.filter(Boolean)
				.at(-1);
			if (line?.startsWith("{")) helper = JSON.parse(line);
		} catch {
			helper = null;
		}

		const htmlPath =
			(helper?.htmlPath && existsSync(helper.htmlPath) && helper.htmlPath) ||
			(existsSync(outFile) ? outFile : undefined);

		if (style.serveHtml && htmlPath) {
			const server = await ensureServer(runtime);
			let html = readFileSync(htmlPath, "utf8");
			html = injectBridge(html, { interactive: true });
			server.setDocument({
				title: runtime.title || style.name,
				html,
				styleId: style.id,
				kind: style.kind,
			});
			runtime.url = server.url;
			runtime.file = htmlPath;
			// durable snapshot
			writeVersionSnapshot(runtime, runtime.activeSurface, html, style.id, style.kind);
			if (shouldOpen && runtime.url) openUrl(runtime.url);
			persistRuntime(runtime);
			const ok = result.code === 0 && helper?.ok !== false;
			return {
				ok,
				styleId: style.id,
				kind: style.kind,
				message:
					helper?.message ||
					(ok ? `command+serve ok → ${runtime.url}` : `command failed (${result.code})`),
				url: runtime.url,
				file: htmlPath,
				details: {
					stdout: result.stdout,
					stderr: result.stderr,
					code: result.code,
					helper,
					cmd,
				},
			};
		}

		persistRuntime(runtime);
		return {
			ok: result.code === 0 && helper?.ok !== false,
			styleId: style.id,
			kind: style.kind,
			message:
				helper?.message ||
				(result.code === 0
					? `command ok: ${cmd}`
					: `command failed (${result.code}): ${result.stderr || result.stdout}`),
			file: htmlPath || file,
			details: { stdout: result.stdout, stderr: result.stderr, code: result.code, helper, cmd },
		};
	}

	return {
		ok: false,
		styleId: style.id,
		kind: style.kind,
		message: `Unsupported kind: ${style.kind}`,
	};
}

export function pollEvents(
	opts?: { afterId?: string; mark?: boolean },
	runtime = getRuntime(),
): TalkEvent[] {
	if (!runtime.server) return [];
	const after = opts?.afterId ?? runtime.lastEventId;
	const events = runtime.server.drainEvents(after);
	if (opts?.mark !== false && events.length > 0) {
		runtime.lastEventId = events[events.length - 1]!.id;
	}
	return events;
}

export function listSessions(runtime = getRuntime()): TalkSessionRecord[] {
	const dir = getTalkSessionsDir();
	if (!existsSync(dir)) return [];
	const out: TalkSessionRecord[] = [];
	let names: string[] = [];
	try {
		names = readdirSync(dir);
	} catch {
		return out;
	}
	for (const name of names) {
		if (!name.startsWith("s-")) continue;
		const metaPath = join(dir, name, "meta.json");
		if (!existsSync(metaPath)) continue;
		try {
			const record = JSON.parse(readFileSync(metaPath, "utf8")) as TalkSessionRecord;
			if (record.id) out.push(record);
		} catch {
			/* skip corrupt */
		}
	}
	return out.sort((a, b) => b.startedAt - a.startedAt);
}

/** Remove one persisted session directory. Returns false when not found. */
export function deleteSession(sessionId: string, sessionsDir = getTalkSessionsDir()): boolean {
	if (!/^s-[0-9]{8}-[0-9]{6}(?:-[0-9a-z]+)?$/i.test(sessionId)) return false;
	const dir = join(sessionsDir, sessionId);
	if (!existsSync(dir)) return false;
	try {
		rmSync(dir, { recursive: true, force: true });
		return true;
	} catch {
		return false;
	}
}

const ROOT_LITTER_PATTERNS = [/^cmd-.+-\d{10,}\./, /^latest-[\w-]+\.(html|json|mmd)$/, /^_probe_$/, /^legacy-\d+$/];

export interface TalkCleanResult {
	removedSessions: number;
	removedFiles: number;
	removedDirs: number;
}

/**
 * Garbage-collect the talk home: sessions older than `days` (by meta startedAt
 * or dir mtime) plus known litter patterns (cmd-* temp files, latest-*.html
 * snapshots, _probe_, legacy-*) in the sessions root. `chat-latest.md` is kept.
 */
export function cleanTalkHome(opts?: { days?: number; sessionsDir?: string }): TalkCleanResult {
	const days = opts?.days ?? 30;
	const cutoff = Date.now() - days * 86_400_000;
	const sessionsDir = opts?.sessionsDir ?? getTalkSessionsDir();
	const result: TalkCleanResult = { removedSessions: 0, removedFiles: 0, removedDirs: 0 };
	if (!existsSync(sessionsDir)) return result;

	const stale = (p: string): boolean => {
		try {
			return statSync(p).mtimeMs < cutoff;
		} catch {
			return false;
		}
	};

	let names: string[] = [];
	try {
		names = readdirSync(sessionsDir);
	} catch {
		return result;
	}
	for (const name of names) {
		const p = join(sessionsDir, name);
		if (name.startsWith("s-")) {
			// Session dir: age from meta.startedAt when available, else mtime
			let startedAt = 0;
			try {
				const meta = JSON.parse(readFileSync(join(p, "meta.json"), "utf8")) as TalkSessionRecord;
				startedAt = meta.startedAt ?? 0;
			} catch {
				/* no/corrupt meta → mtime */
			}
			const old = startedAt > 0 ? startedAt < cutoff : stale(p);
			if (old) {
				try {
					rmSync(p, { recursive: true, force: true });
					result.removedSessions += 1;
				} catch {
					/* ignore */
				}
			}
			continue;
		}
		if (name === "chat-latest.md") continue;
		if (!ROOT_LITTER_PATTERNS.some((re) => re.test(name))) continue;
		if (!stale(p)) continue;
		try {
			const isDir = statSync(p).isDirectory();
			rmSync(p, { recursive: true, force: true });
			if (isDir) result.removedDirs += 1;
			else result.removedFiles += 1;
		} catch {
			/* ignore */
		}
	}
	// legacy-* dirs sit next to sessions/ under the talk home
	const talkHome = join(sessionsDir, "..");
	try {
		for (const name of readdirSync(talkHome)) {
			if (!/^legacy-\d+$/.test(name)) continue;
			const p = join(talkHome, name);
			if (stale(p)) {
				rmSync(p, { recursive: true, force: true });
				result.removedDirs += 1;
			}
		}
	} catch {
		/* ignore */
	}
	return result;
}

function loadEventsFromDisk(sessionId: string): TalkEvent[] {
	const evFile = join(getSessionDir(sessionId), "events.jsonl");
	if (!existsSync(evFile)) return [];
	try {
		const lines = readFileSync(evFile, "utf8").split(/\r?\n/).filter(Boolean);
		return lines
			.slice(-500)
			.map((line) => {
				try {
					return JSON.parse(line) as TalkEvent;
				} catch {
					return null;
				}
			})
			.filter((e): e is TalkEvent => e !== null && typeof e.id === "string");
	} catch {
		return [];
	}
}

export async function resumeSession(
	sessionId: string,
	opts?: { open?: boolean },
	runtime = getRuntime(),
): Promise<TalkSessionState> {
	const dir = getSessionDir(sessionId);
	const metaPath = join(dir, "meta.json");
	if (!existsSync(metaPath)) throw new Error(`Session not found: ${sessionId}`);
	const meta = JSON.parse(readFileSync(metaPath, "utf8")) as TalkSessionRecord;
	const style =
		getStyleById(runtime.styles, meta.styleId) ??
		getStyleById(runtime.styles, getDefaultStyleId(runtime.styles));
	if (!style) throw new Error(`Style for session ${sessionId} is no longer available`);

	runtime.active = true;
	runtime.sessionId = sessionId;
	runtime.styleId = style.id;
	runtime.title = meta.title;
	runtime.startedAt = meta.startedAt ?? Date.now();
	runtime.lastRenderAt = meta.lastRenderAt;
	runtime.renderCount = meta.renderCount ?? 0;
	runtime.versionCount = meta.versionCount ?? 0;
	runtime.chatLog = [];
	runtime.lastEventId = undefined;
	runtime.pendingOpen = true;
	runtime.surfaces.clear();
	runtime.activeSurface = "main";

	if (style.kind === "html" || style.kind === "html-js") {
		const server = await ensureServer(runtime);
		const versionDir = join(dir, "versions");
		let restored = false;
		if (existsSync(versionDir)) {
			let files: string[] = [];
			try {
				files = readdirSync(versionDir).filter((f) => f.endsWith(".html")).sort();
			} catch {
				files = [];
			}
			if (files.length > 0) {
				// Restore every distinct surface from its latest version file
				const bySurface = new Map<string, string>();
				for (const f of files) {
					const m = /^[0-9]+-(.+?)\.html$/.exec(f);
					const surface = m?.[1] ?? "main";
					bySurface.set(surface, f);
				}
				for (const [surface, f] of bySurface) {
					const html = readFileSync(join(versionDir, f), "utf8");
					server.setDocument(
						{ title: meta.title ?? "Talk", html, styleId: style.id, kind: style.kind },
						surface,
					);
					const prev = runtime.surfaces.get(surface);
					runtime.surfaces.set(surface, {
						id: surface,
						title: meta.title ?? "Talk",
						styleId: style.id,
						kind: style.kind,
						file: join(versionDir, f),
						updatedAt: Date.now(),
						versionCount: (prev?.versionCount ?? 0) + 1,
					});
				}
				const active = [...bySurface.keys()].at(-1) ?? "main";
				runtime.activeSurface = active;
				runtime.file = runtime.surfaces.get(active)?.file;
				restored = true;
			}
		}
		// Restore the surface that was active when the session stopped
		if (meta.activeSurface && runtime.surfaces.has(meta.activeSurface)) {
			runtime.activeSurface = meta.activeSurface;
			runtime.file = runtime.surfaces.get(meta.activeSurface)?.file;
		}
		if (!restored) {
			const placeholder = wrapFragmentAsDocument({
				title: meta.title ?? "Talk",
				bodyHtml: `<p>Resumed session <strong>${escapeHtml(sessionId)}</strong> — no rendered version found.</p>`,
				interactive: style.kind === "html-js",
			});
			server.setDocument(
				{ title: meta.title ?? "Talk", html: placeholder, styleId: style.id, kind: style.kind },
				"main",
			);
			runtime.activeSurface = "main";
		}
		runtime.url = server.url;
		// Restore event history into memory only — never re-persist (the journal
		// already contains these events) — and advance the cursor so the agent
		// does not re-receive restored events on the next poll.
		const events = loadEventsFromDisk(sessionId);
		for (const evt of events) {
			try {
				server.pushEvent(evt, { persist: false, broadcast: false });
			} catch {
				/* ignore */
			}
		}
		if (events.length > 0) runtime.lastEventId = events[events.length - 1]!.id;
	} else if (style.kind === "chat") {
		const chatFile = join(dir, "chat.md");
		if (existsSync(chatFile)) {
			try {
				const text = readFileSync(chatFile, "utf8");
				const re = /### (assistant|user|system)(?: @ (\S+))?\n\n([\s\S]*?)(?=\n### |$)/g;
				let m: RegExpExecArray | null;
				while ((m = re.exec(text))) {
					runtime.chatLog.push({
						role: m[1] as "assistant" | "user" | "system",
						text: (m[3] ?? "").trim(),
						ts: m[2] ? (Date.parse(m[2]) || 0) : 0,
					});
				}
			} catch {
				/* ignore */
			}
		}
	}

	writeSessionMeta(runtime);
	persistRuntime(runtime);
	if (opts?.open && runtime.url) openUrl(runtime.url);
	return getSessionState(runtime);
}

export function buildTalkSystemAppendix(runtime = getRuntime()): string {
	if (!runtime.active) return "";
	const style = getStyleById(runtime.styles, runtime.styleId);
	const styles = formatStyleList(runtime.styles);
	return `
## /talk mode is ACTIVE

You are in an interactive multimodal talk session with the user.

Current style: **${runtime.styleId}** (${style?.kind ?? "?"}) — ${style?.description ?? ""}
Base/default style for new sessions: **${getDefaultStyleId(runtime.styles)}** (reference-derived formal report design system: paper palette + sidebar + serif hierarchy + KPI/evidence/verdict).
${runtime.url ? `Surface URL: ${runtime.url}` : ""}
${runtime.file ? `Latest file: ${runtime.file}` : ""}

### Tools
- \`talk_list_styles\` — list evolutionary interaction styles
- \`talk_set_style\` — switch style mid-conversation (e.g. chat → html-interactive → draw)
- \`talk_render\` — render content in the current (or chosen) style; supports multi-surface (surface param), incremental DOM patches (patch param) and auto visual self-check (verify param)
- \`talk_poll_events\` — read user interaction events from interactive HTML (buttons, talkSend, forms, inputs)
- \`talk_verify\` — visual self-check: headless screenshot + console errors + DOM info for the current surface
- \`talk_export\` — export current surface as html/md/png/pdf
- \`talk_status\` — session status (sessionId, surfaces, versions)

### Commands
- \`/talk resume [id]\` — resume a session (default: last one); \`/talk history\` — list sessions
- \`/talk export <html|md|png|pdf> [out]\` — export current surface
- \`/talk test\` — run the talk regression suite
- \`/talk surfaces\` — list surfaces; \`/talk open [surface]\` — open a surface

### Incremental updates
- **Patch**: \`talk_render({ content: \"\", patch: { selector: \"#id\", html: \"<p>…</p>\", method: \"inner|outer|append|prepend|remove\" } })\` updates only a subtree — no reload, scroll/focus preserved. Patches are not versioned.
- **Forms**: any form with \`data-talk-form\` is serialized (values) and sent via talkSend on submit; elements with \`data-talk-input\` send debounced input events.
- **Surfaces**: render to a named surface with \`surface: \"id\"\`; each surface keeps its own document + version history; \`/s/<id>\` serves it at a stable URL.

### Persistence
- Every session is stored under ~/.pi/agent/talk/sessions/<id>/ (meta.json, versions/, events.jsonl, chat.md). /talk stop keeps it; /talk resume brings it back.
- Export/verify artifacts land in the session dir (exports/, shots/).

### Visual self-check
- Use \`talk_verify\` after rendering (or \`verify: true\` on talk_render): it screenshots the surface headlessly and reports console errors + DOM stats, then you can describe the screenshot to check the real appearance — never ship a blind render.

### Style guidance
- **chat**: put the full reply text in talk_render content; keep it readable. Also answer briefly in the main chat.
- **html-static**: pass an HTML fragment or full document. No JS bridge.
- **html-interactive**: ONLY for light clickable prototypes / choice UIs. Its default shell is plain white cards — NEVER use it for 汇报/结项/周报/阶段验收 pages (those look ugly). Prefer **report**.
- **report**: the ONLY formal-report shell (derived from the supplied 智渔粮库 journal-style HTML). REQUIRED for 汇报/结项/周报/阶段说明/验收/评审/审计. content = body fragment using .hero/.sec-head/.kpi/.card/.tbl-wrap/.note/.tl/.verdict; no active content or one-off inline layout soup. Inspect result details.audit and fix errors/warnings. Cookbook: ~/.pi/agent/talk/styles/report/COOKBOOK.md
- **arch**: architecture diagrams via local Archify (tt-a1i/archify ← Cocoon generator). content = Archify JSON IR (preferred), full HTML, or Mermaid. Types: architecture/workflow/sequence/dataflow/lifecycle. Cookbook: ~/.pi/agent/talk/styles/arch/COOKBOOK.md
- **draw**: content is newline-separated draw.sh ops (ensure, rect, text, arrow, snapshot, clear). Prefer small labeled sketches.
- If the active style is wrong for the content, call talk_set_style then re-render; do not keep piling content into the wrong shell.
- Custom packs under ~/.pi/agent/talk/styles/ may add more styles over time — list them before assuming.

### Evolution
If the current style is insufficient (e.g. need JS where only static HTML exists), switch with talk_set_style or suggest adding a new pack under ~/.pi/agent/talk/styles/<id>/manifest.json. Do not rewrite the core extension for a one-off.

### Available styles
${styles}
`.trim();
}

