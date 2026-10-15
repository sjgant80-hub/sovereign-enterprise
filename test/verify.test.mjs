// verify.test.mjs — the auditor's checker page is gated too: verify.html's module script parses and imports only names
// that exist; the sample company it makes gives every verdict it promises; and "save this checker as one file" inlines
// every kernel it runs — the saved copy parses, carries no import, and its inlined checker verifies a real checkpoint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { judge } from '../src/audit.mjs';
import { renderVerdict, samples, standalone, resolvePath, SITE } from '../ui/verify.mjs';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const html = read('verify.html');
const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const check = (code) => {
  const dir = mkdtempSync(join(tmpdir(), 'se-verify-'));
  try { const f = join(dir, 'page.mjs'); writeFileSync(f, code); return spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
};

test('verify.html: one module script; it parses; every name it imports exists', async () => {
  assert.equal(scripts.length, 1);
  const r = check(scripts[0]);
  assert.equal(r.status, 0, r.stderr);
  const imports = [...scripts[0].matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.\/[^']+)'/g)];
  assert.deepEqual(imports.map((m) => m[2]), ['./src/audit.mjs', './ui/verify.mjs']);
  for (const [, names, path] of imports) {
    const mod = await import(new URL(path.slice(2), ROOT));
    for (const n of names.split(',').map((x) => x.trim()).filter(Boolean)) assert.ok(n in mod, path + ' does not export ' + n);
  }
  const ui = read('ui/verify.mjs');
  for (const [, names, path] of ui.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.\.\/[^']+)'/g)) {
    const mod = await import(new URL(path.slice(3), ROOT));
    for (const n of names.split(',').map((x) => x.trim()).filter(Boolean)) assert.ok(n in mod, 'ui/verify.mjs: ' + path + ' does not export ' + n);
  }
});

test('verify.html explains itself: what it is, start here, how it works, what it rests on, for auditors, the blueprint, the paper', () => {
  for (const want of ['without trusting the company', 'Start here', 'How it works', 'What a verdict rests on', 'For auditors and banks', 'The blueprint', 'Why a transparency log, not a blockchain',
    'RFC 9162', 'Save this checker as one file', 'Try it on a sample company']) assert.ok(html.includes(want), want);
  assert.equal((html.match(/<svg /g) || []).length, 2);
  assert.equal((html.match(/role="img"/g) || []).length, 2);
  for (const id of new Set([...html.matchAll(/\sid="([^"$]+)"/g)].map((m) => m[1]))) assert.equal((html.match(new RegExp('\\sid="' + id + '"', 'g')) || []).length, 1, 'id ' + id + ' is defined once');
  for (const id of [...scripts[0].matchAll(/\$\('([a-z-]+)'\)/g)].map((m) => m[1])) assert.ok(html.includes('id="' + id + '"'), 'the script uses #' + id + ', which the page defines');
  for (const s of [...html.matchAll(/data-sample="([a-z]+)"/g)].map((m) => m[1])) assert.ok(['checkpoint', 'proof', 'grew', 'tampered', 'rewritten'].includes(s), s);
  // light and dark: every colour the page uses is a token defined in both
  const used = new Set([...html.matchAll(/var\(--([a-z0-9]+)\)/g)].map((m) => m[1]));
  const dark = /:root\{([^}]*)\}/.exec(html)[1], light = /:root\[data-theme="light"\]\{([^}]*)\}/.exec(html)[1];
  for (const v of used) assert.ok(dark.includes('--' + v + ':'), '--' + v + ' (dark)');
  for (const v of used) if (!['mono', 'sans'].includes(v)) assert.ok(light.includes('--' + v + ':'), '--' + v + ' (light)');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1"/);
  assert.doesNotMatch(html, /[$€]\d|\bprice|pricing/i);
});

test('renderVerdict: every word escaped; the save button only when there is a proven checkpoint to keep', () => {
  const v = renderVerdict({ tone: 'ok', title: '<b>t</b>', lines: ['a & b', '<script>'], keep: { size: 1 } });
  assert.ok(v.includes('&lt;b&gt;t&lt;/b&gt;') && v.includes('a &amp; b') && v.includes('&lt;script&gt;'));
  assert.ok(v.includes('data-act="keep"') && v.includes('class="verdict ok"'));
  assert.ok(!renderVerdict({ tone: 'bad', title: 'x', lines: [] }).includes('data-act="keep"'));
  assert.ok(renderVerdict({ tone: 'odd', title: 'x' }).includes('class="verdict bad"'));
  for (const junk of [null, undefined, 'x', 7]) assert.equal(renderVerdict(junk), '');
});

const S = await samples();
test('the sample company gives every verdict the page promises', async () => {
  assert.deepEqual(Object.keys(S).sort(), ['checkpoint', 'grew', 'proof', 'rewritten', 'tampered']);
  const v = async (s, h) => { const r = await judge(S[s], h ? S[h] : undefined); return [r.tone, r.title]; };
  assert.deepEqual(await v('checkpoint'), ['ok', 'A genuine signed checkpoint']);
  assert.deepEqual(await v('proof', 'checkpoint'), ['ok', 'This entry is in the books']);
  assert.deepEqual(await v('grew', 'checkpoint'), ['ok', 'The books only grew since 2026-10-01 09:00 UTC']);
  assert.deepEqual(await v('tampered', 'checkpoint'), ['bad', 'This entry is not proven']);
  assert.deepEqual(await v('rewritten', 'checkpoint'), ['bad', 'Two different signed versions of the books']);
  const cp = JSON.parse(S.checkpoint);
  assert.deepEqual([cp.size, cp.cosigs.length], [10, 1]);
  assert.deepEqual(await samples(), S, 'the samples are byte-reproducible: seeded keys, deterministic Ed25519');
});

test('save this checker as one file: every kernel inlined, no imports left, links absolute — and the inlined checker works', async () => {
  const one = await standalone(html, async (p) => read(p));
  const s = [...one.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(s.length, 1);
  assert.doesNotMatch(s[0], /^import /m);
  assert.doesNotMatch(s[0], /^export /m);
  for (const m of ['src/audit.mjs', 'src/vault.mjs', 'src/keys.mjs', 'src/canon.mjs', 'src/gate.mjs', 'src/sha256.mjs', 'src/books.mjs', 'src/brain.mjs', 'src/node.mjs', 'src/crdt.mjs', 'ui/verify.mjs']) {
    assert.equal((s[0].match(new RegExp('__m\\["' + m.replace('.', '\\.') + '"\\] = ', 'g')) || []).length, 1, m + ' inlined once');
  }
  assert.ok(s[0].includes('globalThis.__STANDALONE = true;'));
  const r = check(s[0]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(one.includes('href="' + SITE + 'index.html"') && !/href="index\.html"/.test(one));
  // the modules alone, run from the saved file's own text, verify a real checkpoint
  const cut = s[0].indexOf('const { judge } = __m["src/audit.mjs"];');
  assert.ok(cut > 0);
  const dir = mkdtempSync(join(tmpdir(), 'se-standalone-'));
  try {
    const f = join(dir, 'mods.mjs');
    writeFileSync(f, s[0].slice(0, cut) + '\nexport default __m;\n');
    const mods = (await import(pathToFileURL(f).href)).default;
    const v = await mods['src/audit.mjs'].judge(S.proof, S.checkpoint);
    assert.deepEqual([v.tone, v.title], ['ok', 'This entry is in the books']);
    assert.equal((await mods['src/audit.mjs'].judge(S.tampered, S.checkpoint)).tone, 'bad');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  await assert.rejects(standalone('<p>no script</p>', async () => ''), /no module script/);
  await assert.rejects(standalone(html, async () => null), /could not read/);
  await assert.rejects(standalone("<script type=\"module\">import { a } from './x.mjs';</script>", async (p) => (p === 'x.mjs' ? "import { b } from './x.mjs';" : '')), /import cycle/);
});

test('resolvePath: relative imports resolve against the file that makes them', () => {
  assert.equal(resolvePath('verify.html', './src/audit.mjs'), 'src/audit.mjs');
  assert.equal(resolvePath('ui/verify.mjs', '../src/node.mjs'), 'src/node.mjs');
  assert.equal(resolvePath('src/audit.mjs', './vault.mjs'), 'src/vault.mjs');
  assert.equal(resolvePath('src/train.mjs', '../vendor/csv-forge/csv.mjs'), 'vendor/csv-forge/csv.mjs');
});
