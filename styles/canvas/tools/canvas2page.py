#!/usr/bin/env python3
"""Obsidian .canvas → talk canvas style pageData

用法: python3 canvas2page.py <file.canvas>   →  输出 pageData JSON（嵌入 talk_render content）
"""
import json, sys, os

COLOR_TO_LAYER = {'1': 'presentation', '2': 'application', '3': 'common',
                  '4': 'infrastructure', '5': 'stage', '6': 'domain'}


def convert(canvas_path: str) -> dict:
    d = json.load(open(canvas_path, encoding='utf-8'))
    nodes, groups, edges = [], [], []
    for n in d.get('nodes', []):
        t = n.get('type')
        if t == 'text':
            lines = (n.get('text') or '').split('\n')
            name = lines[0].replace('**', '').strip() if lines else '节点'
            sub = '\n'.join(lines[1:]).strip()
            nodes.append({
                'id': n['id'], 'name': name,
                'layer': COLOR_TO_LAYER.get(str(n.get('color', '')), 'stage'),
                'sub': sub, 'x': n.get('x', 0), 'y': n.get('y', 0),
                'w': n.get('width', 250), 'h': n.get('height', 110),
            })
        elif t == 'group':
            groups.append({
                'id': n['id'], 'label': n.get('label', ''),
                'x': n.get('x', 0), 'y': n.get('y', 0),
                'width': n.get('width', 300), 'height': n.get('height', 200),
                'color': str(n.get('color', '')),
            })
        else:  # file / link 节点降级为文本卡片
            nodes.append({
                'id': n['id'],
                'name': n.get('file') or n.get('url', '链接')[:40] or '节点',
                'layer': 'stage', 'sub': f"{t} 节点",
                'x': n.get('x', 0), 'y': n.get('y', 0),
                'w': n.get('width', 250), 'h': n.get('height', 110),
            })
    for e in d.get('edges', []):
        edges.append({'from': e.get('fromNode'), 'to': e.get('toNode')})
    edges = [e for e in edges if e['from'] and e['to']]
    title = os.path.splitext(os.path.basename(canvas_path))[0]
    return {
        'version': 2,
        'title': title,
        'canvasPath': canvas_path,
        'nodes': nodes, 'edges': edges, 'groups': groups,
        'viewport': d.get('viewport', {'x': 0, 'y': 0, 'zoom': 0.85}),
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('用法: canvas2page.py <file.canvas>', file=sys.stderr)
        sys.exit(1)
    data = convert(sys.argv[1])
    print(json.dumps(data, ensure_ascii=False, indent=2))
