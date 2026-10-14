import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, toHex, fromHex, utf8, fromUtf8 } from '../src/canon.mjs';

test('sorted keys, no whitespace, nested', () => {
  assert.equal(canonical({ b: 1, a: [true, null, 'x'], c: { z: 0, y: -3 } }), '{"a":[true,null,"x"],"b":1,"c":{"y":-3,"z":0}}');
});

test('scalars', () => {
  assert.equal(canonical(null), 'null');
  assert.equal(canonical(true), 'true');
  assert.equal(canonical(false), 'false');
  assert.equal(canonical(0), '0');
  assert.equal(canonical(-0), '0');
  assert.equal(canonical(Number.MAX_SAFE_INTEGER), '9007199254740991');
  assert.equal(canonical('a"b'), '"a\\"b"');
});

test('rejects non-integers and non-JSON values', () => {
  assert.throws(() => canonical(1.5));
  assert.throws(() => canonical(NaN));
  assert.throws(() => canonical(Infinity));
  assert.throws(() => canonical(Number.MAX_SAFE_INTEGER + 1));
  assert.throws(() => canonical(undefined));
  assert.throws(() => canonical(() => 1));
  assert.throws(() => canonical(new Date(0)));
  assert.throws(() => canonical(new Map()));
  assert.throws(() => canonical(1n));
});

test('null-prototype objects are plain', () => {
  const o = Object.create(null);
  o.b = 2; o.a = 1;
  assert.equal(canonical(o), '{"a":1,"b":2}');
});

test('hex round-trip and strictness', () => {
  const b = new Uint8Array([0, 1, 15, 16, 255]);
  assert.equal(toHex(b), '00010f10ff');
  assert.deepEqual(fromHex('00010f10ff'), b);
  assert.deepEqual(fromHex(''), new Uint8Array(0));
  assert.throws(() => fromHex('abc'));
  assert.throws(() => fromHex('AB'));
  assert.throws(() => fromHex('zz'));
  assert.throws(() => fromHex(12));
});

test('utf8 round-trip; fatal on bad bytes', () => {
  assert.equal(fromUtf8(utf8('£€✓')), '£€✓');
  assert.throws(() => fromUtf8(new Uint8Array([0xff, 0xfe])));
});
