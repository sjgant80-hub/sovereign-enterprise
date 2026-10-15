#!/usr/bin/env node
// run-company.mjs — re-run the whole AI company headlessly and write (or check) its receipt.
//
//   node tools/run-company.mjs            → runs, writes receipts/company.json
//   node tools/run-company.mjs --check    → runs, refuses unless the result matches the committed receipt exactly
//
// Same runtime the live page runs (src/runtime.mjs), same brain files, same seed, a fixed posting date — so the
// company it builds is identical byte for byte on any machine. A stranger does not have to trust the numbers on the
// page: they re-run this and get the same digest, the same books, the same accuracy against the same outcomes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createCompany } from '../src/runtime.mjs';
import { sha256 } from '../src/sha256.mjs';
import { prng } from '../src/sim.mjs';

const ROOT = new URL('../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
const CHECK = process.argv.includes('--check');
const SEED = 20261014, DATE = '2026-10-14', EVENTS = 480, SPEED = 3;

export async function runCompany({ events = EVENTS, seed = SEED } = {}) {
  const index = read('brains/index.json');
  const patterns = Object.fromEntries(Object.entries(index).map(([d, m]) => [d, read('brains/' + m.file)]));
  const log = [];
  const real = Object.fromEntries(Object.entries(index).filter(([d, m]) => m.sample && d !== 'shopper').map(([d, m]) => [d, read('brains/' + m.sample)]));
  const co = createCompany({ index, patterns, shopper: read('brains/shopper.sample.json'), real }, { seed, date: () => DATE, log: (s) => log.push(s) });
  co.autoPromote = true;   // no person sits at a headless re-run: its overseer approves each regrown brain at once, and the record says so
  await co.boot();
  const script = [];   // the scripted day: the same interventions a human can make on the page
  let hostileId = null;
  for (let tick = 0; co.n < events; tick++) {
    await co.tick({ events: Math.min(SPEED, events - co.n) });
    if (tick === 20) { hostileId = (await co.hostile(prng(7))).id; script.push({ tick, act: 'hostile message' }); }
    if (tick === 40) { const r = await co.poison('day-1'); script.push({ tick, act: 'poisoned brain offered', adopted: r.filter((x) => x.adopted).length, refused: r.filter((x) => !x.adopted).length }); }
    if (tick === 60) { co.online.audit = false; script.push({ tick, act: 'Audit agent offline' }); }
    if (tick === 80) { co.online.audit = true; script.push({ tick, act: 'Audit agent back online' }); }
    if (tick === 100) {
      const w = co.nodes.overseer.list('watch').find((x) => x.status === 'open' && x.action);
      if (w) { await co.resolve('overseer', w.id, w.action); script.push({ tick, act: 'overseer approved a held call', channel: w.channel, action: w.action }); }
    }
    if (tick === 120) {
      const v = co.nodes.overseer.view();
      const g = v.roster.find((r) => r.to === co.keys.systems.pub);
      const max = Math.max(0, ...co.nodes.overseer.hashes().map((h) => { const e = JSON.parse(new TextDecoder().decode(co.nodes.overseer.bytes(h))); return e.from === co.keys.systems.pub ? e.seq : 0; }));
      await co.nodes.overseer.revoke(g.grant, max);
      script.push({ tick, act: 'Systems agent fired' });
    }
  }
  await co.drain();
  const h = co.byEvent.get(hostileId);
  const hs = script.find((x) => x.act === 'hostile message');
  if (hs) hs.result = h && h.by === 'screen' ? 'quarantined' : 'NOT quarantined';
  const s = co.summary('owner');
  const sysAfter = co.ledger.filter((x) => x.agent === 'systems').length;
  return { model: 'sovereign-enterprise/company-run/3', seed, date: DATE, events, speed: SPEED, script, summary: s, systemsDecisionsTotal: sysAfter, growthLog: log.length };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/').replace(/^\//, '')}` || process.argv[1].endsWith('run-company.mjs')) {
  const t0 = Date.now();
  const out = await runCompany();
  const body = JSON.stringify(out, null, 1);
  const receipt = { ...out, receiptHash: sha256(body) };
  const s = out.summary;
  console.log(`${out.events} events · ${s.decisions} decisions · ${(s.automatedPermille / 10).toFixed(1)}% automated · ${(s.rightPermille / 10).toFixed(1)}% right vs outcomes · ${s.crossChecked} cross-checked · ${s.viaMesh} via mesh · ${s.learned} learned · regrowths ${s.regrowthsPromoted}/${s.regrowthsTried} · converged ${s.converged} · books balanced ${s.books.balanced} · vault audits ${s.vault.audits} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const path = new URL('receipts/company.json', ROOT);
  if (CHECK) {
    const committed = JSON.parse(readFileSync(path, 'utf8'));
    const same = committed.receiptHash === receipt.receiptHash;
    console.log(same ? `RECEIPT MATCHES · ${receipt.receiptHash.slice(0, 16)}` : `RECEIPT MISMATCH · committed ${committed.receiptHash.slice(0, 16)} vs re-run ${receipt.receiptHash.slice(0, 16)}`);
    process.exit(same && s.converged && s.books.balanced && s.vault.audits ? 0 : 1);
  }
  mkdirSync(new URL('receipts/', ROOT), { recursive: true });
  writeFileSync(path, JSON.stringify(receipt, null, 1) + '\n');
  console.log('wrote receipts/company.json · ' + receipt.receiptHash.slice(0, 16));
}
