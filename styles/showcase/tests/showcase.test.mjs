/**
 * Showcase pack test suite — `node --test tests/*.mjs` from the pack dir.
 * Verifies manifest contract, template integrity, builtin data completeness
 * and the interaction protocol (search / filter / events / keyboard).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(join(root, name), 'utf8');

describe('showcase pack', () => {
  it('declares a valid html-js manifest', () => {
    const manifest = JSON.parse(read('manifest.json'));
    assert.equal(manifest.id, 'showcase');
    assert.equal(manifest.kind, 'html-js');
    assert.equal(manifest.entry, 'index.html');
    assert.equal(typeof manifest.version, 'string');
    for (const capability of ['showcase', 'gallery', 'cards', 'filter', 'search', 'keyboard', 'responsive', 'events']) {
      assert.ok(manifest.capabilities.includes(capability), `missing capability ${capability}`);
    }
  });

  it('is a self-contained full document with the content slot and no external deps', () => {
    const html = read('index.html');
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /<html lang="zh-CN">/);
    assert.ok(html.includes('{{content}}'), 'missing {{content}} slot');
    assert.ok(html.includes('{{title}}'), 'missing {{title}} slot');
    // no template leftovers / engine collisons
    assert.ok(!/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(html.replace('{{content}}', '').replace('{{title}}', '')));
    // no external scripts / inline handlers / raw eval
    assert.ok(!/<script[^>]*\ssrc=/i.test(html), 'external script detected');
    assert.ok(!/\son\w+=/i.test(html), 'inline event handler detected');
    assert.ok(!/eval\s*\(/.test(html), 'eval() detected');
  });

  it('ships protocol-example builtin entries without demo references', () => {
    const html = read('index.html');
    const ids = [...html.matchAll(/\{id:"([a-zA-Z0-9_-]+)",icon:"([^"]+)",title:"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(ids.length >= 3, `expected >=3 builtin entries, got ${ids.length}`);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length, 'duplicate entry ids');
    // no leftover references to removed demo packs
    assert.ok(!/\/s\/demo-/.test(html), 'builtin must not reference /s/demo-*');
    assert.ok(!/demo-slides|demo-genui|demo-playground|demo-story/.test(html), 'builtin must not reference removed demo ids');
    // status vocabulary is closed
    for (const status of [...html.matchAll(/status:"([a-z]+)"/g)].map((m) => m[1])) {
      assert.ok(['new', 'ready', 'beta', 'dev'].includes(status), `unknown status ${status}`);
    }
  });

  it('implements the interaction protocol', () => {
    const html = read('index.html');
    // search + filter + open events sent to the bridge
    assert.match(html, /talkSend\("showcase:open"/);
    assert.match(html, /talkSend\("showcase:filter"/);
    assert.match(html, /talkSend\("showcase:search"/);
    // keyboard protocol: "/" focuses search, Escape clears
    assert.match(html, /e\.key==="\/"/);
    assert.match(html, /e\.key==="Escape"/);
    // same-tab navigation (no target=_blank): avoids SSE connection exhaustion
    assert.ok(!/target="_blank"/.test(html), 'cards must navigate in the same tab');
    // JSON content protocol accepted
    assert.match(html, /JSON\.parse\(raw\)/);
  });

  it('keeps stable ids and accessible affordances', () => {
    const html = read('index.html');
    const ids = [...html.matchAll(/\bid="([a-zA-Z0-9_-]+)"/g)].map((m) => m[1]);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, 'duplicate element ids');
    assert.ok(html.includes('aria-label="搜索条目"'), 'search input missing aria-label');
    assert.ok(html.includes(':focus-visible'), 'missing focus-visible styles');
    assert.ok(html.includes('@media print'), 'missing print styles');
    assert.ok(html.includes('@media(max-width:640px)'), 'missing mobile styles');
  });

  it('escapes item fields before injecting into cards', () => {
    const html = read('index.html');
    assert.ok(html.includes('replace(/&/g,"&amp;")'), 'ESC must escape &');
    assert.ok(html.includes('replace(/</g,"&lt;")'), 'ESC must escape <');
    assert.ok(html.includes('replace(/\"/g,"&quot;")'), 'ESC must escape quotes');
    assert.ok(html.includes('ESC(i.href'), 'href escaped on render');
  });
});
