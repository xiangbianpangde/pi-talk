/**
 * /talk — shared types for the evolutionary interaction-style system.
 *
 * Styles are data packs under ~/.pi/agent/talk/styles/<id>/ plus a small set
 * of built-in engine kinds. Adding a new pack does not require editing the
 * extension core — drop a folder, then `/talk reload-styles` or `/reload`.
 */

export type TalkKind = "chat" | "html" | "html-js" | "draw" | "command";

export interface TalkStyleManifest {
	/** Stable id (directory name by default). */
	id: string;
	/** Human label. */
	name: string;
	/** One-line description for pickers and agent guidance. */
	description: string;
	/** Engine kind that renders this style. */
	kind: TalkKind;
	/** Relative entry file inside the style pack (html kinds). */
	entry?: string;
	/** Optional shell command template for kind=command. Use {{content}} {{title}} {{url}} {{file}} {{out}}. */
	command?: string;
	/**
	 * When true (command kind), after the command runs, load {{out}} (or JSON stdout.htmlPath)
	 * into the local talk server so the browser surface updates.
	 */
	serveHtml?: boolean;
	/** Extension for {{out}} path when serveHtml is set (default .html). */
	outExt?: string;
	/** Capability tags for evolution / discovery. */
	capabilities?: string[];
	/** Component dependencies (ids under ~/.pi/agent/talk/components/). "components" injects tokens.css + component classes. */
	dependencies?: string[];
	/** Optional version for pack authors. */
	version?: number | string;
	/** If true, hide from default picker but still callable by id. */
	hidden?: boolean;
	/** Preferred default / base style for new /talk sessions. */
	default?: boolean;
	/**
	 * Governance profile applied by the engine. Currently "report" opts the
	 * style into the strict report design-system audit + hash-CSP pipeline;
	 * absent → advisory lint only. Decouples governance from style ids.
	 */
	governance?: "report" | string;
	/** Short "when to use this style" hint surfaced in pickers and the system appendix. */
	useWhen?: string;
}

/** Built-in default when no style is chosen. Prefer pack id "report" (devguard journal shell). */
export const DEFAULT_TALK_STYLE_ID = "report";

/** Picker / list priority — report first as the base surface. */
export const TALK_STYLE_PICK_ORDER = [
	"report",
	"arch",
	"draw",
	"html-interactive",
	"html-static",
	"diagram-cards",
	"chat",
] as const;

export interface TalkStyle extends TalkStyleManifest {
	/** Absolute path to the style pack directory (if any). */
	dir?: string;
	/** Absolute path to entry file (resolved). */
	entryPath?: string;
	/** Origin: builtin engine default or discovered pack. */
	source: "builtin" | "pack";
}

export interface TalkEvent {
	id: string;
	ts: number;
	type: string;
	payload?: unknown;
	source?: string;
	/** Surface id the event originated from (browser bridge sends it). */
	surface?: string;
}

/** DOM patch operation applied client-side (incremental render, no full reload). */
export interface TalkPatch {
	/** CSS selector for the target element. */
	selector: string;
	/** HTML to insert (inner/outer/append/prepend) or omitted for remove. */
	html?: string;
	/** inner (default) | outer | append | prepend | remove */
	method?: "inner" | "outer" | "append" | "prepend" | "remove";
	/** Target surface id (default: active surface). */
	surface?: string;
}

/** One renderable surface inside a session (multi-surface workbench). */
export interface TalkSurface {
	id: string;
	title: string;
	styleId: string;
	kind: string;
	file?: string;
	updatedAt: number;
	versionCount: number;
	/** Author content fragment (for markdown export). */
	fragment?: string;
}

/** On-disk session record for /talk history + resume. */
export interface TalkSessionRecord {
	id: string;
	styleId: string;
	title?: string;
	startedAt: number;
	lastRenderAt?: number;
	renderCount: number;
	versionCount: number;
	eventCount: number;
	surfaces: string[];
	activeSurface?: string;
	endedAt?: number;
}

export interface TalkRenderInput {
	styleId?: string;
	title?: string;
	/** Primary payload. Meaning depends on kind. */
	content: string;
	/** Optional structured extras (draw ops JSON, html head, etc.). */
	meta?: Record<string, unknown>;
	/** When true, open/focus the surface after render. */
	open?: boolean;
	/** Target surface id (multi-surface workbench; default: active surface). */
	surface?: string;
	/** Incremental DOM patch instead of a full document render. */
	patch?: TalkPatch;
	/** Run the visual self-check (screenshot + console) after rendering. */
	verify?: boolean;
}

export interface TalkRenderResult {
	ok: boolean;
	styleId: string;
	kind: TalkKind;
	message: string;
	url?: string;
	file?: string;
	details?: Record<string, unknown>;
}

export interface TalkSessionState {
	active: boolean;
	sessionId?: string;
	styleId: string;
	startedAt: number;
	lastRenderAt?: number;
	title?: string;
	url?: string;
	file?: string;
	renderCount: number;
	versionCount: number;
	eventCount: number;
	port?: number;
	activeSurface?: string;
	surfaces?: Array<{ id: string; styleId: string; title: string; versionCount: number }>;
}

export const BUILTIN_STYLE_IDS = ["chat", "html-static", "html-interactive", "draw"] as const;
export type BuiltinStyleId = (typeof BUILTIN_STYLE_IDS)[number];
