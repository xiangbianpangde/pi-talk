import { parse, parseFragment, serialize } from "../../../npm/node_modules/parse5/dist/index.js";

export const REPORT_DESIGN_SYSTEM_VERSION = "3.1.0";

export type ReportAuditSeverity = "error" | "warning";

export interface ReportAuditIssue {
	severity: ReportAuditSeverity;
	code: string;
	message: string;
}

export interface ReportAuditResult {
	version: string;
	valid: boolean;
	errors: ReportAuditIssue[];
	warnings: ReportAuditIssue[];
	/** Canonical HTML5 serialization. Publish this, never the unparsed source. */
	normalizedHtml: string;
	stats: {
		bytes: number;
		sections: number;
		cards: number;
		kpis: number;
		tables: number;
		inlineStyles: number;
	};
}

export interface AssembledReportAuditResult {
	valid: boolean;
	errors: ReportAuditIssue[];
	warnings: ReportAuditIssue[];
}

type HtmlNode = any;

const MAX_REPORT_BYTES = 180_000;
const MAX_REPORT_NODES = 10_000;
const MAX_REPORT_DEPTH = 128;

interface FragmentFacts {
	classCounts: Map<string, number>;
	ids: Map<string, number>;
	headings: Array<{ level: number; node: HtmlNode }>;
	localLinks: string[];
	sections: HtmlNode[];
	nonHeroSections: HtmlNode[];
	kpis: HtmlNode[];
	tables: HtmlNode[];
	inlineStyleCount: number;
	topLevel: HtmlNode[];
	heroes: HtmlNode[];
	verdicts: HtmlNode[];
}

const ACTIVE_ELEMENTS = new Set([
	"base", "embed", "form", "iframe", "link", "meta", "object", "script", "style", "template",
]);

/** Formal reports are documents, not arbitrary applications. */
const ALLOWED_ELEMENTS = new Set([
	"a", "abbr", "article", "b", "blockquote", "br", "button", "caption", "cite",
	"code", "col", "colgroup", "dd", "del", "details", "div", "dl", "dt", "em",
	"figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img",
	"kbd", "li", "mark", "ol", "p", "pre", "q", "s", "samp", "section", "small",
	"span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th",
	"thead", "time", "tr", "u", "ul", "var",
]);

const SHELL_ELEMENTS = new Set(["html", "head", "body", "main", "aside", "nav", "footer"]);
const VOID_ELEMENTS = new Set(["br", "col", "hr", "img"]);
const RESERVED_IDS = new Set([
	"report-content-root", "report-main", "report-nav", "report-runtime", "talk-bridge",
]);
const RESERVED_CLASSES = new Set([
	"report-shell", "report-side", "report-main", "report-brand", "report-nav", "report-footer",
	"skip-link", "talk-badge",
]);
const CONTENT_HIDING_CLASSES = new Set(["sr-only", "tab-pane", "tab-panel", "report-empty"]);
const BEHAVIOR_CLASSES = new Set(["anim-bar", "counter", "mermaid", "sim-step", "tab-pane", "tab-panel", "tabbar", "tabs"]);

const GLOBAL_ATTRIBUTES = new Set([
	"class", "dir", "id", "lang", "role", "style", "tabindex", "title",
]);
const ELEMENT_ATTRIBUTES: Record<string, Set<string>> = {
	a: new Set(["download", "href", "rel", "target"]),
	button: new Set(["disabled", "type"]),
	col: new Set(["span"]),
	colgroup: new Set(["span"]),
	details: new Set(["open"]),
	img: new Set(["alt", "decoding", "height", "loading", "src", "width"]),
	td: new Set(["colspan", "headers", "rowspan"]),
	th: new Set(["abbr", "colspan", "headers", "rowspan", "scope"]),
	time: new Set(["datetime"]),
};

const ALLOWED_DATA_ATTRIBUTES = new Set([
	"data-decimals", "data-duration", "data-nav", "data-nav-group", "data-nav-title",
	"data-pane", "data-prefix", "data-print-title", "data-sim-final", "data-sim-mode",
	"data-sim-reset", "data-sim-root", "data-suffix", "data-tab", "data-talk-event",
	"data-talk-value", "data-target",
]);

function attrsOf(node: HtmlNode): Map<string, string> {
	return new Map((node.attrs ?? []).map((attribute: { name: string; value: string }) => [attribute.name.toLowerCase(), attribute.value]));
}

function classesOf(node: HtmlNode): Set<string> {
	return new Set((attrsOf(node).get("class") ?? "").split(/\s+/).filter(Boolean));
}

function isElement(node: HtmlNode): boolean {
	return Boolean(node && typeof node.tagName === "string");
}

function descendants(node: HtmlNode): HtmlNode[] {
	const out: HtmlNode[] = [];
	const stack: HtmlNode[] = [];
	const pushChildren = (current: HtmlNode): void => {
		const children = [...(current?.childNodes ?? [])];
		if (current?.content) children.push(current.content);
		for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
	};
	pushChildren(node);
	while (stack.length) {
		const current = stack.pop();
		if (!current) continue;
		out.push(current);
		pushChildren(current);
	}
	return out;
}

function inspectTreeLimits(root: HtmlNode): { nodes: number; maxDepth: number; exceeded: boolean } {
	let nodes = 0;
	let maxDepth = 0;
	const stack: Array<{ node: HtmlNode; depth: number }> = [{ node: root, depth: 0 }];
	while (stack.length) {
		const entry = stack.pop();
		if (!entry?.node) continue;
		nodes += 1;
		maxDepth = Math.max(maxDepth, entry.depth);
		if (nodes > MAX_REPORT_NODES || maxDepth > MAX_REPORT_DEPTH) return { nodes, maxDepth, exceeded: true };
		const children = [...(entry.node.childNodes ?? [])];
		if (entry.node.content) children.push(entry.node.content);
		for (let index = children.length - 1; index >= 0; index -= 1) stack.push({ node: children[index], depth: entry.depth + 1 });
	}
	return { nodes, maxDepth, exceeded: false };
}

function hasDescendantClass(node: HtmlNode, className: string): boolean {
	return descendants(node).some((child) => isElement(child) && classesOf(child).has(className));
}

function hasAncestorClass(ancestors: HtmlNode[], className: string): boolean {
	return ancestors.some((ancestor) => isElement(ancestor) && classesOf(ancestor).has(className));
}

function decodeUrlForAudit(value: string): string {
	let decoded = value;
	for (let pass = 0; pass < 3; pass += 1) {
		const next = decoded
			.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
			.replace(/&(amp|colon|tab|newline);?/gi, (_, name: string) => {
				const values: Record<string, string> = { amp: "&", colon: ":", tab: "\t", newline: "\n" };
				return values[name.toLowerCase()] ?? "";
			});
		if (next === decoded) break;
		decoded = next;
	}
	return decoded.replace(/[\u0000-\u0020\u007f-\u009f\s]+/g, "").toLowerCase();
}

function isSafeUrl(attribute: "href" | "src", value: string): { safe: boolean; javascript: boolean } {
	// parse5 has already decoded numeric/named character references using HTML5 rules.
	const normalized = decodeUrlForAudit(value);
	if (!normalized || normalized.startsWith("#") || normalized.startsWith("/") || normalized.startsWith("./") || normalized.startsWith("../")) {
		return { safe: true, javascript: false };
	}
	if (normalized.startsWith("javascript:") || normalized.startsWith("vbscript:")) {
		return { safe: false, javascript: true };
	}
	const scheme = normalized.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
	if (!scheme) return { safe: true, javascript: false };
	if (attribute === "href") return { safe: ["http", "https", "mailto", "tel"].includes(scheme), javascript: false };
	if (["http", "https"].includes(scheme)) return { safe: true, javascript: false };
	if (scheme === "data") {
		return { safe: /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(normalized), javascript: false };
	}
	return { safe: false, javascript: false };
}

function stableToken(value: string): boolean {
	return /^[A-Za-z][A-Za-z0-9_.:-]*$/.test(value);
}

function validateDataAttribute(
	name: string,
	value: string,
	elementName: string,
	classes: Set<string>,
	add: (severity: ReportAuditSeverity, code: string, message: string) => void,
): void {
	if (!ALLOWED_DATA_ATTRIBUTES.has(name)) {
		add("error", "disallowed-attribute", `Report component attribute ${name} is not in the design-system schema.`);
		return;
	}
	if (["data-target", "data-decimals", "data-duration", "data-prefix", "data-suffix"].includes(name) && !classes.has("counter")) {
		add("error", "component-schema", `${name} is only valid on .counter elements.`);
	}
	if (name === "data-target") {
		const number = Number(value);
		if (!value.trim() || !Number.isFinite(number) || Math.abs(number) > 1_000_000_000_000_000) {
			add("error", "invalid-data-value", `${name} must be a finite number with magnitude at most 10^15.`);
		}
		return;
	}
	if (name === "data-decimals") {
		if (!/^\d+$/.test(value) || Number(value) > 6) add("error", "invalid-data-value", `${name} must be an integer from 0 to 6.`);
		return;
	}
	if (name === "data-duration") {
		if (!/^\d+$/.test(value) || Number(value) > 10_000) add("error", "invalid-data-value", `${name} must be an integer from 0 to 10000 milliseconds.`);
		return;
	}
	if (["data-tab", "data-pane", "data-talk-event", "data-sim-root", "data-sim-reset"].includes(name)) {
		if (!stableToken(value)) add("error", "invalid-data-value", `${name} must be a non-empty stable ASCII token.`);
		if (name === "data-tab" && !classes.has("tb") && !classes.has("tab")) add("error", "component-schema", "data-tab is only valid on .tb/.tab controls.");
		if (name === "data-pane" && !classes.has("tab-pane") && !classes.has("tab-panel")) add("error", "component-schema", "data-pane is only valid on tab panes.");
		if (name === "data-talk-event" && !["a", "button"].includes(elementName)) add("error", "component-schema", "data-talk-event is only valid on links or buttons.");
		if (["data-sim-root", "data-sim-reset"].includes(name) && elementName !== "button") add("error", "component-schema", `${name} is only valid on buttons.`);
		return;
	}
	if (name === "data-sim-mode") {
		if (!["good", "bad-sec", "bad-quality"].includes(value)) add("error", "invalid-data-value", `${name} uses an unsupported simulator mode.`);
		if (elementName !== "button") add("error", "component-schema", `${name} is only valid on buttons.`);
		return;
	}
	if (["data-nav-title", "data-nav-group", "data-prefix", "data-suffix", "data-print-title", "data-talk-value"].includes(name)) {
		if (!value.trim() || value.length > 200) add("error", "invalid-data-value", `${name} must contain 1–200 characters.`);
		if (name === "data-nav-title" && elementName !== "section") add("error", "component-schema", "data-nav-title is only valid on report sections.");
		if (name === "data-print-title" && !classes.has("tab-pane") && !classes.has("tab-panel")) add("error", "component-schema", "data-print-title is only valid on tab panes.");
		return;
	}
	if (name === "data-nav" && !stableToken(value)) add("error", "invalid-data-value", `${name} must be a stable ASCII ID.`);
}

function validateCommonAttributeValue(
	name: string,
	value: string,
	elementName: string,
	add: (severity: ReportAuditSeverity, code: string, message: string) => void,
): void {
	if (["width", "height"].includes(name)) {
		if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 4096) add("error", "invalid-attribute-value", `${name} must be an integer from 1 to 4096.`);
	}
	if (["colspan", "rowspan", "span"].includes(name)) {
		if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100) add("error", "invalid-attribute-value", `${name} must be an integer from 1 to 100.`);
	}
	if (name === "scope" && !["row", "col", "rowgroup", "colgroup"].includes(value)) add("error", "invalid-attribute-value", "th scope must be row, col, rowgroup or colgroup.");
	if (name === "target" && !["_self", "_blank"].includes(value)) add("error", "invalid-attribute-value", "Link target must be _self or _blank.");
	if (name === "type" && elementName === "button" && value.toLowerCase() !== "button") add("error", "invalid-attribute-value", "Report buttons must use type=button.");
	if (name === "loading" && !["lazy", "eager"].includes(value)) add("error", "invalid-attribute-value", "Image loading must be lazy or eager.");
	if (name === "decoding" && !["async", "sync", "auto"].includes(value)) add("error", "invalid-attribute-value", "Image decoding must be async, sync or auto.");
	if (name === "dir" && !["ltr", "rtl", "auto"].includes(value)) add("error", "invalid-attribute-value", "dir must be ltr, rtl or auto.");
	if (["title", "aria-label"].includes(name) && value.length > 500) add("error", "invalid-attribute-value", `${name} exceeds 500 characters.`);
	if (name === "role" && !["group", "heading", "img", "list", "listitem", "none", "note", "presentation", "region", "status"].includes(value.toLowerCase())) add("error", "invalid-attribute-value", `Role ${value} is outside the formal-report role set.`);
}

function validateTabSets(
	fragment: HtmlNode,
	add: (severity: ReportAuditSeverity, code: string, message: string) => void,
): void {
	for (const parent of [fragment, ...descendants(fragment)]) {
		const children = parent.childNodes ?? [];
		for (let index = 0; index < children.length; index += 1) {
			const bar = children[index];
			if (!isElement(bar)) continue;
			const barClasses = classesOf(bar);
			if (!barClasses.has("tabs") && !barClasses.has("tabbar")) continue;
			const tabClass = barClasses.has("tabs") ? "tb" : "tab";
			const panelClass = barClasses.has("tabs") ? "tab-pane" : "tab-panel";
			const tabs = descendants(bar).filter((node) => isElement(node) && classesOf(node).has(tabClass));
			if (tabs.some((node) => node.tagName !== "button")) add("error", "tabs-anatomy", "Tab controls must be button elements.");
			const panels: HtmlNode[] = [];
			for (let panelIndex = index + 1; panelIndex < children.length; panelIndex += 1) {
				const panel = children[panelIndex];
				if (panel?.nodeName === "#text" && !String(panel.value ?? "").trim()) continue;
				if (!isElement(panel) || !classesOf(panel).has(panelClass)) break;
				panels.push(panel);
			}
			if (tabs.length === 0 || tabs.length !== panels.length) {
				add("error", "tabs-anatomy", `Each .${barClasses.has("tabs") ? "tabs" : "tabbar"} needs an equal, non-zero run of adjacent panes.`);
				continue;
			}
			const tabKeys = tabs.map((node, tabIndex) => attrsOf(node).get("data-tab") ?? String(tabIndex));
			const paneKeys = panels.map((node, panelIndex) => attrsOf(node).get("data-pane") ?? String(panelIndex));
			if (new Set(tabKeys).size !== tabKeys.length || new Set(paneKeys).size !== paneKeys.length || tabKeys.some((key) => !paneKeys.includes(key))) {
				add("error", "tabs-anatomy", "Tab and pane keys must be unique and match one-to-one within each set.");
			}
		}
	}
}

function makeReportAuditResult(
	content: string,
	errors: ReportAuditIssue[],
	warnings: ReportAuditIssue[],
	normalizedHtml: string,
	stats?: Partial<ReportAuditResult["stats"]>,
): ReportAuditResult {
	const result: ReportAuditResult = {
		version: REPORT_DESIGN_SYSTEM_VERSION,
		valid: errors.length === 0,
		errors,
		warnings,
		normalizedHtml: "",
		stats: {
			bytes: Buffer.byteLength(content),
			sections: stats?.sections ?? 0,
			cards: stats?.cards ?? 0,
			kpis: stats?.kpis ?? 0,
			tables: stats?.tables ?? 0,
			inlineStyles: stats?.inlineStyles ?? 0,
		},
	};
	Object.defineProperty(result, "normalizedHtml", { value: normalizedHtml, enumerable: false });
	return result;
}

function auditReportContentUnsafe(
	content: string,
	options?: { requireStructure?: boolean },
): ReportAuditResult {
	const issues: ReportAuditIssue[] = [];
	const issueKeys = new Set<string>();
	const add = (severity: ReportAuditSeverity, code: string, message: string): void => {
		const key = `${severity}:${code}:${message}`;
		if (issueKeys.has(key)) return;
		issueKeys.add(key);
		issues.push({ severity, code, message });
	};
	const byteLength = Buffer.byteLength(content);
	if (byteLength > MAX_REPORT_BYTES) {
		add("error", "fragment-too-large", `Report fragment exceeds the hard ${MAX_REPORT_BYTES}-byte limit.`);
		return makeReportAuditResult(content, issues, [], "");
	}
	const parseErrors: Array<{ code?: string }> = [];
	let fragment: HtmlNode;
	try {
		fragment = parseFragment(content, {
			sourceCodeLocationInfo: true,
			onParseError: (error: { code?: string }) => parseErrors.push(error),
		});
	} catch (error) {
		add("error", "malformed-html", `HTML5 parser failed: ${error instanceof Error ? error.message : String(error)}`);
		fragment = parseFragment("");
	}
	if (parseErrors.length > 0) {
		add("error", "malformed-html", `HTML5 parser reported: ${[...new Set(parseErrors.map((error) => error.code ?? "parse-error"))].join(", ")}.`);
	}
	const limits = inspectTreeLimits(fragment);
	if (limits.exceeded) {
		add("error", "fragment-complexity", `Report fragment exceeds max depth ${MAX_REPORT_DEPTH} or node count ${MAX_REPORT_NODES} (observed depth ${limits.maxDepth}, nodes ${limits.nodes}+).`);
		return makeReportAuditResult(content, issues.filter((issue) => issue.severity === "error"), issues.filter((issue) => issue.severity === "warning"), "");
	}
	// Closing shell tags may be ignored by fragment parsing. They are still rejected,
	// and only the canonical serialization is ever published.
	if (/<\/?\s*(?:html|head|body|main|aside|nav|footer)\b/i.test(content)) {
		add("error", "shell-escape", "Report content cannot open or close document-shell elements.");
	}

	const facts: FragmentFacts = {
		classCounts: new Map(), ids: new Map(), headings: [], localLinks: [], sections: [],
		nonHeroSections: [], kpis: [], tables: [], inlineStyleCount: 0, topLevel: [], heroes: [], verdicts: [],
	};
	facts.topLevel = (fragment.childNodes ?? []).filter((node: HtmlNode) => isElement(node) || (node.nodeName === "#text" && String(node.value ?? "").trim()));

	const visit = (node: HtmlNode): void => {
		if (node.nodeName === "#comment") {
			add("error", "comment-markup", "HTML comments and bogus-comment syntax are not allowed in report fragments.");
			return;
		}
		if (!isElement(node)) return;

		const ancestors = ancestorChain(node);
		const name = String(node.tagName).toLowerCase();
		const attrs = attrsOf(node);
		if (node.sourceCodeLocation?.startTag && !node.sourceCodeLocation?.endTag && !VOID_ELEMENTS.has(name)) {
			add("error", "malformed-html", `Element <${name}> must have an explicit closing tag in report source.`);
		}
		const classes = classesOf(node);
		if (SHELL_ELEMENTS.has(name)) add("error", "shell-escape", `Shell element <${name}> is not allowed inside report content.`);
		else if (!ALLOWED_ELEMENTS.has(name)) add("error", ACTIVE_ELEMENTS.has(name) ? "active-content" : "unsupported-element", `Element <${name}> is not allowed in a formal report.`);

		for (const [attributeName, value] of attrs) {
			if (/^on[a-z0-9_-]+$/i.test(attributeName)) {
				add("error", "inline-handler", `Inline event handler ${attributeName} is not allowed in reports.`);
				continue;
			}
			if (attributeName === "hidden") {
				add("error", "hidden-content", "Author-supplied hidden attributes are not allowed in formal reports; runtime tabs manage hidden state.");
				continue;
			}
			const allowed = GLOBAL_ATTRIBUTES.has(attributeName)
				|| attributeName.startsWith("aria-")
				|| attributeName.startsWith("data-")
				|| ELEMENT_ATTRIBUTES[name]?.has(attributeName);
			if (!allowed) add("error", "disallowed-attribute", `Attribute ${attributeName} is not allowed on <${name}>.`);
			if (attributeName.startsWith("data-")) validateDataAttribute(attributeName, value, name, classes, add);
			validateCommonAttributeValue(attributeName, value, name, add);
			if ((attributeName === "href" || attributeName === "src")) {
				const url = isSafeUrl(attributeName, value);
				if (!url.safe) add("error", url.javascript ? "javascript-url" : "unsafe-url", `${attributeName} uses a disallowed URL scheme.`);
			}
			if (attributeName === "tabindex" && !["0", "-1"].includes(value)) {
				add("error", "invalid-attribute-value", "tabindex must be 0 or -1 in report content.");
			}
		}

		for (const className of classes) {
			if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(className)) add("error", "invalid-class", `Class token ${JSON.stringify(className)} is outside the report class vocabulary.`);
			if (RESERVED_CLASSES.has(className)) add("error", "shell-identity", `Class .${className} is reserved by the report shell.`);
			facts.classCounts.set(className, (facts.classCounts.get(className) ?? 0) + 1);
		}

		const id = attrs.get("id");
		if (id !== undefined) {
			if (!stableToken(id)) add("error", "invalid-id", `ID ${JSON.stringify(id)} must use a stable ASCII identifier.`);
			if (RESERVED_IDS.has(id) || id.startsWith("report-tabs-") || id.startsWith("report-tip-")) add("error", "shell-identity", `ID #${id} is reserved by the report runtime.`);
			facts.ids.set(id, (facts.ids.get(id) ?? 0) + 1);
		}

		const style = attrs.get("style");
		if (style !== undefined) {
			facts.inlineStyleCount += 1;
			const declarations = style.split(";").map((part) => part.trim()).filter(Boolean);
			const safeProgressToken = declarations.length === 1 && /^--w\s*:\s*(?:100(?:\.0+)?|[0-9]{1,2}(?:\.[0-9]+)?)%$/i.test(declarations[0]!);
			if (!safeProgressToken) add("error", "inline-style", "Formal reports only allow style=\"--w:0%…100%\" for progress; use design-system classes for layout and color.");
			if (!classes.has("anim-bar")) add("error", "component-schema", "The --w progress token is only valid on .anim-bar.");
		}
		if (attrs.has("data-talk-value") && !attrs.has("data-talk-event")) add("error", "component-schema", "data-talk-value requires data-talk-event on the same control.");
		if (classes.has("counter") && attrs.has("data-target") && !hasAncestorClass(ancestors, "num")) add("error", "component-schema", ".counter[data-target] must live inside a .num value container.");
		if (classes.has("anim-bar") && !hasAncestorClass(ancestors, "bar-row")) add("error", "component-schema", ".anim-bar must live inside .bar-row.");
		if (classes.has("mermaid") && !hasAncestorClass(ancestors, "mermaid-wrap")) add("error", "component-schema", ".mermaid must live inside .mermaid-wrap.");
		if (name === "img" && !attrs.has("alt")) add("warning", "image-alt", "Every report image should include an alt attribute (empty for decorative images)." );
		if (name === "a" && attrs.get("target") === "_blank" && !/\bnoopener\b/i.test(attrs.get("rel") ?? "")) add("warning", "noopener", "Links with target=\"_blank\" should include rel=\"noopener noreferrer\".");
		if (name === "a" && (attrs.get("href") ?? "").startsWith("#")) facts.localLinks.push((attrs.get("href") ?? "").slice(1));

		if (/^h[1-6]$/.test(name)) {
			facts.headings.push({ level: Number(name[1]), node });
			if (["none", "presentation"].includes((attrs.get("role") ?? "").toLowerCase())) add("error", "hidden-structure", "Headings cannot use presentation/none roles.");
		}
		if (name === "section" && id) {
			facts.sections.push(node);
			if (!classes.has("hero")) facts.nonHeroSections.push(node);
		}
		if (name === "table") facts.tables.push(node);
		if (classes.has("kpi")) facts.kpis.push(node);
		if (classes.has("hero")) facts.heroes.push(node);
		if (classes.has("verdict")) facts.verdicts.push(node);

		const isRequiredStructure = classes.has("hero") || classes.has("verdict") || (name === "section" && id !== undefined);
		if (isRequiredStructure) {
			if (["none", "presentation"].includes((attrs.get("role") ?? "").toLowerCase())) add("error", "hidden-structure", "Required report structure cannot use presentation/none roles.");
			if ((attrs.get("aria-hidden") ?? "").toLowerCase() === "true" || [...classes].some((className) => CONTENT_HIDING_CLASSES.has(className))) {
				add("error", "hidden-structure", "Hero, navigable sections and verdict cannot be hidden or use content-hiding classes.");
			}
			if ([...classes].some((className) => BEHAVIOR_CLASSES.has(className))) add("error", "component-schema", "Required report structure cannot also be a counter, chart, tab, simulator step or animation component.");
		}

	};
	const visitStack: HtmlNode[] = [...(fragment.childNodes ?? [])].reverse();
	while (visitStack.length) {
		const node = visitStack.pop();
		if (!node) continue;
		visit(node);
		const children = [...(node.childNodes ?? [])];
		if (node.content) children.push(node.content);
		for (let index = children.length - 1; index >= 0; index -= 1) visitStack.push(children[index]);
	}

	for (const [id, count] of facts.ids) if (count > 1) add("error", "duplicate-id", `Report fragment repeats ID #${id}.`);
	for (const target of facts.localLinks) if (target && !facts.ids.has(target)) add("warning", "broken-anchor", `Local link #${target} has no matching report ID.`);
	for (const kpi of facts.kpis) {
		if (!hasDescendantClass(kpi, "num") || !hasDescendantClass(kpi, "lbl")) add("error", "kpi-anatomy", "Each .kpi must contain a .num and a .lbl descendant.");
	}
	validateTabSets(fragment, add);

	const requireStructure = options?.requireStructure ?? true;
	if (requireStructure) {
		if (facts.heroes.length !== 1) add("error", "missing-hero", `Formal reports must contain exactly one .hero block (found ${facts.heroes.length}).`);
		const hero = facts.heroes[0];
		if (hero && (hero.tagName !== "section" || !attrsOf(hero).get("id") || !attrsOf(hero).get("data-nav-title"))) add("error", "hero-anatomy", ".hero must be a section with id and data-nav-title.");
		const h1s = facts.headings.filter((heading) => heading.level === 1);
		if (h1s.length !== 1) add("error", "h1-count", `Formal reports must contain exactly one h1 (found ${h1s.length}).`);
		if (h1s[0] && !hasAncestorClass(ancestorChain(h1s[0].node), "hero")) add("error", "hero-anatomy", "The report h1 must be inside .hero.");
		if (facts.nonHeroSections.length === 0) add("error", "missing-sections", "Add at least one non-hero section[id].sec-head block for navigable evidence.");
		for (const section of facts.nonHeroSections) {
			const attrs = attrsOf(section);
			const classes = classesOf(section);
			if (!classes.has("sec-head") || !attrs.get("data-nav-title")) add("error", "section-anatomy", "Every non-hero section[id] must use .sec-head and data-nav-title.");
		}
		if (facts.verdicts.length !== 1) add("error", "missing-verdict", `Formal reports must contain exactly one .verdict decision block (found ${facts.verdicts.length}).`);
		const first = facts.topLevel[0];
		const last = facts.topLevel[facts.topLevel.length - 1];
		if (!isElement(first) || !classesOf(first).has("hero")) add("error", "hero-order", "The first meaningful top-level report node must be .hero.");
		if (!isElement(last) || !classesOf(last).has("verdict")) add("error", "verdict-order", "The final meaningful top-level report node must be .verdict.");
		for (let index = 1; index < facts.headings.length; index += 1) {
			if (facts.headings[index]!.level > facts.headings[index - 1]!.level + 1) {
				add("warning", "heading-order", `Heading hierarchy jumps from h${facts.headings[index - 1]!.level} to h${facts.headings[index]!.level}.`);
				break;
			}
		}
	}
	const normalizedHtml = serialize(fragment);
	try {
		const secondPass = serialize(parseFragment(normalizedHtml));
		if (secondPass !== normalizedHtml) add("error", "unstable-sanitization", "HTML5 parse/serialize output is not idempotent; fragment rejected as a mutation risk.");
	} catch {
		add("error", "unstable-sanitization", "Canonical report fragment could not be reparsed.");
	}
	const errors = issues.filter((issue) => issue.severity === "error");
	const warnings = issues.filter((issue) => issue.severity === "warning");
	return makeReportAuditResult(content, errors, warnings, normalizedHtml, {
		sections: facts.sections.length,
		cards: facts.classCounts.get("card") ?? 0,
		kpis: facts.kpis.length,
		tables: facts.tables.length,
		inlineStyles: facts.inlineStyleCount,
	});
}

export function auditReportContent(
	content: string,
	options?: { requireStructure?: boolean },
): ReportAuditResult {
	try {
		return auditReportContentUnsafe(content, options);
	} catch (error) {
		return makeReportAuditResult(
			content,
			[{
				severity: "error",
				code: "audit-failure",
				message: `Report audit failed closed: ${error instanceof Error ? error.message : String(error)}`,
			}],
			[],
			"",
		);
	}
}

function ancestorChain(node: HtmlNode): HtmlNode[] {
	const chain: HtmlNode[] = [];
	for (let current = node?.parentNode; current; current = current.parentNode) chain.push(current);
	return chain;
}

export function auditAssembledReportDocument(html: string): AssembledReportAuditResult {
	const issues: ReportAuditIssue[] = [];
	const add = (severity: ReportAuditSeverity, code: string, message: string): void => {
		if (!issues.some((issue) => issue.severity === severity && issue.code === code && issue.message === message)) issues.push({ severity, code, message });
	};
	const parseErrors: Array<{ code?: string }> = [];
	let document: HtmlNode;
	try {
		document = parse(html, { sourceCodeLocationInfo: true, onParseError: (error: { code?: string }) => parseErrors.push(error) });
	} catch (error) {
		add("error", "assembled-parse", `Final report document could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
		document = parse("");
	}
	// Missing doctype is irrelevant here; any other generated-document parse error is blocking.
	const relevantErrors = parseErrors.filter((error) => error.code !== "missing-doctype");
	if (relevantErrors.length) add("error", "assembled-parse", `Final report HTML5 parse errors: ${[...new Set(relevantErrors.map((error) => error.code ?? "parse-error"))].join(", ")}.`);
	const nodes = [document, ...descendants(document)];
	const elements = nodes.filter(isElement);
	const ids = new Map<string, number>();
	for (const element of elements) {
		const id = attrsOf(element).get("id");
		if (id) ids.set(id, (ids.get(id) ?? 0) + 1);
	}
	for (const [id, count] of ids) if (count > 1) add("error", "assembled-duplicate-id", `Final report repeats ID #${id}.`);
	for (const requiredId of ["report-main", "report-nav", "report-content-root", "report-runtime", "talk-bridge"]) {
		if ((ids.get(requiredId) ?? 0) !== 1) add("error", "assembled-shell", `Final report must contain exactly one #${requiredId}.`);
	}
	const h1Count = elements.filter((element) => element.tagName === "h1").length;
	if (h1Count !== 1) add("error", "assembled-h1", `Final report must contain exactly one h1 across all slots (found ${h1Count}).`);
	const scripts = elements.filter((element) => element.tagName === "script");
	if (scripts.length !== 2 || !scripts.some((node) => attrsOf(node).get("id") === "report-runtime") || !scripts.some((node) => /^v[12]$/.test(attrsOf(node).get("data-talk-bridge") ?? ""))) {
		add("error", "assembled-active-content", "Final report may contain only the trusted report runtime and Talk bridge scripts.");
	}
	if (elements.filter((element) => element.tagName === "style").length !== 1) add("error", "assembled-style", "Final report must contain exactly one trusted design-system style element.");
	const cspMetas = elements.filter((element) => element.tagName === "meta" && (attrsOf(element).get("http-equiv") ?? "").toLowerCase() === "content-security-policy");
	if (cspMetas.length !== 1) add("error", "assembled-csp", "Final report snapshot must embed exactly one Content-Security-Policy meta tag.");
	const nonceMetas = elements.filter((element) => element.tagName === "meta" && attrsOf(element).get("name") === "report-style-nonce");
	const styleNonce = nonceMetas.length === 1 ? attrsOf(nonceMetas[0]).get("content") : undefined;
	const embeddedPolicy = cspMetas.length === 1 ? attrsOf(cspMetas[0]).get("content") ?? "" : "";
	if (!styleNonce || !embeddedPolicy.includes(`'nonce-${styleNonce}'`)) add("error", "assembled-csp", "Final report must bind one Mermaid style nonce into its embedded CSP.");
	const contentRoot = elements.find((element) => attrsOf(element).get("id") === "report-content-root");
	if (!contentRoot || !ancestorChain(contentRoot).some((ancestor) => attrsOf(ancestor).get("id") === "report-main")) add("error", "assembled-shell", "#report-content-root must remain inside #report-main.");
	const errors = issues.filter((issue) => issue.severity === "error");
	return { valid: errors.length === 0, errors, warnings: issues.filter((issue) => issue.severity === "warning") };
}

export function formatReportAudit(audit: ReportAuditResult): string {
	return `report-ds v${audit.version} audit: ${audit.errors.length} error(s), ${audit.warnings.length} warning(s)`;
}
