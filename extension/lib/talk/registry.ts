/**
 * Style registry — discovers evolutionary talk style packs.
 *
 * Pack layout:
 *   ~/.pi/agent/talk/styles/<id>/manifest.json
 *   ~/.pi/agent/talk/styles/<id>/<entry>   # usually index.html
 *
 * Built-in styles always exist even if packs are missing; packs with the
 * same id override the builtin metadata (kind/entry/description) so users
 * can evolve a style in place (e.g. html-static → richer template).
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getTalkStylesDir } from "./paths";
import {
	DEFAULT_TALK_STYLE_ID,
	TALK_STYLE_PICK_ORDER,
	type TalkKind,
	type TalkStyle,
	type TalkStyleManifest,
} from "./types";

export { DEFAULT_TALK_STYLE_ID, TALK_STYLE_PICK_ORDER };

const VALID_KINDS = new Set<TalkKind>(["chat", "html", "html-js", "draw", "command"]);

export const BUILTIN_STYLES: TalkStyle[] = [
	{
		id: "chat",
		name: "Chat",
		description: "Side-channel text/markdown conversation in a TUI overlay widget",
		kind: "chat",
		capabilities: ["text", "markdown", "tui"],
		source: "builtin",
		version: 1,
	},
	{
		id: "html-static",
		name: "Static HTML",
		description: "Render a static HTML document in the browser (no agent-bound JS bridge)",
		kind: "html",
		entry: "index.html",
		capabilities: ["html", "static", "browser"],
		source: "builtin",
		version: 1,
	},
	{
		id: "html-interactive",
		name: "Interactive HTML",
		description: "HTML + JS with talkSend()/SSE bridge for real-time user interaction events",
		kind: "html-js",
		entry: "index.html",
		capabilities: ["html", "js", "browser", "realtime", "events"],
		source: "builtin",
		version: 1,
	},
	{
		id: "draw",
		name: "Draw Canvas",
		description: "Shared tldraw whiteboard via the draw skill (real-time visual conversation)",
		kind: "draw",
		capabilities: ["canvas", "draw", "realtime"],
		source: "builtin",
		version: 1,
	},
];

export function isTalkKind(value: unknown): value is TalkKind {
	return typeof value === "string" && VALID_KINDS.has(value as TalkKind);
}

export function parseManifest(raw: unknown, fallbackId: string): TalkStyleManifest | null {
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as Record<string, unknown>;
	const id = typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : fallbackId;
	if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) return null;
	const name = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : id;
	const description =
		typeof obj.description === "string" && obj.description.trim()
			? obj.description.trim()
			: `Talk style ${id}`;
	if (!isTalkKind(obj.kind)) return null;
	const entry = typeof obj.entry === "string" && obj.entry.trim() ? obj.entry.trim() : undefined;
	const command = typeof obj.command === "string" && obj.command.trim() ? obj.command.trim() : undefined;
	const capabilities = Array.isArray(obj.capabilities)
		? obj.capabilities.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
		: undefined;
	const dependencies = Array.isArray(obj.dependencies)
		? obj.dependencies.filter((d): d is string => typeof d === "string" && /^[a-z0-9_-]{1,64}$/i.test(d))
		: undefined;
	const version =
		typeof obj.version === "string" || typeof obj.version === "number" ? obj.version : undefined;
	const hidden = obj.hidden === true;
	const isDefault = obj.default === true;
	const serveHtml = obj.serveHtml === true;
	const governance =
		typeof obj.governance === "string" && obj.governance.trim() ? obj.governance.trim() : undefined;
	const useWhen =
		typeof obj.useWhen === "string" && obj.useWhen.trim() ? obj.useWhen.trim() : undefined;
	const outExt =
		typeof obj.outExt === "string" && obj.outExt.trim()
			? obj.outExt.trim().startsWith(".")
				? obj.outExt.trim()
				: `.${obj.outExt.trim()}`
			: undefined;
	if ((obj.kind === "html" || obj.kind === "html-js") && !entry) {
		// default entry; still valid
	}
	if (obj.kind === "command" && !command) return null;
	return {
		id,
		name,
		description,
		kind: obj.kind,
		entry: entry ?? (obj.kind === "html" || obj.kind === "html-js" ? "index.html" : undefined),
		command,
		serveHtml,
		outExt,
		capabilities,
		dependencies,
		version,
		hidden,
		default: isDefault,
		governance,
		useWhen,
	};
}

export function loadManifestFile(filePath: string, fallbackId: string): TalkStyleManifest | null {
	try {
		const text = readFileSync(filePath, "utf8");
		return parseManifest(JSON.parse(text), fallbackId);
	} catch {
		return null;
	}
}

export function discoverStylePacks(stylesDir = getTalkStylesDir()): TalkStyle[] {
	if (!existsSync(stylesDir)) return [];
	const out: TalkStyle[] = [];
	let entries: string[] = [];
	try {
		entries = readdirSync(stylesDir);
	} catch {
		return [];
	}
	for (const name of entries) {
		if (name.startsWith(".")) continue;
		const dir = join(stylesDir, name);
		try {
			if (!statSync(dir).isDirectory()) continue;
		} catch {
			continue;
		}
		const manifestPath = join(dir, "manifest.json");
		const manifest = existsSync(manifestPath)
			? loadManifestFile(manifestPath, name)
			: null;
		// Allow pack without manifest if it has index.html → html-js by convention
		const style: TalkStyle | null = manifest
			? {
					...manifest,
					dir,
					entryPath: manifest.entry ? join(dir, manifest.entry) : undefined,
					source: "pack",
				}
			: existsSync(join(dir, "index.html"))
				? {
						id: name,
						name,
						description: `Auto-discovered HTML style pack (${name})`,
						kind: "html-js",
						entry: "index.html",
						entryPath: join(dir, "index.html"),
						dir,
						capabilities: ["html", "js", "auto"],
						source: "pack",
					}
				: null;
		if (!style) continue;
		if (style.entry && !style.entryPath) style.entryPath = join(dir, style.entry);
		out.push(style);
	}
	return out;
}

export function mergeStyles(builtins: TalkStyle[], packs: TalkStyle[]): TalkStyle[] {
	const map = new Map<string, TalkStyle>();
	for (const b of builtins) map.set(b.id, b);
	for (const p of packs) {
		const prev = map.get(p.id);
		if (prev) {
			// Pack overrides metadata but keeps builtin fallbacks for missing fields.
			map.set(p.id, {
				...prev,
				...p,
				capabilities: p.capabilities ?? prev.capabilities,
				description: p.description || prev.description,
				name: p.name || prev.name,
				source: "pack",
			});
		} else {
			map.set(p.id, p);
		}
	}
	return [...map.values()].sort((a, b) => styleSortKey(a) - styleSortKey(b) || a.id.localeCompare(b.id));
}

function styleSortKey(s: TalkStyle): number {
	const idx = (TALK_STYLE_PICK_ORDER as readonly string[]).indexOf(s.id);
	if (s.default) return -1; // force first among defaults
	return idx >= 0 ? idx : 100 + s.id.charCodeAt(0);
}

export function validateManifest(manifest: TalkStyleManifest): Array<{ severity: "error" | "warning"; code: string; message: string }> {
	const issues: Array<{ severity: "error" | "warning"; code: string; message: string }> = [];
	if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(manifest.id)) {
		issues.push({ severity: "error", code: "bad-id", message: `Style id "${manifest.id}" must match ^[a-z0-9][a-z0-9_-]{0,63}$` });
	}
	if (manifest.version !== undefined && typeof manifest.version !== "string" && typeof manifest.version !== "number") {
		issues.push({ severity: "error", code: "bad-version", message: `Style ${manifest.id}: version must be a string or number` });
	}
	if ((manifest.kind === "html" || manifest.kind === "html-js") && manifest.entry) {
		const bad = /[\\/]|(?:^|\.\.)(?:\.\.)?\//.test(manifest.entry) || manifest.entry.includes("..");
		if (bad || !/^[a-zA-Z0-9._-]{1,120}$/.test(manifest.entry)) {
			issues.push({ severity: "error", code: "bad-entry", message: `Style ${manifest.id}: entry "${manifest.entry}" must be a relative filename without path separators` });
		}
	}
	if (manifest.kind === "command" && !manifest.command) {
		issues.push({ severity: "error", code: "missing-command", message: `Style ${manifest.id}: kind=command requires a command template` });
	}
	if (manifest.hidden && manifest.default) {
		issues.push({ severity: "warning", code: "hidden-default", message: `Style ${manifest.id}: hidden + default is contradictory; default wins for new sessions` });
	}
	if (manifest.dependencies?.some((d) => !/^[a-z0-9_-]{1,64}$/i.test(d))) {
		issues.push({ severity: "warning", code: "bad-dependency", message: `Style ${manifest.id}: dependency ids must be ^[a-z0-9_-]{1,64}$` });
	}
	if (manifest.serveHtml && manifest.kind !== "command") {
		issues.push({ severity: "warning", code: "serveHtml-kind", message: `Style ${manifest.id}: serveHtml only applies to kind=command` });
	}
	return issues;
}

export function loadStyleRegistry(stylesDir = getTalkStylesDir()): TalkStyle[] {
	return mergeStyles(BUILTIN_STYLES, discoverStylePacks(stylesDir));
}

export function getStyleById(styles: TalkStyle[], id: string): TalkStyle | undefined {
	const key = id.trim().toLowerCase();
	return styles.find((s) => s.id.toLowerCase() === key);
}

/** Resolve the base/default style id (report pack preferred). */
export function getDefaultStyleId(styles: TalkStyle[]): string {
	const marked = styles.find((s) => s.default && !s.hidden);
	if (marked) return marked.id;
	if (getStyleById(styles, DEFAULT_TALK_STYLE_ID)) return DEFAULT_TALK_STYLE_ID;
	const first = styles.find((s) => !s.hidden);
	return first?.id ?? DEFAULT_TALK_STYLE_ID;
}

export function formatStyleList(styles: TalkStyle[], opts?: { includeHidden?: boolean }): string {
	const list = opts?.includeHidden ? styles : styles.filter((s) => !s.hidden);
	if (list.length === 0) return "(no styles)";
	return list
		.map((s) => {
			const caps = s.capabilities?.length ? ` [${s.capabilities.join(", ")}]` : "";
			const src = s.source === "pack" ? "pack" : "builtin";
			const when = s.useWhen ? `\n  适用: ${s.useWhen}` : "";
			return `- ${s.id} — ${s.name} (${s.kind}, ${src})${caps}\n  ${s.description}${when}`;
		})
		.join("\n");
}

export function stylePickerOptions(styles: TalkStyle[]): string[] {
	return styles
		.filter((s) => !s.hidden)
		.map((s) => `${s.id} — ${s.name} (${s.kind})`);
}

export function parseStylePickerChoice(choice: string | undefined): string | undefined {
	if (!choice) return undefined;
	const id = choice.split("—")[0]?.trim() || choice.trim();
	return id || undefined;
}
