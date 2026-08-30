# Inspect 截图热区标注 · Cookbook

## 用法

```text
talk_render({ styleId: "inspect", content: "<图片 URL 或 data:image/png;base64,…>" })
```

- 本地文件请先转为 data URL（base64）；远程 URL 需可跨域加载
- 画布按图片比例居中绘制
- 可传 `metaJson: {"replies": "{\"错位\":\"自定义答复文本\",…}"}` 覆盖各标签的 agent 答复模板

## 交互

- 工具：▭ 框选 / ↗ 箭头 / ● 点选；标签：错位 / 对比度 / 这是按钮 / 看不清 / 其他
- 提交后每个热区生成 agent 答复（按标签模板，可被 agent 进一步替换）
- 撤销 / 清空 / 单条删除

## 事件回传

- `inspect.annotate` {tool, label, x, y} · `inspect.hotspot` {label, reply, x, y}
