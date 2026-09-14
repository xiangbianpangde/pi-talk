#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const paths = {
  shell: join(root, 'shell.html'),
  manifest: join(root, 'manifest.json'),
  css: join(root, 'explain.css'),
  js: join(root, 'explain.js'),
  index: join(root, 'index.html'),
};

function read(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trimEnd();
}

const version = JSON.parse(read(paths.manifest)).version;

function compileTemplate() {
  const shell = read(paths.shell);
  const css = read(paths.css);
  const js = read(paths.js);
  if (!js.includes(`VERSION = '${version}';`)) {
    throw new Error(`explain.js version does not match manifest ${version}`);
  }
  if (!shell.includes('/*__EXPLAIN_CSS__*/') || !shell.includes('/*__EXPLAIN_JS__*/')) {
    throw new Error('shell.html is missing a build marker');
  }
  return shell
    .replace('/*__EXPLAIN_CSS__*/', css)
    .replace('/*__EXPLAIN_JS__*/', js) + '\n';
}

const index = compileTemplate();
const check = process.argv.includes('--check');

if (check) {
  if (read(paths.index) + '\n' !== index) {
    console.error('Generated index.html is stale. Run node build.mjs.');
    process.exit(1);
  }
  console.log('explain build check: OK');
} else {
  writeFileSync(paths.index, index);
  console.log(`built ${paths.index}`);
}
