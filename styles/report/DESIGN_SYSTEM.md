# Talk Report Design System

**Version:** 3.2.0
**Status:** release candidate  
**Canonical implementation:** `report.css` + `report.js` + `shell.html` → `index.html`

## 1. Design intent

The system is extracted from the user's reference report:

`智渔粮库 · AI 智能体联合研发方案整合报告.html`

It preserves the reference report's recognizable visual grammar:

- warm paper background rather than app-dashboard gray;
- deep crimson for decisions and identity;
- blue-gray for structure and information;
- serif display typography with sans-serif body copy and mono metadata;
- fixed contents rail, dense evidence tables, KPI cards, timelines and a decisive closing verdict;
- restrained motion and compact, journal-like information density.

The goal is not to clone one page. It is to make that page's grammar repeatable across scientific research reports, lab evaluations, project proposals, milestones, weekly updates and acceptance summaries.

## 2. Non-negotiable principles

1. **Conclusion first.** The first viewport must answer: what happened, why it matters, and what decision/action follows.
2. **Visual mind-model first for comprehensive reports.** Comprehensive formal reports (such as acceptance, proposal, review, progress, or scientific research) must anchor human comprehension with an executive visualization (Mermaid flowchart, architecture subgraph, or process chain) directly after the executive overview. Single-concept pedagogical drill-downs (talk_explain / explain.ir/v1) focus on layered pedagogical disclosure and are exempt from the global closed-loop diagram requirement.
3. **No naked jargon accumulation.** Technical identifiers, class names, and algorithms must never be dumped as comma-separated lists. Every mechanism must state its concrete action and real-world value ("动词 + 用户/业务价值"). Numbers must tie to real physical or business entities, not empty test counts.
4. **Scientific research rigor.** Research reporting must adhere to empirical rigor: clear scientific hypothesis, controlled baseline comparisons, ablation contribution, honest negative failure boundaries, and sample size disclosure.
5. **One semantic component per job.** A card is context; a note is a caveat; a hypothesis is a testable claim; a boundary box is an honest limitation; a verdict is the final decision.
6. **Color reinforces meaning but never carries it alone.** Always pair color with text or status labels.
7. **Formal reports use `styleId: report`.** `html-interactive` is an explicit prototype mode, not an alternate reporting shell.
8. **No one-off visual forks.** New patterns enter `report.css`, this specification, the fixture and tests together.
9. **Readable failure.** Optional Mermaid failure must preserve source; reduced motion, narrow screens and print must retain all information. No hiding concepts in unstyled all-text `<details>` folds.

## 3. Architecture and source of truth

```text
report/
├── manifest.json                     # pack identity + capabilities
├── shell.html                        # semantic shell and template variables
├── report.css                        # tokens, components, utilities, media rules
├── report.js                         # nav, tabs, counters, progress, audit, fallback
├── build.mjs                         # deterministic compiler
├── index.html                        # GENERATED runtime template
├── fixtures/
│   ├── production-report.content.html
│   └── production-report.html        # GENERATED standalone visual fixture
├── COOKBOOK.md                       # agent authoring quick reference
├── DESIGN_SYSTEM.md                  # this contract
├── QUALITY.md                        # release gates
└── RESEARCH.md                       # reuse/adapt decision record
```

Never hand-edit `index.html` or `fixtures/production-report.html`. Run `node build.mjs`, then `node build.mjs --check`.

## 4. Design tokens

### Color roles

| Token | Reference role | Usage |
|---|---|---|
| `--bg`, `--bg-soft` | paper / paper inset | page and quiet grouping |
| `--panel`, `--panel-2` | white / warm white | cards, tables, details |
| `--txt`, `--txt-dim`, `--txt-faint` | text hierarchy | title, body, metadata |
| `--brand`, `--brand-2` | deep crimson | identity, decisions, final verdict |
| `--accent`, `--accent-2` | blue-gray | navigation, information, structure |
| `--gold` | ochre | data emphasis and watch items |
| `--good`, `--warn`, `--bad` | outcome states | verified, attention, critical |
| `--line`, `--line-soft` | rules | containment without heavy chrome |

### Typography

| Token | Role |
|---|---|
| `--serif` | hero, section titles, verdict headings, KPI values |
| `--sans` | body, labels, cards and tables |
| `--mono` | metadata, tags, identifiers, status and code |

### Geometry

Spacing uses `--space-1` through `--space-8` (4–56 px). Radius uses `--radius-sm`, `--radius`, `--radius-lg`. Layout uses `--sidebar-w` and `--content-max`. Do not introduce arbitrary spacing when a token or utility exists.

## 5. Required report anatomy

A formal report should normally contain:

1. `.hero` with exactly one `h1`, one-sentence `.sub`, status pills and metadata;
2. two to six `section[id].sec-head` blocks with `data-nav-title`;
3. a conclusion/evidence sequence using semantic components;
4. one `.verdict` near the end with a clear decision and next action.

Recommended information order:

```text
Executive summary → KPI/status → evidence → comparison or risks → timeline/next steps → verdict
```

## 6. Component contracts

| Component | Required anatomy | Use for |
|---|---|---|
| Hero | `.hero > h1 + .sub` | report title and executive thesis |
| Section | `section[id].sec-head[data-nav-title]` | navigable chapters |
| KPI | `.kpi > .num + .lbl` (`.sub` optional) | a small set of decision-relevant metrics tied to real entities |
| Card | `.card > h3 + content` | context or grouped reasoning |
| Hypothesis | `.hypothesis` (direct children: `.hypo-tag`, `h3\|h4`, `.hypo-body > .hypo-row`) | scientific hypotheses with premise, prediction, and mechanism |
| Formula wrap | `.formula-wrap` (direct children: `.formula-math`, `.formula-vars > .var-item`) | mathematical objectives with variable semantics table |
| Evidence table | `.tbl-wrap > table` with caption and scoped headers | problem-to-mechanism mappings and traceable comparisons |
| Ablation matrix | `.tbl-wrap > table.ablation-table` | controlled group comparisons and component ablation deltas |
| Boundary box | `.boundary-box` (direct children: `.boundary-head`, `.grid > .boundary-item`) | honest negative results, failure conditions, and limitations |
| Discovery card | `.card.discovery` (direct children: `.disc-badge`, `h3\|h4`, `p`, `.vs-compact > .v-col`) | empirical insights and counter-intuitive observations |
| Sample badge | `.sample-pill.(field\|sim\|stat\|warn)` | sample scale (N=...), environment, and statistical significance |
| Note | `.note.(info\|warn\|crit\|good)` | caveat or bounded callout |
| Compare | `.vs > .vs-col.old + .vs-mid + .vs-col.new` | before/after dilemma vs upgrade contrast |
| Timeline | `.tl > .tl-item` | milestones and evolution of architectural decisions |
| Horizontal chain | `.h-tl > .ev + .arrow` | concise operational pipelines or closed loops |
| Tabs | `.tabs > .tb[data-tab]` + sibling `.tab-pane[data-pane]` | alternate views of evidence to prevent information overload |
| Progress | `.anim-bar` with custom property `--w` | bounded progress only |
| Details | `details.conv` | optional depth for secondary appendices; hand-authored report text must not hide primary concept explanations in unformatted details folds |
| Verdict | `.verdict > .lbl + h3 + p` | final decision, boundary and next action |
| Actions | `.actions > button[data-talk-event]` | lightweight feedback to the agent |

Modifiers: `.hl`, `.brand`, `.gold`, `.good`, `.crit`, `.discovery`; grid: `.grid.g2` through `.g6`; status: `.b-pill.ok|mid|no|inf|br`.

## 7. Content patterns by report type

| Intent | Recommended composition |
|---|---|
| Scientific research / lab report | Hero → Problem & Hypothesis (`.hypothesis`, `.formula-wrap`) → Visual closed loop (Mermaid) → Controlled evaluation & Ablation matrix (`.ablation-table`, `.sample-pill`) → Negative boundaries (`.boundary-box`) → Key discoveries (`.card.discovery`) → Research roadmap verdict |
| Stage acceptance / delivery | Hero → Problem context & delivered experience → Visual interaction loop (Mermaid) → Problem-to-mechanism mapping table (`.tbl-wrap`, `.tabs`) → Negative boundaries & residual gaps (`.vs`, `.boundary-box`) → Acceptance verdict *(raw CI test counts relegated to appendix)* |
| Proposal / architecture review | Hero → Real-world dilemmas vs upgrade goals (`.vs`) → Global closed-loop flowchart (Mermaid) → Subsystem deep-dives (`.tabs` + `.tbl-wrap`) → Architecture evolution timeline (`.tl`) → Phased implementation roadmap (`.h-tl`) → Decision request verdict |
| Progress & milestone update | Hero → Delivered behavioral capabilities (NOT file counts) → Milestone flowchart/burn-down → Technical trade-offs & blockers (`.card.gold`, `.note.warn`) → Next-phase plan verdict |
| Concept explanation (in report text) | Hero/section → Plain intuition summary → Accompanying visual diagram (.mermaid-wrap / ASCII) → What it IS vs what it is NOT (.vs / .vs-compact) → Concrete real-world example (.code-block) → Takeaway (structured cards; NO unformatted details text-folds) |
| Concept explanation (talk_explain) | Handled by talk_explain targeting the dedicated explain design system (styles/explain/): single-column editorial flow, 100% directly visible .layer-block sections (strictly zero details folding), .analogy-card with .breakage-note, .limits-block, and inline .check-card controls |

## 8. Anti-patterns to reject

1. **Empty test scorecards**: Filling reports with "73/73 pass", "0 errors", and a table of unit test names. A test report must explain the test suite's design strategy, what hypothesis it guards, and what empirical boundaries were discovered.
2. **Promotional phase progress**: Celebrating "100% pass", "24 files edited", and buzzwords without explaining what system behavior changed or what trade-offs were made.
3. **All-text `<details>` folds in report bodies**: Hiding a wall of unformatted text inside an ad-hoc `<details>` fold to explain a core concept in report bodies. Use structured cards (`.card`) with mini-diagrams, before/after contrast, and concrete code examples instead. (Dedicated concept explanations are handled by `talk_explain` and `styles/explain/` with 100% direct visibility and zero details folding).
4. **Naked jargon lists**: Writing sentences that merely string together technical identifiers without action or user value.

## 9. Accessibility contract

- One `h1`; headings do not skip levels without reason.
- Every `section` used in navigation has a stable unique `id`.
- Tables use `caption` and `th scope="col|row"` where applicable; `.tbl-wrap` becomes a named, keyboard-focusable scroll region.
- Images have meaningful `alt` or `alt=""` when decorative.
- Buttons have visible text or `aria-label`.
- Tabs are keyboard-operable (arrows, Home, End, Enter/Space) and receive ARIA relationships automatically.
- Focus must remain visible; do not suppress outlines.
- Reduced-motion preference disables animations; print hides navigation/actions while expanding every tab pane and closed `details` block so evidence is not lost.

## 10. Trust and safety boundary

`report` accepts a conservative document fragment, not arbitrary application HTML. Before publication, the standard HTML5 `parse5` tokenizer/tree builder, canonical parse→serialize→reparse pass and allowlists enforce all of the following:

- only the documented text, table, card, disclosure, image and button elements are accepted; comments/bogus-comment syntax are prohibited;
- shell elements/IDs/classes cannot be closed, duplicated or impersonated; only canonical HTML5 serialization is interpolated;
- active content, inline `on*` handlers, unsafe URL schemes and parser-confusing markup are rejected;
- IDs are stable ASCII and unique; a second full-document audit catches cross-slot IDs/headings and verifies the trusted shell/scripts/CSP;
- hero/h1, non-hero navigable section and final verdict anatomy/order/visibility are blocking contracts;
- component `data-*` values and placements are schema-bound (counter duration/decimals are finite and clamped; tabs match one-to-one);
- inline layout is rejected; the sole style exception is a bounded `--w:0%…100%` token on `.anim-bar`.

The renderer places accepted content inside `#report-content-root`. The Talk bridge is located against the trusted shell with the HTML5 parser before slot interpolation. A report-specific CSP then permits only hash-authorized scripts and canonical stylesheet plus a per-render nonce for Mermaid's generated SVG style, disables script attributes, objects, forms, frames and workers, and limits connections to the local Talk origin. The same policy is embedded as a CSP `<meta>` in `latest-report.html`, so offline snapshots retain the boundary. Use `data-talk-event`, `data-talk-value`, `data-sim-mode` and design-system classes instead. If a task genuinely requires arbitrary JavaScript, explicitly switch to `html-interactive`; do not weaken the report gate.

Mermaid is optional, pinned to 11.16.1, protected by SRI + hash-based CSP and initialized in strict mode. It begins only after `window.load`, cannot delay core `data-report-ready`, and has a bounded 12-second load window; source is visible throughout and remains with a status message on failure.

## 11. Runtime self-audit

The page exposes:

```js
window.ReportDesignSystem.version
window.ReportDesignSystem.audit(document)
```

Audit returns `{ errors, warnings, stats }` and checks duplicate IDs, heading/hero structure, KPI anatomy, accessible images/buttons/table regions and inline-style drift. A successful render must have zero errors and should have zero warnings; warnings require review, not blind suppression.
