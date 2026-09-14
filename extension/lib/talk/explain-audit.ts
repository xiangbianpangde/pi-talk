import { parse, parseFragment, serialize } from "../../../npm/node_modules/parse5/dist/index.js";

export const EXPLAIN_DESIGN_SYSTEM_VERSION = "1.0.0";

export type ExplainAuditSeverity = "error" | "warning";

export interface ExplainAuditIssue {
	severity: ExplainAuditSeverity;
	code: string;
	message: string;
}

export interface ExplainAuditResult {
	version: string;
	valid: boolean;
	errors: ExplainAuditIssue[];
	warnings: ExplainAuditIssue[];
	normalizedHtml: string;
	stats: {
		bytes: number;
		layers: number;
		analogies: number;
		codeBlocks: number;
		checks: number;
	};
}

type HtmlNode = any;

const MAX_EXPLAIN_BYTES = 180_000;
const MAX_EXPLAIN_NODES = 10_000;
const MAX_EXPLAIN_DEPTH = 128;

const ACTIVE_ELEMENTS = new Set([
	"base", "embed", "form", "iframe", "link", "meta", "object", "script", "style", "template",
]);

const ALLOWED_ELEMENTS = new Set([
	"a", "abbr", "article", "b", "blockquote", "br", "button", "caption", "cite",
	"code", "col", "colgroup", "dd", "del", "div", "dl", "dt", "em",
	"figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img",
	"kbd", "li", "mark", "ol", "p", "pre", "q", "s", "samp", "section", "small",
	"span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th",
	"thead", "time", "tr", "u", "ul", "var",
]);

const RESERVED_IDS = new Set([
	"explain-content-root", "explain-main", "explain-runtime", "talk-bridge",
]);

const GLOBAL_ATTRIBUTES = new Set([
	"class", "dir", "id", "lang", "role", "tabindex", "title", "aria-label", "aria-hidden", "aria-pressed", "aria-live", "aria-atomic",
]);

const ELEMENT_ATTRIBUTES: Record<string, Set<string>> = {
	a: new Set(["download", "href", "rel", "target"]),
	button: new Set(["disabled", "type", "aria-pressed"]),
	col: new Set(["span"]),
	colgroup: new Set(["span"]),
	img: new Set(["alt", "decoding", "height", "loading", "src", "width"]),
	td: new Set(["colspan", "headers", "rowspan"]),
	th: new Set(["abbr", "colspan", "headers", "rowspan", "scope"]),
	time: new Set(["datetime"]),
};

const ALLOWED_DATA_ATTRIBUTES = new Set([
	"data-talk-event", "data-talk-value", "data-target",
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
		if (nodes > MAX_EXPLAIN_NODES || maxDepth > MAX_EXPLAIN_DEPTH) return { nodes, maxDepth, exceeded: true };
		const children = [...(entry.node.childNodes ?? [])];
		if (entry.node.content) children.push(entry.node.content);
		for (let index = children.length - 1; index >= 0; index -= 1) stack.push({ node: children[index], depth: entry.depth + 1 });
	}
	return { nodes, maxDepth, exceeded: false };
}

function findDescendantByClass(node: HtmlNode, className: string): HtmlNode | undefined {
	return descendants(node).find((child) => isElement(child) && classesOf(child).has(className));
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

export function auditExplainContent(
	content: string,
	options?: { requireStructure?: boolean },
): ExplainAuditResult {
	const issues: ExplainAuditIssue[] = [];
	const add = (severity: ExplainAuditSeverity, code: string, message: string): void => {
		if (!issues.some((i) => i.severity === severity && i.code === code && i.message === message)) {
			issues.push({ severity, code, message });
		}
	};

	const byteLength = Buffer.byteLength(content);
	if (byteLength > MAX_EXPLAIN_BYTES) {
		add("error", "fragment-too-large", `Explain fragment exceeds ${MAX_EXPLAIN_BYTES} bytes.`);
		return {
			version: EXPLAIN_DESIGN_SYSTEM_VERSION,
			valid: false,
			errors: issues.filter((i) => i.severity === "error"),
			warnings: issues.filter((i) => i.severity === "warning"),
			normalizedHtml: "",
			stats: { bytes: byteLength, layers: 0, analogies: 0, codeBlocks: 0, checks: 0 },
		};
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
		for (const err of parseErrors) {
			add("error", "malformed-html", `HTML5 parser reported: ${err.code || "syntax-error"}.`);
		}
	}

	const limits = inspectTreeLimits(fragment);
	if (limits.exceeded) {
		add("error", "fragment-too-complex", `Explain fragment exceeds max nodes (${MAX_EXPLAIN_NODES}) or max depth (${MAX_EXPLAIN_DEPTH}).`);
		return {
			version: EXPLAIN_DESIGN_SYSTEM_VERSION,
			valid: false,
			errors: issues.filter((i) => i.severity === "error"),
			warnings: issues.filter((i) => i.severity === "warning"),
			normalizedHtml: "",
			stats: { bytes: byteLength, layers: 0, analogies: 0, codeBlocks: 0, checks: 0 },
		};
	}

	const ids = new Map<string, number>();
	const headings: Array<{ level: number; node: HtmlNode }> = [];
	let layerCount = 0;
	let analogyCount = 0;
	let codeBlockCount = 0;
	let checkCount = 0;
	const analogyNodes: HtmlNode[] = [];

	const visit = (node: HtmlNode): void => {
		if (node.nodeName === "#comment") {
			add("error", "comment-markup", "HTML comments are not allowed in explain fragments.");
			return;
		}
		if (!isElement(node)) return;

		const name = String(node.tagName).toLowerCase();
		const attrs = attrsOf(node);
		const classes = classesOf(node);

		// 硬性禁止 <details>
		if (name === "details") {
			add("error", "forbidden-details", "The explain design system is directly visible and strictly forbids <details> folding.");
			return;
		}

		if (ACTIVE_ELEMENTS.has(name)) {
			add("error", "forbidden-element", `Element <${name}> is forbidden in explain fragments.`);
			return;
		}

		if (!ALLOWED_ELEMENTS.has(name)) {
			add("error", "disallowed-element", `Element <${name}> is not in the allowed explain element set.`);
			return;
		}

		// 属性白名单与安全校验
		const allowedAttrs = new Set([...GLOBAL_ATTRIBUTES, ...(ELEMENT_ATTRIBUTES[name] ?? [])]);
		for (const [attrName, attrVal] of attrs) {
			if (attrName.startsWith("data-")) {
				if (!ALLOWED_DATA_ATTRIBUTES.has(attrName)) {
					add("error", "disallowed-data-attribute", `Data attribute ${attrName} is not in the explain schema.`);
				} else if (attrName === "data-talk-event" && !["a", "button"].includes(name)) {
					add("error", "invalid-attribute", "data-talk-event is only permitted on links or buttons.");
				} else if (attrName === "data-talk-event" && !stableToken(attrVal)) {
					add("error", "invalid-attribute", "data-talk-event must be a stable ASCII identifier.");
				}
				continue;
			}
			if (attrName.startsWith("on")) {
				add("error", "active-attribute", `Inline handler ${attrName} is prohibited.`);
				continue;
			}
			if (attrName === "style") {
				// Explain 设计系统完全平铺，不需要作者自定义内联 style
				add("error", "forbidden-style", "Inline style attributes are forbidden in explain fragments; use explain design-system classes.");
				continue;
			}
			if (!allowedAttrs.has(attrName)) {
				add("error", "disallowed-attribute", `Attribute ${attrName} is not permitted on <${name}>.`);
				continue;
			}

			// URL 安全性校验
			if (attrName === "href" || attrName === "src") {
				const check = isSafeUrl(attrName as "href" | "src", attrVal);
				if (!check.safe) {
					add("error", "unsafe-url", `Unsafe URL scheme in ${attrName}="${attrVal}".`);
				}
			}

			// Link target 安全性
			if (name === "a" && attrName === "target") {
				const targetVal = attrVal.toLowerCase();
				if (!["_blank", "_self"].includes(targetVal)) {
					add("error", "invalid-link-target", 'Link target must be "_blank" or "_self".');
				} else if (targetVal === "_blank") {
					const rel = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/);
					if (!rel.includes("noopener")) {
						add("error", "unsafe-link-target", 'Links with target="_blank" must include rel="noopener".');
					}
				}
			}

			// Button 类型
			if (name === "button" && attrName === "type") {
				if (attrVal !== "button") {
					add("error", "invalid-button-type", 'Buttons in explain must use type="button".');
				}
			}
		}

		const id = attrs.get("id");
		if (id) {
			if (RESERVED_IDS.has(id)) add("error", "reserved-id", `ID #${id} is reserved by the explain shell.`);
			if (!stableToken(id)) add("error", "invalid-id", `ID "${id}" must be a stable ASCII identifier.`);
			ids.set(id, (ids.get(id) || 0) + 1);
		}

		if (/^h[1-6]$/.test(name)) {
			headings.push({ level: Number(name[1]), node });
		}

		if (classes.has("layer-block")) layerCount += 1;
		if (classes.has("analogy-card")) {
			analogyCount += 1;
			analogyNodes.push(node);
		}
		if (classes.has("code-block")) codeBlockCount += 1;
		if (classes.has("check-card")) checkCount += 1;
	};

	const stack = [...(fragment.childNodes ?? [])].reverse();
	while (stack.length) {
		const curr = stack.pop();
		if (!curr) continue;
		visit(curr);
		const children = [...(curr.childNodes ?? [])];
		if (curr.content) children.push(curr.content);
		for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
	}

	// 校验重复 ID
	for (const [id, count] of ids) {
		if (count > 1) add("error", "duplicate-id", `Duplicate ID #${id} found in fragment.`);
	}

	// 校验 h1
	const requireStructure = options?.requireStructure ?? true;
	if (requireStructure) {
		const h1s = headings.filter((h) => h.level === 1);
		if (h1s.length !== 1) {
			add("error", "h1-count", `Explain fragments must contain exactly one h1 (found ${h1s.length}).`);
		}
	}

	// 校验平滑标题顺序
	for (let i = 1; i < headings.length; i += 1) {
		if (headings[i]!.level > headings[i - 1]!.level + 1) {
			add("warning", "heading-order", `Heading hierarchy jumps from h${headings[i - 1]!.level} to h${headings[i]!.level}.`);
			break;
		}
	}

	// 校验类比卡片必须包含恰好一个直接子项 .analogy-text 且紧邻跟随恰好一个 .breakage-note
	for (const analogy of analogyNodes) {
		const directElements = (analogy.childNodes ?? []).filter(isElement);
		const textIndices: number[] = [];
		const breakageIndices: number[] = [];
		for (let i = 0; i < directElements.length; i += 1) {
			if (classesOf(directElements[i]).has("analogy-text")) textIndices.push(i);
			if (classesOf(directElements[i]).has("breakage-note")) breakageIndices.push(i);
		}
		if (
			textIndices.length !== 1 ||
			breakageIndices.length !== 1 ||
			breakageIndices[0] !== textIndices[0] + 1
		) {
			add("error", "analogy-anatomy", "Each .analogy-card must contain exactly one direct child .analogy-text immediately followed by exactly one .breakage-note.");
		}
	}

	const normalizedHtml = serialize(fragment);
	const errors = issues.filter((i) => i.severity === "error");
	const warnings = issues.filter((i) => i.severity === "warning");

	return {
		version: EXPLAIN_DESIGN_SYSTEM_VERSION,
		valid: errors.length === 0,
		errors,
		warnings,
		normalizedHtml,
		stats: {
			bytes: byteLength,
			layers: layerCount,
			analogies: analogyCount,
			codeBlocks: codeBlockCount,
			checks: checkCount,
		},
	};
}

export function formatExplainAudit(result: ExplainAuditResult): string {
	const parts = [
		`explain-ds v${result.version} audit: ${result.errors.length} error(s), ${result.warnings.length} warning(s)`,
	];
	for (const issue of result.errors) parts.push(`  ❌ [${issue.code}] ${issue.message}`);
	for (const issue of result.warnings) parts.push(`  ⚠️  [${issue.code}] ${issue.message}`);
	return parts.join("\n");
}
