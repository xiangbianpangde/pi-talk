# /talk — Multimodal Interaction Engine for Pi

[English](#english) | [简体中文](#简体中文)

---

<a id="english"></a>

## English

> `/talk` opens a persistent side surface for Pi agents that is **not limited to markdown**.  
> Styles are evolutionary: start simple, add packs over time without rewriting the core engine.

### Refactor status — not accepted / not frozen

The text-first MVP is implemented: bare/message-only `/talk` sends a main-transcript request with no picker or side session. `talk_report_context` collects bounded task evidence and `talk_report_brief` conservatively checks the main assistant's candidate claims, preserving failures and suppressing duplicate automatic drafts. There are no background model calls. Observation is not independent verification. Completion now requires a task-start requirement decomposition with exact user-text anchors and evidence mapped to every registered criterion. This decomposition is producer-authored: the engine cannot independently prove that it covers every user requirement. The first requirement registration is immutable within its task scope; a changed user scope must start a new task rather than silently replace the list. Incidental log truncation/eviction is a warning, not a completion veto. Truncated or missing mapped acceptance evidence, a truncated goal, or an evicted failure still blocks completion. `isError=false` means tool execution did not fail; it does not universally prove business-level acceptance. Historical failures may be marked resolved only through an explicit link to a later successful execution with the same tool/input identity. Bare `/talk` summarizes the previous scope; `/talk <message>` starts a new text-task scope. Candidate ordering uses a small deterministic risk/decision/result priority, not a semantic relevance model. Claim support requires exact text or the same ordered tokens after removing limited grammatical articles; different numbers, negation or token order are rejected. A word subset scattered across a log is not accepted as support. This is not semantic entailment: substantive paraphrases should be marked inferred, not observed. Settled drafts default to change suppression. `talk_report_brief(publish=true)` can publish one validated update through a unified transcript boundary using `pi.sendMessage(..., {triggerTurn:false})`; suppressed drafts create no entry. Publication is still producer-invoked, not an autonomous settled-event synthesis workflow. Evidence is ephemeral and resets with a new prompt or branch; cross-restart history and real-case semantic/cost benchmarks remain unaccepted. Trigger's legacy helpers remain stable, but the full lifecycle freeze matrix is not yet complete. Do not interpret renderer test counts as final acceptance.

Patch governance now resolves the existing target surface before auditing or checking report authorization. Explicit cross-style patches and unknown targets are rejected. HTML and image permits are reserved synchronously before asynchronous rendering, released on failure, and consumed after a successful render (including successful renders with warnings).

Run isolated regression tests with `node extension/lib/talk/tests/run-tests.mjs`. For release verification use `TALK_REQUIRE_CHROME=1 node extension/lib/talk/tests/run-tests.mjs`; missing Chromium is a failure in release mode, otherwise browser-dependent cases explicitly report SKIP. The runner still depends on locally installed esbuild, parse5 and typebox; it is not yet a portable CI environment. Chromium can fail intermittently on macOS without a usable display context; a failed run is not automatically retried or reported as passing.

### Non-blocking stage reporting and authorization

Stage updates must not terminate authorized work. The injected policy and skill require consequential change before an update and prohibit stopping just to announce commits, test counts or plans. Repeated, empty and producer-classified routine automatic briefs are suppressed; explicit questions remain responsive. `talk_report_brief(updatePurpose="routine")` skips milestone/plan/commit chatter unless it contains a risk, blocker or decision. Classification is supplied by the producer, not guessed from keywords. Its continuation field is always `continue`: even a blocker label does not establish that the user must participate. Suppressed routine drafts do not replace the last sendable draft baseline. These are draft controls, not a host-level guarantee against a model ending its response. Ask for essential missing input, real scope changes or an operation requiring permission, not permission to continue already-authorized work. This policy is verified in actual Pi prompt injection, but live-model compliance is not yet independently measured. The extension does not override host/user aborts or guarantee that every assistant follows the policy. Ordinary text requires no format authorization; the existing explicit rich-media gate remains separate.

### Live stage-continuation probe

An opt-in live test (`tests/live-stage-evaluation.mjs`) used `cpa/gpt-6.1-sol` with the actual bundled extension and only controlled tools, an isolated HOME, ephemeral sessions and synthetic task input (no private history sent). The final isolated run completed routine and recoverable-risk stages `[1,2,3]` with **0 premature stops and 0 requests to continue**; the user-only missing-credential scenario stopped at `[1,2]`. Times were 85.45s / 67.54s / 55.09s; provider-reported input/output totals were 9956/702, 8507/638 and 6051/587. These are three current-policy scenarios, not an old/new cost comparison or general compliance guarantee. Long provider latency is real and no improvement is claimed. The harness is paid, opt-in and excluded from normal tests. An earlier exploratory run lacked isolated HOME, so only the rerun is treated as isolation evidence; the harness now requires isolated HOME and a separate read-only auth/config root.

### Third-round correctness fixes

Requirement coverage now requires `observed` result claims and evidence explicitly included in the acceptance evidence set for **each** registered requirement; `inferred` findings remain reportable but cannot establish acceptance. Scope qualifiers (`all`, `全部`, `所有`) are preserved. A successful transport/tool call still does not establish business acceptance: producers must supply actual business verification observations; the engine does not independently interpret arbitrary test-report payloads. The live probe now fails on missing final text, premature stops, missing credential requests or false completion in the blocked scenario. The tightened assertions were rerun with `cpa/gpt-6.1-sol`: all three scenarios passed, no premature end or missing final text was observed, and the blocked scenario explicitly requested the missing credential without a completion claim. Current-run times were 38.20s / 46.41s / 29.57s; input/output totals were 8576/733, 12516/789 and 8099/530. This is still a three-scenario current-policy probe, not a semantic quality benchmark or old/new performance comparison.

### Transcript delivery boundary

`extension/lib/talk/delivery.ts` implements actual send/suppress delivery, without injecting a user message, triggering a new model turn, opening a browser or requesting presentation permission. Publication is opt-in via `talk_report_brief(publish=true)`; draft-only remains the default. Real Pi SDK tests assert one persisted `talk-stage-update` custom message on first publication, no additional entry for a repeated automatic brief, and a second entry for an explicit request. An isolated live `cpa/gpt-6.1-sol` delivery probe subsequently verified routine suppression, first risk publication, identical automatic suppression and explicit repetition: exactly two expected stage entries, stages `[1,2,3]`, no premature stop/continue request, and no repeated risk phrase in the final answer. Runtime was 34.91s with provider-reported input/output 5342/549. The probe explicitly instructed the test workflow; it is not naturalistic automatic-reporting quality evidence. This validates transcript persistence and controlled live delivery, not live TUI rendering or autonomous stage reporting. Avoid separately repeating an already published stage update. Draft-only previews do not mark content delivered; the extension advances its suppression baseline only after successful publication. Failed publication remains retryable. Validation, publication and baseline updates are serialized for concurrent brief tool calls; failed operations do not poison the queue. `explicit` defaults to false at the brief tool boundary: merely starting a task with a user prompt does not turn every intermediate update into a user-requested report. Deduplication remains scoped to the in-memory task and is not a durable exactly-once protocol.

### User preference calibration

The user chose the conclusion/status-first alternative in **5/5** presented historical-task comparisons. This supports concise, decision-oriented main-transcript reporting with explicit unfinished work and limits, without imposing a fixed template. Both alternatives were assistant-authored; this was neither blinded independent fact review nor an engine-generated A/B benchmark. It establishes a presentation preference, not demonstrated factual accuracy, Token savings or latency improvement.

### Real Pi SDK runner validation

Set `PI_CODING_AGENT_PACKAGE` to the installed Pi package directory when running the isolated regression runner to include `tests/pi-lifecycle.mjs`. The test uses Pi's actual `DefaultResourceLoader`, in-memory `AgentSession` and `ExtensionRunner` to load the bundled extension, dispatch task start, tool result, settlement replay/abort, fork boundary and shutdown, and assert evidence/branch state via the real tool definition. The test also executes two actual `AgentSession.prompt()` loops through a deterministic response-stream fixture and checks consecutive task reset and settlement. No network/provider requests are made. Fixture dispatch verifies Pi runtime integration, not semantic quality or live model retries. A separate real `AgentSessionRuntime.newSession()` / `switchSession()` test now verifies actual session replacement and reopening of file-backed synthetic history: the transcript restores while ephemeral task evidence starts empty. Actual `session.reload()` is also tested: ephemeral evidence resets and only one brief tool remains registered. Actual abort of a pending response stream followed by recovery is covered; an aborted task does not become a settled reporting opportunity. Actual runtime fork isolates evidence as well as replacement/resume. Raw checkout loading initially failed because legacy parse5 imports resolve relative to an installed layout; the test bundles dependencies explicitly rather than claiming checkout portability is fixed.

### Authorized local-history replay (2026-10-09)

`extension/lib/talk/tests/history-evaluation.ts` is an opt-in, read-only local history evaluator. It selects at most two tasks per session, excludes compacted/branched histories, and requires a user prompt, tool results and a final assistant reply. It emits counts and timings only, never raw task text, file paths or tool payloads. It is not part of normal regression tests and requires explicit permission to access history.

A local run replayed **20 unique task fingerprints from 15 sessions**, comprising **34 execution failures** across the selected cases; duplicate goal/tool traces are excluded. All 20 rejected a fabricated completed state without historical requirement mappings; all 20 suppressed repeated automatic drafts and responded to explicit requests. 18/20 had some truncated/evicted context. Local deterministic collection/refinement p50 was **0.459 ms**, p95 **1.300 ms**, with **0 additional semantic model calls**. These timings exclude model synthesis and user interaction; they are not end-to-end latency improvements. Original reply sizes and historical model usage are measured by the evaluator, but no new model-produced reports were compared: **semantic accuracy, information value, reading burden, semantic deduplication and model Token savings remain unmeasured**. The replay is evidence for structural invariants only, not final acceptance or Trigger freezing. Raw histories and per-case local outputs are not committed.

### Overview

`/talk` is an extension for the [Pi coding agent](https://github.com/earendil-works/pi-coding-agent) that provides rich multimodal interaction alongside the main transcript — journal-grade formal reports, interactive UIs, Archify architecture diagrams, whiteboard canvases, code diff comparisons, and a cognitive Explanation Layer.

#### Core Philosophy
- **Separation of Presentation and Understanding**: `/talk` handles *how to present*; the Explanation Layer handles *how humans come to understand*. Strategies like ELI5, Feynman, and Socratic are producer policies that compile into a unified Explanation IR (`explain.ir/v1`), rather than ballooning into separate styles.
- **Evolutionary Packs**: Style packs are self-contained folders with a declarative `manifest.json`. Drop a directory into `~/.pi/agent/talk/styles/` and it becomes available immediately without restarting the engine core.
- **Governed Safety**: Strict content auditing via HTML5 `parse5` canonicalization, hash-based CSP, sanitization, and headless visual verification (`talk_verify`).

---

### Key Features

1. **Evolutionary Style System (12+ Styles)**
   - `report` (explicit formal HTML): Journal-style formal HTML report design system (paper palette, serif hierarchy, KPI, cards, evidence tables, timeline, verdict).
   - `talk_report_images`: Governed one-page image reporting; after completion and acceptance, choose 1–5 pages and generate editable 1200×1600 SVG plus PNG. Contract: `extension/lib/talk/report-image/DESIGN_SYSTEM.md`.
   - `explain`: Dedicated pedagogical explanation design system (distraction-free 68ch single-column layout, 100% directly visible, zero forced details folding, analogy breakage guards, inline checks).
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
   - **Dedicated Explain Design System**: Compiles into the independent `explain` design system (`styles/explain/`) with single-column editorial layout (68ch), 100% directly visible content, and strictly zero forced `<details>` folding.
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
│       ├── explain/         # Explanation Layer: IR types, validator & explain compiler
│       ├── explain-audit.ts # parse5 safety auditor for explain design system
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
| `/talk` | Request a concise report in the main transcript; no picker or side session |
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
| `talk_prepare_report` | Explicit formal rich-media requests only: authorize a subtype/count after acceptance; never required for ordinary text |
| `talk_render` | Render HTML/JSON/Markdown or DOM patches; formal report HTML requires a fresh HTML-mode `reportPermit` |
| `talk_report_images` | Generate the chosen number of SVG + PNG infographics with provenance and limitations using an image-mode permit |
| `talk_explain` | Validate and compile an `explain.ir/v1` plan into the dedicated `explain` design system |
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

The regression suite covers report completion/type selection, the talk engine, and style packs. Run the command above for the current count.

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
   - `report`（显式正式 HTML 样式）：期刊式正式 HTML 汇报报告系统（温暖纸张色调、衬线字体层级、KPI 统计、卡片、证据表格、时间线、结论框）。
   - `talk_report_images`：正式「一张图汇报」模式；完成任务并验收后，选择 1–5 张，生成 SVG + PNG。
   - `explain`：专属概念精解设计系统（68ch 单栏沉浸阅读、100% 平铺直陈、零强制折叠、直觉类比破壁、代码走读与内嵌自测）。
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
   - **专属 Explain 设计系统**：编译至专属 `explain` 概念精解设计系统（`styles/explain/`），采用 68ch 单栏沉浸式阅读流，100% 平铺展开，彻底杜绝任何形式的 details 强行折叠。
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
│       ├── explain/         # 解释层：IR 类型定义、fail-closed 校验器与编译器
│       ├── explain-audit.ts # explain 专属 parse5 审计器与安全门禁
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
| `/talk` | 在主对话请求简洁汇报；无选择器或侧表面 |
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
| `talk_prepare_report` | 完成并验收后询问类型；图像汇报再问 1–5 张，并发放模式专用许可 |
| `talk_render` | 渲染内容到活动表面；正式 HTML 汇报需要 HTML 许可 `reportPermit` |
| `talk_report_images` | 凭图像许可生成指定张数的 SVG + PNG，附来源和局限 |
| `talk_explain` | 校验并将 `explain.ir/v1` 蓝图编译并渲染至专属 `explain` 设计系统 |
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

回归测试覆盖任务完成/汇报类型闸门、交互引擎及样式包；当前数量以执行结果为准。

---

### 开源许可

[MIT License](LICENSE)
