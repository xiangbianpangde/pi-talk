# Compare 方案对比审阅 · Cookbook

## 用法

```text
talk_render({ styleId: "compare", content: JSON.stringify({
  title, subtitle,
  versions: [{ name: "版本 A（现行）", text: "多行文本…" }, { name: "版本 B（拟修订）", text: "…" }]
}) })
```

## 交互

- 并排 diff：真实行级 LCS；差异块内再做**词级二次 diff**（相似度配对 + 词 LCS），相同词正常色、差异词高亮 —— 精确到「强制/约/授权/留档」级
- 差异块逐项审阅（redline 环）：接受 / 拒绝 / 改写（内联输入）/ 评论（内联输入）
  - 接受新增块 → 进入清洁稿；接受删除块 → 从清洁稿移除；拒绝删除 → 保留原文
  - 评论不覆盖已有决定
- 底部统计：待决 / 已处理 / 采纳 / 拒绝 / 改写 / 评论
- 「导出清洁稿 + 审阅记录」：应用所有决定后的 clean 稿 + 逐块记录（talkSend `compare.export`）

## 事件回传

- `compare.decide` {i, decision, text?} · `compare.comment` {i, comment}
