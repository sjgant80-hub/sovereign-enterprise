#!/usr/bin/env node
// witness-all.mjs — the mutation + fuzz gate over the decision kernels of the spine.
//   crdt.mjs  — the materialiser: dedupe, the role tree, the joins, the views (what the company IS)
//   gate.mjs  — verify-before-parse (what may enter)
//   canon.mjs — the one canonical byte form (what a signature covers)
//   vault.mjs — the transparency log (what can be proven to an outsider)
//   books.mjs — double-entry (what the money says)
//   lease.mjs — data leases + crypto-shredding (what a leaver / an erasure leaves behind)
//   office.mjs — the AI-native office cost + capacity kernel (every number the white paper shows)
//   brain.mjs  — every node a brain: route → gate → verified answer or ABSTAIN; adopt-only-if-it-re-verifies-here
//   agent.mjs  — what an agent does with an answer: screen, own, mesh, second-brain cross-check, watch list
//   screen.mjs — inbound text screen (invisible Unicode, bidi, tag smuggling, prompt injection)
//   grow.mjs   — a node grows its own brain on its own data, graded on held-out rows it never grew on
//   train.mjs  — teach the company your own work: a CSV → a verified brain grown on the device
//   mesh.mjs   — how the brains talk: ask / reply / second opinion as signed records, never shared memory
//   market.mjs — the board case: owned compute vs dedicated cloud GPU vs per-token; how far an AI-native rival can undercut
//   company.mjs — the AI company: the door, each agent's step, what decisions write, learning, regrowth, the board
//   explain.mjs — the page that explains itself: six diagrams, any decision traced, the blueprint, the adoption guide
//   adopt.mjs  — fit it to your business: your headcount through the white paper's own model
//   rtc.mjs    — cross-machine sync: the copy-paste code, the DTLS-bound proof of key, the have/want/env session and
//                its bounds, and the WebRTC glue (run against an in-memory RTCPeerConnection, so nothing is excluded)
//   antibody.mjs — a confirmed attack → a signed antibody each device adopts only if it fires on none of its own benign messages
//   watch.mjs  — the behaviour watch over the agents (BES): off its work, entropy collapse, drift on the same work, auto-pause
//   model.mjs  — the model tier: adapters (timeouts, request shapes), strict parsers, worst-case budget, the audit record
//   plant.mjs  — the differentiation layer: a business's files classified, its brains grown, its old decisions re-grown and checked, the plan sealed
//   store.mjs  — the device's secrets at rest: the non-extractable key in IndexedDB, the sealed log and its retention rule, the
//                one-time migration off the plaintext copies (run against an in-memory IndexedDB with real WebCrypto)
//   recovery.mjs — owner recovery cards: Shamir over GF(256), the checksummed card, every refusal
//   shell.mjs  — node-shell + wiring: the one agent step (the demo runs it too), one real device running one agent, the tech
//                person’s checklist and the owner-signed wiring receipt
//   receipt.mjs — the per-planting receipt: before and after on the business's own held-out rows, the office comparison, the live results — signed, re-derivable, reproducible
//   audit.mjs  — what an outsider can check: signed checkpoints, entry proofs, proofs the books only grew, signed brain files
//   exportco.mjs — export (the records, never a key; lockable under a passphrase) and restore through the gate; the spreadsheets
//   bridge.mjs — the bridges: bank statements, customer lists and trial balances in (read, checked, reconciled); the books out to Sage
//   sow.mjs    — a plan carried into a company: published by the owner's or an admin's device; each agent device reads who really
//                signed a planted brain, refuses one its signer may not plant before reading it, and re-checks the rest on its own rows
//   evidence.mjs — what the numbers prove: confusion matrices, intervals, the test against doing nothing, the second brain's worth, decisions re-run from the record
//   oversight.mjs — the people's side: one list of what waits for a person, choices that count only from a person's key, the rules a person sets
// keys/sha256/node/sim are value-tested (NIST vectors, real signatures, end-to-end convergence), not mutated.
import { runMutations } from './.witness/witness.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the witness would hide REAL code: its masker reads '…' / "…" as strings and does not stop at a newline, so a
 *  stray quote inside a regex or a backtick template blanks code up to the next matching quote — and those operators are
 *  never mutated (a false clean). A JS string cannot span lines unescaped, so any quoted run that crosses one is a span
 *  of hidden code. Returns [first line, last line] for each. */
export function hiddenSpans(src) {
  const spans = [];
  let state = 'code', start = -1, line = 1, startLine = 1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (c === '\n') line++;
    if (state === 'code') {
      if (c === '/' && d === '/') { i++; state = 'line'; }
      else if (c === '/' && d === '*') { i++; state = 'block'; }
      else if (c === "'" || c === '"') { state = c; start = i; startLine = line; }
    } else if (state === 'line') { if (c === '\n') state = 'code'; }
    else if (state === 'block') { if (c === '*' && d === '/') { i++; state = 'code'; } }
    else if (c === '\\') { if (src[i + 1] === '\n') line++; i++; }
    else if (c === state) { if (line > startLine) spans.push([startLine, line]); state = 'code'; }
  }
  if (state === "'" || state === '"') spans.push([startLine, line]);
  return spans;
}
export const PAIRS = [
  ['src/shell.mjs', ['test/shell.test.mjs']],
  ['src/store.mjs', ['test/store.test.mjs']],
  ['src/recovery.mjs', ['test/recovery.test.mjs']],
  ['src/crdt.mjs', ['test/crdt.test.mjs', 'test/fuzz.test.mjs', 'test/spine.fuzz.test.mjs']],
  ['src/gate.mjs', ['test/gate.test.mjs', 'test/fuzz.test.mjs', 'test/spine.fuzz.test.mjs']],
  ['src/canon.mjs', ['test/canon.test.mjs']],
  ['src/vault.mjs', ['test/vault.test.mjs', 'test/vault.edge.test.mjs']],
  ['src/books.mjs', ['test/books.test.mjs']],
  ['src/lease.mjs', ['test/lease.test.mjs']],
  ['src/office.mjs', ['test/office.test.mjs']],
  ['src/brain.mjs', ['test/brain.test.mjs', 'test/fuzz.test.mjs']],
  ['src/agent.mjs', ['test/agent.test.mjs', 'test/fuzz.test.mjs']],
  ['src/screen.mjs', ['test/agent.test.mjs', 'test/fuzz.test.mjs']],
  ['src/grow.mjs', ['test/grow.test.mjs']],
  ['src/company.mjs', ['test/company.test.mjs', 'test/fuzz.test.mjs']],
  ['src/market.mjs', ['test/market.test.mjs']],
  ['src/mesh.mjs', ['test/mesh.test.mjs']],
  ['src/train.mjs', ['test/train.test.mjs']],
  ['src/model.mjs', ['test/model.test.mjs']],
  ['src/antibody.mjs', ['test/antibody.test.mjs']],
  ['src/watch.mjs', ['test/watch.test.mjs']],
  ['src/rtc.mjs', ['test/rtc.test.mjs']],
  ['src/explain.mjs', ['test/explain.test.mjs']],
  ['src/adopt.mjs', ['test/adopt.test.mjs']],
  ['src/plant.mjs', ['test/plant.test.mjs']],
  ['src/evidence.mjs', ['test/evidence.test.mjs']],
  ['src/oversight.mjs', ['test/oversight.test.mjs']],
  ['src/receipt.mjs', ['test/receipt.test.mjs']],
  ['src/audit.mjs', ['test/audit.test.mjs']],
  ['src/exportco.mjs', ['test/exportco.test.mjs']],
  ['src/bridge.mjs', ['test/bridge.test.mjs']],
  ['src/sow.mjs', ['test/sow.test.mjs']],
];
// imported (by the tests) it only lends hiddenSpans and PAIRS; run directly, it is the gate
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();

function main() {
const only = process.argv.slice(2);
// a name that matches no kernel judges nothing — and nothing judged must never print CLEAN
const unknown = only.filter((o) => !PAIRS.some(([src]) => src === o));
if (unknown.length) { console.log(`WITNESS NOT RUN — no kernel named ${unknown.join(', ')} (name it as its path, e.g. src/oversight.mjs)`); process.exit(1); }
let allClean = true; const rows = [];
for (const [src, tests] of PAIRS) {
  if (only.length && !only.includes(src)) continue;
  if (!existsSync(join(HERE, src))) continue;
  const t0 = Date.now();
  // code the masker would hide is never mutated — refuse to judge rather than report a clean that skipped it
  const hidden = hiddenSpans(readFileSync(join(HERE, src), 'utf8'));
  if (hidden.length) {
    console.log(`✗ ${src.padEnd(16)} HIDDEN CODE — a stray quote hides lines ${hidden.map(([a, b]) => a + '–' + b).join(', ')} from mutation; write it as \\x22 / \\x27`);
    allClean = false;
    continue;
  }
  // a red suite kills every mutant and reads as CLEAN — so the unmutated code must pass its tests first, or nothing is judged
  const base = spawnSync(process.execPath, ['--test', ...tests], { cwd: HERE, encoding: 'utf8', timeout: 300000 });
  if (base.status !== 0) {
    console.log(`✗ ${src.padEnd(16)} RED BASELINE — its tests fail with no mutation applied (${tests.join(', ')}); nothing can be judged`);
    allClean = false;
    continue;
  }
  const r = runMutations(join(HERE, src), { cwd: HERE, cap: 5000, timeout: 120000, testCmd: ['node', '--test', ...tests] });
  rows.push(r);
  console.log(`${r.clean && !r.capped ? '✓' : '✗'} ${src.padEnd(16)} ${String(r.killed).padStart(3)}/${String(r.total).padEnd(3)} killed${r.ignored.length ? ` · ${r.ignored.length} reviewed-equivalent` : ''} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const s of r.survived) console.log(`    SURVIVED line ${s.line}: ${s.mutation} :: ${s.snippet}`);
  if (!r.clean || r.capped) allClean = false;
}
const k = rows.reduce((a, r) => a + r.killed, 0), n = rows.reduce((a, r) => a + r.total, 0);
console.log(`\n${allClean ? 'WITNESS CLEAN' : 'WITNESS NOT CLEAN'} — ${k}/${n} mutants killed`);
process.exit(allClean ? 0 : 1);
}
