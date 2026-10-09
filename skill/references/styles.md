# Style usage and pack authoring

The entry skill owns report-completion policy and tool routing. This reference covers the independent lifecycle of non-report styles and new style packs. Formal reports always follow the `talk_prepare_report` gate in `../SKILL.md`.

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

可选字段: `governance: "report"` 让该包复用 report 的内容审计+hash-CSP 管线(不再是 report 独占); `command` 包的 command 模板支持 `{{extDir}}`(扩展目录,可移植,不要写死绝对路径)。

For `command` packs, set `"command": "sideshow publish {file} --title {title}"` etc.

Then: `/talk reload-styles` or `/reload`, and the new id appears in `talk_list_styles`.

**Evolution example path:** `html-static` → add JS bridge pack `html-interactive` → specialized pack `diagram-cards` → optional `command` pack wrapping sideshow.
