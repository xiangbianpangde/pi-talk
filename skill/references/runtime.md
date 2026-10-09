# Runtime capabilities

Read this reference when implementing or debugging /talk sessions, persistence, patches, event delivery, export, or pack loading. The formal-report completion and user-type gate is in `../SKILL.md`.

- **Persistence**: every session lives at `~/.pi/agent/talk/sessions/<id>/` (`meta.json`, `versions/`, `events.jsonl`, `chat.md`, `shots/`, `exports/`). `/talk stop` keeps it; `/talk resume` restores document(s), surfaces and events.
- **Multi-surface**: render to named surfaces (`surface: "alt"` in talk_render); each keeps its own document + version history; served at `/s/<id>`. The surface active at stop time is restored on resume.
- **Incremental patches**: `patch: {selector, html, method: inner|outer|append|prepend|remove}` updates only a subtree via SSE — no reload, scroll/focus preserved. Compound selectors (`#id`, `.class`, `tag`, 组合) 会在服务端同步应用到存档并生成新版本快照(reload/resume/export 都能看到);复杂选择器(伪类/属性/组合器)只广播给活页面并带 warning,刷新即失。
- **Bidirectional events (bridge v2)**: `window.talkSend` + `data-talk-event` clicks + `data-talk-form` form serialization + `data-talk-input` debounced input events; every event carries its `surface`. resume 恢复历史事件但不重复落盘,游标停在最后一条,不会向 agent 重放。
- **Visual self-check**: `talk_verify` (or `verify: true` on talk_render) screenshots the surface headlessly (python playwright probe → chrome fallback) and reports console/page errors; then describe the screenshot to see the real render. Never ship a blind render.
- **Export pipeline**: `/talk export` / `talk_export` — html snapshot, GFM markdown (report fragments convert cleanly), full-page png, print-pdf (report print CSS respected).
- **Shared components**: styles declaring `dependencies: ["components"]` get `~/.pi/agent/talk/components/tokens.css` injected (`tk-*` classes + tokens; see components/README.md).
- **Style lifecycle**: manifest validation (`validateManifest`) + light structure/security lint for non-report html styles (advisory, in render details); `/talk test` runs the engine suite + report design-system suite.
