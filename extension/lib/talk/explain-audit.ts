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

function hasDescendantClass(node: HtmlNode, className: string): boolean {
	return descendants(node).some((child) => isElement(child) && classesOf(child).has(className));
}

function findDescendantByClass(node: HtmlNode, className: string): HtmlNode | undefined {
	return descendants(node).find((child) => isElement(child) && classesOf(child).has(className));
}

export function auditExplainContent(content: string): ExplainAuditResult {
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

		const id = attrs.get("id");
		if (id) {
			if (RESERVED_IDS.has(id)) add("error", "reserved-id", `ID #${id} is reserved by the explain shell.`);
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

		// 检查 style 属性（禁止非令牌内联布局）
		const styleAttr = attrs.get("style");
		if (styleAttr && styleAttr.trim()) {
			const parts = styleAttr.split(";").map((p) => p.trim()).filter(Boolean);
			const nonToken = parts.some((p) => !/^--[a-z0-9_-]+\s*:/i.test(p));
			if (nonToken) {
				add("error", "inline-style", "Explain pages only allow design system tokens for inline styles; use classes for layout.");
			}
		}

		// 检查 onclick 等内联事件
		for (const [attrName] of attrs) {
			if (/^on[a-z]+/i.test(attrName)) {
				add("error", "active-attribute", `Inline handler ${attrName} is prohibited.`);
			}
		}
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
	const h1s = headings.filter((h) => h.level === 1);
	if (h1s.length !== 1) {
		add("error", "h1-count", `Explain fragments must contain exactly one h1 (found ${h1s.length}).`);
	}

	// 校验平滑标题顺序
	for (let i = 1; i < headings.length; i += 1) {
		if (headings[i]!.level > headings[i - 1]!.level + 1) {
			add("warning", "heading-order", `Heading hierarchy jumps from h${headings[i - 1]!.level} to h${headings[i]!.level}.`);
			break;
		}
	}

	// 校验类比卡片必须包含类比失效说明
	for (const analogy of analogyNodes) {
		if (!findDescendantByClass(analogy, "breakage-note")) {
			add("error", "analogy-breakage", "Each .analogy-card must contain a .breakage-note explaining where the analogy breaks down.");
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

