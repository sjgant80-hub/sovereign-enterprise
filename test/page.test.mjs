// page.test.mjs — the live page's own script is gated too: it must parse, and every name it imports must exist in the
// module it imports from. (Kernel tests can't see a typo in index.html; this can.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);

test('the page has one module script, and it parses', () => {
  assert.equal(scripts.length, 1);
  const dir = mkdtempSync(join(tmpdir(), 'se-page-'));
  try {
    const f = join(dir, 'page.mjs');
    writeFileSync(f, scripts[0]);
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('every name the page imports is exported by that module', async () => {
  const imports = [...scripts[0].matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.\/[^']+)'/g)];
  assert.ok(imports.length >= 10, 'the page imports its kernels');
  for (const [, names, path] of imports) {
    const mod = await import(new URL('../' + path.slice(2), import.meta.url));
    for (const raw of names.split(',').map((x) => x.trim()).filter(Boolean)) {
      const name = raw.split(/\s+as\s+/)[0].trim();
      assert.ok(name in mod, `${path} does not export ${name}`);
    }
  }
});

test('every ui module the page imports also imports only names that exist', async () => {
  for (const f of ['ui/explainer.mjs', 'ui/brochure.mjs', 'ui/train.mjs', 'ui/wire.mjs', 'ui/plant.mjs']) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    for (const [, names, path] of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.\.\/[^']+)'/g)) {
      const mod = await import(new URL('../' + path.slice(3), import.meta.url));
      for (const raw of names.split(',').map((x) => x.trim()).filter(Boolean)) assert.ok(raw.split(/\s+as\s+/)[0].trim() in mod, `${f}: ${path} does not export ${raw}`);
    }
  }
});

test('no element id is defined in two places in the page (both branches of one ternary count once)', () => {
  const at = new Map();
  html.split('\n').forEach((line, n) => { for (const m of line.matchAll(/\sid="([^"$]+)"/g)) (at.get(m[1]) || at.set(m[1], new Set()).get(m[1])).add(n); });
  assert.deepEqual([...at].filter(([, lines]) => lines.size > 1).map(([id]) => id), []);
});
