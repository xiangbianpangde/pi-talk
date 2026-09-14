/**
 * Explanation Layer — compiler: `explain.ir/v1` → dedicated `explain` design system.
 *
 * Compiles a pedagogical ExplanationPlan into the `explain` visual vocabulary:
 * .explain-hero / .layer-block / .analogy-card / .breakage-note / .check-card /
 * .limits-block / .takeaway-block.
 *
 * 100% directly visible: strictly NO <details> folding, no accordion click-friction.
 * Published through `renderTalk({ styleId: "explain" })`.
 *
 * Safety rule: every IR string is HTML-escaped *first*, then wrapped in trusted
 * markup. Explaining `<script>` or `onclick=` therefore renders as literal text
 * instead of being rejected or executed.
 *
 * Quiz answers are deliberately absent from the DOM: `answerId` never reaches
 * the page, and choice buttons emit only `explain-check` + `checkId::choiceId`.
 * Judgement happens agent-side, where learner state belongs.
 */

import {
	EXPLAIN_AUDIENCE_LABEL,
	EXPLAIN_KIND_LABEL,
	type ExplanationPlan,
	type UnderstandingCheck,
} from "./types";

export interface CompiledExplanation {
	html: string;
	meta: Record<string, string>;
	sections: number;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** Inline subset on already-escaped text: `code` and **bold** only. */
function inlineMarkdown(escaped: string): string {
	const codeSpans: string[] = [];
	const masked = escaped.replace(/`([^`\n]+)`/g, (_m, code: string) => {
		codeSpans.push(`<code>${code}</code>`);
		return `\u0000${codeSpans.length - 1}\u0000`;
	});
	const bolded = masked.replace(/\*\*([^*\n]+)\*\*/g, (_m, strong: string) => `<strong>${strong}</strong>`);
	return bolded.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => codeSpans[Number(index)] ?? "");
}

/**
 * Markdown-lite: paragraphs, `- `/`* ` bullets, `1. ` lists, ``` fences.
 * No raw HTML passthrough, ever.
 */
export function renderMarkdownLite(source: string): string {
	const lines = source.replace(/\r\n?/g, "\n").split("\n");
	const out: string[] = [];
	let paragraph: string[] = [];
	let items: string[] = [];
	let listType: "ul" | "ol" | null = null;
	let fence: string[] | null = null;

	const flushParagraph = (): void => {
		if (!paragraph.length) return;
		out.push(`<p>${inlineMarkdown(escapeHtml(paragraph.join(" ")))}</p>`);
		paragraph = [];
	};
	const flushList = (): void => {
		if (listType && items.length) {
			out.push(
				`<${listType}>${items
					.map((item) => `<li>${inlineMarkdown(escapeHtml(item))}</li>`)
					.join("")}</${listType}>`,
			);
		}
		items = [];
		listType = null;
	};

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("```")) {
			if (fence) {
				out.push(`<pre class="code-block"><code>${fence.map((l) => escapeHtml(l)).join("\n")}</code></pre>`);
				fence = null;
			} else {
				flushParagraph();
				flushList();
				fence = [];
			}
			continue;
		}
		if (fence) {
			fence.push(line);
			continue;
		}
		if (!trimmed) {
			flushParagraph();
			flushList();
			continue;
		}
		const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
		const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
		if (bullet || numbered) {
			flushParagraph();
			const wanted = bullet ? "ul" : "ol";
			if (listType && listType !== wanted) flushList();
			if (!listType) listType = wanted;
			items.push((bullet?.[1] ?? numbered?.[1] ?? "").trim());
			continue;
		}
		flushList();
		paragraph.push(trimmed);
	}
	if (fence) {
		out.push(`<pre class="code-block"><code>${fence.map((l) => escapeHtml(l)).join("\n")}</code></pre>`);
	}
	flushList();
	flushParagraph();
	return out.join("");
}

export function plainText(markdown: string): string {
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	const proseLines: string[] = [];
	let inFence = false;
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("```")) {
			inFence = !inFence;
			continue;
		}
		if (inFence || !trimmed) continue;
		if (/^#{1,6}\s+/.test(trimmed)) continue;
		const stripped = trimmed
			.replace(/^[-*]\s+/, "")
			.replace(/^\d+[.)]\s+/, "")
			.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
			.replace(/`([^`\n]+)`/g, "$1")
			.replace(/\*\*([^*\n]+)\*\*/g, "$1")
			.trim();
		if (stripped) proseLines.push(stripped);
	}
	return proseLines.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * First sentence of the core layer, used as the hero lead thesis and takeaway.
 */
export function thesisOf(core: string): string {
	const flat = plainText(core);
	const sentence = flat.split(/(?<=[。！？])|(?<=[.?!])\s+/)[0] ?? flat;
	return sentence.length > 140 ? `${sentence.slice(0, 139)}…` : sentence;
}

/** Compile a validated plan into an explain design-system fragment. */
export function compileExplanation(plan: ExplanationPlan): CompiledExplanation {
	const parts: string[] = [];
	const core = plan.layers.find((layer) => layer.kind === "core") ?? plan.layers[0];
	const thesis = thesisOf(core.content);

	// Positional checks: render check card immediately after its target layer
	const checksByLayer = new Map<string, UnderstandingCheck[]>();
	for (const check of plan.checks ?? []) {
		const list = checksByLayer.get(check.afterLayerId) ?? [];
		list.push(check);
		checksByLayer.set(check.afterLayerId, list);
	}

	const renderCheckCards = (layerId: string): string => {
		const checks = checksByLayer.get(layerId);
		if (!checks?.length) return "";
		return checks
			.map((check) => {
				const buttons = check.choices
					.map(
						(choice) =>
							`<button type="button" class="choice-btn" data-talk-event="explain-check" data-talk-value="${escapeHtml(
								`${check.id}::${choice.id}`,
							)}">${escapeHtml(choice.label)}</button>`,
					)
					.join("");
				return [
					`<div class="check-card">`,
					`<div class="check-prompt">${escapeHtml(check.question)}</div>`,
					`<div class="check-sub">选一个选项进行理解验证；答案由 Agent 侧即时判断</div>`,
					`<div class="choices-grid">${buttons}</div>`,
					`</div>`,
				].join("");
			})
			.join("");
	};

	parts.push(
		`<section class="explain-hero" id="hero">`,
		`<div class="tag-row">`,
		`<span class="pill primary">${escapeHtml(EXPLAIN_AUDIENCE_LABEL[plan.audience])}</span>`,
		`<span class="pill brand">${plan.layers.length} 个解构层级</span>`,
		`<span class="pill neutral">${plan.limitations.length} 条认知边界</span>`,
		`</div>`,
		`<h1>${escapeHtml(plan.topic)}</h1>`,
		`<p class="lead">${inlineMarkdown(escapeHtml(thesis))}</p>`,
		`<div class="meta-row"><span>由浅入深 · 概念精解</span><span>•</span><span>全面平铺无折叠</span></div>`,
		`</section>`,
	);

	plan.layers.forEach((layer, index) => {
		const body = renderMarkdownLite(layer.content);
		parts.push(
			`<section id="layer-${escapeHtml(layer.id)}" class="layer-block">`,
			`<div class="layer-tag">${String(index + 1).padStart(2, "0")} · ${escapeHtml(EXPLAIN_KIND_LABEL[layer.kind])}</div>`,
			`<h2>${escapeHtml(layer.title)}</h2>`,
		);

		if (layer.kind === "analogy") {
			parts.push(
				`<div class="analogy-card">`,
				`<div class="analogy-text">${body}</div>`,
				layer.analogyBreakage
					? `<div class="breakage-note"><b>类比在哪里失效：</b>${inlineMarkdown(escapeHtml(layer.analogyBreakage))}</div>`
					: "",
				`</div>`,
			);
		} else {
			parts.push(`<div class="layer-body">${body}</div>`);
		}

		const checkMarkup = renderCheckCards(layer.id);
		if (checkMarkup) parts.push(checkMarkup);
		parts.push(`</section>`);
	});

	parts.push(
		`<section id="limitations" class="limits-block">`,
		`<h3>这套解释在哪里失效（认知边界）</h3>`,
		`<ul>${plan.limitations
			.map((item) => `<li>${inlineMarkdown(escapeHtml(item))}</li>`)
			.join("")}</ul>`,
		`</section>`,
	);

	parts.push(
		`<section class="takeaway-block">`,
		`<div class="takeaway-lbl">TAKEAWAY · 核心心智</div>`,
		`<h3>${inlineMarkdown(escapeHtml(thesis))}</h3>`,
		`<p>${
			plan.checks?.length
				? "每层下面的理解检查答错了，告诉我哪一层没懂——我会针对性深入解析那一层。"
				: "想再深一层探索机制或代码细节，随时直接向我提问。"
		}</p>`,
		`</section>`,
	);

	return {
		html: parts.join("\n"),
		meta: {
			title: plan.topic,
			subtitle: `${EXPLAIN_AUDIENCE_LABEL[plan.audience]} · ${plan.layers.length} 层精解`,
		},
		sections: plan.layers.length + 1,
	};
}
