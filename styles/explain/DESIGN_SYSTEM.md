# Explain Design System

**Version:** 1.0.0  
**Status:** release candidate  
**Canonical implementation:** `explain.css` + `explain.js` + `shell.html` → `index.html`  
**Governance:** `explain`

## 1. Design intent

The Explain design system is built specifically for **pedagogy and conceptual understanding**: helping humans build accurate mental models of technical concepts, mechanisms, and architectures.

It deliberately differs from the `report` design system:
- **No report chrome**: no heavy sidebar navigation rail, no executive KPI tallies, no bureaucratic verdict blocks.
- **Distraction-free reading width**: centered single-column layout (66–72 characters, ~740px) with generous typography and breathing room.
- **Direct visibility without friction**: **100% directly visible content; strictly zero `<details>` accordion folding**. Short and long explanations are read continuously from top to bottom.
- **Cognitive structure**: clear hook, causality mechanism, analogy with breakage warning, code walkthrough, cognitive boundaries, and inline understanding checks.

## 2. Component vocabulary

| Component | Selector / Structure | Purpose |
|---|---|---|
| Explainer Hero | `.explain-hero > .tag-row + h1 + p.lead + .meta-row` | Topic title and intuitive core thesis |
| Layer Block | `.layer-block > .layer-tag + h2 + .layer-body` | Directly visible conceptual layer |
| Analogy Card | `.analogy-card > .analogy-text + .breakage-note` | Real-world metaphor with visible limitation warning |
| Breakage Note | `.breakage-note > b + text` | Explicitly states where the analogy stops holding |
| Code Block | `pre.code-block > code` | Syntax-highlighted configuration or code snippet |
| Limits Block | `.limits-block > h3 + ul > li` | Cognitive boundaries where the explanation breaks down |
| Check Card | `.check-card > .check-prompt + .choices-grid > button.choice-btn` | Inline interactive understanding check |
| Takeaway Block | `.takeaway-block > .takeaway-lbl + h3 + p` | One-sentence mental model anchor to remember |

## 3. Trust, safety and CSP boundary

Explain accepts clean, canonical HTML fragments produced by `compileExplanation` or authors. Before rendering, `auditExplainContent` enforces:
- Prohibited elements: active content (`script`, `style`, `iframe`, `object`, `embed`, `form`), shell elements.
- Prohibited attributes: inline `on*` handlers, unquoted/malformed attributes.
- **Strictly prohibited**: `<details>` elements and `style` attributes. All styling must use design-system classes.
- Safe URLs only: `javascript:`, `vbscript:`, and `file:` schemes are blocked. Links with `target="_blank"` require `rel="noopener"`.
- CSP: Hash-based CSP covers all trusted inline scripts in `shell.html` (`explain-runtime`), the Talk event bridge, and disallows unsafe inline scripts and object embedding.
