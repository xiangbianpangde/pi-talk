---
name: talk
description: Multimodal /talk sessions with evolutionary styles and governed HTML or infographic reports. Use for formal 汇报/一张图汇报, interactive HTML, visual explanations and canvas beyond markdown.
metadata:
  version: "1.1.0"
  status: "active"
  layer: "task"
  priority: "40"
  triggers: "talk,multimodal,formal-report"
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

When in doubt → `talk_set_style({ styleId: "report" })`, but **do not generate a formal HTML or image report until all work and acceptance checks are complete**. After completion, call `talk_prepare_report` to ask the user which type they want; if they choose 一张图汇报, ask for 1–5 images and use its one-use permit with `talk_report_images`; otherwise use `talk_render` for HTML. For incomplete work, explain status in plain text. Do not use inline-styled `html-interactive` as a workaround.

## When to use

- User runs `/talk` or asks for interactive HTML / canvas / visual explanation
- Text in the main transcript is awkward (UI mock, branching choices, live diagram)
- You need clickable options, live HTML, or the shared draw whiteboard

## Style selection（必读，避免丑页）

| 用户意图 | styleId | 备注 |
|----------|---------|------|
| **默认 / 说不清 / 正式内容** | **`report`（基础）** | 新会话默认；侧栏+衬线+KPI/卡片/表格 |
| 汇报 / 结项 / 周报 / 阶段说明 / 评审 | **`report`** | 禁止 html-interactive 内联拼页 |
| 一张图汇报 / 信息图汇报 | **`talk_report_images` 工具** | 先 `talk_prepare_report` 选图像模式和 1–5 张；不走 HTML 样式 |
| 架构图 / 时序 / 数据流 / 系统地图 | **`arch`** | Archify JSON |
| 画布共创 | **`draw`** | tldraw |
| 多版本文案/方案并排对比、redline 审阅 | `compare` | content = JSON {versions:[…]} |
| 分层解释（ELI5/机制/代码/类比 + 理解检查） | **`talk_explain` 工具** | 专属 explain 概念精解样式：单栏沉浸、100% 平铺零折叠 |
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
1. 标题/正文出现「汇报」「结项」「阶段结论」「验收」「周报」「评审」「审计」→ 先完成全部任务和验收；若仍有待办、外部阻塞或未验证项，只用文字说明进度，**不输出正式汇报**。完成后调用 `talk_prepare_report({summary,checks,remainingWork:[]})` 询问类型；选“一张图汇报”时继续询问 1–5 张，用许可调用 `talk_report_images`；否则以许可调用 `talk_render({styleId:"report",reportPermit,...})`。每份新汇报须重新询问；不要绕过许可。
2. `report` 是唯一正式 HTML 汇报壳；图像汇报由结构化 SVG→PNG 设计系统生成，必须提供证据来源和局限，不得捏造指标。`html-interactive` 只适合轻交互原型，不能作为另一套汇报格式。
3. `talk_render` 返回 report audit 后，修复全部 error 和 warning（交付目标为 0/0）；不要通过切换到 raw HTML 样式绕过设计系统。
4. 若当前 session 已是错误样式，立刻 `talk_set_style` 切换后 `talk_render` 重渲，不要在错误壳上继续堆内容。
5. 概念解释走 `talk_explain` 直达独立 `explain` 设计系统：用户说「解释一下 / 我没懂 / 用大白话 / 给新人讲」且需要深入概念或因果机制时，构造 `explain.ir/v1` 的 ExplanationPlan（一句话核心 → 机制/例子/代码/类比层 → 1–3 条 limitations → 可选 0–2 个理解检查），一次调用完成校验与渲染。页面 100% 直接平铺可见，绝无 `<details>` 强制折叠；类比层必须给 `analogyBreakage`（类比在哪里失效）；`answerId` 只留在 IR 里，页面不显示正确答案；答错后重渲整页。
6. **综合汇报的可视化心智模型要求**：在撰写综合性正式汇报（如阶段验收、方案立项、周报复盘、科研实验汇报）时，在 Hero 或总览之后必须包含一张 Mermaid 可视化闭环/架构流转图，并配以伴随解释卡片（图文互证），帮助读者建立全局心智模型；单点概念解释（`talk_explain`）定位为渐进分层教学交互面，豁免综合报告的整体闭环流程图要求。
7. **去术语化与严禁空心跑分**：严禁出现无主语的代码/算法名词连缀串（如“实现了 A, B, C”），必须陈述具体动作与价值（“动词 + 业务/用户价值”）；数字必须挂钩真实实体（痛点数、试验点数、实测增益），严禁将纯 CI 单元测试通过率作为正文主干。
8. **科研范式与概念解构边界**：
   - 科研与实验汇报必须遵循五联体：核心假设（`.hypothesis`）、闭环系统（Mermaid）、消融对照（`.ablation-table`）、失效边界（`.boundary-box`）、实证洞见（`.card.discovery`）。
   - **概念解释的场景区分**：
     - ① **正式汇报（Report）正文内的概念说明**：严禁在正文中扔一个无排版全文字 `<details>` 偷懒敷衍，必须采用“一句话定义 + 微图解/代码 + 正反辨析”的结构化解构卡片（参考 COOKBOOK 模板二）。
     - ② **对话中单点概念的渐进式教学**：当用户在会话中直接要求「解释一下 XX / 我没懂 / 给新人讲讲」时，严格使用 `talk_explain` 工具走 `explain.ir/v1` 教学层级（100% 直接平铺可见，绝无 `<details>` 强制折叠，并带内联自测检查）。

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
| `talk_prepare_report` | Only after full completion and passing checks, ask the user for this report's type; returns a one-use permit (cancellation/no UI fails closed) |
| `talk_render` | Render to the active surface; report-governed HTML requires an HTML-mode `reportPermit`; supports `surface`, `patch` and `verify` |
| `talk_report_images` | Generate exactly the user-selected 1–5 editable SVG + 1200×1600 PNG pages under session exports; requires an image-mode permit. Use the project design contract at `extension/lib/talk/report-image/DESIGN_SYSTEM.md` when working in the source checkout |
| `talk_explain` | Validate an ExplanationPlan (`explain.ir/v1`) and render it into the dedicated explain design system: 100% directly visible layered explanation, analogy breakage, limits block and optional inline checks. Fails closed |
| `talk_poll_events` | Read clicks / `talkSend` events / form submissions / debounced input events |
| `talk_verify` | Visual self-check: headless screenshot + console errors + DOM stats of the current surface |
| `talk_export` | Export current surface: html / md / png / pdf |
| `talk_status` | Session url, sessionId, surfaces, versions, pending events |

## Capabilities (engine v2)

For session persistence, patching, event delivery, export, and pack loading internals, read [Runtime capabilities](references/runtime.md).

## Styles

For chat, prototype HTML, draw, arch, and pack authoring details, read [Style usage and pack authoring](references/styles.md).

### report（期刊式正式汇报设计系统）
Extracted from the user's `智渔粮库 · AI 智能体联合研发方案整合报告.html`. It is the single formal-report shell for 周报/结项/评审/验收/审计/方案汇报.

```text
talk_set_style({ styleId: "report" })
// Only after every task/acceptance check passes; ask the user each time.
talk_prepare_report({ summary: "…", checks: ["…"], remainingWork: [] })
talk_render({
  styleId: "report",
  reportPermit: "<id returned in talk_prepare_report details>",
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

## Agent playbook

1. If `/talk` just started, greet briefly. Render in the chosen style only when appropriate; a default `report` session is not permission to publish an unfinished HTML report.
2. Prefer the active style; switch with `talk_set_style` when the medium is wrong.
3. For interactive HTML, always give the user something clickable, then `talk_poll_events`.
4. Do not dump huge HTML into the main chat — render to the surface, summarize in chat.
5. Never put secrets into HTML surfaces (loopback-only server, but still visible in browser).
6. When a capability is missing, prefer **adding a pack** over inventing one-off code.

## Related

- Skill `draw` — canvas primitives
- Package `sideshow` — richer multi-part browser surfaces (optional `command` pack)
