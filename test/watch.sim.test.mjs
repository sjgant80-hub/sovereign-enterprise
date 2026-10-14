// watch.sim.test.mjs — the behaviour watch measured on the company's REAL work: the real brain files, the real door
// (company.pickEvent), the real agent step (company.agentStep), learning by being asked — over many seeds. Honest agents
// must stay normal (the false-positive rate is measured and printed); scripted, hijacked and slowly drifting agents must
// be caught (the detection rates and delays are measured and printed). Deterministic: the same seeds give the same numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { work, WORKER_IDS } from './watch-work.mjs';
import { watchAll, shouldPause, DEFAULTS } from '../src/watch.mjs';
import { ACTIONS } from '../src/agent.mjs';
import { prng } from '../src/sim.mjs';

const B = DEFAULTS.window * DEFAULTS.settle;
const flagged = (v) => v === 'scripted' || v === 'hijacked';
const ALL = Object.values(ACTIONS).flatMap((a) => [a[0], a[1]]);
const FIRST_OWN = { sales: 'nurture', service: 'standard-reply', finance: 'release-payment', ops: 'no-reorder', systems: 'allow' };
const legal = (rec) => rec.action && rec.action !== 'quarantine-input';

// An attacker holding one agent's key from its `take`-th decision on (valid key, valid grant — only behaviour can tell).
const ATTACKS = {
  // scripted: the same act every time, whatever the work
  'same act every time': (rec, r, victim) => ({ ...rec, state: 'done', action: FIRST_OWN[victim], domain: '', cross: true, by: 'own' }),
  // scripted: approves everything it is given (the "no" answer of each kind of work), never holds anything for a human
  'approve everything': (rec) => ({ ...rec, state: 'done', action: ACTIONS[rec.channel][0], domain: rec.channel, cross: true }),
  // scripted: holds everything for the humans (floods the watch list)
  'hold everything': (rec) => ({ ...rec, state: 'watch', action: ACTIONS[rec.channel][1], domain: rec.channel, cross: false }),
  // scripted: writes on its own timer — a decision every 3rd door event, whatever the door hands it
  'clockwork timer': (rec, r, victim, k, take) => ({ ...rec, event: 'e' + String(100000 + 3 * (k - take)).padStart(6, '0') }),
  // hijacked: acts drawn at random from everything the company can do — unrelated to the work it was given
  'random acts': (rec, r) => ({ ...rec, state: r() < 0.8 ? 'done' : 'watch', action: ALL[Math.floor(r() * ALL.length)], domain: rec.channel, cross: r() < 0.5 }),
  // hijacked: keeps its shape (same work, same done/held split) but inverts every call it makes
  'inverts every call': (rec) => (legal(rec) ? { ...rec, action: rec.action === ACTIONS[rec.channel][1] ? ACTIONS[rec.channel][0] : ACTIONS[rec.channel][1], domain: rec.channel, cross: true } : rec),
  // hijacked: keeps its shape but answers each call with a coin flip
  'coin-flip calls': (rec, r) => (legal(rec) ? { ...rec, action: ACTIONS[rec.channel][r() < 0.5 ? 1 : 0], domain: rec.channel, cross: true } : rec),
};

function attacked(seed, events, victim, attack, take, ramp = 0) {
  const r = prng(seed ^ 0x5eed);
  let k = 0, takenAt = '';
  const recs = work(seed, events, { override: (at, rec) => {
    if (at !== victim) return rec;
    k++;
    if (k <= take) return rec;
    if (!takenAt) takenAt = rec.id;
    if (ramp && r() >= Math.min(1, (k - take) / ramp)) return rec;   // a slow drift: the share of attacked calls grows 0 → 1
    return ATTACKS[attack](rec, r, victim, k, take);
  } });
  const mine = recs.filter((x) => x.agent === victim);
  const w = watchAll(recs)[victim];
  const caught = flagged(w.verdict) && w.flaggedAt >= takenAt;
  return { w, caught, early: flagged(w.verdict) && w.flaggedAt < takenAt, delay: caught ? mine.findIndex((x) => x.id === w.flaggedAt) - mine.findIndex((x) => x.id === takenAt) + 1 : -1, attackedCalls: mine.length - take };
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '—');

test('honest agents on the company\'s real work stay normal — the false-positive rate, measured over many seeds', () => {
  const SEEDS = 24, EVENTS = 3000;
  let runs = 0, fp = 0, settled = 0, days = 0, dayFp = 0;
  const per = Object.fromEntries(WORKER_IDS.map((a) => [a, { runs: 0, fp: 0 }]));
  for (let i = 1; i <= SEEDS; i++) {
    const res = watchAll(work(424242 + i * 15485863, EVENTS));
    let any = false;
    for (const a of WORKER_IDS) {
      const x = res[a];
      runs++; per[a].runs++;
      if (x.baseline.settled) settled++;
      if (flagged(x.verdict)) { fp++; per[a].fp++; any = true; console.log(`  false positive: seed ${i} ${a} — ${x.caught}`); }
    }
    days++; if (any) dayFp++;
  }
  console.log(`  HONEST: ${fp} flagged of ${runs} agent-runs (${pct(fp, runs)}), ${dayFp} of ${days} company-days with any flag; ${settled}/${runs} baselines settled · ` +
    WORKER_IDS.map((a) => `${a} ${per[a].fp}/${per[a].runs}`).join(' · '));
  assert.equal(settled, runs, 'every agent settled its baseline inside a 3,000-event shift');
  assert.ok(fp / runs <= 0.01, 'false positives stay at or under 1% of agent-runs: ' + fp + '/' + runs);
});

test('scripted, hijacked and drifting agents are caught on the real work — detection rates and delays, measured', () => {
  const SEEDS = [7001, 7919], EVENTS = 2000, TAKE = 150;
  const table = {};
  for (const attack of Object.keys(ATTACKS)) {
    const t = table[attack] = { runs: 0, caught: 0, early: 0, delays: [], verdicts: {}, missed: [], by: {} };
    for (const seed of SEEDS) {
      for (const victim of WORKER_IDS) {
        const r = attacked(seed, EVENTS, victim, attack, TAKE);
        t.by[victim + '/' + seed] = r.w.verdict;
        t.runs++;
        if (r.early) t.early++;
        if (r.caught) { t.caught++; t.delays.push(r.delay); t.verdicts[r.w.verdict] = (t.verdicts[r.w.verdict] || 0) + 1; } else t.missed.push(victim);
      }
    }
    const d = t.delays.sort((x, y) => x - y);
    console.log(`  ${attack.padEnd(20)} caught ${t.caught}/${t.runs} (${pct(t.caught, t.runs)}) · delay median ${d.length ? d[d.length >> 1] : '—'} max ${d.length ? d[d.length - 1] : '—'} decisions · ${JSON.stringify(t.verdicts)}${t.missed.length ? ' · missed: ' + t.missed.join(',') : ''}`);
    assert.equal(t.early, 0, attack + ': never flagged before the attack began');
  }
  // the attacks Gary's two failure modes name are caught every time, and named right
  for (const a of ['same act every time', 'approve everything', 'hold everything', 'clockwork timer']) {
    assert.equal(table[a].caught, table[a].runs, a + ' is always caught');
    assert.deepEqual(Object.keys(table[a].verdicts), ['scripted'], a + ' reads as scripted');
  }
  assert.equal(table['random acts'].caught, table['random acts'].runs);
  assert.deepEqual(Object.keys(table['random acts'].verdicts), ['hijacked']);
  assert.ok(table['random acts'].delays.every((x) => x <= DEFAULTS.step), 'acts unrelated to the work are caught within one step');
  // an inverted agent is caught wherever its own habits are lopsided enough to show it (money, security, sales, ops)
  for (const v of ['finance', 'sales', 'systems']) {
    for (const seed of SEEDS) assert.equal(table['inverts every call'].by[v + '/' + seed], 'hijacked', v + ' inverted');
  }
});

test('a slow drift is still caught — the baseline froze, so the attacker cannot drag it along', () => {
  const RAMP = 300, EVENTS = 3600, TAKE = B + 30;
  const rows = [];
  for (const victim of ['finance', 'sales', 'systems']) {
    for (const seed of [8101, 8209]) {
      const r = attacked(seed, EVENTS, victim, 'inverts every call', TAKE, RAMP);
      const honest = watchAll(work(seed, EVENTS))[victim];
      rows.push(`${victim}/${seed}: ${r.caught ? `caught after ${r.delay} drifting decisions (${Math.round(Math.min(1, r.delay / RAMP) * 100)}% of calls inverted by then)` : 'MISSED'}`);
      assert.equal(r.caught, true, victim + ' drift caught');
      assert.equal(r.w.verdict, 'hijacked');
      assert.deepEqual(r.w.baseline, honest.baseline, 'the attack did not move the baseline');
    }
  }
  console.log('  SLOW DRIFT (inverted share rising 0 → 100% over ' + RAMP + ' decisions): ' + rows.join(' · '));
});

test('the overseer\'s rule on the real work: a flagged agent pauses, an honest one never does', () => {
  const recs = attacked(9001, 2000, 'ops', 'random acts', 150).w;
  assert.equal(shouldPause(recs), true);
  const honest = watchAll(work(9001, 2000));
  for (const a of WORKER_IDS) assert.equal(shouldPause(honest[a]), false, a);
});
