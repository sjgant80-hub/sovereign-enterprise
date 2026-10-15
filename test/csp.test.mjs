// Every page carries a Content-Security-Policy that pins exactly the scripts on it (tools/csp.mjs): no script that is not
// one of the page's own can run. An edit to a page's script without re-running the tool fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PAGES, scriptHashes, policy, withPolicy, current } from '../tools/csp.mjs';
import { standalone } from '../ui/verify.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const cspOf = (html) => (/<meta http-equiv="Content-Security-Policy" content="([^"]*)" \/>/.exec(html) || [])[1] || '';
const directive = (csp, name) => (csp.split('; ').find((d) => d.startsWith(name + ' ')) || '').slice(name.length + 1).split(' ');

test('every page pins exactly its own inline scripts, and nothing else may run', () => {
  for (const p of PAGES) {
    const html = read(p), csp = cspOf(html);
    assert.ok(csp, p + ' carries a policy');
    assert.equal(current(html), true, p + ': run node tools/csp.mjs after changing its scripts');
    const scripts = directive(csp, 'script-src');
    const pinned = scripts.filter((s) => s.startsWith("'sha256-")).map((s) => s.slice(8, -1));
    assert.deepEqual(pinned, scriptHashes(html), p);
    assert.ok(pinned.length >= 1, p);
    // the scripts it pins are the page's own, byte for byte
    const own = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => createHash('sha256').update(m[1]).digest('base64'));
    assert.deepEqual(pinned, own, p);
    for (const bad of ["'unsafe-inline'", "'unsafe-eval'", '*', 'data:', 'http:', 'https:']) assert.ok(!scripts.includes(bad), p + ' script-src has no ' + bad);
    assert.deepEqual(directive(csp, 'object-src'), ["'none'"], p);
    assert.deepEqual(directive(csp, 'base-uri'), ["'self'"], p);
    assert.deepEqual(directive(csp, 'form-action'), ["'none'"], p);
    assert.deepEqual(directive(csp, 'default-src'), ["'self'"], p);
    assert.equal(html.indexOf('<meta http-equiv="Content-Security-Policy"'), html.indexOf('<meta charset="utf-8" />') + '<meta charset="utf-8" />\n'.length, p + ': first in <head>, after the charset');
    // no inline event handler or javascript: link anywhere — the policy would refuse them
    assert.doesNotMatch(html, /\son(click|load|error|change|input|submit|mouseover)\s*=/i, p);
    assert.doesNotMatch(html, /href="javascript:/i, p);
  }
});

test('the tool: one policy per page, put back where it belongs, refused as stale the moment a script changes', () => {
  const page = '<!doctype html>\n<html><head>\n<meta charset="utf-8" />\n<title>t</title></head><body><script>a()</script><script type="module">b()</script></body></html>\n';
  const once = withPolicy(page);
  assert.equal(withPolicy(once), once, 'running it again changes nothing');
  assert.equal(current(once), true);
  assert.equal(current(page), false, 'no policy yet');
  assert.equal(once.match(/Content-Security-Policy/g).length, 1);
  const h = (s) => createHash('sha256').update(s).digest('base64');
  assert.deepEqual(scriptHashes(once), [h('a()'), h('b()')]);
  assert.equal(cspOf(once), policy([h('a()'), h('b()')]));
  assert.equal(current(once.replace('a()', 'a(1)')), false, 'a changed script is no longer pinned');
  assert.equal(current(withPolicy(once.replace('a()', 'a(1)'))), true);
  assert.deepEqual(scriptHashes('<script src="x.js"></script>'), [], 'a script by URL has no inline text to pin');
  assert.throws(() => withPolicy('<html><head></head></html>'), /no <meta charset/);
});

test('the checker saved as one file pins its one combined script — it runs offline under its own policy', async () => {
  const html = read('verify.html');
  const one = await standalone(html, async (p) => read(p));
  const scripts = [...one.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 1);
  const pinned = directive(cspOf(one), 'script-src').filter((s) => s.startsWith("'sha256-")).map((s) => s.slice(8, -1));
  assert.deepEqual(pinned, [createHash('sha256').update(scripts[0]).digest('base64')]);
  assert.equal(current(one), true);
  // everything else about the policy is the page's own
  assert.equal(cspOf(one).replace(/'sha256-[^']+' /g, ''), cspOf(html).replace(/'sha256-[^']+' /g, ''));
});
