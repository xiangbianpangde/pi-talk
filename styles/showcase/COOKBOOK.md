# `/talk showcase` · Showcase 展示台（agent 创作手册）

应用画廊式展示台：把一批独立条目（demo / 工具 / 页面 / 功能）组织成**可搜索、可分类的卡片网格**，作为导航中心。

## 何时使用

| 场景 | 用 showcase | 用 report |
|---|---|---|
| 展示多个可进入的页面/demo/工具，让用户选 | ✅ 主选 | — |
| 产品功能画廊、应用中心、案例集 | ✅ 主选 | — |
| 正式汇报/结项/评审正文 | — | ✅ 主选 |

## 渲染调用

```js
talk_render({
  styleId: "showcase",
  title: "工具中心",
  content: JSON.stringify({          // 可选：不传则使用内置示例
    title: "工具中心",
    logo: "🧰",
    sub: "一行副标题（显示在页脚）",
    items: [
      { id: "cal", icon: "📅", title: "排期计算器", sub: "工具", desc: "…",
        href: "/tools/cal", cat: "工具", status: "ready" },
      // …
    ],
  }),
  // 多展示台建议渲染到命名 surface：metaJson: {"surface":"tools"}
})
```

`content` 也接受**纯数组** `[{...}]`（等价于 items）。

## 条目 schema

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✓ | 稳定唯一 id，用于事件回传 |
| `title` | string | ✓ | 卡片标题 |
| `desc` | string | ✓ | 一句话描述（卡片副文） |
| `href` | string | ✓ | 点击跳转地址（**同页导航**，勿用 target=_blank） |
| `icon` | string | — | emoji 图标，默认 🔹 |
| `sub` | string | — | 标题下小字（如英文名/类型） |
| `cat` | string | — | 分类（自动生成筛选 chips；缺省归入「其他」） |
| `status` | string | — | `new` 新 / `ready` 可用 / `beta` 预览 / `dev` 开发中，默认 ready |

## 交互与事件

- 搜索框实时过滤（名称/描述/分类/子标题），快捷键 `/` 聚焦、`Esc` 清空
- 分类 chips 过滤；卡片 Tab 可达、Enter 打开、`:focus-visible` 高亮
- 事件（经 talkSend 回传 agent）：`showcase:open {id,title}`、`showcase:filter {cat}`、`showcase:search {q}`
- 空态提示；统计行显示条目/分类/当前显示数；打印时隐藏控件保留卡片列表

## 设计约定（为什么）

- **同页导航**：每个打开页面会占用一条 SSE 长连接，浏览器每地址并发连接有上限（6），新标签页堆叠会导致页面"打不开"。卡片一律同页跳转，子页面提供「返回」入口。
- 纸张色系 + 白卡片 + 克制的阴影，与 report 家族一致；无外部依赖，离线可用。
- 键盘优先：搜索、筛选、打开全部可脱离鼠标完成。

## 质量门槛

1. 渲染后 `talk_verify` 截图 + 控制台 0 错误。
2. `cd ~/.pi/agent/talk/styles/showcase && node --test tests/*.mjs` 6 项契约测试全绿（manifest / 模板 / 内置数据 / 协议 / 可访问性 / 转义）。
3. 接入 `/talk test`（引擎 runner 自动扫描 `styles/*/tests`）。
4. 交付前在浏览器实测：搜索 → 分类 → 空态 → 打开卡片 → 返回。
