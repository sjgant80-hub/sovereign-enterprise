import { test } from 'node:test';
import assert from 'node:assert/strict';
import { split, combine, readCard, gfMul, gfInv, toBase32, fromBase32, VERSION, MAX_CARDS, MAX_SECRET } from '../src/recovery.mjs';
import { sha256Bytes } from '../src/sha256.mjs';
import { prng } from '../src/sim.mjs';
import { hostileInputs } from '../.witness/witness.mjs';

/** A deterministic random source (tests only): bytes from a seeded PRNG. */
const seeded = (seed) => { const r = prng(seed); return (n) => Uint8Array.from({ length: n }, () => Math.floor(r() * 256)); };
const SECRET = sha256Bytes('recovery-test/owner-seed');          // a 32-byte seed, as the page splits
const combos = (arr, k) => (k === 0 ? [[]] : arr.flatMap((x, i) => combos(arr.slice(i + 1), k - 1).map((c) => [x, ...c])));
const eq = (a, b) => assert.deepEqual([...a], [...b]);
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Change one base32 character of a card (skipping the version prefix and spaces) to a different valid one. */
const typo = (card, at, step = 1) => {
  const pos = [...card].map((c, i) => [c, i]).filter(([c, i]) => i >= VERSION.length + 1 && c !== ' ').map(([, i]) => i)[at];
  const c = card[pos];
  return card.slice(0, pos) + ALPHA[(ALPHA.indexOf(c) + step) % 32] + card.slice(pos + 1);
};

test('GF(256): the AES field — known products, every inverse, 0 has none', () => {
  assert.equal(gfMul(0x57, 0x83), 0xc1);           // FIPS-197 §4.2
  assert.equal(gfMul(0x57, 0x13), 0xfe);
  assert.equal(gfMul(0x83, 0x57), 0xc1);
  assert.equal(gfMul(0x80, 0x02), 0x1b);           // the reduction step
  assert.equal(gfMul(0xff, 0xff), 0x13);
  assert.equal(gfMul(0, 0x57), 0);
  assert.equal(gfMul(0x57, 0), 0);
  assert.equal(gfMul(1, 0xab), 0xab);
  assert.equal(gfInv(0x53), 0xca);
  assert.equal(gfInv(1), 1);
  assert.equal(gfInv(0), 0);
  for (let a = 1; a < 256; a++) assert.equal(gfMul(a, gfInv(a)), 1, 'inverse of ' + a);
});

test('base32 (Crockford): known spellings, lenient reading, one spelling per byte string', () => {
  assert.equal(toBase32(new Uint8Array(0)), '');
  assert.equal(toBase32(Uint8Array.of(0xff)), 'ZW');
  assert.equal(toBase32(Uint8Array.of(0, 1, 2, 3, 4)), '000G40R4');
  assert.equal(toBase32(new Uint8Array(5).fill(0xff)), 'ZZZZZZZZ');
  assert.equal(toBase32(Uint8Array.of(0x10)), '20');
  assert.equal(toBase32(Uint8Array.of(0xde, 0xad, 0xbe, 0xef)), 'VTPVXVR');
  for (const n of [0, 1, 2, 3, 4, 5, 6, 31, 32, 43, 64]) {
    const b = seeded(n)(n);
    eq(fromBase32(toBase32(b)), b);
  }
  eq(fromBase32('zw'), [0xff]);
  eq(fromBase32('0O0G40R4'), [0, 1, 2, 3, 4]);       // O reads as 0
  eq(fromBase32('I0'), [8]);                          // I and L read as 1
  eq(fromBase32('l0'), [8]);
  assert.equal(fromBase32('ZU'), null);              // U is not in the alphabet
  assert.equal(fromBase32('Z!'), null);
  assert.equal(fromBase32('ZX'), null);              // non-zero padding bits: a second spelling of 0xff is refused
  assert.equal(fromBase32('ZW0'), null);             // a whole extra character
  assert.equal(fromBase32('Z'), null);               // five bits make no byte, and are not padding
  assert.equal(fromBase32('0'), null);               // …even when they are all zero
  assert.equal(fromBase32('000000000'), null);       // 45 bits: five bytes and five more bits that are not padding
  eq(fromBase32('00000000'), [0, 0, 0, 0, 0]);
  eq(fromBase32(''), []);
  for (const [, v] of hostileInputs()) assert.doesNotThrow(() => fromBase32(v));
  assert.equal(fromBase32({ toString() { throw new Error('x'); } }), null);
});

test('2 of 3 by default: any two cards rebuild the key, one alone is refused; cards are short and plain', () => {
  const r = split(SECRET, { random: seeded(1) });
  assert.equal(r.ok, true);
  assert.equal(r.cards.length, 3);
  for (const c of r.cards) {
    assert.match(c, /^SE1( [0-9A-HJKMNP-TV-Z]{1,4}){18}$/);
    assert.ok(c.length <= 92, c.length + ' characters');
    const rc = readCard(c);
    assert.equal(rc.ok, true);
    assert.equal(rc.k, 2);
    assert.equal(rc.n, 3);
  }
  assert.deepEqual(r.cards.map((c) => readCard(c).x), [1, 2, 3]);
  for (const pair of combos(r.cards, 2)) {
    const c = combine(pair);
    assert.equal(c.ok, true);
    eq(c.secret, SECRET);
    assert.equal(c.k, 2);
    assert.equal(c.n, 3);
  }
  assert.deepEqual(combine([r.cards[2], r.cards[0]]).used, [3, 1]);
  for (const one of r.cards) assert.deepEqual(combine([one]), { ok: false, reason: 'too-few', need: 2, have: 1 });
  assert.deepEqual(combine([]), { ok: false, reason: 'too-few', need: null, have: 0 });
  // deterministic given the random source; real randomness by default
  assert.deepEqual(split(SECRET, { random: seeded(1) }).cards, r.cards);
  assert.notDeepEqual(split(SECRET, { random: seeded(2) }).cards, r.cards);
  const live = split(SECRET);
  assert.equal(live.ok, true);
  eq(combine(live.cards.slice(1)).secret, SECRET);
  // the golden card: the format is a contract with every card already printed
  assert.equal(split(Uint8Array.of(7, 7, 7, 7), { random: () => Uint8Array.of(1, 2, 3, 4) }).cards[0],
    'SE1 ' + toBase32(Uint8Array.of(2, 3, 1, ...sha256Bytes(new Uint8Array([...new TextEncoder().encode('se-recovery-v1:'), 7, 7, 7, 7])).slice(0, 4), 6, 5, 4, 3,
      ...sha256Bytes(new Uint8Array([...new TextEncoder().encode('SE1'), 2, 3, 1, ...sha256Bytes(new Uint8Array([...new TextEncoder().encode('se-recovery-v1:'), 7, 7, 7, 7])).slice(0, 4), 6, 5, 4, 3])).slice(0, 4))).match(/.{1,4}/g).join(' '));
});

test('every K-of-N up to 5: every K cards rebuild it, every K−1 are refused as too few', () => {
  for (let n = 2; n <= 5; n++) {
    for (let k = 2; k <= n; k++) {
      const r = split(SECRET, { k, n, random: seeded(100 * n + k) });
      assert.equal(r.ok, true, k + '/' + n);
      assert.equal(r.cards.length, n);
      for (const c of r.cards) { const rc = readCard(c); assert.equal(rc.k, k); assert.equal(rc.n, n); }
      for (const set of combos(r.cards, k)) eq(combine(set).secret, SECRET);
      for (const set of combos(r.cards, k - 1)) assert.deepEqual(combine(set), set.length ? { ok: false, reason: 'too-few', need: k, have: k - 1 } : { ok: false, reason: 'too-few', need: null, have: 0 });
      // more than K, all from the set: still the key
      eq(combine(r.cards).secret, SECRET);
      assert.equal(combine(r.cards).used.length, k);
    }
  }
  // the widest set, and the smallest and largest secrets
  const wide = split(SECRET, { k: 7, n: MAX_CARDS, random: seeded(9) });
  eq(combine(wide.cards.slice(9)).secret, SECRET);
  assert.equal(combine(wide.cards.slice(10)).reason, 'too-few');
  for (const len of [1, 2, 31, 33, 48, MAX_SECRET]) {
    const s = seeded(len)(len);
    const r = split(s, { k: 3, n: 4, random: seeded(len + 1) });
    eq(combine([r.cards[3], r.cards[1], r.cards[0]]).secret, s);
  }
});

test('one card says nothing about the key: over every random polynomial, card 1 takes every value equally, whatever the secret', () => {
  // a 1-byte secret, 2 of 2: card 1 = s ⊕ c·1. Enumerate every coefficient c: the card's share byte runs through all
  // 256 values exactly once — for EVERY secret. So the share alone is uniform and independent of the secret.
  for (const s of [0, 1, 0x5a, 0xff]) {
    const seen = new Set();
    for (let c = 0; c < 256; c++) seen.add(readCard(split(Uint8Array.of(s), { k: 2, n: 2, random: () => Uint8Array.of(c) }).cards[0]).share[0]);
    assert.equal(seen.size, 256, 'secret ' + s);
  }
  // and 3 of 3 with two cards: for every pair of coefficients, cards 1 and 2 jointly take each pair of values exactly as
  // often whatever the secret (counted over a 1-byte secret: 65,536 polynomials, 65,536 pairs, each once)
  for (const s of [0, 0xc3]) {
    const seen = new Set();
    for (let c = 0; c < 65536; c += 1) {
      const cards = split(Uint8Array.of(s), { k: 3, n: 3, random: () => Uint8Array.of(c & 255, c >> 8) }).cards;
      seen.add(readCard(cards[0]).share[0] * 256 + readCard(cards[1]).share[0]);
    }
    assert.equal(seen.size, 65536, 'secret ' + s);
  }
});

test('a typo is caught on the card it is on — every position, before anything is combined', () => {
  const r = split(SECRET, { random: seeded(3) });
  const chars = r.cards[1].replace(/ /g, '').length - VERSION.length;
  for (let at = 0; at < chars; at++) {
    for (const step of [1, 7, 16]) {
      const bad = typo(r.cards[1], at, step);
      const rc = readCard(bad);
      assert.equal(rc.ok, false, 'position ' + at);
      assert.ok(['checksum', 'format'].includes(rc.reason), rc.reason);
      assert.deepEqual(combine([r.cards[0], bad]), { ok: false, reason: rc.reason, card: 1 });
    }
  }
  // the checksum itself: a changed share byte, re-encoded with a stale check, is a checksum failure
  const raw = fromBase32(r.cards[0].slice(4).replace(/ /g, ''));
  raw[10] ^= 1;
  assert.equal(readCard('SE1 ' + toBase32(raw)).reason, 'checksum');
  // spacing, dashes and case do not matter
  assert.equal(readCard(r.cards[2].replace(/ /g, '-').toLowerCase()).ok, true);
  assert.equal(readCard('  ' + r.cards[2].replace(/ /g, '\n') + ' ').ok, true);
  assert.equal(readCard(r.cards[2].replace(/ /g, '')).ok, true);
  assert.equal(readCard(r.cards[2].replace(/0/g, 'O')).ok, true, 'O for 0');
});

test('refusals: mixed sets, two printings of one key, duplicates, wrong version, junk', () => {
  const a = split(SECRET, { random: seeded(4) }).cards;
  const other = split(sha256Bytes('another company'), { random: seeded(4) }).cards;
  assert.deepEqual(combine([a[0], other[1]]), { ok: false, reason: 'mixed' });
  // a 2-of-3 card with a 3-of-4 card of the same key
  const wider = split(SECRET, { k: 3, n: 4, random: seeded(4) }).cards;
  assert.equal(combine([a[0], wider[1]]).reason, 'mixed');
  assert.equal(combine([wider[0], a[1]]).reason, 'mixed');
  // only N differs (2 of 3 against 2 of 4), or only K (2 of 4 against 3 of 4): still different sets
  const twoOfFour = split(SECRET, { k: 2, n: 4, random: seeded(6) }).cards;
  const threeOfFour = split(SECRET, { k: 3, n: 4, random: seeded(6) }).cards;
  assert.equal(combine([a[0], twoOfFour[1]]).reason, 'mixed');
  assert.equal(combine([twoOfFour[0], threeOfFour[1], threeOfFour[2]]).reason, 'mixed');
  assert.equal(combine([threeOfFour[0], twoOfFour[1]]).reason, 'mixed');
  // a different-length secret with the same mark is impossible to make honestly — forge one: mixed
  const short = readCard(a[0]);
  const forged = (() => {
    const body = Uint8Array.of(short.k, short.n, 2, ...short.mark, ...short.share.slice(1));
    return 'SE1 ' + toBase32(Uint8Array.of(...body, ...sha256Bytes(Uint8Array.of(...new TextEncoder().encode('SE1'), ...body)).slice(0, 4)));
  })();
  assert.equal(readCard(forged).ok, true);
  assert.equal(combine([a[0], forged]).reason, 'mixed');
  // two printings of the same key: same mark, different polynomials — combining across them is refused, not wrong
  const b = split(SECRET, { random: seeded(5) }).cards;
  assert.deepEqual(combine([a[0], b[1]]), { ok: false, reason: 'mismatch' });
  assert.deepEqual(combine([b[2], a[1]]), { ok: false, reason: 'mismatch' });
  // a third card that does not lie on the same polynomial is refused even though the first two would do
  assert.deepEqual(combine([a[0], a[1], b[2]]), { ok: false, reason: 'mismatch' });
  eq(combine([a[0], a[1], a[2]]).secret, SECRET);
  // a forged card whose share is consistent but whose mark is not the secret's: mismatch at the end
  const wrongMark = (() => {
    const c = readCard(a[1]);
    const body = Uint8Array.of(c.k, c.n, c.x, ...c.mark.map((v) => v ^ 1), ...c.share);
    return 'SE1 ' + toBase32(Uint8Array.of(...body, ...sha256Bytes(Uint8Array.of(...new TextEncoder().encode('SE1'), ...body)).slice(0, 4)));
  })();
  const c0 = readCard(a[0]);
  const wrongMark0 = (() => {
    const body = Uint8Array.of(c0.k, c0.n, c0.x, ...c0.mark.map((v) => v ^ 1), ...c0.share);
    return 'SE1 ' + toBase32(Uint8Array.of(...body, ...sha256Bytes(Uint8Array.of(...new TextEncoder().encode('SE1'), ...body)).slice(0, 4)));
  })();
  assert.deepEqual(combine([wrongMark0, wrongMark]), { ok: false, reason: 'mismatch' });
  // duplicates: the same card twice, with or without a third
  assert.deepEqual(combine([a[1], a[1]]), { ok: false, reason: 'duplicate' });
  assert.deepEqual(combine([a[0], a[1], a[0]]), { ok: false, reason: 'duplicate' });
  assert.deepEqual(combine([a[1], b[1]]), { ok: false, reason: 'duplicate' }, 'card 2 from two printings is still card 2');
  // version and shape
  assert.deepEqual(combine([a[0], 'SE2' + a[1].slice(3)]), { ok: false, reason: 'version', card: 1 });
  assert.deepEqual(combine(['hello', a[1]]), { ok: false, reason: 'version', card: 0 });
  assert.deepEqual(combine([a[0], 'SE1']), { ok: false, reason: 'format', card: 1 });
  assert.deepEqual(combine([a[0], 'SE1 ' + 'U'.repeat(20)]), { ok: false, reason: 'format', card: 1 });
  assert.deepEqual(combine([a[0], 7]), { ok: false, reason: 'card-type', card: 1 });
  assert.deepEqual(combine([a[0], 'SE1 ' + '0'.repeat(400)]), { ok: false, reason: 'card-size', card: 1 });
  assert.equal(readCard('SE1 ' + '0'.repeat(396)).reason, 'checksum', 'exactly 400 characters is read, then refused on its content');
  assert.deepEqual(combine('SE1 …'), { ok: false, reason: 'cards-type' });
  assert.deepEqual(combine(new Array(MAX_CARDS + 1).fill(a[0])), { ok: false, reason: 'too-many' });
  assert.equal(combine(new Array(MAX_CARDS).fill(a[0])).reason, 'duplicate');
});

test('a card that reads but does not describe a set is refused as format', () => {
  const card = (k, n, x, shareLen = 4) => {
    const body = Uint8Array.of(k, n, x, 1, 2, 3, 4, ...new Uint8Array(shareLen));
    return 'SE1 ' + toBase32(Uint8Array.of(...body, ...sha256Bytes(Uint8Array.of(...new TextEncoder().encode('SE1'), ...body)).slice(0, 4)));
  };
  assert.equal(readCard(card(2, 3, 1)).ok, true);
  assert.equal(readCard(card(2, 2, 2)).ok, true);
  assert.equal(readCard(card(MAX_CARDS, MAX_CARDS, MAX_CARDS)).ok, true);
  assert.equal(readCard(card(2, 3, 1, MAX_SECRET)).ok, true);
  assert.equal(readCard(card(2, 3, 1, 1)).ok, true);
  for (const [k, n, x, len] of [[1, 3, 1], [0, 3, 1], [3, 2, 1], [2, MAX_CARDS + 1, 1], [2, 3, 0], [2, 3, 4], [2, 3, 1, MAX_SECRET + 1], [2, 3, 1, 0]]) {
    assert.equal(readCard(card(k, n, x, len)).reason, 'format', [k, n, x, len].join('/'));
  }
});

test('split refuses what it cannot do safely, and never throws', () => {
  assert.equal(split(new Uint8Array(0)).reason, 'secret');
  assert.equal(split(new Uint8Array(MAX_SECRET + 1)).reason, 'secret');
  assert.equal(split(new Uint8Array(MAX_SECRET)).ok, true);
  assert.equal(split(Array.from(SECRET)).reason, 'secret');
  assert.equal(split('secret').reason, 'secret');
  assert.equal(split(SECRET, { k: 1, n: 3 }).reason, 'threshold', 'one card would BE the key');
  assert.equal(split(SECRET, { k: 4, n: 3 }).reason, 'threshold');
  assert.equal(split(SECRET, { k: 2, n: MAX_CARDS + 1 }).reason, 'threshold');
  assert.equal(split(SECRET, { k: 2, n: MAX_CARDS }).ok, true);
  assert.equal(split(SECRET, { k: 3, n: 3 }).ok, true);
  assert.equal(split(SECRET, { k: 2.5, n: 3 }).reason, 'threshold');
  assert.equal(split(SECRET, { k: 2, n: '3' }).reason, 'threshold');
  assert.equal(split(SECRET, { random: () => new Uint8Array(31) }).reason, 'random');
  assert.equal(split(SECRET, { random: () => new Uint8Array(33) }).reason, 'random');
  assert.equal(split(SECRET, { k: 3, n: 3, random: () => new Uint8Array(32) }).reason, 'random', 'K−1 coefficient rows are drawn');
  assert.equal(split(SECRET, { k: 3, n: 3, random: () => new Uint8Array(64) }).ok, true);
  assert.equal(split(SECRET, { random: () => Array(32).fill(0) }).reason, 'random');
  assert.equal(split(SECRET, { random: () => { throw new Error('no entropy'); } }).reason, 'fault');
  // the coefficients are wiped after use
  const coef = new Uint8Array(32).fill(9);
  split(SECRET, { random: () => coef });
  assert.ok(coef.every((v) => v === 0));
  const toxic = { get k() { throw new Error('boom'); } };
  assert.equal(split(SECRET, toxic).reason, 'fault');
  for (const [label, v] of hostileInputs()) {
    assert.doesNotThrow(() => split(v), label);
    assert.doesNotThrow(() => split(SECRET, v), label);
    assert.doesNotThrow(() => readCard(v), label);
    assert.doesNotThrow(() => combine(v), label);
    assert.doesNotThrow(() => combine([v, v]), label);
    assert.equal(combine([v]).ok, false, label);
    assert.equal(readCard(v).ok, false, label);
  }
  const arrToxic = [];
  Object.defineProperty(arrToxic, 0, { get() { throw new Error('boom'); } });
  arrToxic.length = 2;
  assert.deepEqual(combine(arrToxic), { ok: false, reason: 'fault' });
});
