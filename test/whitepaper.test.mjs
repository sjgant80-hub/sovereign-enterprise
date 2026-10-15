// whitepaper.test.mjs — the white paper's numbers are computed in the reader's browser by the kernels, so a kernel that
// renames a field leaves the paper printing NaN with every kernel test still green (it happened: §8 read fields the
// cloud kernel no longer returned). This runs the paper's own script against the real kernels and the real data files,
// with a stand-in document, and checks every section it fills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const html = readFileSync(new URL('whitepaper.html', ROOT), 'utf8');

async function render() {
  const [script] = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const code = script.replace(/from '\.\/([^']+)'/g, (_, p) => `from '${new URL(p, ROOT).href}'`);
  const els = new Map();
  const saved = { document: globalThis.document, fetch: globalThis.fetch };
  globalThis.document = { getElementById: (id) => els.get(id) || els.set(id, { id, innerHTML: '', textContent: '' }).get(id) };
  globalThis.fetch = async (u) => ({ json: async () => JSON.parse(readFileSync(new URL(String(u).split('?')[0], ROOT), 'utf8')) });
  const dir = mkdtempSync(join(tmpdir(), 'se-wp-'));
  try {
    const f = join(dir, 'paper.mjs');
    writeFileSync(f, code);
    await import(pathToFileURL(f).href + '?t=' + process.hrtime.bigint());
  } finally {
    rmSync(dir, { recursive: true, force: true });
    globalThis.document = saved.document; globalThis.fetch = saved.fetch;
  }
  return els;
}
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '\x22', '&#39;': '\x27' };
const text = (el) => (el.innerHTML || el.textContent).replace(/<[^>]*>/g, ' ').replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENT[m]);

test('the white paper fills every section from the kernels, and no number is missing', async () => {
  const els = await render();
  const want = ['stamp', 'hero', 'sharenote', 'vs', 'depts', 'roles', 'hw', 'cap', 'cost', 'notcounted', 'move', 'payback', 'sens',
    'breakeven', 'cloud', 'cloudnote', 'rival', 'rivalnote', 'brains', 'run', 'runscript', 'sources'];
  for (const id of want) {
    assert.ok(els.has(id), `the script never fills #${id}`);
    const t = text(els.get(id));
    assert.ok(t.trim().length > 0, `#${id} is empty`);
    assert.doesNotMatch(t, /\bNaN\b|\bundefined\b|\bnull\b|Infinity/, `#${id} prints a missing number: ${t.slice(0, 200)}`);
  }
  // every element the script writes exists on the page (a typo in an id would write into nothing)
  for (const id of els.keys()) assert.match(html, new RegExp(`id="${id}"`), `#${id} is written but not on the page`);
});

test('the white paper says what is assumed and what is measured, and the move is counted', async () => {
  const els = await render();
  const run = JSON.parse(readFileSync(new URL('receipts/company.json', ROOT), 'utf8')).summary;
  const measured = (run.automatedPermille / 10).toFixed(1) + '%';
  assert.match(text(els.get('hero')), /the model's assumption/);
  assert.ok(text(els.get('hero')).includes(measured) && text(els.get('sharenote')).includes(measured));
  assert.match(text(els.get('move')), /Statutory redundancy/);
  assert.match(text(els.get('payback')), /pays back in|does not pay back/);
  assert.match(text(els.get('sens')), /50% of the work[\s\S]*70% of the work[\s\S]*90% of the work/);
  assert.match(text(els.get('cloud')), /office hours only[\s\S]*always on[\s\S]*per token/);
  // the claims removed for want of proof stay removed
  assert.doesNotMatch(html, /blind test|signed off\s+by a lead/);
});
