import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { realRows, shopperRows, realHalves, REAL, kindOf, SYNTHETIC, sample } from '../src/streams.mjs';
import { validPattern, adopt, verifyOn, answer, route, toRecord, fromRecord, GATE_AUC } from '../src/brain.mjs';
import { growPattern } from '../src/grow.mjs';
import { ACTIONS } from '../src/agent.mjs';
import { OWNER_OF, AGENTS } from '../src/company.mjs';
import { seedFor } from '../src/runtime.mjs';

const path = (p) => new URL('../brains/' + p, import.meta.url);
const read = (p) => JSON.parse(readFileSync(path(p)));
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const DOMAINS = ['churn', 'fraud', 'credit', 'maintenance', 'intrusion', 'energy'];
const realIndex = read('real/index.json');
const brain = Object.fromEntries(DOMAINS.map((d) => [d, read(REAL[d].file)]));
const samp = Object.fromEntries(DOMAINS.map((d) => [d, read(REAL[d].sample)]));
const rows = Object.fromEntries(DOMAINS.map((d) => [d, realRows(samp[d])]));
const SHAPE = ['model', 'domain', 'title', 'role', 'real', 'note', 'features', 'rules', 'base', 'threshold', 'spread', 'dist', 'heldAuc', 'heldAcc', 'held', 'train', 'patternId', 'seed', 'verified', 'lineage'];

// The published facts, pinned: rows as published, exact duplicates removed, usable rows and positives, and the sample.
// A file edited by hand — or rebuilt from a different upstream file — fails here.
const EXPECT = {
  churn: { published: 3150, dupes: 300, usable: 2850, pos: 446, sample: 855, samplePos: 140, share: null },
  credit: { published: 30000, dupes: 35, usable: 29965, pos: 6630, sample: 1500, samplePos: 343, share: null },
  fraud: { published: 284807, dupes: 1081, usable: 283726, pos: 473, sample: 1070, samplePos: 107, share: 0.1 },
  maintenance: { published: 10000, dupes: 0, usable: 10000, pos: 339, sample: 610, samplePos: 61, share: 0.1 },
  intrusion: { published: 123117, dupes: 5195, usable: 117922, pos: 105907, sample: 1500, samplePos: 375, share: 0.25 },
  energy: { published: 2075259, dupes: 0, usable: 33944, pos: 6620, sample: 1500, samplePos: 270, share: null },
};

test('every real brain is a valid, gated pattern in the shipped shape, under the domain id its agent acts on', () => {
  for (const d of DOMAINS) {
    const p = brain[d];
    for (const k of SHAPE) assert.ok(k in p, d + ' lacks ' + k);
    assert.equal(validPattern(p), true, d);
    assert.equal(p.model, 'konomi-slm/1');
    assert.equal(p.domain, d);
    assert.ok(ACTIONS[d], d + ' has agent actions');
    assert.equal(p.role, OWNER_OF[d]);
    assert.equal(REAL[d].role, OWNER_OF[d]);
    assert.ok(p.heldAuc >= GATE_AUC, d + ' clears the gate on held-out');
    assert.equal(p.verified, true);
    assert.equal(p.provenance.grow.innerVerified, true);
    assert.ok(p.provenance.grow.innerHeldAuc >= GATE_AUC);
    assert.match(p.patternId, /^[0-9a-f]{16}$/);
    assert.ok(p.seed.startsWith('◊ seed.v1 ' + d + ' '));
    assert.match(p.lineage, /Thomas Frumkin/);
    assert.match(p.lineage, /sjgant80-hub\/seed-library/);
    assert.equal(p.real, REAL[d].real);
    assert.equal(p.kind, REAL[d].kind);
    assert.equal(p.licence, REAL[d].licence);
    assert.ok(p.licence.length > 5);
    assert.match(p.note, p.real ? /^REAL data/ : /^PUBLISHED-SYNTHETIC data \(not real\)/);
    assert.equal(p.held, p.provenance.heldRows);
    assert.equal(p.train, p.provenance.trainRows);
  }
});

test('honesty: only real-world measurements are flagged real; the synthetic and derived ones say so in every file', () => {
  assert.deepEqual(DOMAINS.filter((d) => brain[d].real), ['churn', 'fraud', 'credit', 'intrusion', 'energy']);
  assert.equal(brain.maintenance.real, false);
  assert.equal(brain.maintenance.kind, 'published-synthetic');
  assert.match(samp.maintenance.source, /^PUBLISHED-SYNTHETIC data \(not real\)/);
  assert.match(samp.maintenance.source, /NOT real measurements/);
  assert.match(samp.energy.source, /DERIVED/);
  assert.equal(brain.energy.kind, 'real-derived-label');
  assert.match(samp.intrusion.source, /STAGED/);
  assert.match(samp.intrusion.source, /not a production network/);
  assert.equal(brain.intrusion.kind, 'real-testbed');
  assert.match(samp.fraud.source, /PCA/);
  assert.match(samp.fraud.source, /ITSELF MADE AVAILABLE UNDER THE ODbL v1\.0/);
  const odbl = 'Contains information from the Credit Card Fraud Detection database (ULB Machine Learning Group / Worldline), which is made available here under the Open Database License (ODbL) v1.0.';
  assert.equal(brain.fraud.provenance.notice, odbl);                 // ODbL 4.3: the brain is a Produced Work and says so
  assert.ok(brain.fraud.note.endsWith(odbl));
  for (const d of DOMAINS) if (d !== 'fraud') assert.equal(brain[d].provenance.notice, null);
  assert.equal(realIndex.inventory.real, false);
  assert.equal(realIndex.inventory.kind, 'synthetic');
  for (const d of DOMAINS) assert.match(REAL[d].badge, REAL[d].real ? /^Real/ : /not real/);
});

test('the index matches the brain files, the registry and the shipped synthetic inventory brain', () => {
  assert.deepEqual(Object.keys(realIndex).sort(), [...SYNTHETIC].sort());
  for (const d of DOMAINS) {
    const e = realIndex[d], p = brain[d];
    assert.equal(e.file, REAL[d].file);
    assert.equal(e.sample, REAL[d].sample);
    assert.ok(existsSync(path(e.file)) && existsSync(path(e.sample)));
    assert.equal(e.heldAuc, p.heldAuc);
    assert.equal(e.patternId, p.patternId);
    for (const k of ['role', 'title', 'real', 'kind', 'licence']) assert.equal(e[k], p[k], d + '.' + k);
    assert.equal(e.dataset, REAL[d].dataset);
    assert.equal(p.provenance.dataset, REAL[d].dataset);
  }
  const inv = realIndex.inventory;
  assert.equal(inv.sample, null);
  assert.equal(inv.file, 'inventory.slm.json');
  assert.equal(validPattern(read(inv.file)), true);
  assert.equal(Object.hasOwn(REAL, 'inventory'), false);
  const shop = read('index.json').shopper;
  assert.equal(REAL.shopper.file, shop.file);
  assert.equal(REAL.shopper.real, shop.real);
  assert.ok(existsSync(path(REAL.shopper.sample)));
});

test('each sample is shaped like the shopper sample, its features are its brain\'s, and its counts are as recorded', () => {
  const shopKeys = Object.keys(read('shopper.sample.json'));
  for (const d of DOMAINS) {
    const s = samp[d], p = brain[d], v = p.provenance, x = EXPECT[d];
    assert.deepEqual(Object.keys(s), shopKeys);
    assert.deepEqual(s.features, p.features);
    assert.ok(s.features.length <= 16);
    assert.equal(s.rows, s.data.length);
    assert.ok(s.rows <= 1500);
    assert.equal(rows[d].length, s.data.length, d + ': no row is malformed');
    for (const row of s.data) assert.equal(row.length, s.features.length + 1);
    // the published facts
    assert.equal(v.publishedRows, x.published);
    assert.equal(v.duplicatesRemoved, x.dupes);
    assert.equal(v.usableRows, x.usable);
    assert.equal(v.usablePositives, x.pos);
    assert.equal(v.populationBase, r6(x.pos / x.usable));
    assert.equal(v.caseMix, x.share);
    // the sample as recorded
    const pos = rows[d].filter((r) => r.y === 1).length;
    assert.equal(s.rows, x.sample);
    assert.equal(pos, x.samplePos);
    assert.equal(v.sampleRows, s.rows);
    assert.equal(v.samplePositives, pos);
    assert.ok(v.heldRows >= v.sampleRows);
    assert.ok(Math.abs(pos / s.rows - v.heldPositives / v.heldRows) < 0.01, d + ': the sample keeps the held-out class mix');
    if (x.share !== null) {
      assert.ok(Math.abs(v.trainPositives / v.trainRows - x.share) < 0.002, d + ': train case mix as stated');
      assert.ok(Math.abs(v.heldPositives / v.heldRows - x.share) < 0.002, d + ': held case mix as stated');
      assert.ok(v.heldPopulationRows > v.heldRows);
      assert.ok(v.heldPopulationAuc >= GATE_AUC, d + ': also holds on the un-thinned held-out population');
    } else assert.equal(v.heldPopulationAuc, null);
    // the source says what it is, where from, under what licence, and how the split was made
    assert.ok(s.source.includes(v.citation));
    assert.ok(s.source.includes('Licence:'));
    assert.ok(s.source.includes(d === 'fraud' ? 'Open Database License v1.0' : 'CC BY 4.0'));
    assert.ok(s.source.includes(v.split));
    assert.match(s.source, /none were seen in growth/);
    assert.match(v.rawSha256, /^[0-9a-f]{64}$/);
    assert.match(v.licenceUrl, /^https:\/\//);
  }
});

test('every real brain re-verifies (adopt) on its own held-out rows, and the recorded figures are what a stranger recomputes', () => {
  for (const d of DOMAINS) {
    const v = verifyOn(brain[d], rows[d]);
    assert.equal(v.n, brain[d].provenance.sampleRows);
    assert.equal(v.auc, brain[d].provenance.sampleAuc, d);
    assert.equal(v.acc, brain[d].provenance.sampleAcc, d);
    const a = adopt(brain[d], rows[d]);
    assert.equal(a.adopt, true, d + ': ' + a.reason);
  }
});

test('in the runtime\'s split, every brain adopts on the local half, and the Audit agent grows an independent brain that holds on the door half', () => {
  const audit = AGENTS.find((a) => a.id === 'audit');
  for (const d of DOMAINS) {
    const { local, door } = realHalves(rows[d]);
    assert.equal(local.length + door.length, rows[d].length);
    assert.equal(adopt(brain[d], local).adopt, true, d + ' on the local half');
    assert.equal(adopt(brain[d], door).adopt, true, d + ' on the door half');
  }
  for (const d of audit.grows) {
    const { local, door } = realHalves(rows[d]);
    const g = growPattern(d, local, brain[d].features, { seed: seedFor('audit', d), grownBy: 'audit' });
    assert.equal(g.verified, true, d + ': ' + g.why);
    assert.notEqual(g.pattern.patternId, brain[d].patternId);
    assert.equal(adopt(g.pattern, door).adopt, true, d + ': the second brain holds on work it never saw');
  }
});

test('every sample row routes to its own brain; no domain\'s rows cover another domain\'s features', () => {
  const lib = Object.fromEntries(DOMAINS.map((d) => [d, brain[d]]));
  lib.shopper = read('shopper.slm.json');
  lib.inventory = read('inventory.slm.json');
  const first = { ...Object.fromEntries(DOMAINS.map((d) => [d, rows[d][0]])), shopper: realRows(read('shopper.sample.json'))[0], inventory: sample('inventory', 1, 1).rows[0] };
  for (const d of DOMAINS) {
    const answered = rows[d].filter((r) => answer({ [d]: brain[d] }, r).verdict === 'VERIFIED').length;
    assert.equal(answered, brain[d].provenance.sampleAnswered);
    assert.ok(answered >= 0.9 * rows[d].length, d + ' answers inside what it was verified on');
  }
  for (const a of Object.keys(first)) {
    const r = route(lib, first[a]);
    assert.equal(r.best.domain, a, a + ' routes to its own brain');
    for (const x of r.ranked) if (x.domain !== a) assert.ok(x.coverage < 1, a + ' rows must not cover ' + x.domain);
  }
});

test('a poisoned real brain (every rule flipped) is refused on the real held-out rows', () => {
  for (const d of DOMAINS) {
    const bad = { ...brain[d], patternId: 'poisoned', rules: brain[d].rules.map((r) => ({ ...r, w: -r.w })) };
    const a = adopt(bad, rows[d]);
    assert.equal(a.adopt, false, d);
    assert.ok(a.localAuc < 0.5);
  }
});

test('a real brain travels the spine as a record and comes back the same', () => {
  for (const d of DOMAINS) {
    const rec = toRecord(brain[d]);
    for (const v of Object.values(rec)) if (typeof v === 'string') assert.ok(v.length <= 2000, d);
    const back = fromRecord(rec);
    assert.ok(back, d);
    assert.deepEqual(back.rules, brain[d].rules);
    assert.deepEqual(back.features, brain[d].features);
    assert.deepEqual(back.dist, brain[d].dist);
    assert.equal(back.heldAuc, brain[d].heldAuc);
    assert.equal(back.real, brain[d].real);
  }
});

test('realRows: a published file is untrusted until checked — bad feature lists refused, bad rows dropped, never repaired', () => {
  assert.equal(shopperRows, realRows);
  const shop = realRows(read('shopper.sample.json'));
  assert.equal(shop.length, 1182);
  assert.equal(shop.filter((r) => r.y === 1).length, 248);
  // rows: only the right width, all finite, label 0/1
  const toxicRow = [1, 0]; Object.defineProperty(toxicRow, 1, { get() { throw new Error('boom'); } });
  assert.deepEqual(realRows({ features: ['a'], data: [[1, 0], null, 'ab', [1, 0, 5], [NaN, 1], [1, Infinity], ['1', 0], [1, 2], [1, 0.5], [2, 0], [3, 1]] }),
    [{ a: 1, y: 0 }, { a: 2, y: 0 }, { a: 3, y: 1 }]);
  assert.deepEqual(realRows({ features: ['a', 'b'], data: [[1, 2, 1]] }), [{ a: 1, b: 2, y: 1 }]);
  assert.deepEqual(realRows({ features: ['a'], data: [toxicRow] }), []);
  // the data must be an array
  assert.deepEqual(realRows({ features: ['a'], data: new Set([[1, 0]]) }), []);
  assert.deepEqual(realRows({ features: ['a'], data: 'x' }), []);
  assert.deepEqual(realRows({ features: ['a'] }), []);
  // feature lists: 1–16 distinct names, never `y`, never a non-string or an array-like impostor
  const f16 = Array.from({ length: 16 }, (_, i) => 'f' + i);
  assert.equal(realRows({ features: f16, data: [[...f16.map((_, i) => i), 1]] }).length, 1);
  const f17 = [...f16, 'f16'];
  assert.deepEqual(realRows({ features: f17, data: [[...f17.map((_, i) => i), 1]] }), []);
  assert.deepEqual(realRows({ features: [], data: [[0]] }), []);
  assert.deepEqual(realRows({ features: ['a', 'a'], data: [[1, 2, 0]] }), []);
  assert.deepEqual(realRows({ features: ['y'], data: [[1, 0]] }), []);
  assert.deepEqual(realRows({ features: [['a']], data: [[1, 0]] }), []);
  assert.deepEqual(realRows({ features: ['1a'], data: [[1, 0]] }), []);
  assert.deepEqual(realRows({ features: ['__proto__'], data: [[1, 0]] }), []);
  assert.deepEqual(realRows({ features: [5], data: [[1, 0]] }), []);
  assert.deepEqual(realRows({ features: 'ab', data: [[1, 2, 0]] }), []);
  const impostor = { length: 1, every: () => true, [Symbol.iterator]: function* () { yield 'a'; } };
  assert.deepEqual(realRows({ features: impostor, data: [[1, 0]] }), []);
  assert.deepEqual(realRows({ features: [{ toString() { throw new Error('boom'); } }], data: [[1, 0]] }), []);
});

test('realHalves: even rows are the company\'s own history, odd rows the live door', () => {
  assert.deepEqual(realHalves(['a', 'b', 'c', 'd', 'e']), { local: ['a', 'c', 'e'], door: ['b', 'd'] });
  assert.deepEqual(realHalves([]), { local: [], door: [] });
  assert.deepEqual(realHalves('abc'), { local: [], door: [] });
});

test('kindOf and the registry: what each stream is, frozen', () => {
  for (const d of [...DOMAINS, 'shopper']) assert.equal(kindOf(d), REAL[d].kind);
  assert.equal(kindOf('churn'), 'real');
  assert.equal(kindOf('maintenance'), 'published-synthetic');
  assert.equal(kindOf('inventory'), 'synthetic');
  assert.equal(kindOf('marketing'), null);
  assert.equal(kindOf('toString'), null);
  assert.equal(kindOf('__proto__'), null);
  assert.equal(Object.isFrozen(REAL), true);
  for (const e of Object.values(REAL)) assert.equal(Object.isFrozen(e), true);
});

test('sample() is unchanged for good input and total on junk', () => {
  const a = sample('fraud', 1, 50);
  assert.equal(a.ok, true);
  assert.equal(a.rows.length, 50);
  assert.equal(a.real, false);
  assert.deepEqual(sample('fraud', 1, 50), a);
  for (const bad of [[Symbol('s'), 5], [1n, 5], [1, Symbol('s')], [1, 1n]]) assert.deepEqual(sample('fraud', ...bad), { ok: false, rows: [], features: [] });
  assert.deepEqual(sample('fraud', 1, 50), a);          // a throw inside never leaves the generator override behind
});

test('fuzz: every exported function of streams.mjs is total on junk', () => {
  const toxic = { get features() { throw new Error('boom'); }, get data() { throw new Error('boom'); }, get length() { throw new Error('boom'); } };
  const JUNK = [undefined, null, 0, NaN, '', 'x', [], {}, [null], toxic, 1n, () => 1, Symbol('s'), { features: toxic, data: toxic }];
  for (const j of JUNK) {
    assert.doesNotThrow(() => realRows(j));
    assert.deepEqual(realRows(j), []);
    assert.doesNotThrow(() => shopperRows(j));
    assert.doesNotThrow(() => realHalves(j));
    assert.equal(kindOf(j), null);
    for (const k of JUNK) {
      assert.doesNotThrow(() => sample(j, k, j));
      assert.doesNotThrow(() => sample('churn', j, k));
    }
    assert.equal(sample(j, 1, 5).ok, false);
  }
});
