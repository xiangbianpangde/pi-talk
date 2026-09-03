/**
 * Explanation Layer — compiler: `explain.ir/v1` → governed `report` fragment.
 *
 * There is no second visual system here. The plan is compiled into the existing
 * report design-system vocabulary (.hero / section[id].sec-head / .card /
 * .note / details.hook / .actions / .verdict) and published through
 * `renderTalk({ styleId: "report" })`, so it inherits the parse5 audit,
 * hash-CSP, talk_verify and export pipeline.
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
	/** Report meta slots to pass alongside the fragment (escaped text by the engine). */
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

/** Inline subset on already-escaped text: `code` and **bold** only.
 * Code spans are made opaque first (P3, Sol review): markdown inside a code
 * span — e.g. `**x**` — stays literal instead of being bolded. */
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
	flushParagraph();
	flushList();
	return out.join("\n");
}

/**
 * Markdown-lite → plain text WITHOUT destroying technical characters
 * (v1 fix, Sol review: the old regex deleted # _ > globally, turning C# into C,
 * x > y into x y, snake_case into snakecase).
 *
 * Only paired delimiters are unwrapped (`code`, **bold**); fenced blocks are
 * dropped (code is rarely thesis material); line-leading markers are removed
 * and heading lines skipped. Ordinary prose keeps every character.
 */
export function plainText(source: string): string {
	const withoutFences = source
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`([^`]*)`/g, "$1")
		.replace(/\*\*(.+?)\*\*/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/<(https?:\/\/[^>]+)>/g, "$1");
	const proseLines: string[] = [];
	for (const rawLine of withoutFences.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		if (/^#{1,6}\s/.test(line)) continue; // heading line: not thesis material
		proseLines.push(line.replace(/^(?:[-*+]|\d+[.)])\s+/, ""));
	}
	return proseLines.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * First sentence of the core layer, used as the hero thesis and the verdict.
 * Only fullwidth CJK terminators split without trailing whitespace; ASCII
 * .?! require following whitespace so URLs (…search?q=x。), ternaries
 * (ready?next:value) and x!.y survive intact (v1 fix, Sol round-3).
 */
export function thesisOf(core: string): string {
	const flat = plainText(core);
	const sentence = flat.split(/(?<=[。！？])|(?<=[.?!])\s+/)[0] ?? flat;
	return sentence.length > 140 ? `${sentence.slice(0, 139)}…` : sentence;
}

function noteBlock(tone: "warn" | "crit" | "info" | "good", icon: string, innerHtml: string): string {
	return `<div class="note ${tone}"><div class="ico" aria-hidden="true">${icon}</div><div>${innerHtml}</div></div>`;
}

/** Compile a validated plan into a report body fragment. */
export function compileExplanation(plan: ExplanationPlan): CompiledExplanation {
	const parts: string[] = [];
	const core = plan.layers.find((layer) => layer.kind === "core") ?? plan.layers[0];
	const thesis = thesisOf(core.content);
	// v1 fix (Sol review): afterLayerId is positional — each check renders
	// immediately after its target layer, not in a detached section.
	const checksByLayer = new Map<string, UnderstandingCheck[]>();
	for (const check of plan.checks ?? []) {
		const list = checksByLayer.get(check.afterLayerId) ?? [];
		list.push(check);
		checksByLayer.set(check.afterLayerId, list);
	}
	const renderCheckCards = (layerId: string): string => {
		const checks = checksByLayer.get(layerId);
		if (!checks?.length) return "";
		const cards = checks
			.map((check) => {
				const buttons = check.choices
					.map(
						(choice) =>
							`<button type="button" data-talk-event="explain-check" data-talk-value="${escapeHtml(
								`${check.id}::${choice.id}`,
							)}">${escapeHtml(choice.label)}</button>`,
					)
					.join("");
				return [
					`<article class="card hl">`,
					`<h3>${escapeHtml(check.question)}</h3>`,
					`<p class="text-small text-faint">选一个；答案由 agent 侧判断，页面不替你宣布对错。</p>`,
					`<div class="actions">${buttons}</div>`,
					`</article>`,
				].join("");
			})
			.join("");
		return checks.length > 1 ? `<div class="grid g2 mt-1">${cards}</div>` : `<div class="mt-1">${cards}</div>`;
	};

	parts.push(
		`<section id="hero" class="hero" data-nav-title="解释">`,
		`<div class="tag-row">`,
		`<span class="b-pill inf">${escapeHtml(EXPLAIN_AUDIENCE_LABEL[plan.audience])}</span>`,
		`<span class="b-pill br">${plan.layers.length} 层</span>`,
		`<span class="b-pill mid">${plan.limitations.length} 条边界</span>`,
		`</div>`,
		`<h1>${escapeHtml(plan.topic)}</h1>`,
		`<p class="sub">${inlineMarkdown(escapeHtml(thesis))}</p>`,
		`<div class="meta-row"><span>Explanation IR v1</span><span>•</span><span>由浅到深，逐层展开</span></div>`,
		`</section>`,
	);

	plan.layers.forEach((layer, index) => {
		const body = renderMarkdownLite(layer.content);
		const inner: string[] = [];
		if (layer.kind === "analogy" && layer.analogyBreakage) {
			inner.push(
				noteBlock(
					"warn",
					"≠",
					`<b>类比在哪里失效</b>：${inlineMarkdown(escapeHtml(layer.analogyBreakage))}`,
				),
			);
		}
		const disclosure =
			index === 0
				? `<div class="mt-1">${body}${inner.join("")}</div>${renderCheckCards(layer.id)}`
				: `<details class="hook"><summary>展开完整说明</summary><div class="body">${body}${inner.join("")}</div></details>${renderCheckCards(layer.id)}`;
		parts.push(
			`<section id="layer-${escapeHtml(layer.id)}" class="sec-head section-gap" data-nav-title="${escapeHtml(layer.title)}">`,
			`<div class="tag">${String(index + 1).padStart(2, "0")} · ${escapeHtml(EXPLAIN_KIND_LABEL[layer.kind])}</div>`,
			`<h2>${escapeHtml(layer.title)}</h2>`,
			disclosure,
			`</section>`,
		);
	});

	parts.push(
		`<section id="limitations" class="sec-head section-gap" data-nav-title="边界与限制">`,
		`<div class="tag">L · LIMITS</div>`,
		`<h2>这套解释在哪里失效</h2>`,
		noteBlock(
			"crit",
			"!",
			`<ul>${plan.limitations
				.map((item) => `<li>${inlineMarkdown(escapeHtml(item))}</li>`)
				.join("")}</ul>`,
		),
		`</section>`,
	);

	parts.push(
		`<div class="verdict">`,
		`<div class="lbl">记住这一句</div>`,
		`<h3>${inlineMarkdown(escapeHtml(thesis))}</h3>`,
		`<p>${
			plan.checks?.length
				? "每层下面的理解检查答错了，就告诉我哪一层没懂——我会重讲那一层而不是重讲全部。"
				: "想再深一层就点名要哪一层（机制 / 例子 / 代码 / 边界），我会重讲那一层而不是重讲全部。"
		}</p>`,
		`</div>`,
	);

	return {
		html: parts.join("\n"),
		meta: {
			mark: "解",
			brand: plan.topic.slice(0, 24),
			subtitle: `${EXPLAIN_AUDIENCE_LABEL[plan.audience]} · ${plan.layers.length} 层解释`,
			meta: `${plan.layers.length} 层 · ${plan.limitations.length} 条边界${
				plan.checks?.length ? ` · ${plan.checks.length} 个检查` : ""
			}`,
		},
		sections: plan.layers.length + 1,
	};
}
