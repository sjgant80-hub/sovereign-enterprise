import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCompany, seedFor, WORKERS } from '../src/runtime.mjs';
import { prng } from '../src/sim.mjs';
import { verifyReceipt } from '../src/brain.mjs';

const read = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const index = read('brains/index.json');
const brains = { index, patterns: Object.fromEntries(Object.entries(index).map(([d, m]) => [d, read('brains/' + m.file)])), shopper: read('brains/shopper.sample.json') };

async function day(n, hook = async () => {}) {
  const log = [];
  const co = createCompany(brains, { date: () => '2026-10-14', log: (s) => log.push(s) });
  await co.boot();
  for (let tick = 0; co.n < n; tick++) {
    await co.syncAll();
    for (let i = 0; i < 3 && co.n < n; i++) await co.next();
    await co.housekeeping();
    await hook(co, tick);
  }
  for (let i = 0; i < 2; i++) { await co.syncAll(); await co.housekeeping(); }
  await co.syncAll();
  return { co, log };
}

test('a working day: agents run the company end to end, every device converges, the books balance and the vault audits', async () => {
  const { co } = await day(150);
  const s = co.summary('owner');
  assert.equal(s.events, 150);
  assert.equal(s.decisions, 150);
  assert.equal(s.converged, true);
  assert.equal(s.books.balanced, true);
  assert.equal(s.vault.audits, true);
  assert.ok(s.vault.size >= 10 && s.vault.cosigned >= 1, 'the Audit agent co-signs the vault');
  assert.ok(s.automatedPermille > 600, 'most work is done end to end: ' + s.automatedPermille);
  assert.ok(s.rightPermille > 650, 'and it is mostly right against the real outcomes: ' + s.rightPermille);
  assert.ok(s.crossChecked > 10 && s.viaMesh > 5);
  for (const id of WORKERS) assert.ok(s.perAgent[id].done > 0, id + ' worked');
  // every own answer carries a receipt that re-hashes; the signed decision on the spine names the same receipt
  const owned = co.ledger.filter((x) => x.receipt);
  assert.ok(owned.length > 50);
  const onSpine = new Map(co.nodes.owner.list('decisions').map((r) => [r.event, r.receipt]));
  for (const x of owned) { assert.equal(verifyReceipt(x.receipt), true); assert.equal(onSpine.get(x.id), x.receipt.receiptHash.slice(0, 16)); }
  // nothing an agent signed was refused as unauthorised: hand-offs carried whatever its grant did not cover
  assert.equal(co.nodes.owner.view().report.unauthorized, 0);
  assert.ok(co.nodes.owner.list('handoff').every((h) => h.status === 'done'));
});

test('the same seed and date build the same company, byte for byte', async () => {
  const a = (await day(60)).co.summary('owner');
  const b = (await day(60)).co.summary('ops');
  assert.equal(a.digest, b.digest);
  assert.deepEqual(a, b);
});

test('attacks and interventions: hostile text quarantined, a poisoned brain refused everywhere, high stakes held without Audit, a fired agent goes silent', async () => {
  const seen = {};
  const { co, log } = await day(180, async (co, tick) => {
    if (tick === 5) seen.hostile = await co.hostile(prng(7));
    if (tick === 8) seen.poison = await co.poison('test');
    if (tick === 12) { co.online.audit = false; seen.offAt = co.n; }
    if (tick === 22) { co.online.audit = true; seen.onAt = co.n; }
    if (tick === 30) {
      const v = co.nodes.overseer.view();
      const g = v.roster.find((r) => r.to === co.keys.systems.pub);
      const max = Math.max(0, ...co.nodes.overseer.hashes().map((h) => { const e = JSON.parse(new TextDecoder().decode(co.nodes.overseer.bytes(h))); return e.from === co.keys.systems.pub ? e.seq : 0; }));
      await co.nodes.overseer.revoke(g.grant, max);
      await co.syncAll();
      seen.firedAt = co.n;
    }
  });
  assert.equal(seen.hostile.by, 'screen');
  assert.equal(co.nodes.owner.list('quarantine').length >= 1, true);
  assert.ok(seen.poison.length >= 4 && seen.poison.every((x) => !x.adopted && x.localAuc < 0.5), 'every device measured the poison and refused it');
  assert.ok(log.some((l) => /claiming AUC 0.990/.test(l)));
  // while Audit was offline, no money/security call was confirmed by Audit
  const offline = co.ledger.filter((x) => +x.id.slice(1) >= seen.offAt && +x.id.slice(1) < seen.onAt);
  assert.ok(offline.every((x) => x.secondBy !== 'audit'));
  assert.ok(offline.some((x) => ['fraud', 'credit', 'intrusion'].includes(x.domain) && x.state === 'watch'), 'high stakes went to the humans');
  // after the firing the Systems agent decides nothing, and every device agrees
  assert.equal(co.ledger.filter((x) => x.agent === 'systems' && +x.id.slice(1) > seen.firedAt).length, 0);
  assert.equal(co.grantLive('systems'), false);
  assert.equal(co.summary('owner').converged, true);
});

test('the humans: a held call chosen by the overseer is carried out by the agent; pausing an agent routes its work away', async () => {
  let chosen = null, pausedAt = null;
  const { co } = await day(150, async (co, tick) => {
    if (tick === 15 && !chosen) {
      const w = co.nodes.overseer.list('watch').find((x) => x.status === 'open' && x.action);
      if (w) { chosen = w; await co.resolve('overseer', w.id, w.action); }
    }
    if (tick === 20) { await co.setControl('owner', 'sales', true); await co.syncAll(); pausedAt = co.n; }
  });
  assert.ok(chosen, 'something was held for a human');
  const done = co.nodes.owner.list('watch').find((x) => x.id === chosen.id);
  assert.equal(done.status, 'executed');
  assert.equal(done.resolvedBy, 'AI overseer');
  assert.ok(done.executedBy);
  assert.equal(co.human.done, 1);
  assert.equal(co.paused('sales'), true);
  assert.equal(co.ledger.filter((x) => x.agent === 'sales' && +x.id.slice(1) > pausedAt).length, 0);
  assert.ok(co.ledger.filter((x) => x.channel === 'shopper' && +x.id.slice(1) > pausedAt).every((x) => x.agent !== 'sales'));
  assert.equal(seedFor('a', 'b'), seedFor('a', 'b'));
});
