#!/usr/bin/env node
// witness-all.mjs — the mutation + fuzz gate over the decision kernels of the spine.
//   crdt.mjs  — the materialiser: dedupe, the role tree, the joins, the views (what the company IS)
//   gate.mjs  — verify-before-parse (what may enter)
//   canon.mjs — the one canonical byte form (what a signature covers)
//   vault.mjs — the transparency log (what can be proven to an outsider)
//   books.mjs — double-entry (what the money says)
//   lease.mjs — data leases + crypto-shredding (what a leaver / an erasure leaves behind)
//   office.mjs — the AI-native office cost + capacity kernel (every number the white paper shows)
// keys/sha256/node/sim are value-tested (NIST vectors, real signatures, end-to-end convergence), not mutated.
import { runMutations } from './.witness/witness.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
const HERE = dirname(fileURLToPath(import.meta.url));
export const PAIRS = [
  ['src/crdt.mjs', ['test/crdt.test.mjs', 'test/fuzz.test.mjs']],
  ['src/gate.mjs', ['test/gate.test.mjs', 'test/fuzz.test.mjs']],
  ['src/canon.mjs', ['test/canon.test.mjs']],
  ['src/vault.mjs', ['test/vault.test.mjs', 'test/vault.edge.test.mjs']],
  ['src/books.mjs', ['test/books.test.mjs']],
  ['src/lease.mjs', ['test/lease.test.mjs']],
  ['src/office.mjs', ['test/office.test.mjs']],
];
const only = process.argv.slice(2);
let allClean = true; const rows = [];
for (const [src, tests] of PAIRS) {
  if (only.length && !only.includes(src)) continue;
  if (!existsSync(join(HERE, src))) continue;
  const t0 = Date.now();
  const r = runMutations(join(HERE, src), { cwd: HERE, cap: 5000, timeout: 120000, testCmd: ['node', '--test', ...tests] });
  rows.push(r);
  console.log(`${r.clean && !r.capped ? '✓' : '✗'} ${src.padEnd(16)} ${String(r.killed).padStart(3)}/${String(r.total).padEnd(3)} killed${r.ignored.length ? ` · ${r.ignored.length} reviewed-equivalent` : ''} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const s of r.survived) console.log(`    SURVIVED line ${s.line}: ${s.mutation} :: ${s.snippet}`);
  if (!r.clean || r.capped) allClean = false;
}
const k = rows.reduce((a, r) => a + r.killed, 0), n = rows.reduce((a, r) => a + r.total, 0);
console.log(`\n${allClean ? 'WITNESS CLEAN' : 'WITNESS NOT CLEAN'} — ${k}/${n} mutants killed`);
process.exit(allClean ? 0 : 1);
