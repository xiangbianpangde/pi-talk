/**
 * Explanation Layer — deterministic validator for `explain.ir/v1`.
 *
 * This is the only thing that makes the IR more than a JSON convention: an
 * invalid plan fails closed and nothing renders. Rules are structural and
 * cheap to check; nothing here tries to judge prose quality, and nothing here
 * rejects strings for *looking* like markup — layer text is escaped by the
 * compiler, so explaining `<script>` or `onclick=` stays legal.
 */

import {
	EXPLAIN_AUDIENCES,
	EXPLAIN_IR_SCHEMA,
	EXPLAIN_LAYER_KINDS,
	EXPLAIN_LIMITS,
	type ExplanationLayer,
	type ExplanationPlan,
	type UnderstandingCheck,
} from "./types";

export interface ExplainIssue {
	severity: "error" | "warning";
	code: string;
	message: string;
	path?: string;
}

export interface ExplainValidation {
	schema: typeof EXPLAIN_IR_SCHEMA;
	valid: boolean;
	errors: ExplainIssue[];
	warnings: ExplainIssue[];
	/** Normalized plan (trimmed strings); null when the input could not be understood. */
	plan: ExplanationPlan | null;
	stats: { layers: number; limitations: number; checks: number; contentChars: number };
}

/** Same token grammar the report auditor accepts for element ids. */
const ID_RE = /^[A-Za-z][A-Za-z0-9_.:-]*$/;

/**
 * Boilerplate that lets a model satisfy "analogyBreakage" without thinking.
 * Flagged, not rejected: the field still renders, the audit just says it is hollow.
 */
const HOLLOW_BREAKAGE = [
	"不完全准确",
	"并不完全等同",
	"不完全一样",
	"只是比喻",
	"只是类比",
	"不精确",
	"有差异",
	"not exact",
	"not perfect",
	"just an analogy",
	"imprecise",
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimmed(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const out = value.trim();
	return out.length ? out : null;
}

function normalizeId(raw: string): string {
	return raw
		.toLowerCase()
		.replace(/[^a-z0-9_.:-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/^(\d)/, "l$1");
}

function layerKindLabel(kind: string): string {
	return kind;
}

/** Validate an unknown value (already parsed JSON) as an ExplanationPlan. */
export function validateExplanationPlan(input: unknown): ExplainValidation {
	const errors: ExplainIssue[] = [];
	const warnings: ExplainIssue[] = [];
	const push = (
		severity: ExplainIssue["severity"],
		code: string,
		message: string,
		path?: string,
	): void => {
		const key = `${severity}:${code}:${message}`;
		const bucket = severity === "error" ? errors : warnings;
		if (!bucket.some((issue) => `${issue.severity}:${issue.code}:${issue.message}` === key)) {
			bucket.push({ severity, code, message, path });
		}
	};

	const fail = (code: string, message: string, path?: string): ExplainValidation => {
		push("error", code, message, path);
		return {
			schema: EXPLAIN_IR_SCHEMA,
			valid: false,
			errors,
			warnings,
			plan: null,
			stats: { layers: 0, limitations: 0, checks: 0, contentChars: 0 },
		};
	};

	if (!isRecord(input)) return fail("bad-input", "ExplanationPlan must be a JSON object.");
	if (input.schema !== EXPLAIN_IR_SCHEMA) {
		return fail(
			"bad-schema",
			`schema must be "${EXPLAIN_IR_SCHEMA}" (got ${JSON.stringify(input.schema ?? null)}).`,
			"schema",
		);
	}

	const topic = trimmed(input.topic);
	if (!topic) return fail("missing-field", "topic is required and must be a non-empty string.", "topic");
	if (topic.length > EXPLAIN_LIMITS.topicMax) {
		return fail(
			"topic-too-long",
			`topic is ${topic.length} chars; keep it under ${EXPLAIN_LIMITS.topicMax} (detail belongs in layers).`,
			"topic",
		);
	}

	const audience = input.audience;
	if (typeof audience !== "string" || !(EXPLAIN_AUDIENCES as readonly string[]).includes(audience)) {
		return fail(
			"audience-enum",
			`audience must be one of ${EXPLAIN_AUDIENCES.join(" | ")}.`,
			"audience",
		);
	}

	if (!Array.isArray(input.layers)) {
		return fail("missing-field", "layers must be an array of 1–6 explanation layers.", "layers");
	}
	if (input.layers.length < EXPLAIN_LIMITS.layerMin || input.layers.length > EXPLAIN_LIMITS.layerMax) {
		return fail(
			"layers-count",
			`layers must number ${EXPLAIN_LIMITS.layerMin}–${EXPLAIN_LIMITS.layerMax} (got ${input.layers.length}).`,
			"layers",
		);
	}

	const layers: ExplanationLayer[] = [];
	const layerIds = new Set<string>();
	let contentChars = 0;

	for (let index = 0; index < input.layers.length; index += 1) {
		const raw = input.layers[index];
		const path = `layers[${index}]`;
		if (!isRecord(raw)) {
			push("error", "layer-shape", `${path} must be an object.`, path);
			continue;
		}
		const rawId = trimmed(raw.id) ?? "";
		const id = normalizeId(rawId);
		if (!id || !ID_RE.test(id)) {
			push(
				"error",
				"layer-id",
				`${path}.id is required and must be a stable ASCII token like "cache-hit" (matches ${ID_RE}).`,
				`${path}.id`,
			);
		} else if (layerIds.has(id)) {
			push("error", "duplicate-layer-id", `${path}.id "${id}" repeats an earlier layer id.`, `${path}.id`);
		} else {
			layerIds.add(id);
		}

		const kind = typeof raw.kind === "string" ? raw.kind : "";
		if (!(EXPLAIN_LAYER_KINDS as readonly string[]).includes(kind)) {
			push(
				"error",
				"layer-kind",
				`${path}.kind must be one of ${EXPLAIN_LAYER_KINDS.join(" | ")} (got ${layerKindLabel(kind || "«empty»")}).`,
				`${path}.kind`,
			);
		}

		const title = trimmed(raw.title);
		if (!title) {
			push("error", "layer-title", `${path}.title is required.`, `${path}.title`);
		} else if (title.length > EXPLAIN_LIMITS.layerTitleMax) {
			push(
				"error",
				"layer-title",
				`${path}.title is ${title.length} chars; max ${EXPLAIN_LIMITS.layerTitleMax}.`,
				`${path}.title`,
			);
		}

		const content = typeof raw.content === "string" ? raw.content.trim() : null;
		if (content === null) {
			push("error", "layer-content", `${path}.content must be a string.`, `${path}.content`);
		} else if (content.length === 0) {
			push("error", "layer-content", `${path}.content is empty.`, `${path}.content`);
		} else if (content.length > EXPLAIN_LIMITS.layerContentMax) {
			push(
				"error",
				"layer-content",
				`${path}.content is ${content.length} chars; max ${EXPLAIN_LIMITS.layerContentMax}. Split it into another layer.`,
				`${path}.content`,
			);
		} else {
			contentChars += content.length;
			if (content.length > EXPLAIN_LIMITS.layerContentDense) {
				push(
					"warning",
					"content-dense",
					`${path}.content is ${content.length} chars — a layer this long stops being an explanation.`,
					`${path}.content`,
				);
			}
		}

		const breakage = trimmed(raw.analogyBreakage);
		if (kind === "analogy") {
			if (!breakage) {
				push(
					"error",
					"analogy-breakage-required",
					`${path} is an analogy layer, so analogyBreakage is mandatory: name where the analogy stops holding.`,
					`${path}.analogyBreakage`,
				);
			} else if (breakage.length > EXPLAIN_LIMITS.breakageMax) {
				push(
					"error",
					"analogy-breakage-required",
					`${path}.analogyBreakage is ${breakage.length} chars; max ${EXPLAIN_LIMITS.breakageMax}.`,
					`${path}.analogyBreakage`,
				);
			} else if (
				breakage.length <= 12 &&
				HOLLOW_BREAKAGE.some((phrase) => breakage.toLowerCase().includes(phrase))
			) {
				push(
					"warning",
					"analogy-breakage-vague",
					`${path}.analogyBreakage says only "${breakage}" — name the concrete dimension where it fails.`,
					`${path}.analogyBreakage`,
				);
			}
		} else if (breakage) {
			push(
				"warning",
				"analogy-breakage-unused",
				`${path}.analogyBreakage is ignored on a "${kind}" layer; move it to limitations[].`,
				`${path}.analogyBreakage`,
			);
		}

		if (title && content !== null) {
			layers.push({
				id,
				kind: (EXPLAIN_LAYER_KINDS as readonly string[]).includes(kind)
					? (kind as ExplanationLayer["kind"])
					: "mechanism",
				title,
				content,
				...(breakage ? { analogyBreakage: breakage } : {}),
			});
		}
	}

	if (layers.length !== input.layers.length) {
		// A layer was dropped by an error above; never render a partial explanation.
		return fail("layer-shape", "One or more layers are invalid; nothing was rendered.", "layers");
	}

	const titles = new Map<string, number>();
	for (const layer of layers) {
		const key = layer.title.toLowerCase();
		titles.set(key, (titles.get(key) ?? 0) + 1);
	}
	for (const [title, count] of titles) {
		if (count > 1) push("warning", "duplicate-title", `"${title}" is used by ${count} layers.`, "layers");
	}
	if (layers[0] && layers[0].kind !== "core") {
		push(
			"warning",
			"core-not-first",
			`layers[0].kind is "${layers[0].kind}"; the first layer should be the one-sentence core.`,
			"layers",
		);
	}
	if (audience === "beginner" && !layers.some((layer) => layer.kind === "analogy")) {
		push("warning", "no-analogy", "audience is beginner but no layer uses kind=\"analogy\".", "layers");
	}

	if (!Array.isArray(input.limitations)) {
		return fail(
			"limitations-required",
			"limitations is mandatory: name where this explanation stops being true (1–3 items).",
			"limitations",
		);
	}
	const limitations: string[] = [];
	for (let index = 0; index < input.limitations.length; index += 1) {
		const item = trimmed(input.limitations[index]);
		const path = `limitations[${index}]`;
		if (!item) {
			push("error", "limitation-empty", `${path} is empty.`, path);
			continue;
		}
		if (item.length > EXPLAIN_LIMITS.limitationItemMax) {
			push(
				"error",
				"limitation-length",
				`${path} is ${item.length} chars; max ${EXPLAIN_LIMITS.limitationItemMax}.`,
				path,
			);
			continue;
		}
		limitations.push(item);
	}
	if (limitations.length < EXPLAIN_LIMITS.limitationMin) {
		return fail("limitations-count", "limitations needs at least one concrete item.", "limitations");
	}
	if (limitations.length > EXPLAIN_LIMITS.limitationMax) {
		push(
			"warning",
			"limitations-count",
			`${limitations.length} limitations; only the first ${EXPLAIN_LIMITS.limitationMax} are kept.`,
			"limitations",
		);
	}

	const checks: UnderstandingCheck[] = [];
	if (input.checks !== undefined && input.checks !== null) {
		if (!Array.isArray(input.checks)) {
			push("error", "checks-shape", "checks must be an array when present.", "checks");
		} else {
			if (input.checks.length > EXPLAIN_LIMITS.checkMax) {
				push(
					"error",
					"checks-count",
					`checks supports at most ${EXPLAIN_LIMITS.checkMax} (got ${input.checks.length}).`,
					"checks",
				);
			}
			const checkIds = new Set<string>();
			for (let index = 0; index < Math.min(input.checks.length, EXPLAIN_LIMITS.checkMax); index += 1) {
				const raw = input.checks[index];
				const path = `checks[${index}]`;
				if (!isRecord(raw)) {
					push("error", "checks-shape", `${path} must be an object.`, path);
					continue;
				}
				const id = normalizeId(trimmed(raw.id) ?? "");
				if (!id || !ID_RE.test(id)) {
					push("error", "check-id", `${path}.id must be a stable ASCII token.`, `${path}.id`);
					continue;
				}
				if (checkIds.has(id) || layerIds.has(id)) {
					push("error", "duplicate-check-id", `${path}.id "${id}" is already used.`, `${path}.id`);
					continue;
				}
				checkIds.add(id);

				const question = trimmed(raw.question);
				if (!question || question.length > EXPLAIN_LIMITS.questionMax) {
					push("error", "check-question", `${path}.question must be 1–${EXPLAIN_LIMITS.questionMax} chars.`, `${path}.question`);
					continue;
				}
				const afterLayerId = normalizeId(trimmed(raw.afterLayerId) ?? "");
				if (!layerIds.has(afterLayerId)) {
					push(
						"error",
						"check-target-unknown",
						`${path}.afterLayerId "${afterLayerId}" does not match any layer id.`,
						`${path}.afterLayerId`,
					);
					continue;
				}
				if (!Array.isArray(raw.choices)) {
					push("error", "check-choices", `${path}.choices must be an array.`, `${path}.choices`);
					continue;
				}
				if (
					raw.choices.length < EXPLAIN_LIMITS.choiceMin ||
					raw.choices.length > EXPLAIN_LIMITS.choiceMax
				) {
					push(
						"error",
						"check-choices",
						`${path}.choices must number ${EXPLAIN_LIMITS.choiceMin}–${EXPLAIN_LIMITS.choiceMax}.`,
						`${path}.choices`,
					);
					continue;
				}
				const choices: { id: string; label: string }[] = [];
				const choiceIds = new Set<string>();
				let choicesOk = true;
				for (let c = 0; c < raw.choices.length; c += 1) {
					const choice = raw.choices[c];
					const cpath = `${path}.choices[${c}]`;
					if (!isRecord(choice)) {
						push("error", "check-choices", `${cpath} must be an object.`, cpath);
						choicesOk = false;
						break;
					}
					const cid = normalizeId(trimmed(choice.id) ?? "");
					const label = trimmed(choice.label);
					if (!cid || !ID_RE.test(cid) || choiceIds.has(cid)) {
						push("error", "choice-id", `${cpath}.id must be a unique stable token.`, `${cpath}.id`);
						choicesOk = false;
						break;
					}
					if (!label || label.length > EXPLAIN_LIMITS.choiceLabelMax) {
						push(
							"error",
							"choice-label",
							`${cpath}.label must be 1–${EXPLAIN_LIMITS.choiceLabelMax} chars.`,
							`${cpath}.label`,
						);
						choicesOk = false;
						break;
					}
					choiceIds.add(cid);
					choices.push({ id: cid, label });
				}
				if (!choicesOk) continue;
				const answerId = normalizeId(trimmed(raw.answerId) ?? "");
				if (!choiceIds.has(answerId)) {
					push(
						"error",
						"check-answer-unknown",
						`${path}.answerId "${answerId}" is not one of the choice ids.`,
						`${path}.answerId`,
					);
					continue;
				}
				checks.push({ id, afterLayerId, question, choices, answerId });
			}
		}
	}

	if (checks.length === 0 && audience === "beginner") {
		push("warning", "no-check", "beginner-level explanation with no understanding check.", "checks");
	}

	return {
		schema: EXPLAIN_IR_SCHEMA,
		valid: errors.length === 0,
		errors,
		warnings,
		plan:
			errors.length === 0
				? {
						schema: EXPLAIN_IR_SCHEMA,
						topic,
						audience: audience as ExplanationPlan["audience"],
						layers,
						limitations: limitations.slice(0, EXPLAIN_LIMITS.limitationMax),
						...(checks.length ? { checks } : {}),
					}
				: null,
		stats: {
			layers: layers.length,
			limitations: limitations.length,
			checks: checks.length,
			contentChars,
		},
	};
}

/** Parse a JSON string then validate. Never throws. */
export function parseExplanationPlan(json: string): ExplainValidation {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch (error) {
		const result: ExplainValidation = {
			schema: EXPLAIN_IR_SCHEMA,
			valid: false,
			errors: [],
			warnings: [],
			plan: null,
			stats: { layers: 0, limitations: 0, checks: 0, contentChars: 0 },
		};
		result.errors.push({
			severity: "error",
			code: "bad-json",
			message: `planJson is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		});
		return result;
	}
	return validateExplanationPlan(parsed);
}

/** One-line-per-issue rendering for tool output. */
export function formatExplainIssues(issues: ExplainIssue[], max = 12): string {
	return issues
		.slice(0, max)
		.map((issue) => `- [${issue.code}]${issue.path ? ` ${issue.path}` : ""} ${issue.message}`)
		.concat(issues.length > max ? [`- …${issues.length - max} more`] : [])
		.join("\n");
}
