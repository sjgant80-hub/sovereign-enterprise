// evidence.test.mjs — the statistics are checked against values worked by hand (never against the module's own output),
// and verifyDecision is run on a real working day of the company and against a forged and a tampered decision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as E from '../src/evidence.mjs';
import { createCompany } from '../src/runtime.mjs';
import { jobMetrics } from '../src/company.mjs';
import { answer, toRecord } from '../src/brain.mjs';
import { signEnvelope } from '../src/node.mjs';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, a + ' vs ' + b);

test('wilson: the 95% interval worked by hand, and its edges', () => {
  // 28 of 31: p = 28/31, z = 1.96 — the Wilson formula written out here, not taken from the module
  const k = 28, n = 31, z = 1.96, p = k / n, d = 1 + z * z / n;
  const mid = (p + z * z / (2 * n)) / d, half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  close(E.wilson(28, 31).lo, mid - half);
  close(E.wilson(28, 31).hi, mid + half);
  close(E.wilson(28, 31).lo, 0.750997, 1e-5);
  close(E.wilson(29, 31).hi, 0.982126, 1e-5);
  close(E.wilson(31, 31).hi, 1, 1e-12);   // all right: the top of the interval is 1
  assert.ok(E.wilson(31, 31).lo < 1 && E.wilson(31, 31).lo > 0.88);
  assert.equal(E.wilson(0, 31).lo, 0);
  assert.ok(E.wilson(0, 31).hi > 0.1 && E.wilson(0, 31).hi < 0.12);
  for (const [a, b] of [[0, 0], [5, 4], [-1, 3], [1.5, 3], [1, '3'], [null, 3]]) assert.deepEqual(E.wilson(a, b), { lo: 0, hi: 1 }, a + '/' + b);
  close(E.wilson(50, 100, 2.576).hi - E.wilson(50, 100, 2.576).lo, 2 * 2.576 * Math.sqrt(0.25 / 100 + 2.576 ** 2 / 40000) / (1 + 2.576 ** 2 / 100));
});

test('signTest: exact two-sided p-values worked by hand; the large-sample approximation agrees', () => {
  assert.equal(E.signTest(10, 0), 2 / 1024);                    // the only splits as uneven: 10–0 and 0–10
  assert.equal(E.signTest(0, 10), 2 / 1024);
  assert.equal(E.signTest(9, 1), 2 * (1 + 10) / 1024);
  assert.equal(E.signTest(8, 2), 2 * (1 + 10 + 45) / 1024);
  assert.equal(E.signTest(1, 2), 1);
  assert.equal(E.signTest(5, 5), 1);
  assert.equal(E.signTest(0, 0), 1);
  assert.equal(E.signTest(1, 0), 1);
  for (const [a, b] of [[-1, 2], [1.5, 2], ['3', 1], [null, null]]) assert.equal(E.signTest(a, b), 1);
  // exact up to EXACT_MAX pairs, then the normal approximation: at the seam the two agree closely
  assert.equal(E.EXACT_MAX, 1000);
  const exact = E.signTest(540, 460), approx = E.signTest(541, 460);    // 1,000 pairs exact; 1,001 approximated
  assert.ok(exact > 0.01 && exact < 0.02 && Math.abs(exact - approx) < 0.006, exact + ' ~ ' + approx);
  close(E.signTest(2000, 2000), 1, 1e-6);
  assert.ok(E.signTest(600, 500) < 0.003 && E.signTest(600, 500) > 0.002);
  assert.ok(E.signTest(5000, 0) < 1e-12);
});

test('confusion and versusNothing: the counts, and the verdict only when the evidence is there', () => {
  const L = [
    { state: 'done', label: 1, truth: 1 }, { state: 'done', label: 1, truth: 0 }, { state: 'done', label: 0, truth: 0 }, { state: 'done', label: 0, truth: 1 },
    { state: 'done', label: 0, truth: 0 }, { state: 'watch', label: 1, truth: 1 }, { state: 'done', label: null, truth: 1 }, { state: 'done', label: 1, truth: null }, null, 7,
  ];
  assert.deepEqual(E.confusion(L), { tp: 1, fp: 1, tn: 2, fn: 1, n: 5 });
  assert.deepEqual(E.confusion('x'), { tp: 0, fp: 0, tn: 0, fn: 0, n: 0 });
  // the machine-failure job of the published day: caught 1, two false alarms, 27 left rightly, 1 missed
  const m = E.versusNothing({ tp: 1, fp: 2, tn: 27, fn: 1, n: 31 });
  assert.deepEqual([m.brainRight, m.nothingRight, m.wins, m.losses, m.p, m.verdict], [28, 29, 1, 2, 1, 'no evidence either way']);
  assert.deepEqual(E.versusNothing({ tp: 9, fp: 0, tn: 70, fn: 1, n: 80 }).verdict, 'better');
  assert.deepEqual(E.versusNothing({ tp: 0, fp: 12, tn: 60, fn: 3, n: 75 }).verdict, 'worse');
  assert.equal(E.versusNothing({ tp: 5, fp: 0, tn: 70, fn: 1, n: 76 }).p, 2 / 32);
  assert.equal(E.versusNothing({ tp: 5, fp: 0, tn: 70, fn: 1, n: 76 }).verdict, 'no evidence either way', 'p = 0.0625: not below 0.05');
  assert.equal(E.versusNothing({ tp: 6, fp: 0, tn: 70, fn: 1, n: 77 }).verdict, 'better', 'p = 0.03125');
  assert.equal(E.ALPHA, 0.05);
  assert.deepEqual(E.versusNothing(null), { n: 0, brainRight: 0, nothingRight: 0, wins: 0, losses: 0, p: 1, verdict: 'no evidence either way', brain: { lo: 0, hi: 1 }, nothing: { lo: 0, hi: 1 } });
});

test('secondOpinion: agreed (and both wrong), disagreed (a catch or a false alarm), or no second brain — money and security jobs only', () => {
  const L = [
    { channel: 'fraud', state: 'done', crossChecked: true, label: 1, truth: 1 },
    { channel: 'fraud', state: 'done', crossChecked: true, label: 0, truth: 1 },        // both wrong
    { channel: 'credit', state: 'watch', why: 'a second brain disagreed — held for a person', label: 1, truth: 0 },   // the first was wrong: a catch
    { channel: 'intrusion', state: 'watch', why: 'a second brain disagreed — held for a person', label: 0, truth: 0 }, // the first was right
    { channel: 'intrusion', state: 'watch', why: 'no second brain could confirm — held for a person', label: 0, truth: 0 },
    { channel: 'churn', state: 'done', crossChecked: true, label: 0, truth: 1 },       // normal stakes: not counted
    { channel: 'fraud', state: 'done', crossChecked: false, label: 0, truth: 0 },      // a high-stakes call done without a second: not counted
    { channel: 'fraud', state: 'watch', label: null, truth: 1 }, null, 'x',
  ];
  assert.deepEqual(E.secondOpinion(L), { asked: 4, agreed: 2, agreedWrong: 1, disagreed: 2, caught: 1, falseAlarm: 1, noSecond: 1 });
  assert.deepEqual(E.secondOpinion(null), { asked: 0, agreed: 0, agreedWrong: 0, disagreed: 0, caught: 0, falseAlarm: 0, noSecond: 0 });
});

// ── on a real working day ──────────────────────────────────────────────────────────────────────────────────────────
const read = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const index = read('brains/index.json');
const brains = { index, patterns: Object.fromEntries(Object.entries(index).map(([d, m]) => [d, read('brains/' + m.file)])), shopper: read('brains/shopper.sample.json'),
  real: Object.fromEntries(Object.entries(index).filter(([d, m]) => m.sample && d !== 'shopper').map(([d, m]) => [d, read('brains/' + m.sample)])) };
async function day(n) {
  const co = createCompany(brains, { date: () => '2026-10-14' });
  await co.boot();
  while (co.n < n) await co.tick({ events: Math.min(3, n - co.n) });
  await co.drain();
  return co;
}

test('on a working day: every job’s counts add up to the board’s own; every brain decision re-runs from the signed record', async () => {
  const co = await day(120);
  const ev = E.jobEvidence(co.ledger), board = jobMetrics(co.ledger);
  assert.deepEqual(Object.keys(ev).sort(), Object.keys(board).sort());
  for (const [d, j] of Object.entries(ev)) {
    assert.equal(j.n, board[d].done, d);
    assert.equal(j.tp + j.fp + j.tn + j.fn, j.n, d);
    assert.equal(j.held, board[d].held, d);
    assert.equal(Math.round(1000 * j.versus.brainRight / j.n), board[d].rightPermille, d);
    assert.equal(Math.round(1000 * j.versus.nothingRight / j.n), board[d].baselinePermille, d);
    // whether it may run unattended, and its break-even, come from its own counts and its own stakes
    assert.deepEqual(j.accept, E.acceptance(j, j.stakes), d);
    assert.equal(j.breakEven, j.tp ? j.fp / j.tp : null, d);
  }
  assert.equal(ev.fraud.stakes, 'high');
  assert.equal(ev.shopper.stakes, 'normal');
  const W = co.nodes.owner;
  const decisions = W.list('decisions');
  let reran = 0, screen = 0;
  for (const d of decisions) {
    const r = E.verifyDecision(W, d.id);
    if (r.ok) {
      reran++;
      assert.equal(r.agent, d.agent);
      assert.equal(r.domain, d.domain);
      assert.match(r.patternId, /^[0-9a-f]{16}$/);
    } else {
      assert.equal(d.by, 'screen', 'only a decision no brain made fails to re-run: ' + r.why);
      assert.equal(r.why, 'no brain receipt to re-run: it was decided by the screen');
      screen++;
    }
  }
  assert.equal(reran + screen, decisions.length);
  assert.ok(reran >= decisions.length - 6 && reran > 100, reran + ' of ' + decisions.length);
  // a decision is re-run on its own signed work: the same receipt, the agent named, the brain signed by an agent
  const one = decisions.find((d) => d.receipt && d.by === 'own');
  const r = E.verifyDecision(W, one.id);
  assert.deepEqual([r.ok, r.event, r.label === (one.action === 'hold-payment' || one.action === 'upfront-terms' || one.action === 'quarantine' || one.action === 'retain' || one.action === 'fast-track' || one.action === 'raise-po' || one.action === 'schedule-service' || one.action === 'shed-load' ? 1 : 0)], [true, one.event, true]);
  assert.ok(['sales', 'service', 'finance', 'ops', 'systems', 'audit', 'owner'].includes(r.brainBy));

  // forged: a decision in Finance's name written by the Systems agent's key — refused before anything is re-run
  const { id: _id, ...fin } = decisions.find((d) => d.agent === 'finance' && d.receipt);
  await co.nodes.systems.put('decisions', 'd-forged', { ...fin, agent: 'finance' });
  // tampered: the Finance agent's own decision with a receipt no brain produced
  await co.nodes.finance.put('decisions', 'd-tampered', { ...fin, receipt: '0123456789abcdef' });
  // a decision whose work is not on the record
  await co.nodes.finance.put('decisions', 'd-orphan', { ...fin, event: 'e-nowhere' });
  await co.drain();
  assert.equal(E.verifyDecision(W, 'd-forged').why, 'the decision is not signed by the agent it names');
  assert.match(E.verifyDecision(W, 'd-tampered').why, /^no signed version of a [a-z]+ brain reproduces this receipt \(\d+ tried\)$/);
  assert.equal(E.verifyDecision(W, 'd-orphan').why, 'the work it decided is not on this device');
  assert.equal(E.verifyDecision(W, 'nope').why, 'no such decision on this device');
  // the tampered receipt was tried against EVERY signed version of that job's brain — counted here from the envelopes
  const versions = new Set();
  for (const h of W.hashes()) {
    const e = JSON.parse(new TextDecoder().decode(W.bytes(h)));
    if (e.op && e.op.k === 'put' && e.op.c === 'brain' && e.op.f && e.op.f.domain === fin.domain && e.op.f.patternId) versions.add(e.op.f.patternId);
  }
  assert.ok(versions.size >= 1);
  assert.equal(E.verifyDecision(W, 'd-tampered').why, 'no signed version of a ' + fin.domain + ' brain reproduces this receipt (' + versions.size + ' tried)');
  // a job no brain is published for; work whose input cannot be read
  await co.nodes.finance.put('decisions', 'd-nojob', { ...fin, domain: 'payroll' });
  await co.nodes.hub.put('inbox', 'e-null', { to: 'finance', channel: fin.channel, features: 'null', status: 'done' });
  await co.nodes.hub.put('inbox', 'e-seven', { to: 'finance', channel: fin.channel, features: '7', status: 'done' });
  await co.nodes.hub.put('inbox', 'e-junk', { to: 'finance', channel: fin.channel, features: '{not json', status: 'done' });
  for (const id of ['null', 'seven', 'junk']) await co.nodes.finance.put('decisions', 'd-' + id, { ...fin, event: 'e-' + id });
  await co.drain();
  assert.equal(E.verifyDecision(W, 'd-nojob').why, 'no signed brain for payroll is on this device');
  for (const id of ['null', 'seven', 'junk']) assert.equal(E.verifyDecision(W, 'd-' + id).why, 'the work it decided has no readable input', id);
  // decided by the model tier, or without a verified brain: no brain receipt, said in words
  await co.nodes.finance.put('decisions', 'd-model', { ...fin, by: 'model:ollama', receipt: '' });
  await co.nodes.finance.put('decisions', 'd-none', { ...fin, by: 'none', receipt: 'not-a-receipt' });
  await co.drain();
  assert.equal(E.verifyDecision(W, 'd-model').why, 'no brain receipt to re-run: it was decided by the model tier');
  assert.equal(E.verifyDecision(W, 'd-none').why, 'no brain receipt to re-run: it was decided without a verified brain');
  assert.equal(E.verifyDecision(null, 'x').why, 'the decision could not be checked');
});


test('the edges: the exact test at its seam, a one-case interval, the second-brain counts, junk and misrouted work', () => {
  // exact at 1,000 pairs: the binomial tail summed in whole numbers here, not by the module
  let C = 1n, sum = 0n;
  for (let i = 0; i <= 460; i++) { sum += C; C = (C * BigInt(1000 - i)) / BigInt(i + 1); }
  const exact = Number((2n * sum * 10n ** 18n) / 2n ** 1000n) / 1e18;
  close(E.signTest(540, 460), exact, 1e-12);
  // one trial: a real interval, not "anything"
  close(E.wilson(1, 1).lo, 1 / (1 + 1.96 * 1.96), 1e-12);
  close(E.wilson(0, 1).hi, 1.96 * 1.96 / (1 + 1.96 * 1.96), 1e-12);
  // the second-brain counts, each kind more than once so no two can stand in for each other
  const L = [
    { channel: 'fraud', state: 'done', crossChecked: true, label: 1, truth: 1 },
    { channel: 'fraud', state: 'done', crossChecked: true, label: 0, truth: 0 },
    { channel: 'fraud', state: 'done', crossChecked: true, label: 0, truth: 1 },
    { channel: 'credit', state: 'watch', why: 'a second brain disagreed', label: 1, truth: 0 },
    { channel: 'credit', state: 'watch', why: 'a second brain disagreed', label: 0, truth: 1 },
    { channel: 'credit', state: 'watch', why: 'a second brain disagreed', label: 0, truth: 0 },
    { channel: 'intrusion', state: 'watch', why: 'no second brain could confirm', label: 0, truth: 0 },
    { channel: 'intrusion', state: 'watch', why: 'no second brain could confirm', label: 1, truth: 1 },
    { channel: 'fraud', state: 'done', crossChecked: false, label: 0, truth: 0 },
  ];
  assert.deepEqual(E.secondOpinion(L), { asked: 6, agreed: 3, agreedWrong: 1, disagreed: 3, caught: 2, falseAlarm: 1, noSecond: 2 });
  // junk in a ledger is skipped, never thrown; work is counted under the job it was, whoever decided it
  const J = E.jobEvidence([null, 7, 'x', { channel: 'fraud', domain: 'credit', state: 'done', label: 1, truth: 1 }, { domain: 'credit', state: 'done', label: 0, truth: 0 }]);
  assert.deepEqual(Object.keys(J).sort(), ['credit', 'fraud']);
  assert.deepEqual([J.fraud.tp, J.fraud.n, J.credit.tn, J.credit.n], [1, 1, 1, 1]);
  assert.deepEqual([J.fraud.stakes, J.fraud.breakEven, J.credit.breakEven, J.fraud.accept.pass], ['high', 0, null, false]);
  assert.deepEqual(E.jobEvidence(null), {});
});

test('a brain version counts only if the role tree authorised it — a key with no right to write brains cannot make a receipt verify', async () => {
  const co = await day(30);
  const W = co.nodes.owner;
  const { id: _id, ...dec } = W.list('decisions').find((d) => d.agent === 'finance' && d.receipt && d.by === 'own');
  const work = W.list('inbox').find((r) => r.id === dec.event);
  const input = JSON.parse(work.features);
  // a brain no agent published: the shipped one, its threshold moved, its id new
  const base = read('brains/' + index[dec.domain].file);
  const fake = { ...base, threshold: base.threshold - 0.0123, patternId: 'beefbeefbeefbeef' };
  const forged = answer({ [dec.domain]: fake }, input);
  assert.equal(forged.verdict, 'VERIFIED');
  const receipt = forged.receipt.receiptHash.slice(0, 16);
  await co.nodes.finance.put('decisions', 'd-planted', { ...dec, receipt });
  // 1 · the hub (no grant to write brains) signs that brain anyway and it reaches the owner's device: stored, never applied
  const hub = co.nodes.hub, tip = hub.tip();
  const env = await signEnvelope(co.keys.hub, { k: 'put', c: 'brain', id: 'fraud.planted', f: toRecord(fake), l: 999999 }, tip.seq + 1, tip.hash);
  const got = await W.receive(env);
  assert.equal(got.ok, true, 'the gate stores it — authority decides whether it applies');
  await co.drain();
  assert.match(E.verifyDecision(W, 'd-planted').why, /^no signed version of a [a-z]+ brain reproduces this receipt/, 'the hub has no right to write brains');
  // 2 · the owner publishes it: an authorised version — the decision re-runs, and says the owner signed that brain
  await W.put('brain', 'fraud.owner', toRecord(fake));
  await co.drain();
  const r = E.verifyDecision(W, 'd-planted');
  assert.deepEqual([r.ok, r.patternId, r.brainBy], [true, 'beefbeefbeefbeef', 'owner']);
});

test('acceptance: may a job run unattended — beat doing nothing, and for money or security clear recall and precision floors on the low end of the interval', () => {
  // a fraud-like job: 7 caught, no false alarm, 1 missed — sign test 7–0, p = 2/128
  const fraud = { tp: 7, fp: 0, tn: 62, fn: 1, n: 70 };
  const a = E.acceptance(fraud, 'high');
  assert.equal(a.pass, true);
  assert.deepEqual(a.why, []);
  assert.equal(a.versus.verdict, 'better');
  assert.deepEqual([a.recall.k, a.recall.n, a.precision.k, a.precision.n], [7, 8, 7, 7]);
  assert.ok(Math.abs(a.recall.lo - 0.5291) < 1e-3 && Math.abs(a.precision.lo - 0.6457) < 1e-3, a.recall.lo + ' ' + a.precision.lo);
  // a handful of lucky calls cannot pass: 3 caught, none false, 3 missed
  const few = E.acceptance({ tp: 3, fp: 0, tn: 20, fn: 3, n: 26 }, 'high');
  assert.equal(few.pass, false);
  assert.deepEqual(few.why.map((w) => w.split(' (')[0]), ['not yet shown better than doing nothing', 'catches too few of the real cases to be sure', 'too many of its flags could be false']);
  assert.match(few.why[1], /\(at least 50% needed; as low as 19% on this evidence\)$/);
  assert.match(few.why[2], /\(at least 50% right needed; as low as 44% on this evidence\)$/);
  // a normal job needs only to beat doing nothing: 10 caught, 2 false alarms (p = 158/4096)
  const normal = E.acceptance({ tp: 10, fp: 2, tn: 30, fn: 9, n: 51 }, 'normal');
  assert.equal(normal.pass, true);
  assert.equal(E.acceptance({ tp: 10, fp: 2, tn: 30, fn: 9, n: 51 }, 'high').pass, false, 'the same counts fail a money job: recall too low');
  // worse than doing nothing is said as such
  assert.deepEqual(E.acceptance({ tp: 0, fp: 6, tn: 10, fn: 2, n: 18 }, 'normal').why, ['worse than doing nothing']);
  // the floors are a business's to raise; exactly on a floor passes, a hair above it fails
  const lo = E.wilson(7, 8).lo;
  assert.equal(E.acceptance(fraud, 'high', { high: { recall: lo, precision: 0 } }).pass, true);
  assert.equal(E.acceptance(fraud, 'high', { high: { recall: lo + 1e-9, precision: 0 } }).pass, false);
  const plo = E.wilson(7, 7).lo;
  assert.equal(E.acceptance(fraud, 'high', { high: { recall: 0, precision: plo } }).pass, true);
  assert.equal(E.acceptance(fraud, 'high', { high: { recall: 0, precision: plo + 1e-9 } }).pass, false);
  assert.equal(E.acceptance(fraud, 'high', { normal: { recall: 0, precision: 0 } }).pass, true, 'floors missing their kind fall back to the defaults');
  assert.deepEqual(E.FLOORS, { high: { recall: 0.5, precision: 0.5 }, normal: { recall: 0, precision: 0 } });
  assert.ok(Object.isFrozen(E.FLOORS) && Object.isFrozen(E.FLOORS.high));
  // junk never throws: no calls is not yet shown better
  for (const junk of [null, undefined, 7, 'x', {}]) assert.equal(E.acceptance(junk, 'high').pass, false);
});

test('costWeighed: the break-even miss-to-false-alarm ratio needs no price; given prices, each way of working is costed', () => {
  const c = { tp: 4, fp: 2, fn: 1, tn: 10, n: 17 };
  assert.deepEqual(E.costWeighed(c), { tp: 4, fp: 2, fn: 1, tn: 10, breakEven: 0.5, priced: null });
  // a missed case at £100, a false alarm at £5
  const p = E.costWeighed(c, { miss: 10000, falseAlarm: 500 }).priced;
  assert.deepEqual(p, { agents: 11000, nothing: 50000, everything: 6000, saving: 39000 });
  assert.equal(p.saving, p.nothing - p.agents);
  // exactly at break-even the saving is nothing
  assert.equal(E.costWeighed(c, { miss: 1000, falseAlarm: 2000 }).priced.saving, 0);
  assert.equal(E.costWeighed({ tp: 3, fp: 0, fn: 2, tn: 9 }).breakEven, 0, 'never a false alarm: worth it at any ratio');
  assert.equal(E.costWeighed({ tp: 0, fp: 3, fn: 2, tn: 9 }).breakEven, null, 'caught nothing: no ratio makes it worth it');
  for (const bad of [{ miss: -1, falseAlarm: 5 }, { miss: 1.5, falseAlarm: 5 }, { miss: 5 }, { falseAlarm: 5 }, null, 'x'])
    assert.equal(E.costWeighed(c, bad).priced, null, JSON.stringify(bad));
  assert.deepEqual(E.costWeighed(c, { miss: 0, falseAlarm: 0 }).priced, { agents: 0, nothing: 0, everything: 0, saving: 0 });
  for (const junk of [null, undefined, 7, 'x']) assert.deepEqual(E.costWeighed(junk), { tp: 0, fp: 0, fn: 0, tn: 0, breakEven: null, priced: null });
});
