import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect, validOp } from '../src/gate.mjs';
import { materialize, dedupe, rows, sequence, text, liveTags, lwwBeats, collections, emptyState } from '../src/crdt.mjs';
import { prng } from '../src/sim.mjs';
import { validPattern, membership, scoreInput, route, answer, verifyReceipt, verifyOn, adopt, fromRecord, meshRoute } from '../src/brain.mjs';
import { decide, needsSecond, actionFor, canSpend, scorecard } from '../src/agent.mjs';
import { screen, revealTags } from '../src/screen.mjs';
import { pickEvent, agentStep, effects, splitEffects, poEntry, shouldLearn, challenge, boardKpis } from '../src/company.mjs';
import { growPattern, toDataset } from '../src/grow.mjs';

// The kernels are total: hostile input is refused or ignored, never a throw.
const toxic = { get k() { throw new Error('boom'); }, get op() { throw new Error('boom'); } };
const JUNK = [undefined, null, 0, -1, NaN, '', 'x', [], {}, [null], toxic, { k: 'put' }, { env: toxic, hash: 'h' },
  { env: { op: toxic }, hash: 'h' }, new Uint8Array(0), 1n, () => 1, Symbol('s')];

test('validOp never throws, and refuses every piece of junk', () => {
  for (const j of JUNK) {
    assert.doesNotThrow(() => validOp(j));
    assert.equal(validOp(j), false);
  }
});

test('inspect never throws on junk or random bytes', () => {
  for (const j of JUNK) assert.doesNotThrow(() => inspect(j));
  const rnd = prng(11);
  for (let i = 0; i < 2000; i++) {
    const b = new Uint8Array(1 + Math.floor(rnd() * 300)).map(() => Math.floor(rnd() * 256));
    if (i % 2) b[0] = 123;
    const r = inspect(b);
    assert.equal(typeof r.ok, 'boolean');
  }
});

test('materialize, dedupe and the views never throw', () => {
  for (const j of JUNK) {
    assert.doesNotThrow(() => materialize(j, 'g'));
    assert.doesNotThrow(() => materialize([j], 'g'));
    assert.doesNotThrow(() => dedupe([j]));
  }
  const s = emptyState();
  assert.doesNotThrow(() => rows(s, 'x'));
  assert.doesNotThrow(() => sequence(s, 'x', 'y'));
  assert.doesNotThrow(() => text(s, 'x', 'y'));
  assert.doesNotThrow(() => liveTags(s, 'x', 'y'));
  assert.doesNotThrow(() => collections(s));
  assert.doesNotThrow(() => lwwBeats([1, 'a', 'x'], [1, 'a', 'x']));
});

test('the AI layer is total: brains, agents and the screen never throw on junk', () => {
  for (const j of JUNK) {
    for (const k of JUNK) {
      assert.doesNotThrow(() => membership(j, k));
      assert.doesNotThrow(() => scoreInput(j, k));
      assert.doesNotThrow(() => route(j, k));
      assert.doesNotThrow(() => answer(j, k));
      assert.doesNotThrow(() => verifyOn(j, k));
      assert.doesNotThrow(() => adopt(j, k));
      assert.doesNotThrow(() => meshRoute(j, k));
      assert.doesNotThrow(() => decide(j, k));
      assert.doesNotThrow(() => needsSecond(j, k));
      assert.doesNotThrow(() => canSpend(j, k, j));
      assert.doesNotThrow(() => pickEvent(() => 0.5, j, k));
      assert.doesNotThrow(() => effects(j, k, 'x'));
      assert.doesNotThrow(() => splitEffects(j, k, 'x'));
      assert.doesNotThrow(() => shouldLearn(j, 'fraud', k));
      assert.doesNotThrow(() => toDataset('d', j, k));
    }
    assert.equal(validPattern(j), false);
    assert.equal(verifyReceipt(j), false);
    assert.equal(fromRecord(j), null);
    assert.doesNotThrow(() => actionFor(j, j));
    assert.doesNotThrow(() => scorecard(j));
    assert.doesNotThrow(() => agentStep(j));
    assert.equal(agentStep({ agentId: 'x', event: j, library: j, peers: j }).decision.state, 'watch');
    assert.doesNotThrow(() => poEntry(j));
    assert.doesNotThrow(() => boardKpis(j));
    assert.doesNotThrow(() => boardKpis([j]));
    assert.doesNotThrow(() => challenge(j, 'fraud', j, j, j, 1));
    assert.equal(growPattern('d', j, j).ok, false);
    assert.doesNotThrow(() => scorecard([j]));
    assert.doesNotThrow(() => screen(j));
    assert.doesNotThrow(() => revealTags(typeof j === 'symbol' ? '' : j));
    assert.equal(decide(j).state === 'done' || decide(j).state === 'watch', true);
  }
  const rnd = prng(29);
  for (let i = 0; i < 500; i++) {
    let s = '';
    for (let n = Math.floor(rnd() * 80); n > 0; n--) s += String.fromCodePoint(Math.floor(rnd() * 0x10ffff) & 0xfffff);
    const r = screen(s);
    assert.equal(typeof r.ok, 'boolean');
  }
});
