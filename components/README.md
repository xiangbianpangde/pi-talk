# /talk components (shared component library)

Neutral, dependency-free component classes for any `html`/`html-js` style pack.

## Enable

Add to the style's `manifest.json`:

```json
{ "id": "my-style", "kind": "html-js", "entry": "index.html", "dependencies": ["components"] }
```

The engine injects `<link rel="stylesheet" href="/api/components/tokens.css">`
into the rendered document automatically. `report` does not use this pack — it
has its own design system (see styles/report/COOKBOOK.md).

## Components

Wrap content in `.tk-page` (max-width shell). Available classes:

| Intent | Classes |
|---|---|
| KPI strip | `.tk-kpi-row` > `.tk-kpi` (.num / .lbl / .sub) |
| Cards | `.tk-grid.g2|g3` > `.tk-card` (`.hl` accent edge) |
| Status | `.tk-pill` + `.ok|mid|no|inf` |
| Table | `.tk-table-wrap` > table (semantic th) |
| Callout | `.tk-note` + `.info|warn|crit|good` |
| Timeline | `.tk-tl` > `.tk-tl-item` (.t / .d) |
| Section label | `.tk-tag` |
| Buttons | `.tk-actions` > `.tk-btn` (.primary) |
| Verdict | `.tk-verdict` (.lbl + h3 + p) |

## Interaction contract

- Buttons with `data-talk-event` + `data-talk-value` reach the agent via `talk_poll_events`.
- Forms with `data-talk-form` serialize values on submit; `data-talk-input` sends debounced input events.
- Never use inline `onclick` (lint flags it).

## Design tokens

Custom properties under `:root` (auto light/dark): `--tk-bg`, `--tk-surface`,
`--tk-border`, `--tk-fg`, `--tk-muted`, `--tk-accent`, `--tk-ok/mid/no/info`,
`--tk-radius`, `--tk-shadow`. Override per page by re-declaring on a wrapper.
