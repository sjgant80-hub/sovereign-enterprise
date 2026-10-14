#!/usr/bin/env node
// tools/simulate.mjs — run the hostile-network simulation and write its receipt, or prove the receipt reproduces.
//   node tools/simulate.mjs           write receipts/sim.json
//   node tools/simulate.mjs --check   regenerate and demand it is byte-identical
// Seeded identities + deterministic Ed25519 + a seeded network => the same bytes on every machine.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulate } from '../src/sim.mjs';
import { canonical } from '../src/canon.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'receipts', 'sim.json');
const CONFIG = { seed: 20261014, nodes: 16, rounds: 30, opsPerRound: 6, partitionFrom: 8, partitionTo: 20, drop: 200, dup: 150, fanout: 2, attacks: 3 };

const r = await simulate(CONFIG);
const text = canonical(r) + '\n';
if (process.argv.includes('--check')) {
  const committed = existsSync(OUT) ? readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (committed !== text) { console.error('the simulation receipt does NOT reproduce'); process.exit(1); }
  console.log(`REPRODUCED — ${r.config.nodes} devices, ${r.partitionRounds} partitioned rounds, ${r.attacks} attacks, converged: ${r.converged}`);
  process.exit(r.converged ? 0 : 1);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, text);
console.log(`${r.converged ? 'CONVERGED' : 'DIVERGED'} — ${r.config.nodes} devices · ${r.envelopes} signed writes · ${r.partitionRounds} partitioned rounds · ` +
  `${r.droppedGossip} dropped + ${r.duplicateDeliveries} duplicated deliveries · ${r.attacks} attacks · digest ${r.digest.slice(0, 16)} → receipts/sim.json`);
process.exit(r.converged ? 0 : 1);
