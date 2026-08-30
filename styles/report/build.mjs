#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const paths = {
  shell: join(root, 'shell.html'),
  manifest: join(root, 'manifest.json'),
  css: join(root, 'report.css'),
  js: join(root, 'report.js'),
  index: join(root, 'index.html'),
  fixtureBody: join(root, 'fixtures', 'production-report.content.html'),
  fixture: join(root, 'fixtures', 'production-report.html'),
};

function read(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trimEnd();
}

const version = JSON.parse(read(paths.manifest)).version;

function compileTemplate() {
  const shell = read(paths.shell);
  const css = read(paths.css);
  const js = read(paths.js);
  if (!js.includes(`VERSION = '${version}';`)) throw new Error(`report.js version does not match manifest ${version}`);
  if (!shell.includes('/*__REPORT_CSS__*/') || !shell.includes('/*__REPORT_JS__*/')) {
    throw new Error('shell.html is missing a build marker');
  }
  return shell
    .replace('/*__REPORT_CSS__*/', css)
    .replace('/*__REPORT_JS__*/', js) + '\n';
}

function applyVars(template, vars) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => vars[key] ?? '');
}

function compileFixture(index) {
  const content = read(paths.fixtureBody);
  return applyVars(index, {
    title: '汇报设计系统 · 上线候选验证',
    mark: '报',
    brand: 'Talk Report',
    subtitle: 'JOURNAL REPORT DESIGN SYSTEM',
    meta: `v${version} · release candidate<br>自动导航 · 响应式 · 可打印`,
    nav: '',
    footer: `Talk Report Design System v${version} · 本页由 fixtures/production-report.content.html 生成`,
    content,
  });
}

const index = compileTemplate();
const fixture = compileFixture(index);
const check = process.argv.includes('--check');

if (check) {
  const mismatches = [];
  if (read(paths.index) + '\n' !== index) mismatches.push('index.html');
  if (read(paths.fixture) + '\n' !== fixture) mismatches.push('fixtures/production-report.html');
  if (mismatches.length) {
    console.error(`Generated files are stale: ${mismatches.join(', ')}. Run node build.mjs.`);
    process.exit(1);
  }
  console.log('report build check: OK');
} else {
  writeFileSync(paths.index, index);
  writeFileSync(paths.fixture, fixture);
  console.log(`built ${paths.index}`);
  console.log(`built ${paths.fixture}`);
}
