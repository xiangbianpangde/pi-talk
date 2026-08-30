/**
 * Lightweight structure/security lint for non-report html styles.
 *
 * Advisory only (never blocks rendering): catches parse errors, inline
 * event handlers, javascript: URLs, unsafe iframes, and shell elements
 * inside fragments. report has its own strict design-system audit.
 */

import { parse as parseHtml, parseFragment } from "../../../npm/node_modules/parse5/dist/index.js";

export interface LintIssue {
	severity: "warning";
	code: string;
	message: string;
}

const MAX_LINT_NODES = 20_000;

function collectNodes(root: any): any[] {
	const out: any[] = [];
	const stack: any[] = [root];
	while (stack.length) {
		const node = stack.pop();
		if (!node) continue;
		out.push(node);
		if (out.length > MAX_LINT_NODES) break;
		const children = [...(node.childNodes ?? [])];
		if (node.content) children.push(node.content);
		for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
	}
	return out;
}

export function lintHtmlFragment(
	content: string,
	opts?: { fullDocument?: boolean },
): LintIssue[] {
	const issues: LintIssue[] = [];
	if (!content.trim()) return issues;

	const parseErrors: Array<{ code?: string }> = [];
	let document: any;
	try {
		document = opts?.fullDocument
			? parseHtml(content, {
					sourceCodeLocationInfo: true,
					onParseError: (error: { code?: string }) => parseErrors.push(error),
				})
			: parseFragment(content, {
					sourceCodeLocationInfo: true,
					onParseError: (error: { code?: string }) => parseErrors.push(error),
				});
	} catch (error) {
		issues.push({
			severity: "warning",
			code: "parse-failed",
			message: `HTML5 parser failed: ${error instanceof Error ? error.message : String(error)}`,
		});
		return issues;
	}

	if (parseErrors.length > 0) {
		const real = parseErrors.filter((e) => e.code !== "missing-doctype" && e.code !== "duplicate-attribute");
		if (real.length > 0) {
			issues.push({
				severity: "warning",
				code: "malformed-html",
				message: `HTML5 parser reported: ${[...new Set(real.map((e) => e.code ?? "parse-error"))].join(", ")}`,
			});
		}
	}

	const nodes = collectNodes(document);
	const tagNames = new Set<string>();
	for (const node of nodes) {
		if (node?.nodeName && !node.nodeName.startsWith("#")) tagNames.add(String(node.tagName ?? node.nodeName).toLowerCase());
	}

	if (!opts?.fullDocument) {
		for (const tag of ["html", "head", "body", "main", "nav", "footer", "aside"]) {
			if (tagNames.has(tag)) {
				issues.push({
					severity: "warning",
					code: "shell-in-fragment",
					message: `<${tag}> inside a fragment: pass a full document via a full-document template, or keep fragments to body content.`,
				});
			}
		}
	}

	for (const node of nodes) {
		if (node?.nodeName?.startsWith("#")) continue;
		const name = String(node.tagName ?? "").toLowerCase();
		const attrs = new Map(
			(node.attrs ?? []).map((a: { name: string; value: string }) => [a.name.toLowerCase(), a.value]),
		);
		for (const [attrName] of attrs) {
			if (/^on[a-z0-9_-]+$/i.test(attrName)) {
				issues.push({
					severity: "warning",
					code: "inline-handler",
					message: `Inline event handler ${attrName} on <${name}>: prefer data-talk-* attributes so events reach the agent.`,
				});
			}
		}
		if (name === "a" || name === "iframe" || name === "form" || name === "img" || name === "script") {
			const href = attrs.get("href") ?? attrs.get("src") ?? attrs.get("action");
			if (href && /^\s*javascript:/i.test(href)) {
				issues.push({
					severity: "warning",
					code: "javascript-url",
					message: `javascript: URL on <${name}> is blocked by CSP and bad practice.`,
				});
			}
		}
		if (name === "iframe" && !attrs.get("sandbox") && !attrs.get("allow")) {
			issues.push({
				severity: "warning",
				code: "unsafe-iframe",
				message: `<iframe> without sandbox/allow: prefer sandbox="allow-scripts" for embedded previews.`,
			});
		}
		if (name === "script" && opts?.fullDocument !== true) {
			issues.push({
				severity: "warning",
				code: "inline-script",
				message: `<script> in author content: allowed for html-interactive prototypes, but prefer the injected talk bridge + data-talk-* attributes.`,
			});
		}
		if (name === "form" && !attrs.has("data-talk-form")) {
			issues.push({
				severity: "warning",
				code: "unbridged-form",
				message: `<form> without data-talk-form will not reach the agent: add data-talk-form="submit" (or a name) so submissions are serialized.`,
			});
		}
		if ((name === "button" || name === "a") && !attrs.has("data-talk-event") && !attrs.has("href")) {
			issues.push({
				severity: "warning",
				code: "unbridged-control",
				message: `<${name}> without data-talk-event has no agent feedback: add data-talk-event="choose" data-talk-value="...".`,
			});
		}
	}

	return issues;
}
