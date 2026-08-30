# Talk Report Design System

**Version:** 3.1.0  
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

The goal is not to clone one page. It is to make that page's grammar repeatable across project reports, reviews, milestones, weekly updates and acceptance summaries.

## 2. Non-negotiable principles

1. **Conclusion first.** The first viewport must answer: what happened, why it matters, and what decision/action follows.
2. **Evidence after assertion.** Use KPI, table, timeline or source blocks for claims that matter.
3. **One semantic component per job.** A card is context; a note is a caveat; a verdict is the final decision.
4. **Color reinforces meaning but never carries it alone.** Always pair color with text or status labels.
5. **Formal reports use `styleId: report`.** `html-interactive` is an explicit prototype mode, not an alternate reporting shell.
6. **No one-off visual forks.** New patterns enter `report.css`, this specification, the fixture and tests together.
7. **Readable failure.** Optional Mermaid failure must preserve source; reduced motion, narrow screens and print must retain all information.

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
| KPI | `.kpi > .num + .lbl` (`.sub` optional) | a small set of decision-relevant metrics |
| Card | `.card > h3 + content` | context or grouped reasoning |
| Evidence table | `.tbl-wrap > table` with caption and scoped headers | traceable comparisons and acceptance data |
| Note | `.note.(info|warn|crit|good)` | caveat or bounded callout |
| Compare | `.vs > .vs-col.old + .vs-mid + .vs-col.new` | before/after or option contrast |
| Timeline | `.tl > .tl-item` | milestones and evolution |
| Tabs | `.tabs > .tb[data-tab]` + sibling `.tab-pane[data-pane]` | alternate views of the same evidence |
| Progress | `.anim-bar` with custom property `--w` | bounded progress only |
| Details | `details.hook` or `details.conv` | optional depth |
| Verdict | `.verdict > .lbl + h3 + p` | final decision, boundary and next action |
| Actions | `.actions > button[data-talk-event]` | lightweight feedback to the agent |

Modifiers: `.hl`, `.brand`, `.gold`, `.good`, `.crit`; grid: `.grid.g2` through `.g6`; status: `.b-pill.ok|mid|no|inf|br`.

## 7. Content patterns by report type

| Intent | Recommended composition |
|---|---|
| Completion / acceptance | Hero → acceptance KPIs → test evidence table → residual risks → verdict |
| Weekly / phase update | Hero → progress KPIs → done/blocked cards → timeline → next-week verdict |
| Proposal / review | Hero → problem evidence → option comparison → architecture/plan → decision request |
| Research summary | Hero → question/method → evidence table → findings cards → limitations note → conclusion |
| Incident / audit | Hero → severity KPIs → timeline → root-cause table → remediation → acceptance verdict |

## 8. Accessibility contract

- One `h1`; headings do not skip levels without reason.
- Every `section` used in navigation has a stable unique `id`.
- Tables use `caption` and `th scope="col|row"` where applicable; `.tbl-wrap` becomes a named, keyboard-focusable scroll region.
- Images have meaningful `alt` or `alt=""` when decorative.
- Buttons have visible text or `aria-label`.
- Tabs are keyboard-operable (arrows, Home, End, Enter/Space) and receive ARIA relationships automatically.
- Focus must remain visible; do not suppress outlines.
- Reduced-motion preference disables animations; print hides navigation/actions while expanding every tab pane and closed `details` block so evidence is not lost.

## 9. Trust and safety boundary

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

## 10. Runtime self-audit

The page exposes:

```js
window.ReportDesignSystem.version
window.ReportDesignSystem.audit(document)
```

Audit returns `{ errors, warnings, stats }` and checks duplicate IDs, heading/hero structure, KPI anatomy, accessible images/buttons/table regions and inline-style drift. A successful render must have zero errors and should have zero warnings; warnings require review, not blind suppression.
