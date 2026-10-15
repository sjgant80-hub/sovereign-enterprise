// ui/verify.mjs — the view over the auditor's checker (verify.html). The checking is src/audit.mjs (gated); this file
// adds three things around it: the verdict in plain words as HTML, a small sample company made in this browser so a
// stranger can try every verdict (genuine, grown, tampered, rewritten) without a file of their own, and "save this
// checker as one file" — the page with every kernel it runs inlined, so a saved copy works offline, from disk, and can
// never change after it was saved.
import { createNode, pull } from '../src/node.mjs';
import { fromSeed } from '../src/keys.mjs';
import { sha256Bytes } from '../src/sha256.mjs';
import { canonical } from '../src/canon.mjs';
import { leafHash, root } from '../src/vault.mjs';
import { encodeLines } from '../src/books.mjs';
import { vaultOf, checkpoint, proofBundle, consistencyBundle } from '../src/audit.mjs';

export const SITE = 'https://sjgant80-hub.github.io/sovereign-enterprise/';
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\x22': '&quot;', '\x27': '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>\x22\x27]/g, (c) => ESC[c]);
const ICON = { ok: '✓', warn: '!', bad: '✗' };

/** A verdict from audit.judge → HTML. Every word escaped. */
export function renderVerdict(v) {
  if (!v || typeof v !== 'object') return '';
  const tone = ['ok', 'warn', 'bad'].includes(v.tone) ? v.tone : 'bad';
  const lines = Array.isArray(v.lines) ? v.lines : [];
  return `<div class="verdict ${tone}" role="status"><h3><span class="vi" aria-hidden="true">${ICON[tone]}</span> ${esc(v.title)}</h3>
    <ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    ${v.keep ? '<div class="row"><button class="primary" data-act="keep">Save this checkpoint — check the next file against it</button></div>' : ''}</div>`;
}

// ── a sample company, made here: three devices, real keys, real signed writes, the same posting the Finance agent does ──
const seedOf = (s) => sha256Bytes('sovereign-enterprise/verify-sample/' + s);
async function sampleBooks(entries, rewriteAt = -1) {
  const K = { owner: await fromSeed(seedOf('owner')), finance: await fromSeed(seedOf('finance')), audit: await fromSeed(seedOf('audit')) };
  const G = K.owner.pub;
  const owner = createNode({ keys: K.owner, genesis: G, name: 'Owner' });
  const fin = createNode({ keys: K.finance, genesis: G, name: 'Finance agent' });
  const au = createNode({ keys: K.audit, genesis: G, name: 'Audit agent' });
  await owner.grant('agent-finance', K.finance.pub, 'agent', ['journal', 'vault', 'vault_head']);
  await owner.grant('agent-audit', K.audit.pub, 'agent', ['vault_cosig']);
  await pull(fin, owner); await pull(au, owner);
  const leaves = [];
  for (let i = 0; i < entries; i++) {
    const pence = 4200 + i * 1375;
    const memo = i === rewriteAt ? 'Refund to customer C' + (1000 + i) : 'Card sale to customer C' + (1000 + i);
    const id = 'j' + String(i + 1).padStart(6, '0');
    const body = { date: '2026-10-' + String(1 + (i % 28)).padStart(2, '0'), memo, lines: encodeLines(i === rewriteAt ? [['4000', pence, 0], ['1200', 0, pence]] : [['1200', pence, 0], ['4000', 0, pence]]) };
    await fin.put('journal', id, body);
    leaves.push(leafHash(canonical({ id, ...body })));
    await fin.put('vault', 'v' + String(i).padStart(6, '0'), { index: i, leaf: leaves[i], entry: id });
    await fin.put('vault_head', 'h' + String(i + 1).padStart(6, '0'), { size: i + 1, root: root(leaves) });
    if ((i + 1) % 10 === 0) { await pull(au, fin); await au.put('vault_cosig', 'c' + String(i + 1).padStart(6, '0'), { size: i + 1, root: root(leaves), by: 'Audit agent' }); }
  }
  await pull(owner, fin); await pull(owner, au);
  return { owner, keys: K.owner };
}
const AT = ['2026-10-01T09:00:00.000Z', '2026-10-14T09:00:00.000Z'];
const text = (o) => JSON.stringify(o, null, 1);

/**
 * Every sample the page offers, as the JSON text a company would send: a checkpoint (10 entries, co-signed), a proof of
 * entry #3, a checkpoint of 14 entries with the proof that the books only grew since the 10, the proof with one word of
 * its entry changed, and a second checkpoint of 10 entries where entry #3 was rewritten (signed by the same keys).
 */
export async function samples() {
  const a = await sampleBooks(10);
  const va = vaultOf(a.owner);
  const cpA = (await checkpoint(va, a.keys, { at: AT[0] })).bundle;
  const proof = proofBundle(va, 3, cpA).bundle;
  const tampered = { ...proof, entry: { ...proof.entry, memo: proof.entry.memo.replace('Card sale', 'Cash sale') } };
  const b = await sampleBooks(14);
  const vb = vaultOf(b.owner);
  const cpB = (await checkpoint(vb, b.keys, { at: AT[1] })).bundle;
  const grew = consistencyBundle(cpA, vb, cpB).bundle;
  const r = await sampleBooks(10, 3);
  const vr = vaultOf(r.owner);
  const cpR = (await checkpoint(vr, r.keys, { at: AT[1] })).bundle;
  return { checkpoint: text(cpA), proof: text(proof), grew: text(grew), tampered: text(tampered), rewritten: text(cpR) };
}

// ── save this checker as one file ───────────────────────────────────────────────────────────────────────────────────
const IMPORT = /^import\s*\{([^}]*)\}\s*from\s*\x27([^\x27]+)\x27;?/gm;
const EXPORT = /^export\s+(?:async\s+)?(?:function\*?\s+|const\s+|let\s+|class\s+)([A-Za-z_$][\w$]*)/gm;
/** A relative import, resolved against the file that makes it ('ui/verify.mjs' + '../src/x.mjs' → 'src/x.mjs'). */
export function resolvePath(from, spec) {
  const out = String(from).split('/').slice(0, -1);
  for (const part of String(spec).split('/')) {
    if (part === '..') out.pop();
    else if (part !== '.') out.push(part);
  }
  return out.join('/');
}
const destructure = (names, dep) => 'const {' + names.replace(/\s+as\s+/g, ': ') + '} = __m[' + JSON.stringify(dep) + '];';
function wrapModule(path, src) {
  const names = [...src.matchAll(EXPORT)].map((m) => m[1]);
  const body = src.replace(IMPORT, (_, n, spec) => destructure(n, resolvePath(path, spec))).replace(/^export\s+/gm, '');
  return '__m[' + JSON.stringify(path) + '] = (() => {\n' + body + '\nreturn { ' + names.join(', ') + ' };\n})();\n';
}

/**
 * The checker as one self-contained HTML file. html — verify.html's own source; load(path) → the source of a module.
 * Every module the page imports (and they import) is inlined in dependency order, each in its own scope; the page's
 * imports become reads of those scopes. Links back to the site become absolute. → the HTML text.
 */
export async function standalone(html, load) {
  const m = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('verify.html has no module script');
  const order = [], state = new Map();
  async function visit(path, src) {
    for (const im of src.matchAll(IMPORT)) {
      const dep = resolvePath(path, im[2]);
      if (state.get(dep) === 'done') continue;
      if (state.get(dep) === 'busy') throw new Error('an import cycle at ' + dep);
      state.set(dep, 'busy');
      const s = await load(dep);
      if (typeof s !== 'string') throw new Error('could not read ' + dep);
      await visit(dep, s);
      state.set(dep, 'done');
      order.push(wrapModule(dep, s));
    }
  }
  await visit('verify.html', m[1]);
  const page = m[1].replace(IMPORT, (_, n, spec) => destructure(n, resolvePath('verify.html', spec)));
  const script = '\nconst __m = Object.create(null);\nglobalThis.__STANDALONE = true;\n' + order.join('') + page;
  const abs = (s) => s.replace(/href=\x22(index\.html|whitepaper\.html)([^\x22]*)\x22/g, (_, f, rest) => 'href="' + SITE + f + rest + '"');
  return abs(html.slice(0, m.index)) + '<script type="module">' + script.replace(/<\/script/gi, '<\\/script') + '</script>' + abs(html.slice(m.index + m[0].length));
}
