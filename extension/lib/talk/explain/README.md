# Explanation Layer — `explain.ir/v1`

**Status: implemented (Phase 1+2).** An ExplanationPlan is
validated fail-closed by `validate.ts`, compiled to the dedicated `explain` design system
(`styles/explain/`) by `render.ts`, and published through `renderTalk({ styleId: "explain" })`.

The layer answers *how a human should come to understand something*. It compiles into the
dedicated `explain` design system: single-column editorial layout (68ch), 100% directly visible,
strictly zero `<details>` accordion folding, with explicit analogy breakage notes and inline understanding checks.

## Contract

```ts
{
  schema: "explain.ir/v1",
  topic: string,                    // 1..120
  audience: "beginner" | "intermediate" | "expert",
  layers: [{                        // 1..6, ordered shallow → deep
    id: string,                     // ^[A-Za-z][A-Za-z0-9_.-]*$, ≤64, EXACT match (no repair, no ":")
    kind: "core" | "mechanism" | "example" | "code" | "analogy",
    title: string,                  // 1..60
    content: string,                // 1..1200, markdown-lite, escaped never parsed as HTML
    analogyBreakage?: string,       // REQUIRED iff kind === "analogy" (≤300)
  }],                               // exactly one kind:"core", and it must be layers[0]
  limitations: string[],            // 1..3 × ≤200 — hard-fail outside the bound, never truncated
  checks?: [{                       // 0..2; rendered immediately after afterLayerId's section
    id: string, afterLayerId: string, question: string,
    choices: [{ id, label }],       // 2..4
    answerId: string,               // judged agent-side; never rendered into the DOM
  }],
}
```

The schema is **closed**: unknown keys on plan/layer/check/choice
are errors, so cut fields stay cut loudly. Ids reject `:` because the quiz wire
format concatenates `checkId::choiceId` — that split must stay unambiguous.
References (`afterLayerId`, `answerId`) must match authored tokens exactly.

Hard gates (render nothing): schema mismatch, unknown fields, missing/empty fields,
bounds, enums, duplicate/unstable/repaired ids, missing `limitations` or >3, analogy
layer without `analogyBreakage`, check referencing an unknown layer or an unknown
answer, zero/multiple `core` layers, core not first.

Warnings (render anyway): dense layer (>900 chars), >4 layers, duplicate titles,
beginner plan without analogy or without a check, hollow `analogyBreakage`
boilerplate ("不完全准确" with nothing concrete).

## Anti-wrong-simplification mechanism

1. `limitations[]` is mandatory and rendered as a visible "这套解释在哪里失效" limits block.
2. `analogyBreakage` is mandatory on analogy layers and rendered as a visible
   "类比在哪里失效" breakage note — preventing oversimplified mental models.

## Quiz / learner state boundary

Choice buttons are `.choice-btn` controls in `.check-card` using the existing bridge:
`data-talk-event="explain-check"` + `data-talk-value="checkId::choiceId"`. The page
never sends `correct`, and `answerId` is never serialized into the DOM; correctness and
remediation are decided by the agent from the IR it holds.

Rules that keep learner state clean:
- learner results live in a separate `explain.state/v1` object, never written back into a plan;
- correctness is verified agent-side, maintaining a clear separation between content and learner state.
