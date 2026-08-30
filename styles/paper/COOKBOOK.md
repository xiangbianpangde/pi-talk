# Paper 长文批注阅读 · Cookbook

## 用法

```text
talk_render({ styleId: "paper", content: "原文 HTML（h1/p/…）" })
```

## 交互

- **划选**原文任意文字 → 浮动分类条（主张 / 方法 / 数字 / 待核）→ 生成分类高亮 + 右侧主张卡
- 主张卡操作：找反证（`paper.claim` action=find_counterevidence）/ 补引用（cite）/ 删除（连带清除高亮）
- 顶部过滤 chips：全部 / 主张 / 方法 / 数字 / 待核 —— 高亮与卡片同步过滤（其余淡出）

## 事件回传（talkSend）

- `paper.claim` {action: highlight|find_counterevidence|cite, category, quote}
- 适用：学术文献、制度文档、调研材料的长文工作台
