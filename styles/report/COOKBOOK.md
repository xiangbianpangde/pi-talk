# `/talk report` · Agent Authoring Cookbook

Canonical design contract: `DESIGN_SYSTEM.md`  
Quality gates: `QUALITY.md`  
Reference visual: `智渔粮库 · AI 智能体联合研发方案整合报告.html`

## 核心原则与四不法则

汇报、结项、周报、阶段说明、验收、评审、审计、科研总结 → `styleId: "report"`.

### 三大约束
1. **心智模型先行（综合汇报）**：任何综合性正式汇报（阶段验收、立项方案、周报复盘、科研实验汇报）必须在第一/二板块包含一张可视化模型图（Mermaid 闭环流转图或分层架构图），并配以 2~3 个伴随解释卡片。单点概念解释（talk_explain）聚焦教学层级，豁免综合闭环图要求。
2. **去术语化与人话表达**：严禁无上下文的名词连缀串。任何技术机制必须说明其**动作与实际价值**（“动词 + 业务/用户价值”）。数字必须挂钩真实实体（如“覆盖 10 大核心痛点”、“N=5 个试验塘口”），严禁纯报用例数。
3. **科研严谨与因果机理**：明确科学假设、对照基准（Baseline）、消融增益（Ablation）与明确的失效边界（Boundary）。

### 四不法则（Anti-Patterns）
- ❌ **不搞空心跑分单**：严禁把“73/73 pass, 0 errors, PASS/PASS”当正文主干（测试数据放入折叠附录）。
- ❌ **不写假大空宣传报**：严禁以“文件数、100% 通过率”充当阶段进展；必须交代系统行为的真实增量、遇到的阻碍与权衡。
- ❌ **不在报告正文中使用全文字折叠解释概念**：在手写正式汇报正文时，严禁直接在 `<details>` 内堆砌大段纯文本作为概念说明；必须采用“一句话定义 + 微图解 + 正反辨析 + 实例代码”的结构化卡片。（注：由编译器管理的 talk_explain / explain.ir/v1 保留 details.hook 作为教学分层展开机制，不受此手写正文规则限制）。
- ❌ **不列无主语名词清单**：严禁出现“实现了 Adapter, HPS, TraceLink, Hook”这类代码标识符清单。

---

## 模板一：科研与实验汇报范式（Scientific Research Report）

适用于：科学探索、模型评估、机理验证、算法选型、实验室进展汇报。

```html
<section id="hero" class="hero" data-nav-title="研究摘要">
  <div class="tag-row">
    <span class="b-pill ok">实证已验证</span>
    <span class="b-pill inf">机理约束建模</span>
    <span class="sample-pill field">实测 N=5 试验点</span>
  </div>
  <h1>热湿传导先验约束消除传感器长期漂移</h1>
  <p class="sub">基于物理扩散方程残差耦合，将老旧仓房单点传感器的随机漂移误差降低 63.4%，并在 5 个平房仓中实现了无人化自动校正。</p>
  <div class="meta-row"><span>2026-09-14</span><span>•</span><span>课题：无人化储粮环境自主感知</span><span>•</span><span>置信度：p &lt; 0.01</span></div>
</section>

<section id="hypothesis" class="sec-head section-gap" data-nav-title="科学问题与假设">
  <div class="tag">01 · HYPOTHESIS</div>
  <h2>从纯黑盒时序拟合到机理先验约束</h2>
  <p>传统统计与纯深度学习在面对传感器局部锈蚀或粉尘污染时，易将硬件漂移误判为真实粮情发热。我们提出物理机理残差约束假设。</p>
</section>

<article class="hypothesis">
  <div class="hypo-tag">[ 核心科学假设 H₁ · 因果机理 ]</div>
  <h3>引入一维热传导物理先验可有效解耦硬件漂移与真实生物发热</h3>
  <div class="hypo-body">
    <div class="hypo-row"><span class="hypo-lbl">前提</span><span>真实粮堆内部热量传递遵循连续扩散定律，空间梯度的瞬时发散速度存在物理上限。</span></div>
    <div class="hypo-row"><span class="hypo-lbl">推论</span><span>超越空间连续性边界的单点温度跃升，可确定性判定为传感器阻抗漂移而非局部发热。</span></div>
    <div class="hypo-row"><span class="hypo-lbl">机理</span><span>构建残差自回归损失函数，将偏离物理约束的梯度实时映射为动态补偿量。</span></div>
  </div>
</article>

<div class="formula-wrap">
  <div class="formula-math">L_total = L_pred(y, y_hat) + λ · ||∇² T_grain - α · ∂T/∂t||²</div>
  <div class="formula-vars g3">
    <div class="var-item"><span class="var-sym">L_pred</span><span class="var-desc">自回归预测误差（追求数据拟合精度）</span></div>
    <div class="var-item"><span class="var-sym">∇²T - α∂T/∂t</span><span class="var-desc">热传导物理残差项（物理可行性约束）</span></div>
    <div class="var-item"><span class="var-sym">λ</span><span class="var-desc">平衡权重，由气调状态自适应调节</span></div>
  </div>
</div>

<section id="system" class="sec-head section-gap" data-nav-title="系统闭环与实验">
  <div class="tag">02 · CLOSED LOOP</div>
  <h2>全流程闭环感知与动态校正</h2>
  <p>将物理方程嵌入流式计算管线，形成感知、过滤、预测、校正的全自主闭环。</p>
</section>

<div class="mermaid-wrap">
  <div class="cap">自主感知与机理动态校正闭环</div>
  <div class="mermaid">flowchart LR
    A[多源传感器流] --> B[物理残差初筛]
    B --> C[动态梯度解耦]
    C --> D[漂移补偿注入]
    D --> E[粮情风险判定]
    E -->|持续反馈| B</div>
</div>

<div class="grid g3">
  <article class="card hl"><h3>物理初筛层</h3><p>以扩散定律剔除高频虚假波动，杜绝误报警。</p></article>
  <article class="card brand"><h3>梯度解耦层</h3><p>分离环境昼夜周期波动与硬件单调漂移。</p></article>
  <article class="card gold"><h3>补偿闭环层</h3><p>自适应校正系数在线更新，无需人工进仓校表。</p></article>
</div>

<section id="results" class="sec-head section-gap" data-nav-title="实证与消融">
  <div class="tag">03 · ABLATION &amp; FINDINGS</div>
  <h2>实证验证与各机制消融贡献</h2>
  <p>在 5 个试验平房仓、为期 90 天的连续对照实验中，评估各机制的独立贡献度。</p>
</section>

<div class="tbl-wrap">
  <table class="ablation-table">
    <caption>消融实验结果（基准 Baseline vs 各变体）</caption>
    <thead><tr><th scope="col" class="col-id">#</th><th scope="col" class="col-md">实验组别</th><th scope="col">自变量配置</th><th scope="col" class="col-sm">预测误差 RMSE</th><th scope="col" class="col-sm">相对增益</th></tr></thead>
    <tbody>
      <tr><td class="num">01</td><td class="baseline">Baseline（传统经验）</td><td>纯固定阈值告警 + 线性滤波</td><td class="num">1.45 ℃</td><td class="delta-neutral">- 基准线 -</td></tr>
      <tr><td class="num">02</td><td>Ablation-A（纯黑盒）</td><td>LSTM 时序模型，无物理机理项</td><td class="num">0.98 ℃</td><td><span class="delta-pos">+32.4%</span><span class="signif">p&lt;0.05</span></td></tr>
      <tr><td class="num">03</td><td>Ablation-B（纯机理）</td><td>有限元物理仿真，无流式更新</td><td class="num">1.21 ℃</td><td><span class="delta-pos">+16.5%</span></td></tr>
      <tr><td class="num">04</td><td class="ours">Ours（机理耦合全模型）</td><td>残差耦合 + 在线动态补偿</td><td class="num">0.53 ℃</td><td><span class="delta-pos">+63.4%</span><span class="signif">p&lt;0.01</span></td></tr>
    </tbody>
  </table>
</div>

<article class="card discovery">
  <div class="disc-badge">KEY FINDING · 实证洞见 <span class="sample-pill field">实测 N=5 仓房</span></div>
  <h3>临界温差倒挂现象</h3>
  <p>观测表明：当仓内外温差小于 3.5 ℃ 时，盲目启动轴流风机反而会因机械摩擦产热加速表层回潮。</p>
  <div class="vs-compact">
    <div class="v-col"><b>传统定时策略</b>每日固定 23:00 全功率通风，电费高且有结露隐患。</div>
    <div class="v-col hl"><b>机理脉冲策略</b>仅在绝对湿度倒挂点开启 45 分钟，降温达标且省电 38%。</div>
  </div>
</article>

<section id="limitations" class="sec-head section-gap" data-nav-title="失效边界">
  <div class="tag">04 · BOUNDARIES</div>
  <h2>诚实记录失效工况与适用边界</h2>
  <p>严谨科研必须交代方法在什么条件下会失效，明确结论适用范围。</p>
</section>

<div class="boundary-box">
  <div class="boundary-head">
    <span class="b-pill no">失效边界</span>
    <h3>持续暴雨高湿工况下的边界退化</h3>
  </div>
  <div class="grid g2">
    <div class="boundary-item"><b>触发工况：</b>仓外连续暴雨超过 72 小时，相对湿度持续 &gt; 90%。</div>
    <div class="boundary-item"><b>失效现象：</b>顶层结露导致近壁传感器阻抗突跳，误差放大至 1.8 ℃。</div>
    <div class="boundary-item"><b>机理归因：</b>显热扩散模型未覆盖气液相变潜热，边界连续性假设被打破。</div>
    <div class="boundary-item"><b>后续启示：</b>第二期须引入相变湿度修正项，并前置除湿联动控制。</div>
  </div>
</div>

<div class="verdict">
  <div class="lbl">RESEARCH VERDICT</div>
  <h3>物理机理先验可作为稳定工业物联网漂移的有效手段；下阶段推进跨季验证</h3>
  <p>本期成果已在 5 个平房仓中完成一阶段验证，下一阶段重点攻坚暴雨高湿相变边界，并推进跨养殖/储粮周期的长期泛化实验。</p>
  <div class="actions">
    <button type="button" class="primary" data-talk-event="report-action" data-talk-value="next-phase">批准下阶段实验</button>
    <button type="button" data-talk-event="report-action" data-talk-value="export-data">导出原始观测集</button>
  </div>
</div>
```

---

## 模板二：结构化概念解构卡片（替代丑陋的 `<details>` 折叠）

当需要解释一个复杂技术或业务概念时，**严禁使用全文字折叠**。必须采用包含以下四个要素的语义卡片：

```html
<article class="card hl">
  <div class="tag">CONCEPT DECONSTRUCTION</div>
  <h3>双轴解耦状态（Dual-Axis State）</h3>
  <p><b>核心定义：</b>将“机器自动化的测试事实”与“人类主观的设计意图判断”彻底分离为两条互不串写的独立状态轴。</p>
  <div class="mermaid-wrap">
    <div class="cap">双轴解耦运行机制</div>
    <div class="mermaid">flowchart LR
      subgraph 机器轴 [自动化验证轴]
        M1[执行测试用例] --> M2[哈希与日志校验] --> M3[PASS / NOT-RUN]
      end
      subgraph 人类轴 [设计决策轴]
        H1[阅读业务意图] --> H2[评估体验与痛点] --> H3[HUMAN_APPROVED]
      end
      M3 -.禁止伪造.-> H2</div>
  </div>
  <div class="vs-compact">
    <div class="v-col"><b>它是什么</b>机器没跑的用例坚决保持 NOT-RUN，客观反映工程就绪度。</div>
    <div class="v-col hl"><b>它绝不是什么</b>绝不是把机器无法验证的疑点转嫁给人签字确认来冒充全绿。</div>
  </div>
  <div class="code-block"><span class="cm">// 状态严禁混合为单个布尔值</span>
<span class="kw">const</span> status = {
  <span class="str">machine_status</span>: <span class="err">"NOT-RUN"</span>,     <span class="cm">// 机器事实未跑即未跑</span>
  <span class="str">human_decision</span>: <span class="str">"DIRECTION_OK"</span>  <span class="cm">// 人类认可路线，但不替机器跑分背书</span>
};</div>
</article>
```

---

## 组件参考索引

| 组件用途 | 核心类名 / 语法 | 使用场景 |
|---|---|---|
| 核心科学假设 | `.hypothesis > .hypo-tag + h4 + .hypo-body` | 提出科学假设、前提、推论与机理 |
| 公式与解构 | `.formula-wrap > .formula-math + .formula-vars` | 数学模型、优化目标，配白话变量表 |
| 消融对照表 | `.tbl-wrap > table.ablation-table` | Baseline vs Ours，`.delta-pos`, `.signif` |
| 失效边界箱 | `.boundary-box > .boundary-head + .grid.g2` | 诚实记录触发工况、失效现象、归因与启示 |
| 样本量徽章 | `.sample-pill.field\|sim\|stat\|warn` | 标注样本量与环境（N=5、p&lt;0.01） |
| 实证观察洞见 | `.card.discovery > .disc-badge + .vs-compact` | 记录反直觉现象、实测规律与经验对照 |
| 现状方案对比 | `.vs > .vs-col.old + .vs-mid + .vs-col.new` | 传统困境 vs 升级目标 |
| 流程/架构图 | `.mermaid-wrap > .cap + .mermaid` | 闭环流程图（Flowchart）、分层架构图 |
| 演进时间轴 | `.tl > .tl-item` | 记录决策与方案收敛历程 |
| 进度对比条 | `.bar-row > .lbl + .bar > .anim-bar + .val` | 多时间尺度或指标定量进度 |
| 折叠详情 | `details.conv` (手写正文折叠) / `details.hook` (`talk_explain` 专用) | 边缘或附录信息收纳 |
| 终审定调框 | `.verdict > .lbl + h3 + p + .actions` | 结案结论、决策要求与下一步操作 |

---

## 渲染调用

```js
talk_render({
  styleId: "report",
  title: "课题阶段实证报告",
  content: `...body fragment...`,
  metaJson: JSON.stringify({
    mark: "研",
    brand: "储粮课题组",
    subtitle: "环境感知机理实证",
    meta: "N=5 仓房实测 · p &lt; 0.01<br>更新 2026-09-14",
    footer: "实验室内部汇报 · 数据截至 2026-09-14"
  })
})
```

## Safe interaction

```html
<div class="actions">
  <button type="button" class="primary" data-talk-event="report-feedback" data-talk-value="approve">通过</button>
  <button type="button" data-talk-event="report-feedback" data-talk-value="revise">修改</button>
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
