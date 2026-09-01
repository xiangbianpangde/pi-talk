# /talk — multimodal interaction engine for Pi

> `/talk` opens a side surface for conversation that is **not limited to markdown**.
> Styles are evolutionary: start simple, add packs over time without rewriting the core.

## Overview

/talk is a Pi agent extension that provides rich multimodal interaction — HTML documents, interactive UIs, architecture diagrams, whiteboard canvases, formal journal-style reports, and more — all rendered in a side surface alongside the main chat transcript.

### Core features

- **Evolutionary style system** — 12+ styles (report, arch, draw, compare, evalgrid, hub, inspect, paper, canvas, showcase, html-interactive, html-static) plus a component library
- **Multi-surface sessions** — render to named surfaces, each with its own document + version history
- **Incremental patches** — SSE-based subtree updates without reload
- **Bidirectional events** — `window.talkSend`, `data-talk-event` clicks, `data-talk-form` form serialization, `data-talk-input` debounced input
- **Persistence** — every session is saved (meta, versions, events, chat, screenshots, exports); resume later with `/talk resume`
- **Visual self-check** — `talk_verify` screenshots + console error checks before every render delivery
- **Export pipeline** — html snapshot, GFM markdown, full-page png, print pdf
- **Formal report design system** — `report` style with journal-grade layout, KPI/card/evidence table/timeline/verdict components, content audit, CSP, Mermaid support
- **Explanation Layer** — `talk_explain` validates an ExplanationPlan (`explain.ir/v1`: shallow→deep layers, mandatory analogy-breakage + limitations, optional understanding checks) and renders it as a governed report; ELI5/Feynman/Socratic are strategies over one IR, not new styles

## Architecture

```
~/.pi/agent/
├── extensions/
│   ├── talk.ts              # Main extension entry point
│   └── lib/talk/            # Core engine (server, session, registry, verify, export, audit…)
│       └── explain/         # Explanation Layer: explain.ir/v1 types + fail-closed validator + report compiler
├── skills/talk/
│   └── SKILL.md             # Agent skill: when & how to use /talk
└── talk/
    ├── components/           # Shared component library (tokens.css)
    ├── styles/               # Style packs
    │   ├── report/           # Formal report design system (default)
    │   ├── arch/             # Architecture diagram engine (Archify)
    │   ├── canvas/           # Obsidian canvas interop
    │   ├── hub/              # Multi-demo prototype shell
    │   ├── showcase/         # Searchable card gallery
    │   ├── evalgrid/         # Case × model evaluation grid
    │   ├── compare/          # Side-by-side version comparison
    │   ├── paper/            # Long-form paper annotation
    │   ├── inspect/          # Screenshot/design hot-spot review
    │   ├── diagram-cards/    # Quick diagram card layout
    │   ├── html-interactive/ # Interactive HTML (JS bridge)
    │   └── html-static/      # Static HTML
    └── sessions/             # Persisted sessions (git-ignored)
```

## Getting started

/talk is installed as part of the Pi agent. In a Pi session:

### User commands

| Command | Action |
|---------|--------|
| `/talk` | Start a new session |
| `/talk report …` | Start with a style + first message |
| `/talk styles` | List all available styles |
| `/talk style <id>` | Switch style mid-session |
| `/talk open` | Open browser surface |
| `/talk surfaces` | List surfaces |
| `/talk history` | List persisted sessions |
| `/talk resume [id]` | Resume a session |
| `/talk export <html\|md\|png\|pdf>` | Export current surface |
| `/talk stop` | Stop (session persists) |
| `/talk test` | Run regression suite |

### Agent tools

| Tool | Purpose |
|------|---------|
| `talk_list_styles` | Discover styles |
| `talk_set_style` | Switch style |
| `talk_render` | Render to active surface |
| `talk_explain` | Validate + render an ExplanationPlan as a governed report (layered explanation) |
| `talk_poll_events` | Read user interaction events |
| `talk_verify` | Visual self-check |
| `talk_export` | Export surface |

## Style system

Every style pack lives under `~/.pi/agent/talk/styles/<id>/` with:

```json
{
  "id": "my-style",
  "name": "My Style",
  "description": "What it is for",
  "kind": "html-js",          // chat | html | html-js | draw | command
  "entry": "index.html",
  "capabilities": ["html", "js", "browser", "events"],
  "version": 1
}
```

Styles can declare `dependencies: ["components"]` for shared tokens, or `governance: "report"` to reuse the report audit pipeline.

## Report design system

The `report` style is the only formal-report shell for /talk. It provides:

- Warm paper palette + left sidebar / compact mobile nav
- Serif display hierarchy (`.hero`, `.sec-head h2`)
- KPI/card/evidence table/timeline/verdict components
- Canonicalization + fragment/assembled safety audit
- Hash-based CSP + Mermaid 11.16.1 (SRI-pinned)
- Keyboard tabs, responsive, print styles

## Tests

```bash
# Run /talk regression suite
/talk test

# Or directly:
node extension/lib/talk/tests/run-tests.mjs

# Run report design-system tests
node styles/report/tests/report-design-system.test.mjs
```

## License

MIT