import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(join(root, name), 'utf8');

function luminance(hex) {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return (hi + 0.05) / (lo + 0.05);
}

function cssToken(css, name) {
  const match = css.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `missing --${name}`);
  return match[1].toUpperCase();
}

describe('explain design system sources', () => {
  it('builds deterministically', () => {
    const output = execFileSync(process.execPath, [join(root, 'build.mjs'), '--check'], { encoding: 'utf8' });
    assert.match(output, /explain build check: OK/);
  });

  it('declares explain v1 as pedagogical style with synchronized version', () => {
    const manifest = JSON.parse(read('manifest.json'));
    assert.equal(manifest.id, 'explain');
    assert.equal(manifest.version, '1.0.0');
    assert.equal(manifest.governance, 'explain');
    assert.match(read('explain.js'), new RegExp(`VERSION = '${manifest.version.replaceAll('.', '\\.')}';`));
    for (const capability of ['pedagogy', 'explanation', 'design-system', 'accessible', 'responsive', 'print']) {
      assert.ok(manifest.capabilities.includes(capability), `missing capability ${capability}`);
    }
  });

  it('keeps text palette accessible on paper background', () => {
    const css = read('explain.css');
    const paper = cssToken(css, 'bg');
    for (const token of ['txt', 'txt-dim', 'accent', 'brand', 'good', 'warn', 'bad', 'gold-text']) {
      const ratio = contrast(cssToken(css, token), paper);
      assert.ok(ratio >= 4.5, `${token} contrast ${ratio.toFixed(2)} is below AA on ${paper}`);
    }
  });

  it('strictly forbids <details> folding in explain shell and runtime rules', () => {
    const shell = read('shell.html');
    assert.doesNotMatch(shell, /<details\b/i, 'explain shell must not contain details');
    const js = read('explain.js');
    assert.match(js, /forbidden-details|details/i);
    assert.match(js, /root\.querySelectorAll\('details'\)/);
  });

  it('enforces safety, attribute allowlist and tree complexity limits in explain audit', async () => {
    const { build } = await import('file://' + join(process.env.HOME ?? '', '.pi', 'agent', 'npm', 'node_modules', 'esbuild', 'lib', 'main.js'));
    const { tmpdir } = await import('node:os');
    const { existsSync } = await import('node:fs');
    const out = join(tmpdir(), `test-audit-explain-${Date.now()}.mjs`);
    const serverAuditPath = [
      join(root, '../../extension/lib/talk/explain-audit.ts'),
      join(root, '../../../extensions/lib/talk/explain-audit.ts'),
      join(process.env.HOME ?? '', '.pi/agent/extensions/lib/talk/explain-audit.ts'),
    ].find((c) => existsSync(c));
    const parse5Path = join(process.env.HOME ?? '', '.pi', 'agent', 'npm', 'node_modules', 'parse5', 'dist', 'index.js');

    assert.ok(serverAuditPath && existsSync(serverAuditPath), 'explain-audit.ts must exist');
    await build({
      entryPoints: [serverAuditPath],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: out,
      absWorkingDir: dirname(serverAuditPath),
      plugins: [{
        name: 'resolve-parse5',
        setup(b) { b.onResolve({ filter: /parse5/ }, () => ({ path: parse5Path })); },
      }],
      logLevel: 'silent',
    });

    const { auditExplainContent } = await import('file://' + out);

    // 1. Details tag is strictly forbidden
    const withDetails = '<section class="explain-hero" id="hero"><h1>Title</h1></section><details><summary>test</summary><p>hide</p></details>';
    assert.ok(auditExplainContent(withDetails).errors.some((e) => e.code === 'forbidden-details'));

    // 2. Unsafe javascript: URL is blocked
    const withJsUrl = '<section class="explain-hero" id="hero"><h1>Title</h1></section><p><a href="javascript:alert(1)">click</a></p>';
    assert.ok(auditExplainContent(withJsUrl).errors.some((e) => e.code === 'unsafe-url'));

    // 3. Inline style attributes are forbidden
    const withStyle = '<section class="explain-hero" id="hero"><h1>Title</h1></section><p style="color:red">styled</p>';
    assert.ok(auditExplainContent(withStyle).errors.some((e) => e.code === 'forbidden-style'));

    // 4. Target _blank without rel="noopener" is blocked (including case-insensitive _BLANK)
    const withBlankTarget = '<section class="explain-hero" id="hero"><h1>Title</h1></section><p><a href="https://example.com" target="_blank">link</a></p>';
    assert.ok(auditExplainContent(withBlankTarget).errors.some((e) => e.code === 'unsafe-link-target'));
    const withCaseBlankTarget = '<section class="explain-hero" id="hero"><h1>Title</h1></section><p><a href="https://example.com" target="_BLANK">link</a></p>';
    assert.ok(auditExplainContent(withCaseBlankTarget).errors.some((e) => e.code === 'unsafe-link-target'));

    // 5. Invalid non-ASCII ID is blocked
    const withBadId = '<section class="explain-hero" id="hero"><h1>Title</h1></section><div id="bad id">text</div>';
    assert.ok(auditExplainContent(withBadId).errors.some((e) => e.code === 'invalid-id'));

    // 6. Analogy-card without analogy-text or with nested wrapper instead of direct children is blocked
    const incompleteAnalogy = '<section class="explain-hero" id="hero"><h1>Title</h1></section><div class="analogy-card"><div class="breakage-note">note</div></div>';
    assert.ok(auditExplainContent(incompleteAnalogy).errors.some((e) => e.code === 'analogy-anatomy'));
    const wrappedAnalogy = '<section class="explain-hero" id="hero"><h1>Title</h1></section><div class="analogy-card"><div class="analogy-text">a</div><div class="wrapper"><div class="breakage-note">b</div></div></div>';
    assert.ok(auditExplainContent(wrappedAnalogy).errors.some((e) => e.code === 'analogy-anatomy'), 'expected analogy-anatomy on nested wrapper');

    // 7. Deep nesting exceeds max depth
    let deep = '<span>deep</span>';
    for (let i = 0; i < 140; i += 1) deep = `<div>${deep}</div>`;
    const withDeep = `<section class="explain-hero" id="hero"><h1>Title</h1></section>${deep}`;
    assert.ok(auditExplainContent(withDeep).errors.some((e) => e.code === 'fragment-too-complex'));

    // 8. Valid explain template with aria-live audits with 0 errors
    const valid = `
      <section class="explain-hero" id="hero">
        <div class="tag-row"><span class="pill primary">初级</span></div>
        <h1>有效概念解释</h1>
        <p class="lead">第一直觉。</p>
      </section>
      <section id="layer-core" class="layer-block">
        <div class="layer-tag">01 · 核心</div>
        <h2>原理说明</h2>
        <div class="layer-body" aria-live="polite"><p>正文内容。</p></div>
      </section>
    `;
    const res = auditExplainContent(valid);
    assert.equal(res.errors.length, 0, `valid template errors: ${JSON.stringify(res.errors)}`);
  });
});
