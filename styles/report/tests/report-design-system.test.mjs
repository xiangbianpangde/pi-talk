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

describe('report design system sources', () => {
  it('builds deterministically', () => {
    const output = execFileSync(process.execPath, [join(root, 'build.mjs'), '--check'], { encoding: 'utf8' });
    assert.match(output, /build check: OK/);
  });

  it('declares report v3.1 as the formal default with synchronized versions', () => {
    const manifest = JSON.parse(read('manifest.json'));
    assert.equal(manifest.id, 'report');
    assert.equal(manifest.default, true);
    assert.equal(manifest.version, '3.1.0');
    assert.match(read('report.js'), new RegExp(`VERSION = '${manifest.version.replaceAll('.', '\\.')}';`));
    const serverAudit = readFileSync(join(root, '../../../extensions/lib/talk/report-audit.ts'), 'utf8');
    assert.match(serverAudit, new RegExp(`REPORT_DESIGN_SYSTEM_VERSION = "${manifest.version.replaceAll('.', '\\.')}"`));
    const agentPackage = JSON.parse(readFileSync(join(root, '../../../npm/package.json'), 'utf8'));
    assert.equal(agentPackage.dependencies.parse5, '8.0.0');
    for (const capability of ['formal-report', 'design-system', 'accessible', 'responsive', 'print']) {
      assert.ok(manifest.capabilities.includes(capability), `missing capability ${capability}`);
    }
  });

  it('keeps the reference palette accessible for normal text', () => {
    const css = read('report.css');
    const paper = cssToken(css, 'bg');
    for (const token of ['txt', 'txt-dim', 'txt-faint', 'brand', 'accent', 'good', 'warn', 'bad']) {
      const ratio = contrast(cssToken(css, token), paper);
      assert.ok(ratio >= 4.5, `${token} contrast ${ratio.toFixed(2)} is below AA`);
    }
  });

  it('scopes shell identity and preserves semantic card modifiers', () => {
    const css = read('report.css');
    assert.match(css, /\.report-brand\{/);
    assert.doesNotMatch(css, /(^|\})\s*\.brand\s*\{/m);
    assert.match(css, /\.card\.brand\{/);
    assert.match(css, /\.card\{display:block/);
  });

  it('contains accessibility, responsive, reduced-motion and print contracts', () => {
    const css = read('report.css');
    const js = read('report.js');
    assert.match(css, /:focus-visible/);
    assert.match(css, /prefers-reduced-motion/);
    assert.match(css, /@media print/);
    assert.match(css, /max-width:560px/);
    assert.match(js, /role', 'tablist/);
    assert.match(js, /aria-selected/);
    assert.match(js, /ReportDesignSystem/);
    assert.match(js, /securityLevel: 'strict'/);
    assert.match(js, /window\.mermaid\.render/);
    assert.match(js, /report-style-nonce/);
    assert.match(js, /beforeprint/);
    assert.match(css, /\.tab-pane\[hidden\].*display:block!important/);
  });

  it('keeps the author fixture free of active content and layout soup', () => {
    const fixture = read('fixtures/production-report.content.html');
    assert.doesNotMatch(fixture, /<(script|style|iframe|object|embed|form|base|meta|link)\b/i);
    assert.doesNotMatch(fixture, /\son[a-z]+\s*=/i);
    for (const match of fixture.matchAll(/style=(['"])(.*?)\1/gis)) {
      const declarations = match[2].split(';').map((part) => part.trim()).filter(Boolean);
      assert.ok(declarations.every((part) => /^--[a-z0-9_-]+\s*:/i.test(part)), `non-token inline style: ${match[2]}`);
    }
    assert.match(fixture, /class="hero"/);
    assert.match(fixture, /class="verdict"/);
    assert.match(fixture, /<caption>/);
  });

  it('generates a complete self-auditing runtime document', () => {
    const index = read('index.html');
    assert.doesNotMatch(index, /__REPORT_(CSS|JS)__/);
    assert.match(index, /data-report-design-system="journal"/);
    assert.match(index, /mermaid@11\.16\.1/);
    assert.match(index, /data-sri="sha384-/);
    assert.match(index, /data-report-mermaid-loader/);
    assert.match(index, /id="report-runtime"/);
    assert.match(index, /id="report-content-root"/);
    assert.match(index, /data-report-ds-version/);
    assert.equal((index.match(/\{\{content\}\}/g) || []).length, 1);
  });
});
