# `/talk report` · Agent authoring cookbook

Canonical design contract: `DESIGN_SYSTEM.md`  
Quality gates: `QUALITY.md`  
Reference visual: `智渔粮库 · AI 智能体联合研发方案整合报告.html`

## Use it whenever the output is a report

汇报、结项、周报、阶段说明、验收、评审、审计、方案总结 → `styleId: "report"`.

Do **not** create a formal report in `html-static`, `html-interactive` or a one-off full HTML document. Those modes remain explicit advanced surfaces for prototypes and special interactions.

## Render call

```js
talk_render({
  styleId: "report",
  title: "项目阶段验收报告",
  content: `...body fragment...`,
  metaJson: JSON.stringify({
    mark: "验",
    brand: "项目名",
    subtitle: "阶段验收",
    meta: "8 项通过 · 1 项观察<br>更新 2026-08-15",
    footer: "内部汇报 · 数据截至 2026-08-15"
    // nav may be omitted: section[id] + data-nav-title auto-build it
  })
})
```

## Minimum production skeleton

```html
<section id="hero" class="hero" data-nav-title="摘要">
  <div class="tag-row">
    <span class="b-pill ok">已验收</span>
    <span class="b-pill inf">阶段 02</span>
  </div>
  <h1>项目阶段验收报告</h1>
  <p class="sub">一句话给出结果、影响与下一步。</p>
  <div class="meta-row"><span>2026-08-15</span><span>•</span><span>范围</span></div>
</section>

<section id="evidence" class="sec-head section-gap" data-nav-title="验收证据">
  <div class="tag">01 · EVIDENCE</div>
  <h2>验收证据</h2>
  <p>说明证据口径。</p>
</section>

<div class="kpi-row">
  <div class="kpi">
    <div class="num"><span class="counter" data-target="12">0</span></div>
    <div class="lbl">通过项</div><div class="sub">本轮</div>
  </div>
  <div class="kpi accent">
    <div class="num"><span class="counter accent" data-target="1">0</span></div>
    <div class="lbl">观察项</div><div class="sub">不阻断</div>
  </div>
</div>

<div class="grid g2">
  <article class="card hl"><h3>已完成</h3><p>事实与证据。</p></article>
  <article class="card gold"><h3>待观察</h3><p>边界与风险。</p></article>
</div>

<div class="tbl-wrap">
  <table>
    <caption>验收明细</caption>
    <thead><tr><th scope="col">项目</th><th scope="col">证据</th><th scope="col">状态</th></tr></thead>
    <tbody><tr><td>功能</td><td>测试路径</td><td class="ok"><span class="b-pill ok">PASS</span></td></tr></tbody>
  </table>
</div>

<div class="verdict">
  <div class="lbl">VERDICT</div>
  <h3>通过上线门，保留一项非阻断观察</h3>
  <p>说明决策、剩余边界与下一动作。</p>
</div>
```

## Component index

| Intent | Classes |
|---|---|
| hero / executive thesis | `.hero`, `.tag-row`, `.sub`, `.meta-row` |
| chapter | `section[id].sec-head`, `.tag`, `.section-gap` |
| KPI | `.kpi-row`, `.kpi`, `.num`, `.lbl`, `.sub`, `.counter` |
| card | `.grid.g2|g3|g4`, `.card.hl|brand|gold|good|crit` |
| status | `.b-pill.ok|mid|no|inf|br`, `.chip-row`, `.chip` |
| evidence | `.tbl-wrap`, `table`, `caption`, scoped `th` |
| callout | `.note.info|warn|crit|good` |
| comparison | `.vs`, `.vs-col.old|new`, `.vs-mid` |
| timeline | `.tl`, `.tl-item` |
| tabs | `.tabs`, `.tb[data-tab]`, `.tab-pane[data-pane]` |
| progress | `.anim-bar` with only `style="--w:80%"` |
| optional depth | `details.hook`, `details.conv` |
| final decision | `.verdict` |
| feedback | `.actions`, `button[data-talk-event]` |

Utilities: `.mt-1..4`, `.mb-0..3`, `.text-small`, `.text-faint`, `.text-right`, `.nowrap`, `.full-span`, `.col-id|sm|md|lg`.

## Accessible tabs

```html
<div class="card">
  <div class="tabs" aria-label="证据视图">
    <button class="tb active" data-tab="test">测试</button>
    <button class="tb" data-tab="risk">风险</button>
  </div>
  <div class="tab-pane active" data-pane="test">...</div>
  <div class="tab-pane" data-pane="risk">...</div>
</div>
```

The runtime associates each tab bar with its immediately following panes (or a `.tab-set` wrapper), adds tab roles, ARIA linkage, print labels, hidden state and arrow/Home/End keyboard behavior. Keep each set's panes contiguous so multiple tab sets remain isolated.

## Safe interaction

```html
<div class="actions">
  <button class="primary" data-talk-event="report-feedback" data-talk-value="approve">通过</button>
  <button data-talk-event="report-feedback" data-talk-value="revise">修改</button>
</div>
```

Simulator controls use `data-sim-mode="good"` and optional `data-sim-root="simSteps"`. Never use `onclick`.

## Authoring prohibitions

- Use only the documented report elements; no HTML comments/bogus comments, shell elements (`main/aside/nav/footer`), raw SVG, `<script>`, `<style>`, iframe/form/embed/object or inline `on*` handlers.
- Keep fragments explicitly balanced. The renderer publishes only parse5-canonical serialization. IDs must be unique stable ASCII; never use reserved `report-*` runtime IDs or shell classes such as `.report-side`.
- URL schemes are restricted; encoded or unquoted `javascript:` is blocked.
- No inline `style="..."` layouts. The only accepted form is one bounded progress token such as `style="--w:80%"` on `.anim-bar`.
- Component data is schema-bound: counter decimals `0…6`, duration `0…10000`, finite targets, stable tab/pane keys and one-to-one adjacent pane sets.
- Never add `hidden`, `aria-hidden="true"`, behavior classes (`counter`, `mermaid`, tabs/animation) or presentational roles to hero, navigable sections or verdict.
- No KPI without `.num` and `.lbl`.
- No evidence table without semantic headers; add a caption when the table carries an acceptance claim.
- No color-only status. Pair it with explicit words: PASS / 阻断 / 观察.
- No more than 4–6 top-level KPI cards and 6–8 primary sections unless the report genuinely needs the depth.

## Verification loop

1. Render with `styleId: report`.
2. Check `talk_render` result details: fragment + assembled-document audit must have zero errors and should have zero warnings.
3. Open the surface and run `window.ReportDesignSystem.audit(document)` when browser QA is available.
4. Verify desktop/tablet/mobile, tabs, auto-nav, console/network/CSP errors and print layout; confirm PDF text contains every inactive tab and closed disclosure.
5. Only then present the report as final.

## 会话轨迹组件（trace · 06 集成）

报告可附带**本次会话的 agent 轨迹**（瀑布图 + 复盘），数据经 `metaJson` 传入，不占用 content 审计额度：

```text
talk_render({
  styleId: "report",
  content: "…正文…",
  metaJson: {
    "trace": "{\"stats\":{\"tokens\":\"52.3k\",\"time\":\"4m12s\",\"cost\":\"$1.84\"},\"steps\":[{\"t\":\"think|tool|wait|fail\",\"label\":\"…\",\"ms\":1200,\"kind\":\"bash\",\"cmd\":\"…\",\"out\":\"…\",\"detail\":\"…\"}]}"
  }
})
```

- `t`：think（思考）/ tool（工具）/ wait（等待）/ fail（失败），决定瀑布条颜色
- `kind:"bash"` + `cmd/out`：点行弹出命令与输出；其他类型显示 `detail`
- 行右侧 ⚑：标记「这步不该发生」，汇入底部复盘清单，事件回传 `trace.flag`
- 不传 `trace` 或传空 → 面板自动隐藏，不影响审计 0/0
- 注意：trace 数据中的 `<` 请转义（数据槽是 div，非 script）
