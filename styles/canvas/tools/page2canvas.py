#!/usr/bin/env python3
"""talk canvas pageData → Obsidian .canvas 文件

用法: python3 page2canvas.py <pageData.json> <out.canvas>
无 groups 时自动按分层聚类生成分组包围盒。
"""
import json, sys

LAYER_TO_COLOR = {'presentation': '1', 'application': '2', 'common': '3',
                  'infrastructure': '4', 'stage': '5', 'domain': '6'}
LAYER_LABELS = {'presentation': '表现层', 'application': '应用层', 'domain': '领域层',
                'infrastructure': '基础设施', 'common': '公共层', 'stage': '管道阶段'}


def convert(page: dict) -> dict:
    nodes, groups = [], []
    for n in page.get('nodes', []):
        name = (n.get('name') or '节点').strip()
        sub = (n.get('sub') or '').strip()
        text = f"**{name}**\n{sub}" if sub else f"**{name}**"
        nodes.append({
            'id': n['id'], 'type': 'text', 'text': text,
            'x': n.get('x', 0), 'y': n.get('y', 0),
            'width': n.get('w', 250), 'height': n.get('h', 110),
            'color': LAYER_TO_COLOR.get(n.get('layer', 'stage'), '5'),
        })

    groups_in = page.get('groups') or []
    if groups_in:
        groups = [{
            'id': g['id'], 'type': 'group', 'label': g.get('label', ''),
            'x': g['x'], 'y': g['y'], 'width': g['width'], 'height': g['height'],
            'color': str(g.get('color', '')),
        } for g in groups_in]
    else:
        by_layer = {}
        for n in page.get('nodes', []):
            by_layer.setdefault(n.get('layer', 'stage'), []).append(n)
        for layer, ns in by_layer.items():
            if not ns:
                continue
            x = min(n['x'] for n in ns) - 30
            y = min(n['y'] for n in ns) - 46
            w = max(n['x'] + n.get('w', 250) for n in ns) - x + 30
            h = max(n['y'] + n.get('h', 110) for n in ns) - y + 46
            groups.append({
                'id': f"g-{layer}", 'type': 'group', 'label': LAYER_LABELS.get(layer, layer),
                'x': x, 'y': y, 'width': w, 'height': h,
                'color': LAYER_TO_COLOR.get(layer, '5'),
            })

    edges = []
    for i, e in enumerate(page.get('edges', [])):
        edges.append({
            'id': f"e-{i:03d}",
            'fromNode': e['from'], 'fromSide': 'right',
            'toNode': e['to'], 'toSide': 'left',
        })

    return {
        'nodes': nodes + groups,
        'edges': edges,
        'viewport': page.get('viewport', {'x': 0, 'y': 0, 'zoom': 0.85}),
    }


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('用法: page2canvas.py <pageData.json> <out.canvas>', file=sys.stderr)
        sys.exit(1)
    page = json.load(open(sys.argv[1], encoding='utf-8'))
    canvas = convert(page)
    with open(sys.argv[2], 'w', encoding='utf-8') as f:
        json.dump(canvas, f, ensure_ascii=False, indent=2)
    print(f"written {sys.argv[2]}: {len(canvas['nodes'])} nodes ({len(page.get('nodes', []))} cards + {len([n for n in canvas['nodes'] if n['type'] == 'group'])} groups), {len(canvas['edges'])} edges")
