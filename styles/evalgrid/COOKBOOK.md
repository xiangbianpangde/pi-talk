# EvalGrid 评测栅格 · Cookbook

## 用法

```text
talk_render({ styleId: "evalgrid", content: JSON.stringify({
  title, subtitle,
  models: ["GPT-4o", "…"],
  cases: [{ name, desc, scores: [3,4,null,…] }],
  outputs: { "GPT-4o": ["用例0完整输出", …] }
}) })
```

- `scores` 为 null 表示未评；`outputs[模型][用例序号]` 提供单元格弹窗中的完整输出
- content 需为合法 JSON（放入 `<script type="application/json">` 槽）

## 交互

- 点单元格 → 完整输出弹窗 + 1–5 打分 / PASS / FAIL
- 列头点击：锁为 baseline（🔒 只读）或解锁；底部汇总实时更新（平均分 / 通过率）
- 「只看失败/未评」过滤行

## 事件回传

- `evalgrid.score` / `evalgrid.passfail` / `evalgrid.lock` {model, case, …}
