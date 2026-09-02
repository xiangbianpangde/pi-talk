# Explanation Layer — `explain.ir/v1`

**Status: implemented (Phase 1+2, plus the Phase 3 event hook).** An ExplanationPlan is
validated fail-closed by `validate.ts`, compiled to the governed `report` design system
by `render.ts`, and published through the existing `renderTalk({styleId:"report"})`
pipeline (parse5 audit, hash-CSP, `talk_verify`, export).

The layer answers *how a human should come to understand something*. It never decides
*how it is painted*: there is no `explain` style pack, no second runtime, no second
audit. Strategy (ELI5 / Feynman / Socratic) is producer policy — how the author fills
the IR — not IR semantics.

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

The schema is **closed** (v1, Sol review): unknown keys on plan/layer/check/choice
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

Not a 5-state claims table. Two cheap, model-survivable requirements:

1. `limitations[]` is mandatory and rendered as a red "这套解释在哪里失效" note.
2. `analogyBreakage` is mandatory on analogy layers and rendered as a visible
   "类比在哪里失效" note — a footnote would be skippable; a note block is not.

## Quiz / learner state boundary (Phase 3)

Choice buttons are plain report `.actions` controls using the existing bridge:
`data-talk-event="explain-check"` + `data-talk-value="checkId::choiceId"`. The page
never sends `correct`, and `answerId` is never serialized into the DOM; correctness and
remediation are decided by the agent from the IR it holds.

Rules that keep Phase 3 from forcing an IR break:

- learner results live in a separate `explain.state/v1` object, never written back into
  a plan; key it by `talkSessionId + surfaceId + layerId/checkId` **plus a
  plan/check content digest** — a full re-render may keep `check.id` while changing
  question/choices/answer, and the digest is what prevents stale answers attaching to
  new semantics (`choice.id` lifecycle is part of the same contract);
- only stable `layer.id` / `check.id` are reserved now;
- after an answer, re-render the full plan (patching a governed report bypasses its
  audit);
- explicitly not reserved: mastery scores, learner profiles, spaced repetition, course
  graphs.

## Usage

`talk_explain({ planJson, title?, open?, verify? })` — the tool validates, compiles and
renders in one call and returns the IR validation plus the report audit in `details`.
Report audit/CSP/export are inherited and blocking; **visual verification is opt-in**
(`verify: true`, or a separate `talk_verify` call) — a screenshot failure does not flip
the render's top-level `ok`. Hand-rolled `talk_render({styleId:"report"})` for the same
content is possible but unvalidated; use it only for debugging.

## 砍掉的东西 (and why)

Cut from the earlier v0.1 draft because nothing consumed them: `strategy`, `goal`,
`audience.background/unknowns/constraints`, per-layer `depth`, `collapsedByDefault`,
`terms[]` + `jargon-undefined` lint (unreliable for zh), `AnalogySpec.mapping[]`
(authors pay, readers skip), the whole `VisualPlan` (arch/canvas own their own IRs —
render companions next to the explanation instead), `claims[].status` (invites
copy-paste evidence), `meta`/provenance (session-layer concern). `unsafe-content`
validation was dropped on purpose: explanations legitimately discuss `<script>` and
`onclick=`, and the compiler escapes rather than rejects.

## Tests

`extension/lib/talk/tests/entry.ts` section 13: 9 tests — validation gates, JSON
failure mode, markdown-lite, governed-audit pass, hostile-text escaping, end-to-end
render, and the quiz event contract. Run from the installed tree:
`node lib/talk/tests/run-tests.mjs` (the repo copy lacks the sibling parse5 path).
