# Functional research record

Format: `source :: verdict :: notes`

npm pi-package search :: no-match :: no package provides a reusable `/talk` formal-report design system matching the supplied HTML
GitHub repository search :: no-match :: earendil-works related results contain no matching report-style implementation
GitHub code search :: no-match :: no public TypeScript `talk_render` report-pack implementation was found
local Pi skills :: adapt :: the existing talk skill already routes formal reports to `styleId=report`
local Pi extensions :: adapt :: `~/.pi/agent/extensions/talk.ts` already implements evolutionary style packs and report as default
local report pack :: adapt :: the visual shell and components were copied from the reference academic HTML but lacked production governance and QA
Pi extension docs/examples :: reuse :: documented `registerTool` prompt guidance, reload lifecycle and `node:test` patterns fit this integration
`parse5@8.0.0` :: reuse :: standards-based HTML5 tokenizer/tree builder + serializer closes browser/auditor differential and supports parsed bridge placement
`@mrclrchtr/supi-insights` :: no-match :: historical session reporting is a different capability and visual contract
supplied 智渔粮库 HTML :: reuse :: canonical visual reference for tokens, typography, shell and component grammar
existing report fixture/session HTML :: adapt :: useful compatibility baseline, but old content relies on inline styles and has no formal audit gate

## Decision

**Path:** adapt existing `report` pack.  
**Target:** style pack + a minimal extension guidance/audit integration, not a new duplicate plugin.  
**Reason:** the evolutionary `/talk` architecture already provides discovery, default selection, rendering, reload and event transport; the missing layer is a governed design system and release validation.

## Risks considered

- visual regression from refactoring selector scope;
- existing fragments using unsafe inline handlers;
- optional Mermaid network dependency;
- style/template source drift;
- mobile navigation and wide evidence tables;
- `/reload` lifecycle and duplicate registration;
- generic HTML modes being mistaken for alternate formal-report shells.

Mitigations are defined in `QUALITY.md` and exercised by the fixture, static tests, integration tests and browser QA.
