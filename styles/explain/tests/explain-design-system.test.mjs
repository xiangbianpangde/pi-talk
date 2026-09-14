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
});
