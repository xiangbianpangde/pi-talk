---
name: talk
description: Multimodal /talk sessions with evolutionary interaction styles (chat, static HTML, interactive HTML+JS, draw canvas, custom packs). Use when the user wants rich interactive conversation beyond markdown.
---

# talk — multimodal interaction styles

`/talk` opens a side surface for conversation that is **not limited to markdown**.
Styles are evolutionary: start simple, add packs over time under
`~/.pi/agent/talk/styles/<id>/` without rewriting the extension core.

## Base / default style

**`report` is the base style** for every new `/talk` session (unless the user
picks another id).

It is the **reference-derived journal report design system**, extracted from the user's `智渔粮库 · AI 智能体联合研发方案整合报告.html`:
- warm paper palette + left sidebar / compact mobile nav
- serif display hierarchy (`.hero` / `.sec-head h2`)
- governed KPI / card / evidence table / timeline / verdict components
- parse5 canonicalization + fragment/assembled safety audit, hash-CSP snapshots, keyboard tabs, responsive/print and readable Mermaid fallback

Cookbook: `~/.pi/agent/talk/styles/report/COOKBOOK.md`  
Contract: `~/.pi/agent/talk/styles/report/DESIGN_SYSTEM.md`

When in doubt → `talk_set_style({ styleId: "report" })` and author content with
report classes, **not** inline-styled `html-interactive` soup.

## When to use

- User runs `/talk` or asks for interactive HTML / canvas / visual explanation
- Text in the main transcript is awkward (UI mock, branching choices, live diagram)
- You need clickable options, live HTML, or the shared draw whiteboard

## Style selection（必读，避免丑页）

| 用户意图 | styleId | 备注 |
|----------|---------|------|
| **默认 / 说不清 / 正式内容** | **`report`（基础）** | 新会话默认；侧栏+衬线+KPI/卡片/表格 |
| 汇报 / 结项 / 周报 / 阶段说明 / 评审 | **`report`** | 禁止 html-interactive 内联拼页 |
| 架构图 / 时序 / 数据流 / 系统地图 | **`arch`** | Archify JSON |
| 画布共创 | **`draw`** | tldraw |
| 多版本文案/方案并排对比、redline 审阅 | `compare` | content = JSON {versions:[…]} |
| 用例 × 模型评测打分、baseline 对照 | `evalgrid` | content = JSON 蓝图 |
| 长文精读批注(抽主张/找反证) | `paper` | content = 原文 HTML |
| 截图/设计稿热区标注反馈 | `inspect` | content = 图片 URL/dataURL |
| 多 demo 交互原型导航壳 | `hub` | 导航模板 + demo 区块 |
| 工具/成果画廊(可搜索卡片) | `showcase` | content = 条目 JSON |
| 自由白板(Obsidian canvas 互通) | `canvas` | content = canvas JSON |
| 点选问卷、临时可点原型 | `html-interactive` | 仅轻交互，不作正式页 |
| 纯文字侧信道 | `chat` | TUI 文本 |

（manifest 可带 `useWhen` 字段;`talk_list_styles` 的输出含「适用」提示,以它为准。）

**硬规则：**
1. 标题/正文出现「汇报」「结项」「阶段结论」「验收」「周报」「评审」「审计」→ 先 `talk_set_style({styleId:"report"})`，再用 report 组件 class（`.hero` `.sec-head` `.kpi` `.card` `.tbl-wrap` `.verdict`…），**不要**用大段 `style="padding:…;border-radius:…"` 内联样式糊页面。
2. `report` 是唯一正式汇报壳（治理能力由 manifest 的 `"governance": "report"` 声明，其它包将来可复用）；`html-interactive` 只适合轻交互原型，不能作为另一套汇报格式。
3. `talk_render` 返回 report audit 后，修复全部 error 和 warning（交付目标为 0/0）；不要通过切换到 raw HTML 样式绕过设计系统。
4. 若当前 session 已是错误样式，立刻 `talk_set_style` 切换后 `talk_render` 重渲，不要在错误壳上继续堆内容。

## Commands (user)

```
/talk                      # picker → start session → kick agent
/talk html-interactive …   # start with a style + first message
/talk styles               # list builtin + pack styles
/talk style <id>           # switch mid-session
/talk open [surface]       # reopen browser surface (optionally a named one)
/talk surfaces             # list surfaces
/talk history              # list persisted sessions
/talk resume [id]          # resume a session (default: latest)
/talk delete <id>          # delete one persisted session
/talk clean [days]         # GC sessions older than N days + stray files (default 30)
/talk export <html|md|png|pdf> [out]  # export current surface
/talk test                 # run the regression suite (engine + report pack)
/talk status | stop
/talk reload-styles        # rescan packs
```

## Tools (agent)

| Tool | Purpose |
|------|---------|
| `talk_list_styles` | Discover styles (set `reload: true` after adding packs) |
| `talk_set_style` | Switch style (`chat`, `html-static`, `html-interactive`, `draw`, packs…) |
| `talk_render` | Render to the active surface; supports `surface` (multi-surface), `patch` (incremental DOM update) and `verify` (auto screenshot+console) |
| `talk_poll_events` | Read clicks / `talkSend` events / form submissions / debounced input events |
| `talk_verify` | Visual self-check: headless screenshot + console errors + DOM stats of the current surface |
| `talk_export` | Export current surface: html / md / png / pdf |
| `talk_status` | Session url, sessionId, surfaces, versions, pending events |

## Capabilities (engine v2)

- **Persistence**: every session lives at `~/.pi/agent/talk/sessions/<id>/` (`meta.json`, `versions/`, `events.jsonl`, `chat.md`, `shots/`, `exports/`). `/talk stop` keeps it; `/talk resume` restores document(s), surfaces and events.
- **Multi-surface**: render to named surfaces (`surface: "alt"` in talk_render); each keeps its own document + version history; served at `/s/<id>`. The surface active at stop time is restored on resume.
- **Incremental patches**: `patch: {selector, html, method: inner|outer|append|prepend|remove}` updates only a subtree via SSE — no reload, scroll/focus preserved. Compound selectors (`#id`, `.class`, `tag`, 组合) 会在服务端同步应用到存档并生成新版本快照(reload/resume/export 都能看到);复杂选择器(伪类/属性/组合器)只广播给活页面并带 warning,刷新即失。
- **Bidirectional events (bridge v2)**: `window.talkSend` + `data-talk-event` clicks + `data-talk-form` form serialization + `data-talk-input` debounced input events; every event carries its `surface`. resume 恢复历史事件但不重复落盘,游标停在最后一条,不会向 agent 重放。
- **Visual self-check**: `talk_verify` (or `verify: true` on talk_render) screenshots the surface headlessly (python playwright probe → chrome fallback) and reports console/page errors; then describe the screenshot to see the real render. Never ship a blind render.
- **Export pipeline**: `/talk export` / `talk_export` — html snapshot, GFM markdown (report fragments convert cleanly), full-page png, print-pdf (report print CSS respected).
- **Shared components**: styles declaring `dependencies: ["components"]` get `~/.pi/agent/talk/components/tokens.css` injected (`tk-*` classes + tokens; see components/README.md).
- **Style lifecycle**: manifest validation (`validateManifest`) + light structure/security lint for non-report html styles (advisory, in render details); `/talk test` runs the engine suite + report design-system suite.

## Builtin styles

### chat
`talk_render({ content: "..." })` appends assistant text to the talk transcript widget/file.

### html-static
Pass an **HTML fragment** or full document. Browser opens at the local talk URL.
No JS event bridge.

### html-interactive (evolved from static)
Same as static, plus:

- Injected `window.talkSend(type, payload)` and `data-talk-event` click delegation
- SSE live reload when you re-render
- After showing choices, call `talk_poll_events` (or ask the user to click, then poll)

Example fragment:

```html
<h2>Pick a layout</h2>
<button data-talk-event="choose" data-talk-value="split">Split pane</button>
<button data-talk-event="choose" data-talk-value="tabs">Tabs</button>
```

### draw
`content` is newline-separated `draw.sh` ops:

```
ensure
rect "API" 120 120
rect "DB" 420 120
arrow API DB
snapshot
```

Uses `~/.pi/agent/skills/draw/draw.sh` and the user's tldraw board.

### arch（架构图 · Archify）
Interactive system maps via local **tt-a1i/archify** (based on Cocoon-AI/architecture-diagram-generator).

```text
talk_set_style({ styleId: "arch" })
talk_render({
  styleId: "arch",
  title: "运行时架构",
  content: "{ ... Archify JSON IR ... }"
})
```

**content 输入（自动识别）：**
1. Archify JSON IR — `diagram_type`: `architecture|workflow|sequence|dataflow|lifecycle`（推荐）
2. 完整 HTML — Cocoon/Archify 产物透传
3. Mermaid — 轻量回退 viewer

**原则：** 8–12 组件、一条主路径、细节进 cards；schema/examples 在 `~/.claude/skills/archify/`。  
**Cookbook：** `~/.pi/agent/talk/styles/arch/COOKBOOK.md`  
用户反馈条：好看 / 简化 / 补关系 → `talk_poll_events`

### report（期刊式正式汇报设计系统）
Extracted from the user's `智渔粮库 · AI 智能体联合研发方案整合报告.html`. It is the single formal-report shell for 周报/结项/评审/验收/审计/方案汇报.

```text
talk_set_style({ styleId: "report" })
talk_render({
  styleId: "report",
  title: "…",
  content: "<!-- hero + sections HTML -->",
  metaJson: "{\"mark\":\"报\",\"brand\":\"项目\",\"subtitle\":\"周报\",\"meta\":\"更新日期\"}"
})
```

- Template vars: `{{title}}` `{{content}}` `{{mark}}` `{{brand}}` `{{subtitle}}` `{{meta}}` `{{nav}}` `{{footer}}`
- If `nav` empty, side nav auto-builds from `section[id]` / `[data-nav]` + `data-nav-title`
- Component cookbook: `~/.pi/agent/talk/styles/report/COOKBOOK.md`
- Design contract: `~/.pi/agent/talk/styles/report/DESIGN_SYSTEM.md`
- Result details include a parser/allowlist + design-system audit; delivery requires zero errors and zero warnings
- Report responses add a hash-based CSP; Mermaid 11.16.1 is SRI-pinned and falls back to readable source
- Prefer this over raw html-interactive whenever the intent is a formal report (KPI / evidence / risks / timeline / verdict)

## Evolutionary strategy (adding styles)

Create a pack:

```text
~/.pi/agent/talk/styles/my-style/
  manifest.json
  index.html          # optional template with {{content}} {{title}} {{styleId}}
```

`manifest.json`:

```json
{
  "id": "my-style",
  "name": "My Style",
  "description": "What it is for",
  "kind": "html-js",
  "entry": "index.html",
  "capabilities": ["html", "js", "custom"],
  "useWhen": "什么时候选我(一句话,进 picker 和系统提示)",
  "version": 1
}
```

Kinds: `chat` | `html` | `html-js` | `draw` | `command`

可选字段:`governance: "report"` 让该包复用 report 的内容审计+hash-CSP 管线(不再是 report 独占);`command` 包的 command 模板支持 `{{extDir}}`(扩展目录,可移植,不要写死绝对路径)。

For `command` packs, set `"command": "sideshow publish {file} --title {title}"` etc.

Then: `/talk reload-styles` or `/reload`, and the new id appears in `talk_list_styles`.

**Evolution example path:** `html-static` → add JS bridge pack `html-interactive` →
specialized pack `diagram-cards` → optional `command` pack wrapping sideshow.

## Agent playbook

1. If `/talk` just started, greet briefly and `talk_render` something useful in the chosen style.
2. Prefer the active style; switch with `talk_set_style` when the medium is wrong.
3. For interactive HTML, always give the user something clickable, then `talk_poll_events`.
4. Do not dump huge HTML into the main chat — render to the surface, summarize in chat.
5. Never put secrets into HTML surfaces (loopback-only server, but still visible in browser).
6. When a capability is missing, prefer **adding a pack** over inventing one-off code.

## Related

- Skill `draw` — canvas primitives
- Package `sideshow` — richer multi-part browser surfaces (optional `command` pack)
