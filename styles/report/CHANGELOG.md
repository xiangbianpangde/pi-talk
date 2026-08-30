# Changelog

## 3.1.0 — 2026-08-15

- Replaced regex-only acceptance with the standard HTML5 parse5 tokenizer/tree builder, canonical serialization, element/attribute/URL allowlists, comment rejection and shell-identity isolation.
- Added component value/placement schemas, visible required-structure contracts and a full assembled-document audit for cross-slot IDs/headings and trusted shell assets.
- Rebuilt bridge detection/body placement on parsed DOM locations and inject the bridge into the trusted shell before slot interpolation.
- Added report-only hash/nonce CSP in both the HTTP response and offline snapshot (including nonce-bound Mermaid SVG styles), a content root boundary and escaped shell identity text.
- Upgraded Mermaid from vulnerable 10.9.1 to 11.16.1 with SHA-384 SRI, post-load bounded fetching, strict mode and always-readable source fallback.
- Made print output expand every tab pane and closed disclosure so evidence is never omitted from PDF.
- Fixed multi-tab-set isolation, malformed hash navigation, sticky-header anchor offset and simulator `aria-current` state.
- Added keyboard-focusable named table regions, focus-visible tooltips, contiguous heading levels and a tablet sticky-navigation breakpoint.
- Added HTML5 differential/mXSS, component-boundary, cross-slot assembly, offline CSP, bridge-collision, version-synchronization and print-evidence regression coverage.

## 3.0.0 — 2026-08-15

- Promoted the reference-derived report shell into a documented design system.
- Added deterministic `shell.html + report.css + report.js → index.html` build.
- Scoped shell selectors and fixed the `.brand` collision that made decision cards inherit sidebar flex layout.
- Added content rhythm, semantic utilities, accessible buttons, mobile navigation, reduced-motion and print modes.
- Added keyboard/ARIA tabs, safer auto-nav DOM construction, richer counters/progress semantics and Mermaid readable fallback.
- Switched Mermaid initialization to strict mode while preserving the pinned visual theme.
- Added browser self-audit via `window.ReportDesignSystem.audit()`.
- Added a production fixture, release quality gates and agent cookbook.
- Added a report-fragment safety/structure audit in the `/talk` renderer.
- Unified formal reporting on `report`; raw HTML choice/demo packs remain explicit advanced styles.

## 2 — 2026-08-01

- Made `report` the default `/talk` style and added template metadata plus auto-navigation.

## 1 — initial extraction

- Extracted the academic journal visual shell and components from an existing merged report.
