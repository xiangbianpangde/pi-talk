# `/talk explain` · Authoring Cookbook

Canonical design contract: `DESIGN_SYSTEM.md`  
Style ID: `"explain"`

## When to use

Use `styleId: "explain"` or the `talk_explain` tool whenever the goal is **explaining a concept, algorithm, or technical mechanism** (ELI5 / 概念精解 / 机制讲解 / 技术科普).

For formal business, stage acceptance, proposals, or weekly updates, use `styleId: "report"`.

## Render call

```js
talk_explain({
  planJson: JSON.stringify({
    schema: "explain.ir/v1",
    topic: "为什么网关偶发 502",
    audience: "intermediate",
    layers: [
      {
        id: "core",
        kind: "core",
        title: "一句话核心",
        content: "上游服务在 3 秒内没回话，网关就替它向客户端返回了 502。"
      },
      {
        id: "mechanism",
        kind: "mechanism",
        title: "超时链条",
        content: "网关只等 3 秒；上游 P99 是 4.1 秒；慢请求于是变成 502。"
      },
      {
        id: "analogy",
        kind: "analogy",
        title: "生动类比：催菜的服务员",
        content: "就像服务员在后厨等了 3 分钟，超时就直接转头告诉客人「菜没做出来，不伺候了」。",
        analogyBreakage: "现实中服务员说没做出来后厨房会停手；但在计算机体系中，网关报错后上游服务仍在继续计算。"
      },
      {
        id: "code",
        kind: "code",
        title: "看这一行配置",
        content: "```nginx\nproxy_read_timeout 3s;\n```"
      }
    ],
    limitations: [
      "只解释网关读取超时的 502，不覆盖连接拒绝或 504",
      "假设上游服务未崩溃"
    ],
    checks: [
      {
        id: "who-answers",
        afterLayerId: "mechanism",
        question: "这个 502 状态码到底是谁生成的？",
        choices: [
          { id: "upstream", label: "上游服务" },
          { id: "gateway", label: "网关" }
        ],
        answerId: "gateway"
      }
    ]
  })
})
```

## HTML Component Anatomy

If authoring manual explain fragments without IR, adhere to this structure:

```html
<section class="explain-hero" id="hero">
  <div class="tag-row">
    <span class="pill primary">中级</span>
    <span class="pill brand">4 层解构</span>
  </div>
  <h1>概念标题</h1>
  <p class="lead">用通俗的一句话建立第一直觉。</p>
</section>

<section id="layer-mechanism" class="layer-block">
  <div class="layer-tag">01 · 运行机制</div>
  <h2>底层因果链</h2>
  <div class="layer-body">
    <p>解释因果链条，平铺展现，严禁使用 details 标签折叠。</p>
  </div>
</section>

<section id="layer-analogy" class="layer-block">
  <div class="layer-tag">02 · 直觉类比</div>
  <h2>生活化类比</h2>
  <div class="analogy-card">
    <div class="analogy-text">类比描述文本。</div>
    <div class="breakage-note"><b>类比在哪里失效：</b>指出类比不能涵盖的技术特例。</div>
  </div>
</section>

<section id="limitations" class="limits-block">
  <h3>这套解释在哪里失效</h3>
  <ul>
    <li>限制条件一</li>
  </ul>
</section>

<section class="takeaway-block">
  <div class="takeaway-lbl">TAKEAWAY · 核心心智</div>
  <h3>一句话记住核心本质。</h3>
  <p>补充提示说明。</p>
</section>
```
