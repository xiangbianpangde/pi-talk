/**
 * Explanation Layer — Explanation IR v1 (types).
 *
 * The IR answers *how a human should come to understand something*. It never
 * answers *how it is painted*: compilation targets the governed `report` design
 * system (`render.ts` → `renderTalk({styleId:"report"})`), so audit, hash-CSP,
 * verify and export stay in one place.
 *
 * Deliberately absent (see explain/README.md "砍掉的东西"):
 *   strategy, goal, audience background/unknowns, depth, collapsedByDefault,
 *   terms[], AnalogySpec.mapping[], VisualPlan, claims[], meta/provenance.
 * None of them had a consumer in the compiler.
 */

export const EXPLAIN_IR_SCHEMA = "explain.ir/v1" as const;

export type ExplainAudience = "beginner" | "intermediate" | "expert";

/** `analogy` is the only kind that carries an extra mandatory field. */
export type ExplainLayerKind = "core" | "mechanism" | "example" | "code" | "analogy";

export interface ExplanationLayer {
	/** Stable ASCII id — becomes `#layer-<id>` and the join key for learner state. */
	id: string;
	kind: ExplainLayerKind;
	title: string;
	/** Plain text / markdown-lite. Escaped by the compiler; never treated as HTML. */
	content: string;
	/** Required iff kind === "analogy": where the analogy stops holding. */
	analogyBreakage?: string;
}
export interface ExplainChoice {
	id: string;
	label: string;
}

/**
 * Understanding check. `afterLayerId` is POSITIONAL: the compiler renders the
 * check card immediately after its target layer (v1 fix, Sol review) — it is
 * not an annotation. The client reports only *what was chosen*
 * (`explain-check` → `checkId::choiceId`); correctness is judged agent-side so
 * the page never declares the learner right on its own behalf.
 */
export interface UnderstandingCheck {
	id: string;
	afterLayerId: string;
	question: string;
	choices: ExplainChoice[];
	answerId: string;
}

export interface ExplanationPlan {
	schema: typeof EXPLAIN_IR_SCHEMA;
	topic: string;
	audience: ExplainAudience;
	/** Ordered shallow → deep. layers[0] must be the single one-sentence core (enforced). */
	layers: ExplanationLayer[];
	/** Where this simplification stops being true. 1–3, never optional. */
	limitations: string[];
	checks?: UnderstandingCheck[];
}

export const EXPLAIN_AUDIENCES: readonly ExplainAudience[] = ["beginner", "intermediate", "expert"];
export const EXPLAIN_LAYER_KINDS: readonly ExplainLayerKind[] = [
	"core",
	"mechanism",
	"example",
	"code",
	"analogy",
];

export const EXPLAIN_LIMITS = {
	topicMax: 120,
	layerMin: 1,
	layerMax: 6,
	/** Stable-id max length; ids are validated exactly as authored (v1). */
	idMax: 64,
	layerTitleMax: 60,
	layerContentMax: 1200,
	/** Compiler warns above this: an ELI5 layer that needs scrolling is not ELI5. */
	layerContentDense: 900,
	breakageMax: 300,
	limitationMin: 1,
	limitationMax: 3,
	limitationItemMax: 200,
	checkMax: 2,
	questionMax: 200,
	choiceMin: 2,
	choiceMax: 4,
	choiceLabelMax: 120,
} as const;

/** Human labels for the compiled page (zh-first, this surface is Chinese). */
export const EXPLAIN_KIND_LABEL: Record<ExplainLayerKind, string> = {
	core: "一句话核心",
	mechanism: "机制",
	example: "例子",
	code: "代码",
	analogy: "类比",
};

export const EXPLAIN_AUDIENCE_LABEL: Record<ExplainAudience, string> = {
	beginner: "零基础",
	intermediate: "有基础",
	expert: "专家",
};
