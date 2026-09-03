# /talk — Multimodal Interaction Engine for Pi

[English](#english) | [简体中文](#简体中文)

---

<a id="english"></a>

## English

> `/talk` opens a persistent side surface for Pi agents that is **not limited to markdown**.  
> Styles are evolutionary: start simple, add packs over time without rewriting the core engine.

### Overview

`/talk` is an extension for the [Pi coding agent](https://github.com/earendil-works/pi-coding-agent) that provides rich multimodal interaction alongside the main transcript — journal-grade formal reports, interactive UIs, Archify architecture diagrams, whiteboard canvases, code diff comparisons, and a cognitive Explanation Layer.

#### Core Philosophy
- **Separation of Presentation and Understanding**: `/talk` handles *how to present*; the Explanation Layer handles *how humans come to understand*. Strategies like ELI5, Feynman, and Socratic are producer policies that compile into a unified Explanation IR (`explain.ir/v1`), rather than ballooning into separate styles.
- **Evolutionary Packs**: Style packs are self-contained folders with a declarative `manifest.json`. Drop a directory into `~/.pi/agent/talk/styles/` and it becomes available immediately without restarting the engine core.
- **Governed Safety**: Strict content auditing via HTML5 `parse5` canonicalization, hash-based CSP, sanitization, and headless visual verification (`talk_verify`).

---

### Key Features

1. **Evolutionary Style System (12+ Styles)**
   - `report` (default): Journal-style formal report design system (paper palette, serif hierarchy, KPI, cards, evidence tables, timeline, verdict).
   - `arch`: Interactive architecture, dataflow, sequence, and system maps via Archify.
   - `compare`: Side-by-side LCS diff comparison with redline review loops and clean document export.
   - `evalgrid`: Case × model benchmark grid with 1–5 scoring and baseline locking.
   - `canvas`: Obsidian-compatible visual canvas interop.
   - `draw`: Shared tldraw collaborative whiteboard.
   - `paper`: Long-form academic document reader with claim extraction.
   - `inspect`: Design mockup and screenshot hot-spot annotation.
   - `hub` & `showcase`: Interactive demo launcher shell and searchable card galleries.
   - `html-interactive` & `html-static`: Full interactive (JS event bridge) and sandboxed static HTML.

2. **Explanation Layer (`talk_explain`)**
   - **Intermediate Representation (`explain.ir/v1`)**: Structured layers ordered shallow → deep (core, mechanism, example, code, analogy).
   - **Fail-Closed Validation**: Strict identity validation (exact authored tokens, no silent trimming/canonicalization, no colons), closed schema (unknown keys rejected), hard bounds on limitations (1–3 items, never truncated).
   - **Anti-Oversimplification Guards**: Mandatory `limitations[]` rendered as callout notes; mandatory `analogyBreakage` on analogy layers (preventing "analogy = identity").
   - **Positional Understanding Checks**: Quiz cards render immediately following their target layer. `answerId` remains agent-side and is never exposed in the DOM; choices emit `explain-check` events over the event bridge.

3. **Multi-Surface Sessions & Incremental Patches**
   - Render to named surfaces (`main`, `diag`, `notes`), each with independent document and version histories.
   - Incremental subtree updates via SSE patches (`method: inner | outer | append | prepend | remove`) without page reloads.

4. **Bidirectional Event Bridge**
   - In-page bridge captures button clicks (`data-talk-event`), form submissions (`data-talk-form`), and debounced input (`data-talk-input`).
   - Delivered directly to agents via `talk_poll_events`.

5. **Visual Self-Check & Export Pipeline**
   - Automated headless Chromium screenshot and console error checks (`talk_verify`).
   - Single-command export to standalone HTML, GFM Markdown, full-page PNG, or print-ready PDF (`talk_export`).

---

### Architecture

```
~/.pi/agent/
├── extensions/
│   ├── talk.ts              # Extension entry point & tool definitions
│   └── lib/talk/            # Engine core
│       ├── explain/         # Explanation Layer: IR types, validator & report compiler
│       ├── registry.ts      # Style pack discovery and manifest validation
│       ├── report-audit.ts  # parse5 safety auditor & CSP generator
│       ├── server.ts        # Loopback HTTP server & SSE event bridge
│       ├── session.ts       # Multi-surface lifecycle, patching & persistence
│       ├── verify.ts        # Headless Chromium self-check probe
│       └── export.ts        # HTML/MD/PNG/PDF export pipeline
├── skills/talk/
│   └── SKILL.md             # Agent skill: style routing & governance guidelines
└── talk/
    ├── components/          # Shared tokens & styles (tokens.css)
    ├── styles/              # 12+ evolutionary style packs
    └── sessions/            # Persisted sessions & event journals (git-ignored)
```

---

### Commands & Tools

#### User Commands

| Command | Description |
|---------|-------------|
| `/talk` | Open interactive style picker and start session |
| `/talk report …` | Start session with specific style and initial content |
| `/talk styles` | List all discovered styles and capabilities |
| `/talk style <id>` | Switch active style on the fly |
| `/talk open [surface]` | Open browser window to the active/named surface |
| `/talk surfaces` | List all active surfaces in current session |
| `/talk history` | List persisted sessions on disk |
| `/talk resume [id]` | Resume a previous session |
| `/talk export <html\|md\|png\|pdf> [out]` | Export current surface |
| `/talk stop` | Stop active server (session is preserved) |
| `/talk test` | Run regression test suite |
| `/talk reload-styles` | Rescan style packs on disk |

#### Agent Tools

| Tool | Purpose |
|------|---------|
| `talk_render` | Render HTML/JSON/Markdown content or incremental DOM patches |
| `talk_explain` | Validate and compile an `explain.ir/v1` plan into a governed report |
| `talk_poll_events` | Poll user interaction events (button clicks, form submits, inputs) |
| `talk_verify` | Headless visual screenshot + console error verification |
| `talk_export` | Export surface to HTML, Markdown, PNG, or PDF |
| `talk_set_style` | Switch session style |
| `talk_list_styles` | Discover available styles and their metadata |
| `talk_status` | Inspect current session URL, versions, and pending events |

---

### Automated Tests

```bash
# Run full regression suite (talk core + explain layer + packs)
node extension/lib/talk/tests/run-tests.mjs

# Or inside Pi:
/talk test
```

All 54 tests passing (41 talk & explain core tests + 7 report design system tests + 6 showcase tests).

---

<a id="简体中文"></a>

## 简体中文

> `/talk` 为 Pi 智能体提供超越纯文本 Markdown 的**富媒体交互侧表面（Side Surface）**。  
> 样式采用演进式架构：开箱即用，通过样式包持续扩展，无需重写核心引擎。

### 概述

`/talk` 是 [Pi coding agent](https://github.com/earendil-works/pi-coding-agent) 的扩展插件。它在主对话流之外开辟独立的浏览器侧窗口，支持期刊级正式汇报报告、交互式 UI、Archify 架构图、思维画板、多版本代码对比审阅以及认知级分层解释（Explanation Layer）。

#### 核心理念
- **分离“怎么呈现”与“怎么解释”**：`/talk` 负责展示层与交互呈现；解释层（Explanation Layer）负责认知路径设计。ELI5、费曼学习法、苏格拉底问答等是生成 Explanation IR (`explain.ir/v1`) 的**解释策略**，而不是膨胀出一堆风格各异的独立 UI 样式。
- **演进式样式包（Evolutionary Packs）**：每个样式包都是带声明式 `manifest.json` 的独立目录。只需在 `~/.pi/agent/talk/styles/` 下放入文件夹，即可实时发现与热加载，无需重启内核。
- **严格的安全与治理闭环**：基于 `parse5` 的 HTML5 规范化与安全审计、严格的 Hash-CSP 白名单策略，以及交付前的无头渲染自检（`talk_verify`）。

---

### 核心特性

1. **演进式样式系统（12+ 款样式）**
   - `report`（默认基础样式）：期刊式正式汇报报告系统（温暖纸张色调、衬线字体层级、KPI 统计、卡片、证据表格、时间线、结论框）。
   - `arch`：交互式架构图、时序图、数据流图与系统生命周期图（基于 Archify）。
   - `compare`：多版本并排 diff（真实 LCS 算法）：增删改高亮、统计徽章、逐项采纳与红线审阅导出。
   - `evalgrid`：用例 × 模型评测对照台：单元格展开、打分与 baseline 锁定。
   - `canvas`：Obsidian Canvas 兼容的双向白板。
   - `draw`：基于 tldraw 的实时协同画板。
   - `paper`：长文精读批注与主张抽取。
   - `inspect`：截图与设计稿热区标注审查。
   - `hub` & `showcase`：多 demo 原型交互导航壳与可搜索成果画廊。
   - `html-interactive` & `html-static`：全功能交互（JS 事件桥接）与安全沙箱静态 HTML。

2. **认知解释层（Explanation Layer · `talk_explain`）**
   - **解释中间表示（`explain.ir/v1`）**：由浅到深的分层结构（核心一句话、运行机制、实例、代码、生活类比）。
   - **Fail-Closed 确定性校验器**：严密的标识符验证（拒绝修饰或修剪空白，禁止冒号，保证身份精确不变）、封闭 Schema（拒绝未知字段）、边界强约束（limitations 严格限制 1–3 条，拒绝静默截断）。
   - **防错误简化安全闸门**：强制声明边界条件（`limitations`）；类比层强制要求指出“类比在哪里失效”（`analogyBreakage`，杜绝“类比等于本质”的简化误导）。
   - **随层理解自测（Positional Checks）**：自测卡片紧随所属解释层渲染；正确答案（`answerId`）仅保留在 Agent 侧，绝不写入 DOM 暴露；用户点选后通过事件桥传回 `explain-check`。

3. **多工作区表面（Multi-Surface）与增量局部更新**
   - 支持向具名表面（如 `main`、`diag`、`notes`）独立渲染，各表面维护独立版本历史。
   - 基于 SSE 的 DOM 增量局部补丁更新（`inner` / `outer` / `append` / `prepend` / `remove`），保持页面焦点与滚动位置。

4. **双向事件桥（Event Bridge）**
   - 页面内置轻量事件代理，自动捕获按钮点击（`data-talk-event`）、表单提交（`data-talk-form`）及防抖输入（`data-talk-input`）。
   - Agent 可随时调用 `talk_poll_events` 拉取用户交互事件，实现闭环对话。

5. **无头视觉自检与导出流水线**
   - 无头 Chromium 页面快照与控制台错误探测（`talk_verify`），消除模型盲渲缺陷。
   - 一键将侧表面导出为纯净 HTML、GFM Markdown、全页长图 PNG 或打印级 PDF（`talk_export`）。

---

### 项目架构

```
~/.pi/agent/
├── extensions/
│   ├── talk.ts              # 扩展入口及工具注册
│   └── lib/talk/            # 核心引擎
│       ├── explain/         # 解释层：IR 类型定义、fail-closed 校验器与报告编译器
│       ├── registry.ts      # 样式包发现与 manifest 校验
│       ├── report-audit.ts  # parse5 审计器与 CSP 生成器
│       ├── server.ts        # 本地 HTTP 服务与 SSE 事件桥
│       ├── session.ts       # 会话生命周期、多表面管理与持久化
│       ├── verify.ts        # 无头 Chromium 渲染探针
│       └── export.ts        # HTML/MD/PNG/PDF 导出管线
├── skills/talk/
│   └── SKILL.md             # 智能体技能：样式路由与治理指引
└── talk/
    ├── components/          # 共享设计令牌与组件库 (tokens.css)
    ├── styles/              # 12+ 款演进式样式包
    └── sessions/            # 持久化会话记录与事件流水（git 忽略）
```

---

### 指令与工具

#### 用户指令

| 指令 | 作用 |
|------|------|
| `/talk` | 唤起交互式样式选择器并启动会话 |
| `/talk report …` | 以指定样式和首条内容启动会话 |
| `/talk styles` | 列出已发现的所有样式包及其功能特性 |
| `/talk style <id>` | 在会话中实时切换表面样式 |
| `/talk open [surface]` | 打开浏览器查看当前活动表面或具名表面 |
| `/talk surfaces` | 列出当前会话中的所有表面 |
| `/talk history` | 查看磁盘上保存的历史会话 |
| `/talk resume [id]` | 恢复指定或最新的历史会话 |
| `/talk export <html\|md\|png\|pdf> [out]` | 导出当前表面内容 |
| `/talk stop` | 停止服务（会话数据完好保存） |
| `/talk test` | 执行自动化回归测试套件 |
| `/talk reload-styles` | 重新扫描本地样式包目录 |

#### 智能体工具

| 工具 | 作用 |
|------|------|
| `talk_render` | 渲染内容到活动表面，支持多表面路由与局部 DOM 补丁更新 |
| `talk_explain` | 校验并编译 ExplanationPlan (`explain.ir/v1`) 为受治理的分层解释报告 |
| `talk_poll_events` | 轮询用户的交互事件（按钮点击、表单提交、输入） |
| `talk_verify` | 无头浏览器截屏自检与控制台错误排查 |
| `talk_export` | 导出表面为 HTML、Markdown、PNG 或 PDF 文件 |
| `talk_set_style` | 切换表面样式 |
| `talk_list_styles` | 获取已注册样式及其元数据 |
| `talk_status` | 查看当前会话状态、URL、版本历史及未决事件 |

---

### 自动化测试

```bash
# 执行完整回归测试套件（talk 核心 + 解释层 + 样式包）
node extension/lib/talk/tests/run-tests.mjs

# 或在 Pi 会话中直接运行：
/talk test
```

全套 54 项测试全部通过（41 项内核与解释层测试 + 7 项 report 设计系统测试 + 6 项 showcase 测试）。

---

### 开源许可

[MIT License](LICENSE)
