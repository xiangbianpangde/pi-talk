/**
 * Export pipeline: turn the current /talk surface into durable artifacts.
 *
 * Formats:
 *  - html — full document snapshot
 *  - md   — GFM markdown (report fragments convert cleanly; others best-effort)
 *  - png  — headless full-page screenshot (chrome)
 *  - pdf  — print-to-pdf (respects report print CSS)
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseHtml } from "../../../npm/node_modules/parse5/dist/index.js";
import { getSessionDir } from "./paths";
import { chromeCapture } from "./verify";
import type { TalkRenderResult } from "./types";

export type TalkExportFormat = "html" | "md" | "png" | "pdf";

export interface ExportTarget {
	sessionId?: string;
	server?: {
		url: string;
		getState(surfaceId?: string): { html: string; title: string; fragment?: string } | undefined;
	};
}

export interface ExportOptions {
	format: TalkExportFormat;
	out?: string;
	surface?: string;
	width?: number;
	height?: number;
}

export async function exportSurface(
	target: ExportTarget,
	opts: ExportOptions,
): Promise<TalkRenderResult> {
	const surface = opts.surface && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(opts.surface) ? opts.surface : "main";
	if (!target.server) {
		return { ok: false, styleId: "", kind: "html-js", message: "No active talk session to export." };
	}
	const state = target.server.getState(surface);
	if (!state) {
		return { ok: false, styleId: "", kind: "html-js", message: `Surface "${surface}" has no rendered document.` };
	}

	const sessionDir = target.sessionId ? getSessionDir(target.sessionId) : getSessionDir("_");
	const exportsDir = join(sessionDir, "exports");
	const stamp = Date.now();

	const resolveOut = (ext: string): string => {
		if (opts.out) {
			const abs = resolve(opts.out);
			mkdirSync(join(abs, ".."), { recursive: true });
			return abs;
		}
		mkdirSync(exportsDir, { recursive: true });
		return join(exportsDir, `${stamp}-${surface}.${ext}`);
	};

	try {
		if (opts.format === "html") {
			const out = resolveOut("html");
			writeFileSync(out, state.html);
			return {
				ok: true,
				styleId: "html",
				kind: "html",
				message: `Exported html → ${out}`,
				file: out,
				details: { format: "html", surface, bytes: Buffer.byteLength(state.html) },
			};
		}

		if (opts.format === "md") {
			const md = htmlToMarkdown(state.fragment ?? state.html);
			const out = resolveOut("md");
			writeFileSync(out, md);
			return {
				ok: true,
				styleId: "",
				kind: "html",
				message: `Exported markdown → ${out}`,
				file: out,
				details: { format: "md", surface, chars: md.length },
			};
		}

		if (opts.format === "png" || opts.format === "pdf") {
			const base = target.server.url;
			const url = surface === "main" ? base : `${base}s/${surface}`;
			const out = resolveOut(opts.format);
			const capture = await chromeCapture(url, out, {
				pdf: opts.format === "pdf",
				width: opts.width,
				height: opts.height,
			});
			if (!capture.ok) {
				return {
					ok: false,
					styleId: "",
					kind: "html",
					message: `Export ${opts.format} failed: ${capture.error || capture.stderr || "capture error"}`,
					details: { format: opts.format, surface },
				};
			}
			return {
				ok: true,
				styleId: "",
				kind: "html",
				message: `Exported ${opts.format} → ${out}`,
				file: out,
				details: { format: opts.format, surface, url },
			};
		}

		return { ok: false, styleId: "", kind: "html", message: `Unknown export format: ${opts.format}` };
	} catch (error) {
		return {
			ok: false,
			styleId: "",
			kind: "html",
			message: `Export failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

const BLOCK_TAGS = new Set(["div", "section", "article", "header", "footer", "nav", "aside", "main", "body", "figure", "figcaption", "details", "summary", "center"]);

function inlineText(node: any): string {
	if (node.nodeName === "#text") return String(node.value ?? "");
	if (node.nodeName === "#comment") return "";
	const name = String(node.tagName ?? "").toLowerCase();
	const attrs = new Map((node.attrs ?? []).map((a: { name: string; value: string }) => [a.name.toLowerCase(), a.value]));
	const inner = (node.childNodes ?? []).map(inlineText).join("");
	switch (name) {
		case "br": return "\n";
		case "strong": case "b": return `**${inner}**`;
		case "em": case "i": return `*${inner}*`;
		case "code": return `\`${inner}\``;
		case "a": {
			const href = attrs.get("href");
			return href ? `[${inner}](${href})` : inner;
		}
		case "img": {
			const alt = attrs.get("alt") ?? "";
			const src = attrs.get("src") ?? "";
			return src ? `![${alt}](${src})` : alt;
		}
		case "script": case "style": return "";
		case "span": case "label": case "small": case "sub": case "sup": case "abbr": case "mark": case "time": case "kbd": case "samp": case "var": case "del": case "ins": case "u": case "s": case "q": case "cite": case "dfn": case "bdi": case "bdo": case "wbr": case "button": case "select": case "option": case "textarea": case "input": return inner;
		default: return inner;
	}
}

function tableToMarkdown(node: any, out: string[]): void {
	const caption = (node.childNodes ?? []).find((c: any) => String(c.tagName ?? "").toLowerCase() === "caption");
	if (caption) out.push(`**${(caption.childNodes ?? []).map(inlineText).join("").trim()}**`, "");
	const rows: string[][] = [];
	const collect = (n: any) => {
		for (const c of n.childNodes ?? []) {
			const name = String(c.tagName ?? "").toLowerCase();
			if (name === "tr") {
				const cells = (c.childNodes ?? [])
					.filter((cc: any) => ["th", "td"].includes(String(cc.tagName ?? "").toLowerCase()))
					.map((cc: any) => (cc.childNodes ?? []).map(inlineText).join("").trim().replace(/\|/g, "\\|"));
				rows.push(cells);
			} else if (name === "thead" || name === "tbody" || name === "tfoot") collect(c);
		}
	};
	collect(node);
	if (rows.length === 0) return;
	const width = Math.max(...rows.map((r) => r.length));
	for (const r of rows) while (r.length < width) r.push("");
	out.push(`| ${rows[0].join(" | ")} |`);
	out.push(`| ${rows[0].map(() => "---").join(" | ")} |`);
	for (const r of rows.slice(1)) out.push(`| ${r.join(" | ")} |`);
	out.push("");
}

export function htmlToMarkdown(html: string): string {
	const document = parseHtml(html, {}) as any;
	const out: string[] = [];

	const walk = (node: any): void => {
		for (const child of node.childNodes ?? []) {
			if (child.nodeName === "#text") {
				const text = String(child.value ?? "").trim();
				if (text) out.push(text, "");
				continue;
			}
			if (child.nodeName === "#comment") continue;
			const name = String(child.tagName ?? "").toLowerCase();
			if (name === "script" || name === "style" || name === "template" || name === "head") continue;
			if (name === "html" || name === "body") {
				walk(child);
				continue;
			}
			if (name === "h1" || name === "h2" || name === "h3" || name === "h4" || name === "h5" || name === "h6") {
				const level = Number(name[1]);
				const text = (child.childNodes ?? []).map(inlineText).join("").trim();
				if (text) out.push(`${"#".repeat(level)} ${text}`, "");
				continue;
			}
			if (name === "p") {
				const text = (child.childNodes ?? []).map(inlineText).join("").trim();
				if (text) out.push(text, "");
				continue;
			}
			if (name === "blockquote") {
				const before = out.length;
				walk(child);
				const block = out.splice(before).filter((l) => l !== "");
				if (block.length) out.push(block.map((l) => `> ${l}`).join("\n"), "");
				continue;
			}
			if (name === "ul" || name === "ol") {
				const ordered = name === "ol";
				let index = 1;
				for (const li of child.childNodes ?? []) {
					if (String(li.tagName ?? "").toLowerCase() !== "li") continue;
					const text = (li.childNodes ?? []).map(inlineText).join("").trim();
					const prefix = ordered ? `${index}. ` : "- ";
					index += 1;
					if (text) out.push(`${prefix}${text}`);
					// nested lists inside li
					for (const sub of li.childNodes ?? []) {
						const subName = String(sub.tagName ?? "").toLowerCase();
						if (subName === "ul" || subName === "ol") {
							const before = out.length;
							walk({ childNodes: [sub] });
							const nested = out.splice(before).filter((l) => l !== "");
							out.push(...nested.map((l) => `  ${l}`));
						}
					}
				}
				out.push("");
				continue;
			}
			if (name === "table") {
				tableToMarkdown(child, out);
				continue;
			}
			if (name === "pre") {
				const code = (child.childNodes ?? []).map(inlineText).join("");
				out.push("```", code, "```", "");
				continue;
			}
			if (name === "hr") {
				out.push("---", "");
				continue;
			}
			if (BLOCK_TAGS.has(name) || ["dl", "dt", "dd", "address", "fieldset", "legend", "form", "menu"].includes(name)) {
				walk(child);
				continue;
			}
			// inline/unknown element: emit inline text
			const text = inlineText(child).trim();
			if (text) out.push(text, "");
		}
	};

	walk(document);
	return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
