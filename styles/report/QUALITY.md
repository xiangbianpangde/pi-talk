# Report design system · release quality gates

A release is acceptable only when every applicable blocking gate is observed, not inferred.

## Gate A — deterministic build

```bash
cd ~/.pi/agent/talk/styles/report
node build.mjs
node build.mjs --check
```

- `index.html` and `fixtures/production-report.html` must be generated and clean.
- Runtime template must contain no unresolved build markers.
- `index.html` is generated; edits belong in `shell.html`, `report.css`, or `report.js`.

## Gate B — static contract

```bash
node --test ~/.pi/agent/talk/styles/report/tests/report-design-system.test.mjs
npx --yes tsx --test ~/.pi/agent/extensions/__tests__/talk.test.ts
```

Blocking:

- report is the default visible formal style;
- manifest/version/capabilities are correct;
- parse5 is present at the pinned dependency version and unsafe fragments are rejected/canonically serialized;
- reference palette and component classes remain present;
- no unscoped `.brand` shell selector regression;
- contrast checks for normal text roles pass WCAG AA;
- build output is reproducible.

## Gate C — extension lifecycle

```bash
pi --no-session -p -e ~/.pi/agent/extensions/talk.ts "reply only ok"
```

Then in an interactive session:

1. `/reload` — no extension error banner;
2. `/talk reload-styles` — report v3.1 is discovered;
3. render a report;
4. `/reload` again — no duplicate registration error.

## Gate D — browser behavior

Use `fixtures/production-report.html` or a live `talk_render` surface.

Desktop: 1440×1000  
Tablet: 900×1100  
Mobile: 390×844

Blocking checks:

- core page reaches `html[data-report-ready="true"]` independently of the optional Mermaid network request;
- `ReportDesignSystem.audit(document).errors.length === 0`;
- `.card.brand` computes to block/grid flow, never the old sidebar flex rule;
- auto-nav contains every expected section and updates active state;
- tabs switch by click and Arrow/Home/End keys with correct ARIA state;
- counter final values and progress ARIA values are correct;
- no horizontal page overflow at mobile width (tables may scroll inside `.tbl-wrap`);
- no uncaught console error;
- `data-report-mermaid` reaches `rendered|source`; source is visible while loading and failure is never blank;
- print stylesheet hides navigation/actions, expands every tab pane and closed `details`, and preserves their text in the PDF;
- the report response carries a hash/nonce CSP; trusted runtime/bridge, canonical CSS and SRI-pinned Mermaid (including its nonce-bound SVG style) load without CSP violations;
- `latest-report.html` carries the equivalent CSP meta; when served without security headers, an injected inline-script probe remains blocked.

## Gate E — content safety

Blocking report-fragment audit errors include:

- non-allowlisted/active elements, comments/bogus comments, HTML5 parse errors, unstable serialization and shell-closing tags;
- reserved shell identity classes/IDs or duplicate/unstable IDs, including duplicates across body/meta/nav/footer after full assembly;
- inline event handlers, quoted/unquoted/entity-obfuscated `javascript:` and other unsafe URL schemes;
- arbitrary inline style (only bounded `--w` on `.anim-bar` is accepted);
- missing, hidden or behavior-mutated hero/h1, non-hero navigable section, verdict, or malformed KPI/tab anatomy;
- unbounded/misplaced component data such as `data-duration=Infinity`, excessive decimals or tab keys without matching panes.

Run a malicious corpus containing `--!>` bogus-comment mXSS, markers inside comments/attributes, `</body>` inside an attribute, unquoted/entity URLs, shell escapes, hidden required structure, numeric boundary values and cross-slot duplicate IDs/h1. Verify only parse5-canonical output is interpolated and response CSP contains no `script-src 'unsafe-inline'`. This is a report-only gate; arbitrary JS belongs to explicit `html-interactive` mode.

## Gate F — visual review

Compare against the supplied reference's visual DNA rather than pixel identity:

- paper background and warm panels;
- deep crimson identity/decision accents;
- blue-gray navigation/information accents;
- serif display hierarchy and compact evidence typography;
- left navigation on desktop, compact horizontal navigation on mobile;
- consistent 8/12/16/24/40 spacing rhythm;
- final verdict is visually decisive without becoming a marketing banner.

Capture desktop/tablet/mobile screenshots for each release candidate. A screenshot alone is not proof; pair it with DOM, console and interaction checks.

## Known bounded dependency

Mermaid 11.16.1 is loaded after `window.load` from an exact jsDelivr URL with SHA-384 SRI and the same hash in the report CSP. Its 12-second timeout is independent of core readiness; network or integrity failure displays diagram source and does not block report content. Before a release, check the pinned version against current Mermaid advisories; a future fully offline release may vendor the bundle if snapshot size and asset-serving strategy are accepted.
