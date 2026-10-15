// tools/csp.mjs — the Content-Security-Policy every page carries, pinned to the exact scripts on it.
//
//   node tools/csp.mjs           → writes the policy into index.html, whitepaper.html and verify.html
//   node tools/csp.mjs --check   → refuses unless every page's policy matches its scripts now (test/csp.test.mjs runs this)
//
// What it stops: a script that is not one of the page's own cannot run — an injected <script>, an inline handler, a
// javascript: link, a script from anywhere but this site and the one CDN the in-browser model is fetched from. The page's
// own inline scripts are allowed by their SHA-256, so any edit to them must be followed by this tool (the check fails
// until it is). What it leaves open, on purpose: connect-src, because the model tier calls a server at whatever address
// its owner chooses (Ollama on this machine, a box on the office network, a provider) and WebLLM fetches model files;
// style-src 'unsafe-inline', because the views set styles inline (a style cannot run code). A <meta> policy cannot set
// frame-ancestors: a company serving this from its own hub sets that as a header.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const PAGES = Object.freeze(['index.html', 'whitepaper.html', 'verify.html']);
const SCRIPT = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
const META = /<meta http-equiv="Content-Security-Policy" content="[^"]*" \/>\n/;

/** The SHA-256 (base64) of each inline script on a page, in order. */
export function scriptHashes(html) {
  return [...String(html).matchAll(SCRIPT)].filter((m) => m[1].length).map((m) => createHash('sha256').update(m[1], 'utf8').digest('base64'));
}

/** The policy for a page whose inline scripts hash to `hashes`. */
export function policy(hashes) {
  return [
    "default-src 'self'",
    "script-src 'self' " + hashes.map((h) => "'sha256-" + h + "'").join(' ') + " https://cdn.jsdelivr.net 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    'connect-src * data: blob:',
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}

/** The meta tag for a page as it stands; with it, the page's own scripts run and no other script can. */
export const metaFor = (html) => '<meta http-equiv="Content-Security-Policy" content="' + policy(scriptHashes(html)) + '" />\n';

/** The page with its policy written in (replacing any older one), right after <meta charset>. */
export function withPolicy(html) {
  const bare = String(html).replace(META, '');
  const at = bare.indexOf('<meta charset="utf-8" />\n');
  if (at < 0) throw new Error('no <meta charset="utf-8" /> line to put the policy after');
  const cut = at + '<meta charset="utf-8" />\n'.length;
  return bare.slice(0, cut) + metaFor(bare) + bare.slice(cut);
}

/** Does this page's policy pin exactly the scripts it carries? */
export const current = (html) => withPolicy(html) === String(html);

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/csp.mjs')) {
  const ROOT = new URL('../', import.meta.url);
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const p of PAGES) {
    const html = readFileSync(new URL(p, ROOT), 'utf8');
    if (current(html)) { console.log('✓ ' + p); continue; }
    if (check) { console.log('✗ ' + p + ' — its policy does not pin the scripts it carries: run node tools/csp.mjs'); stale++; continue; }
    writeFileSync(new URL(p, ROOT), withPolicy(html));
    console.log('wrote ' + p + ' · ' + scriptHashes(html).length + ' script(s) pinned');
  }
  process.exit(stale ? 1 : 0);
}
