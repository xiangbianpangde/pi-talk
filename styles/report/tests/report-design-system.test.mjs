import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

  it('declares report v3 as the formal default with synchronized versions', () => {
    const manifest = JSON.parse(read('manifest.json'));
    assert.equal(manifest.id, 'report');
    assert.equal(manifest.default, true);
    assert.equal(manifest.version, '3.2.0');
    assert.match(read('report.js'), new RegExp(`VERSION = '${manifest.version.replaceAll('.', '\\.')}';`));
    const serverAuditPath = [
      join(root, '../../extension/lib/talk/report-audit.ts'),
      join(root, '../../../extensions/lib/talk/report-audit.ts'),
      join(process.env.HOME ?? '', '.pi/agent/extensions/lib/talk/report-audit.ts'),
    ].find((candidate) => existsSync(candidate));
    assert.ok(serverAuditPath, 'could not find report-audit.ts');
    const serverAudit = readFileSync(serverAuditPath, 'utf8');
    assert.match(serverAudit, new RegExp(`REPORT_DESIGN_SYSTEM_VERSION = "${manifest.version.replaceAll('.', '\\.')}"`));
    const agentPackagePath = [
      join(root, '../../../npm/package.json'),
      join(process.env.HOME ?? '', '.pi/agent/npm/package.json'),
    ].find((candidate) => existsSync(candidate));
    assert.ok(agentPackagePath, 'could not find npm/package.json');
    const agentPackage = JSON.parse(readFileSync(agentPackagePath, 'utf8'));
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
    // Verify scientific component colors against actual composite backgrounds
    const goldText = cssToken(css, 'gold-text');
    const statBg = '#FAF3E5';
    const statRatio = contrast(goldText, statBg);
    assert.ok(statRatio >= 4.5, `.sample-pill.stat contrast ${statRatio.toFixed(2)} is below AA on ${statBg}`);
    const signifRatio = contrast(goldText, '#FFFFFF');
    assert.ok(signifRatio >= 4.5, `.signif contrast ${signifRatio.toFixed(2)} is below AA on white`);
  });

  it('scopes shell identity and preserves semantic card modifiers', () => {
    const css = read('report.css');
    assert.match(css, /\.report-brand\{/);
    assert.doesNotMatch(css, /(^|\})\s*\.brand\s*\{/m);
    assert.match(css, /\.card\.brand\{/);
    assert.match(css, /\.card\{display:block/);
    assert.match(css, /\.card\.discovery\{/);
    assert.match(css, /\.hypothesis\{/);
    assert.match(css, /\.boundary-box\{/);
    assert.match(css, /\.formula-wrap\{/);
    assert.match(css, /\.sample-pill\{/);
    assert.match(css, /\.ablation-table/);
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

  it('keeps COOKBOOK.md templates valid, comment-free and audit-clean', async () => {
    const cookbook = read('COOKBOOK.md');
    // Ensure all markdown code fences are properly balanced
    const fenceCount = (cookbook.match(/^```/gm) || []).length;
    assert.equal(fenceCount % 2, 0, `COOKBOOK.md has unbalanced code fences (${fenceCount})`);

    // Ensure all html code blocks are free of HTML comments (which fail report-audit)
    const htmlBlocks = [...cookbook.matchAll(/```html\n([\s\S]*?)\n```/g)].map((m) => m[1]);
    assert.ok(htmlBlocks.length >= 2, 'expected at least 2 html template blocks in COOKBOOK.md');
    for (const block of htmlBlocks) {
      assert.doesNotMatch(block, /<!--[\s\S]*?-->/, 'COOKBOOK.md template contains HTML comment which is blocked by audit');
      assert.doesNotMatch(block, /<(script|style|iframe|object|embed|form|base|meta|link)\b/i);
    }

    // Audit full report skeletons against server audit gate
    const esbuildPath = join(process.env.HOME ?? '', '.pi', 'agent', 'npm', 'node_modules', 'esbuild', 'lib', 'main.js');
    const serverAuditPath = [
      join(root, '../../extension/lib/talk/report-audit.ts'),
      join(root, '../../../extensions/lib/talk/report-audit.ts'),
      join(process.env.HOME ?? '', '.pi/agent/extensions/lib/talk/report-audit.ts'),
    ].find((candidate) => existsSync(candidate));

    assert.ok(existsSync(esbuildPath), `esbuild required for template audit test at ${esbuildPath}`);
    assert.ok(serverAuditPath && existsSync(serverAuditPath), `report-audit.ts required for template audit test`);

    const { build } = await import('file://' + esbuildPath);
    const { tmpdir } = await import('node:os');
    const out = join(tmpdir(), `audit-test-${Date.now()}.mjs`);
    const parse5Path = join(process.env.HOME ?? '', '.pi', 'agent', 'npm', 'node_modules', 'parse5', 'dist', 'index.js');
    await build({
      entryPoints: [serverAuditPath],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: out,
      absWorkingDir: dirname(serverAuditPath),
      plugins: [{
        name: 'resolve-parse5',
        setup(b) {
          b.onResolve({ filter: /parse5/ }, () => ({ path: parse5Path }));
        },
      }],
      logLevel: 'silent',
    });
    const { auditReportContent } = await import('file://' + out);

    // Audit every HTML template block in COOKBOOK (both full skeletons and partial components)
    for (const block of htmlBlocks) {
      const isFull = block.includes('id="hero"') && block.includes('class="verdict"');
      const audit = auditReportContent(block, { requireStructure: isFull });
      assert.equal(audit.errors.length, 0, `template audit errors in block:\n${block}\nerrors: ${JSON.stringify(audit.errors)}`);
      assert.equal(audit.warnings.length, 0, `template audit warnings in block:\n${block}\nwarnings: ${JSON.stringify(audit.warnings)}`);
    }
  });

  it('fails audit on incomplete scientific component anatomy (negative tests)', async () => {
    const esbuildPath = join(process.env.HOME ?? '', '.pi', 'agent', 'npm', 'node_modules', 'esbuild', 'lib', 'main.js');
    const serverAuditPath = [
      join(root, '../../extension/lib/talk/report-audit.ts'),
      join(root, '../../../extensions/lib/talk/report-audit.ts'),
      join(process.env.HOME ?? '', '.pi/agent/extensions/lib/talk/report-audit.ts'),
    ].find((candidate) => existsSync(candidate));
    const parse5Path = join(process.env.HOME ?? '', '.pi', 'agent', 'npm', 'node_modules', 'parse5', 'dist', 'index.js');

    const { build } = await import('file://' + esbuildPath);
    const { tmpdir } = await import('node:os');
    const out = join(tmpdir(), `negative-audit-test-${Date.now()}.mjs`);
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
    const { auditReportContent } = await import('file://' + out);

    // 1. Missing main blocks
    const missingHypo = '<article class="hypothesis"><p>incomplete</p></article>';
    const missingFormula = '<div class="formula-wrap"><div class="formula-math">x = 1</div></div>';
    const missingBoundary = '<div class="boundary-box"><div class="boundary-head"><h4>Title</h4></div></div>';
    const missingDisc = '<article class="card discovery"><h3>Title</h3></article>';

    assert.ok(auditReportContent(missingHypo, { requireStructure: false }).errors.some((e) => e.code === 'hypothesis-anatomy'));
    assert.ok(auditReportContent(missingFormula, { requireStructure: false }).errors.some((e) => e.code === 'formula-anatomy'));
    assert.ok(auditReportContent(missingBoundary, { requireStructure: false }).errors.some((e) => e.code === 'boundary-anatomy'));
    assert.ok(auditReportContent(missingDisc, { requireStructure: false }).errors.some((e) => e.code === 'discovery-anatomy'));

    // 2. Hollow subblocks & structural relationship errors
    // Hypothesis with empty hypo-body (no hypo-row)
    const hollowHypo = '<article class="hypothesis"><div class="hypo-tag">[H]</div><h3>Title</h3><div class="hypo-body">empty</div></article>';
    assert.ok(auditReportContent(hollowHypo, { requireStructure: false }).errors.some((e) => e.code === 'hypothesis-anatomy'));

    // Formula with empty formula-vars (no var-item)
    const hollowFormula = '<div class="formula-wrap"><div class="formula-math">x = 1</div><div class="formula-vars"></div></div>';
    assert.ok(auditReportContent(hollowFormula, { requireStructure: false }).errors.some((e) => e.code === 'formula-anatomy'));

    // Boundary box with orphan boundary-item (missing .grid)
    const orphanBoundary = '<div class="boundary-box"><div class="boundary-head"><h4>Title</h4></div><div class="boundary-item">orphan</div></div>';
    assert.ok(auditReportContent(orphanBoundary, { requireStructure: false }).errors.some((e) => e.code === 'boundary-anatomy'));

    // Discovery card with badge + heading + vs-compact but missing p or missing v-col
    const hollowDisc = '<article class="card discovery"><div class="disc-badge">FINDING</div><h3>Title</h3><div class="vs-compact">no columns</div></article>';
    assert.ok(auditReportContent(hollowDisc, { requireStructure: false }).errors.some((e) => e.code === 'discovery-anatomy'));
  });
});
