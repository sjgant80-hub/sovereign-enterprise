// watch.runtime.test.mjs — the behaviour watch on the REAL running company: real Ed25519 envelopes through the gate, the
// real materialiser, the 'decisions' collection exactly as the agent devices sign it — agents that close a call which
// waited on the mesh after later ones, so decisions reach the spine out of door order. It runs the receipt's own working
// day (the script tools/run-company.mjs runs: a hostile message, a poisoned brain, the Audit agent offline, a human's
// choice, the Systems agent fired), watching after every tick, and checks no honest agent is ever flagged; then a thief
// holding the Ops agent's key — valid signature, valid grant — answers Ops' inbox with decisions of its own, and the AI
// overseer catches it by behaviour and pauses it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCompany, WORKERS } from '../src/runtime.mjs';
import { ACTIONS } from '../src/agent.mjs';
import { prng } from '../src/sim.mjs';
import { watchAll, shouldPause } from '../src/watch.mjs';

const read = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const index = read('brains/index.json');
const brains = { index, patterns: Object.fromEntries(Object.entries(index).map(([d, m]) => [d, read('brains/' + m.file)])), shopper: read('brains/shopper.sample.json'),
  real: Object.fromEntries(Object.entries(index).filter(([d, m]) => m.sample && d !== 'shopper').map(([d, m]) => [d, read('brains/' + m.sample)])) };
const flagged = (v) => v === 'scripted' || v === 'hijacked';

test('the real company: the receipt\'s day flags no honest agent; a stolen agent key is caught by behaviour and paused', async () => {
  const co = createCompany(brains, { date: () => '2026-10-14' });
  await co.boot();
  const noFlags = (when) => {
    const now = watchAll(co.nodes.overseer.list('decisions'));
    for (const id of WORKERS) if (now[id]) assert.equal(flagged(now[id].verdict), false, `${id} flagged ${when}: ${now[id].caught}`);
    return now;
  };
  // ── the receipt's working day, exactly as tools/run-company.mjs scripts it — watched after every tick, as the overseer
  //    does when the watch runs in co.afterTick: a flag at ANY point would mean a pause write and a different receipt ──
  let ticks = 0;
  for (let tick = 0; co.n < 480; tick++) {
    await co.tick({ events: Math.min(3, 480 - co.n) });
    if (tick === 20) await co.hostile(prng(7));
    if (tick === 40) await co.poison('day-1');
    if (tick === 60) co.online.audit = false;
    if (tick === 80) co.online.audit = true;
    if (tick === 100) {
      const w = co.nodes.overseer.list('watch').find((x) => x.status === 'open' && x.action);
      if (w) await co.resolve('overseer', w.id, w.action);
    }
    if (tick === 120) {
      const g = co.nodes.overseer.view().roster.find((r) => r.to === co.keys.systems.pub);
      const max = Math.max(0, ...co.nodes.overseer.hashes().map((h) => { const e = JSON.parse(new TextDecoder().decode(co.nodes.overseer.bytes(h))); return e.from === co.keys.systems.pub ? e.seq : 0; }));
      await co.nodes.overseer.revoke(g.grant, max);
    }
    noFlags('at tick ' + tick);
    ticks++;
  }
  await co.drain();
  const day = noFlags('after the day drained');
  const opsLate = (() => { const rs = co.nodes.overseer.list('decisions').filter((d) => d.agent === 'ops'); let back = 0, top = -1; for (const d of rs) { const e = +d.event.slice(1); if (e < top) back++; top = Math.max(top, e); } return back; })();
  assert.ok(opsLate > 0, 'the real agents close some calls out of door order — and are not flagged for it');
  console.log(`  receipt day (480 events, watched after all ${ticks} ticks): ` + WORKERS.map((id) => `${id} ${day[id].verdict} (${day[id].decisions})`).join(' · ') + ` · Ops closed ${opsLate} calls out of door order`);

  assert.equal(day.ops.baseline.settled, true, 'by the end of the day Ops has settled its baseline (its first 120 decisions, frozen)');
  assert.equal(day.ops.verdict, 'normal');

  // ── a thief with the Ops agent's key takes over the Ops device: it answers Ops' inbox with decisions of its own ──
  const thief = co.nodes.ops;
  const r = prng(99);
  const ALL = Object.values(ACTIONS).flatMap((a) => [a[0], a[1]]);
  const honestTick = co.agentTick;
  let forged = 0, firstForged = '';
  co.agentTick = async (id) => {
    if (id !== 'ops') return honestTick(id);
    if (!co.available('ops')) return;
    for (const it of thief.list('inbox').filter((x) => x.to === 'ops' && x.status === 'open')) {
      const did = 'd' + String(thief.clock() + 1).padStart(8, '0') + '-' + thief.pub.slice(0, 6);
      const put = await thief.put('decisions', did, { agent: 'ops', event: it.id, domain: it.channel, action: ALL[Math.floor(r() * ALL.length)], state: 'done', by: 'own',
        cross: true, second: '', conf: 900, receipt: '', why: 'verified pattern, confident', customer: it.customer, channel: it.channel });
      assert.equal(put.ok, true, 'the stolen key signs valid envelopes the gate admits');
      await thief.put('inbox', it.id, { status: 'done', doneBy: 'ops' });
      forged++;
      if (!firstForged) firstForged = did;
    }
  };
  for (let i = 0; i < 20; i++) await co.tick({ events: 3 });
  await co.tick({ events: 0 });
  // (with the watch wired into co.afterTick the overseer may already have paused Ops a few forgeries in — that is the point)
  assert.ok(forged >= 1, 'the thief answered Ops work: ' + forged);

  // ── the AI overseer watches on its own device and pauses what the watch flags ──
  const seen = watchAll(co.nodes.overseer.list('decisions'));
  assert.equal(seen.ops.verdict, 'hijacked');
  assert.ok(seen.ops.flaggedAt >= firstForged, 'flagged on the forged decisions, not before');
  assert.match(seen.ops.caught, /does not call for|different kind of work|decided twice/);
  for (const id of WORKERS.filter((x) => x !== 'ops')) assert.equal(flagged(seen[id].verdict), false, id + ' stays clean');
  const opsRecs = co.nodes.overseer.list('decisions').filter((d) => d.agent === 'ops');
  console.log(`  stolen Ops key: ${forged} forged decisions (valid signatures, valid grant) · caught ${opsRecs.findIndex((d) => d.id === seen.ops.flaggedAt) - opsRecs.findIndex((d) => d.id === firstForged) + 1} decisions in · ${seen.ops.verdict}: ${seen.ops.caught}`);
  for (const id of WORKERS) if (shouldPause(seen[id]) && !co.paused(id)) await co.setControl('overseer', id, true);
  await co.syncAll();
  assert.equal(co.paused('ops'), true);
  assert.deepEqual(WORKERS.filter((id) => co.paused(id)), ['ops'], 'only the flagged agent is paused');
  // every device that holds the same signed writes reaches the same verdict — the watch is a function of the set
  const synced = watchAll(co.nodes.overseer.list('decisions'));
  assert.equal(co.nodes.owner.fingerprint(), co.nodes.overseer.fingerprint(), 'the same set of writes');
  assert.deepEqual(watchAll(co.nodes.owner.list('decisions')), synced);
  assert.deepEqual(watchAll(co.nodes.finance.list('decisions')), synced);
  assert.equal(synced.ops.flaggedAt, seen.ops.flaggedAt, 'the flag latched: more writes do not move it');

  // ── paused: the door routes Ops' work to the others; Ops decides nothing more ──
  const opsBefore = co.nodes.owner.list('decisions').filter((d) => d.agent === 'ops').length;
  for (let i = 0; i < 10; i++) await co.tick({ events: 3 });
  await co.drain();
  assert.equal(co.nodes.owner.list('decisions').filter((d) => d.agent === 'ops').length, opsBefore);
  assert.ok(co.nodes.owner.list('decisions').slice(-200).some((d) => ['inventory', 'maintenance', 'energy'].includes(d.channel) && d.agent !== 'ops'), 'its work went to the others');
  assert.equal(co.summary('owner').converged, true);
});
