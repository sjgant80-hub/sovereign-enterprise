import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeSignal, decodeSignal, stripSdp, checkSdp, fingerprintOf, bindText, parseMessage, isMember,
  createSyncSession, connectAsHost, connectAsGuest, attachSession, LIMITS, SIGNAL_VERSION, BIND_TAG, ICE_SERVERS,
} from '../src/rtc.mjs';
import { createNode, pull, signEnvelope } from '../src/node.mjs';
import { fromSeed, sign } from '../src/keys.mjs';
import { sha256, sha256Bytes } from '../src/sha256.mjs';
import { canonical, utf8, toHex } from '../src/canon.mjs';
import { prng } from '../src/sim.mjs';

// ── fixtures: realistic SDPs (documentation-range addresses only: 192.0.2/24, 198.51.100/24, 203.0.113/24) ─────────
const FPX = (seed) => 'sha-256 ' + toHex(sha256Bytes(seed)).toUpperCase().match(/../g).join(':');
const FA = FPX('link-a'), FB = FPX('link-b');
function chromeSdp({ fp = FPX('chrome'), ufrag = 'Xk3p', pwd = '9vQ2mWlC0rTq7sYbN5hJ8dFe', setup = 'actpass', cands = 3, port = 54321 } = {}) {
  const host = '4f7c2e1a-8d3b-4c6e-9a1f-2b5d7e9c0a13.local';
  const known = [
    `a=candidate:2999745851 1 udp 2122260223 ${host} ${port} typ host generation 0 network-id 1 network-cost 10`,
    `a=candidate:842163049 1 udp 1686052607 203.0.113.7 ${port} typ srflx raddr 0.0.0.0 rport 0 generation 0 network-id 1 network-cost 10`,
    `a=candidate:1510613869 1 tcp 1518280447 ${host} 9 typ host tcptype active generation 0 network-id 1 network-cost 10`,
  ];
  const c = [];
  for (let i = 0; i < cands; i++) c.push(i < 3 ? known[i] : `a=candidate:${1000 + i} 1 udp ${2122260000 - i} 192.0.2.${i} ${40000 + i} typ host generation 0 network-id 2`);
  return ['v=0', 'o=- 7614219274584779017 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=extmap-allow-mixed', 'a=msid-semantic: WMS',
    `m=application ${port} UDP/DTLS/SCTP webrtc-datachannel`, 'c=IN IP4 203.0.113.7', ...c,
    `a=ice-ufrag:${ufrag}`, `a=ice-pwd:${pwd}`, 'a=ice-options:trickle', `a=fingerprint:${fp}`, `a=setup:${setup}`, 'a=mid:0',
    'a=sctp-port:5000', 'a=max-message-size:262144', ''].join('\r\n');
}
function firefoxSdp({ fp = FPX('firefox') } = {}) {
  const host = 'a1b2c3d4-e5f6-4789-a012-3456789abcde.local';
  return ['v=0', 'o=mozilla...THIS_IS_SDPARTA-99.0 3845019574323477163 0 IN IP4 0.0.0.0', 's=-', 't=0 0', 'a=sendrecv',
    `a=fingerprint:${fp.toLowerCase().replace('sha-256', 'sha-256')}`, 'a=group:BUNDLE 0', 'a=ice-options:trickle', 'a=msid-semantic:WMS *',
    'm=application 61234 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 198.51.100.23',
    `a=candidate:0 1 UDP 2122252543 ${host} 61234 typ host`, 'a=candidate:1 1 UDP 1686052863 198.51.100.23 61234 typ srflx raddr 0.0.0.0 rport 0',
    `a=candidate:2 1 TCP 2105524479 ${host} 9 typ host tcptype active`, 'a=candidate:3 1 UDP 2122187007 2001:db8::7 61235 typ host',
    'a=sendrecv', 'a=end-of-candidates', 'a=ice-pwd:6f1d2c3b4a5e6f7a8b9c0d1e2f3a4b5c', 'a=ice-ufrag:9a8b7c6d', 'a=mid:0', 'a=setup:actpass',
    'a=sctp-port:5000', 'a=max-message-size:1073741823', ''].join('\r\n');
}
const STRIPPED = stripSdp(chromeSdp());
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const codeOf = (head, body) => head + '.' + body + '.' + sha256(head + '.' + body).slice(0, 8);   // a code with a GOOD checksum
async function deflated(text) {
  const s = new Blob([utf8(text)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
/** A stripped SDP of exactly n characters (the ice-pwd is padded). */
function sdpOfLength(n) {
  const base = stripSdp(chromeSdp({ pwd: 'p' }));
  return base.replace('a=ice-pwd:p\r\n', 'a=ice-pwd:p' + 'q'.repeat(n - base.length) + '\r\n');
}

// ── 1. THE CODE ────────────────────────────────────────────────────────────────────────────────────────────────────

test('encode → decode round-trips a Chrome-shaped and a Firefox-shaped SDP, deflated and plain, offer and answer', async () => {
  for (const [sdp, fp] of [[chromeSdp(), FPX('chrome')], [firefoxSdp(), FPX('firefox')], [chromeSdp({ cands: 9, setup: 'active' }), FPX('chrome')]]) {
    const stripped = stripSdp(sdp);
    assert.ok(stripped);
    for (const bad of ['a=extmap-allow-mixed', 'a=msid-semantic', 'a=ice-options', 'a=sendrecv']) assert.equal(stripped.includes(bad), false, bad);
    assert.equal(stripped.split('a=candidate:').length, sdp.split('a=candidate:').length);     // every candidate kept
    for (const type of ['offer', 'answer']) {
      const runs = [[undefined, 'z'], [{}, 'z'], [{ deflate: true }, 'z'], [{ deflate: false }, 'p']];
      const lens = {};
      for (const [opts, mode] of runs) {
        const e = await encodeSignal({ type, sdp }, opts);
        assert.equal(e.ok, true);
        assert.equal(e.code.slice(0, 7), SIGNAL_VERSION + '.' + type[0] + mode + '.');
        assert.ok(e.code.length <= LIMITS.code);
        lens[mode] = e.code.length;
        const d = await decodeSignal(e.code);
        assert.deepEqual(d, { ok: true, type, sdp: stripped, fingerprint: fp });
        assert.equal((await decodeSignal(e.code, { expect: type })).ok, true);
      }
      assert.ok(lens.z < lens.p, 'deflate makes the code shorter');
    }
  }
  // an RTCSessionDescription-like object with getters, as the browser hands it over
  const desc = { get type() { return 'offer'; }, get sdp() { return chromeSdp(); }, toJSON() { return {}; } };
  assert.equal((await decodeSignal((await encodeSignal(desc)).code)).sdp, STRIPPED);
});

test('with no CompressionStream the code falls back to plain, and still decodes', async () => {
  const saved = globalThis.CompressionStream;
  let e;
  try {
    delete globalThis.CompressionStream;
    e = await encodeSignal({ type: 'offer', sdp: chromeSdp() });
  } finally {
    globalThis.CompressionStream = saved;
  }
  assert.equal(e.code.slice(0, 7), 'SE1.op.');
  assert.equal((await decodeSignal(e.code)).sdp, STRIPPED);
});

test('a pasted code survives line wraps and stray spaces; the raw paste is bounded before any work', async () => {
  const { code } = await encodeSignal({ type: 'answer', sdp: chromeSdp() });
  const wrapped = '  ' + code.match(/.{1,60}/g).join('\r\n ') + '\n\t';
  assert.equal((await decodeSignal(wrapped)).sdp, STRIPPED);
  const padded = code + ' '.repeat(LIMITS.code * 4 - code.length);
  assert.equal(padded.length, LIMITS.code * 4);
  assert.equal((await decodeSignal(padded)).ok, true);                             // exactly at the bound: read
  assert.equal((await decodeSignal(padded + ' ')).reason, 'code-size');            // one past it: refused unread
});

test('decode refuses a tampered, truncated, mis-versioned, mis-typed or garbage code — each for its own reason', async () => {
  const { code: offer } = await encodeSignal({ type: 'offer', sdp: chromeSdp() });
  const { code: answer } = await encodeSignal({ type: 'answer', sdp: chromeSdp() });
  const [, , body] = offer.split('.');
  const flip = (s, i) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
  assert.equal((await decodeSignal(flip(offer, 20))).reason, 'code-checksum');
  assert.equal((await decodeSignal(offer.slice(0, -1) + (offer.endsWith('0') ? '1' : '0'))).reason, 'code-checksum');
  assert.equal((await decodeSignal(offer.slice(0, offer.length - 20))).reason, 'code-version');   // the checksum part cut off
  for (const j of [undefined, null, 1, {}, [], () => 1]) assert.equal((await decodeSignal(j)).reason, 'code-type');
  assert.equal((await decodeSignal('')).reason, 'code-version');
  assert.equal((await decodeSignal(codeOf('SE2.oz', body))).reason, 'code-version');
  assert.equal((await decodeSignal(offer + '.x')).reason, 'code-version');
  assert.equal((await decodeSignal(codeOf('SE1.xz', body))).reason, 'code-kind');
  assert.equal((await decodeSignal(codeOf('SE1.oq', body))).reason, 'code-kind');
  assert.equal((await decodeSignal(codeOf('SE1.ozz', body))).reason, 'code-kind');
  assert.equal((await decodeSignal(codeOf('SE1.o', body))).reason, 'code-kind');
  assert.equal((await decodeSignal(codeOf('SE1.az', body))).type, 'answer');       // the kind is the code's own claim …
  assert.equal((await decodeSignal(offer, { expect: 'answer' })).reason, 'wrong-kind');   // … checked against what the caller expects
  assert.equal((await decodeSignal(answer, { expect: 'offer' })).reason, 'wrong-kind');
  assert.equal((await decodeSignal(answer, { expect: 'answer' })).type, 'answer');
  assert.equal((await decodeSignal(answer, {})).type, 'answer');
  assert.equal((await decodeSignal(codeOf('SE1.op', 'ab*d'))).reason, 'code-base64');
  assert.equal((await decodeSignal(codeOf('SE1.op', 'AAAAA'))).reason, 'code-base64');
  assert.equal((await decodeSignal(codeOf('SE1.oz', b64u(new Uint8Array([0xff, 0xff, 0xff, 0xff]))))).reason, 'code-inflate');
  assert.equal((await decodeSignal(codeOf('SE1.op', b64u(new Uint8Array([0x76, 0x3d, 0xff, 0xfe]))))).reason, 'code-utf8');
  const noFp = stripSdp(chromeSdp()).replace(/a=fingerprint:[^\r]*\r\n/, '');
  assert.equal((await decodeSignal(codeOf('SE1.op', b64u(utf8(noFp))))).reason, 'sdp-fingerprint');
  assert.equal((await decodeSignal(codeOf('SE1.op', b64u(utf8(chromeSdp()))))).reason, 'sdp-line');   // unstripped: refused, not trusted
  assert.equal((await encodeSignal({ type: 'pranswer', sdp: chromeSdp() })).reason, 'type');
  assert.equal((await encodeSignal({ type: 'offer', sdp: noFp })).reason, 'sdp');
});

test('a deflate bomb stops at LIMITS.sdp; an SDP of exactly LIMITS.sdp still travels, deflated and plain', async () => {
  const bomb = await deflated('v=0\r\n' + 'a'.repeat(1_000_000));
  const bombCode = codeOf('SE1.oz', b64u(bomb));
  assert.ok(bombCode.length < 2000);
  assert.equal((await decodeSignal(bombCode)).reason, 'sdp-size');
  const max = sdpOfLength(LIMITS.sdp);
  assert.equal(max.length, LIMITS.sdp);
  assert.equal(checkSdp(max).ok, true);
  for (const opts of [undefined, { deflate: false }]) {
    const e = await encodeSignal({ type: 'offer', sdp: max }, opts);
    assert.ok(e.code.length <= LIMITS.code, 'a max-size SDP always fits a code');
    assert.equal((await decodeSignal(e.code)).sdp, max);
  }
  const over = sdpOfLength(LIMITS.sdp + 1);
  assert.equal(over.length, LIMITS.sdp + 1);
  assert.equal(checkSdp(over).reason, 'sdp-size');
  assert.equal((await encodeSignal({ type: 'offer', sdp: over })).reason, 'sdp');
  assert.equal((await decodeSignal(codeOf('SE1.oz', b64u(await deflated(over))))).reason, 'sdp-size');   // stopped while inflating
  assert.equal((await decodeSignal(codeOf('SE1.op', b64u(utf8(over))))).reason, 'sdp-size');
});

test('the code bound: exactly LIMITS.code characters is read, one more is refused unread', async () => {
  const at = 'SE1.op.'.length + 1 + 8;
  const exact = codeOf('SE1.op', 'A'.repeat(LIMITS.code - at));
  assert.equal(exact.length, LIMITS.code);
  assert.equal((await decodeSignal(exact)).reason, 'sdp-size');                   // read — and refused on what it holds
  assert.equal((await decodeSignal(codeOf('SE1.op', 'A'.repeat(LIMITS.code - at + 1)))).reason, 'code-size');
});

test('checkSdp / stripSdp hand WebRTC only a single data-channel description with one fingerprint', () => {
  const ok = STRIPPED;
  assert.deepEqual(checkSdp(ok), { ok: true, fingerprint: FPX('chrome') });
  for (const j of [undefined, null, 5, {}, []]) assert.equal(checkSdp(j).reason, 'sdp-type');
  assert.equal(checkSdp(ok + 'a=mid:0').reason, 'sdp-shape');                                        // not CRLF-terminated
  const lines = ok.split('\r\n');
  assert.equal(checkSdp([lines[1], lines[0], ...lines.slice(2)].join('\r\n')).reason, 'sdp-shape');  // v=0 not first
  assert.equal(checkSdp(ok.replace('a=mid:0\r\n', 'a=mid:0\r\na=extmap-allow-mixed\r\n')).reason, 'sdp-line');
  assert.equal(checkSdp(ok.replace('a=mid:0', 'a=mid:é0')).reason, 'sdp-line');
  assert.equal(checkSdp(ok.replace('a=mid:0', 'a=mid:\u00010')).reason, 'sdp-line');
  assert.equal(checkSdp(ok.replace('a=mid:0\r\n', 'a=mid:0\r\n\r\n')).reason, 'sdp-line');           // an empty line
  assert.equal(checkSdp(ok.replace('a=ice-ufrag:Xk3p\r\n', 'a=ice-ufrag:Xk3p\r\na=ice-ufrag:Zz9q\r\n')).reason, 'sdp-once');
  assert.equal(checkSdp(ok.replace(/a=ice-pwd:[^\r]*\r\n/, '')).reason, 'sdp-once');
  assert.equal(checkSdp(ok.replace('m=application 54321 UDP/DTLS/SCTP webrtc-datachannel', 'm=audio 9 UDP/TLS/RTP/SAVPF 111')).reason, 'sdp-media');
  assert.equal(checkSdp(stripSdp(chromeSdp({ cands: LIMITS.candidates }))).ok, true);
  assert.equal(checkSdp(stripSdp(chromeSdp({ cands: 0 }))).ok, true);
  assert.equal(stripSdp(chromeSdp({ cands: LIMITS.candidates + 1 })), null);
  assert.equal(checkSdp(chromeSdp({ cands: LIMITS.candidates + 1 }).replace(/a=(extmap|msid|ice-options)[^\r]*\r\n/g, '')).reason, 'sdp-candidates');
  const twoFp = ok.replace('a=mid:0\r\n', 'a=mid:0\r\na=fingerprint:' + FPX('other') + '\r\n');
  assert.equal(checkSdp(twoFp).reason, 'sdp-fingerprint');
  const sameFpTwice = ok.replace('a=mid:0\r\n', 'a=mid:0\r\na=fingerprint:' + FPX('chrome') + '\r\n');
  assert.equal(checkSdp(sameFpTwice).ok, true);
  // stripSdp: LF-only input is accepted; the input bound is exact
  assert.equal(stripSdp(chromeSdp().replace(/\r\n/g, '\n')), STRIPPED);
  const raw = chromeSdp();
  const pad = (n) => raw + 'x=' + 'y'.repeat(n - raw.length - 4) + '\r\n';
  assert.equal(pad(LIMITS.sdpIn).length, LIMITS.sdpIn);
  assert.equal(stripSdp(pad(LIMITS.sdpIn)), STRIPPED);
  assert.equal(stripSdp(pad(LIMITS.sdpIn + 1)), null);
  for (const j of [undefined, null, 5, {}, [], 'v=0']) assert.equal(stripSdp(j), null);
});

test('fingerprintOf: the one certificate an SDP commits to, upper-cased; none, two, or an oversize SDP → null', () => {
  assert.equal(fingerprintOf(firefoxSdp()), FPX('firefox'));                     // a lower-case line is normalised
  assert.equal(fingerprintOf(chromeSdp()), FPX('chrome'));
  assert.equal(fingerprintOf('v=0\r\n'), null);
  assert.equal(fingerprintOf(chromeSdp() + 'a=fingerprint:' + FPX('b') + '\r\n'), null);
  const big = (n) => chromeSdp() + ' '.repeat(n - chromeSdp().length);
  assert.equal(fingerprintOf(big(LIMITS.sdpIn)), FPX('chrome'));
  assert.equal(fingerprintOf(big(LIMITS.sdpIn + 1)), null);
  for (const j of [undefined, null, 1, {}, []]) assert.equal(fingerprintOf(j), null);
});

// ── 2. THE SESSION ─────────────────────────────────────────────────────────────────────────────────────────────────

const KEYS = [];
for (let i = 0; i < 6; i++) KEYS.push(await fromSeed(sha256Bytes('rtc-test/' + i)));
const G = KEYS[0].pub;
const dev = (i, genesis = G) => ({ keys: KEYS[i], node: createNode({ keys: KEYS[i], genesis, name: 'd' + i }) });
async function writes(d, prefix, n) {
  for (let i = 0; i < n; i++) assert.equal((await d.node.put('tasks', prefix + i, { title: prefix + ' ' + i })).ok, true);
}
/** n signed puts by device d, each naming the one before (the per-writer hash chain), taken through the gate as one batch
 *  (fast fixtures: one gate pass instead of n puts). */
async function bulk(d, prefix, n) {
  const tip = d.node.tip();
  const l0 = d.node.clock();
  const list = [];
  let prev = tip.hash;
  for (let i = 0; i < n; i++) {
    const b = await signEnvelope(d.keys, { k: 'put', c: 'tasks', id: prefix + i, f: { title: prefix + ' ' + i }, l: l0 + 1 + i }, tip.seq + 1 + i, prev);
    prev = toHex(sha256Bytes(b));
    list.push(b);
  }
  assert.equal(await d.node.take(list), n);
}
/** Two sessions joined by an in-memory link. box.toA / box.toB hold what is in flight; sentA / sentB every message sent. */
function pair(a, b, { fa = FA, fb = FB, ra = fb, rb = fa, oa = {}, ob = {} } = {}) {
  const box = { toA: [], toB: [], sentA: [], sentB: [] };
  const sa = createSyncSession({ node: a.node, keys: a.keys, local: fa, remote: ra, send: (m) => { box.toB.push(m); box.sentA.push(JSON.parse(m)); }, ...oa });
  const sb = createSyncSession({ node: b.node, keys: b.keys, local: fb, remote: rb, send: (m) => { box.toA.push(m); box.sentB.push(JSON.parse(m)); }, ...ob });
  return { sa, sb, box };
}
/** Deliver until both directions are empty. net(m) → copies to deliver (0 lost, 2 duplicated); pick(n) → which queued one. */
async function pump(p, net = () => 1, pick = () => 0) {
  for (let guard = 0; p.box.toA.length || p.box.toB.length; guard++) {
    if (guard > 60000) throw new Error('no quiescence');
    for (const [q, s] of [[p.box.toB, p.sb], [p.box.toA, p.sa]]) {
      if (!q.length) continue;
      const m = q.splice(Math.min(pick(q.length), q.length - 1), 1)[0];
      for (let c = net(m); c > 0; c--) await s.onMessage(m);
    }
  }
}
const kinds = (sent) => sent.map((m) => m.t);
/** Deliver one message at a time until pred() holds; throws (never spins) if the link goes quiet first. */
async function stepUntil(p, pred) {
  for (let g = 0; !pred(); g++) {
    if (g > 5000 || !(p.box.toA.length || p.box.toB.length)) throw new Error('the link went quiet before it happened');
    const q = p.box.toB.length ? [p.box.toB, p.sb] : [p.box.toA, p.sa];
    await q[1].onMessage(q[0].shift());
  }
}
const count = (sent, t) => sent.filter((m) => m.t === t).length;
async function members() {
  const a = dev(0), b = dev(1);
  await a.node.grant('g-b', KEYS[1].pub, 'admin', ['*']);
  await pull(b.node, a.node);
  return { a, b };
}

test('two devices on a link converge — each sent exactly what the other lacked, every byte through the gate', async () => {
  const { a, b } = await members();
  await bulk(a, 'a', 20);
  await writes(b, 'b', 7);
  await b.node.typeAt('docs', 'plan', 0, 'hi');
  const aLacks = b.node.hashes().filter((h) => !a.node.has(h)).length;
  const bLacks = a.node.hashes().filter((h) => !b.node.has(h)).length;
  assert.deepEqual([aLacks, bLacks], [9, 20]);
  const p = pair(a, b);
  assert.equal(p.sa.start().state, 'binding');
  p.sb.start();
  await pump(p);
  assert.equal(a.node.digest(), b.node.digest());
  assert.equal(a.node.fingerprint(), b.node.fingerprint());
  assert.equal(b.node.text('docs', 'plan'), 'hi');
  const ia = p.sa.info(), ib = p.sb.info();
  for (const i of [ia, ib]) {
    assert.equal(i.state, 'live');
    assert.equal(i.proven, true);
    assert.equal(i.sharing, true);
    assert.deepEqual([i.replay, i.refused, i.strikes, i.dropped], [0, 0, 0, 0]);
  }
  assert.equal(ia.peer, KEYS[1].pub);
  assert.equal(ib.peer, KEYS[0].pub);
  assert.equal(ia.admitted, aLacks);
  assert.equal(ib.admitted, bLacks);
  assert.equal(count(p.box.sentA, 'env'), bLacks);                  // nothing the peer already had, nothing echoed back
  assert.equal(count(p.box.sentB, 'env'), aLacks);
  assert.equal(ia.in, p.box.sentB.length);
  assert.equal(ia.out, p.box.sentA.length);
});

test('a live write is pushed once, with no new round; a quiet link stays quiet on tick', async () => {
  const { a, b } = await members();
  await writes(a, 'a', 3);
  const p = pair(a, b);
  p.sa.start(); p.sb.start();
  await pump(p);
  const before = [p.box.sentA.length, p.box.sentB.length];
  p.sa.tick(); p.sb.tick();
  await pump(p);
  assert.deepEqual([kinds(p.box.sentA.slice(before[0])), kinds(p.box.sentB.slice(before[1]))], [['sum'], ['sum']], 'a quiet link: one digest each way, no round');
  const mark = [p.box.sentA.length, p.box.sentB.length];
  const r = await a.node.put('tasks', 'live', { title: 'pushed' });
  assert.deepEqual(kinds(p.box.sentA.slice(mark[0])), ['env']);
  await pump(p);
  assert.equal(b.node.has(r.hash), true);
  assert.equal(p.box.sentB.length, mark[1], 'the receiver does not push it back');
  p.sa.tick(); p.sb.tick();
  await pump(p);
  assert.deepEqual([kinds(p.box.sentA.slice(mark[0] + 1)), kinds(p.box.sentB.slice(mark[1]))], [['sum'], ['sum']], 'after a push the digests already agree');
});

test('sum: an equal digest starts nothing; a differing one starts one round; mid-round, or from a peer it does not share with, it is ignored', async () => {
  const { a, b } = await members();
  await writes(a, 'a', 2);
  const p = pair(a, b);
  p.sa.start(); p.sb.start();
  await pump(p);
  const sum = (fp) => JSON.stringify({ t: 'sum', fp });
  let n = p.box.sentA.length;
  assert.deepEqual(await p.sa.onMessage(sum(b.node.fingerprint())), { ok: true, t: 'sum' });
  assert.equal(p.box.sentA.length, n, 'equal digests: nothing to do');
  await p.sa.onMessage(sum(sha256('elsewhere')));
  assert.deepEqual(kinds(p.box.sentA.slice(n)), ['have'], 'a differing digest: one round');
  n = p.box.sentA.length;
  await p.sa.onMessage(sum(sha256('elsewhere again')));
  assert.equal(p.box.sentA.length, n, 'a round already in flight is not restarted');
  await pump(p);
  assert.equal(a.node.fingerprint(), b.node.fingerprint());
  const s0 = dev(0), m = dev(3);
  await writes(s0, 's', 2);
  const q = pair(s0, m);
  q.sa.start(); q.sb.start();
  await pump(q);
  const k = q.box.sentA.length;
  await q.sa.onMessage(sum(sha256('stranger')));
  assert.equal(q.box.sentA.length, k, 'nothing is offered to a device this one does not share with');
});

test('a revoke in the middle of a round abandons it: the next tick offers nothing more', async () => {
  const a = dev(0), m = dev(3);
  await bulk(a, 'a', LIMITS.list + 5);
  const p = pair(a, m);
  p.sa.start(); p.sb.start();
  await pump(p);
  await a.node.grant('g-m', KEYS[3].pub, 'staff', ['tasks']);
  assert.equal(count(p.box.sentA, 'have'), 1, 'the grant started a round');
  await a.node.revoke('g-m', 0);
  p.box.toB.length = 0;                                                            // nothing in flight reaches it
  const n = p.box.sentA.length;
  p.sa.tick();
  assert.deepEqual(kinds(p.box.sentA.slice(n)), ['sum'], 'the abandoned chunk is not offered again');
  assert.equal(m.node.size(), 0);
});

test('a lossy, duplicating, reordering link still converges — binding included — with no strikes', async () => {
  for (const seed of [7, 11, 29]) {
    const rnd = prng(seed);
    const { a, b } = await members();
    await bulk(a, 'a', 40);
    await bulk(b, 'b', 25);
    const p = pair(a, b);
    p.sa.start(); p.sb.start();
    const net = () => { const r = rnd(); return r < 0.2 ? 0 : r < 0.32 ? 2 : 1; };
    const pick = (n) => Math.floor(rnd() * Math.min(n, 3));
    let t = 0;
    for (; t < 400 && a.node.fingerprint() !== b.node.fingerprint(); t++) { await pump(p, net, pick); p.sa.tick(); p.sb.tick(); }
    assert.ok(t < 400, 'converged under loss (seed ' + seed + ')');
    assert.equal(a.node.digest(), b.node.digest());
    for (const s of [p.sa, p.sb]) {
      const i = s.info();
      assert.equal(i.state, 'live');
      assert.deepEqual([i.refused, i.strikes], [0, 0]);
    }
    assert.ok(p.sa.info().replay + p.sb.info().replay > 0, 'duplicates arrived and were refused as replays');
  }
});

test('a device from a different company is refused at hello, and nothing crosses', async () => {
  const a = dev(0), x = dev(2, KEYS[2].pub);
  await writes(a, 'a', 3);
  await writes(x, 'x', 3);
  const p = pair(a, x);
  p.sa.start(); p.sb.start();
  await pump(p);
  for (const s of [p.sa, p.sb]) assert.deepEqual([s.info().state, s.info().reason], ['refused', 'company-mismatch']);
  assert.deepEqual([a.node.size(), x.node.size()], [3, 3]);
  for (const sent of [p.box.sentA, p.box.sentB]) assert.deepEqual(kinds(sent), ['hello']);
});

test('a man in the middle of the copy-paste cannot splice in: each end sees a different certificate pair, no proof verifies', async () => {
  const { a, b } = await members();
  await writes(a, 'a', 5);
  // Mallory swapped both codes for her own: A's link ends at her certificate M1, B's at M2. She relays every byte verbatim.
  const p = pair(a, b, { ra: FPX('mallory-1'), rb: FPX('mallory-2') });
  p.sa.start(); p.sb.start();
  await pump(p);
  for (const s of [p.sa, p.sb]) assert.deepEqual([s.info().state, s.info().reason, s.info().proven], ['refused', 'proof', false]);
  for (const sent of [p.box.sentA, p.box.sentB]) assert.deepEqual(kinds(sent), ['hello', 'proof']);
  assert.equal(b.node.size(), 1);                                                    // only the grant it already held
});

test('a stranger who holds the code proves its key but is offered nothing — until the owner grants it; a revoke stops the flow', async () => {
  const a = dev(0), m = dev(3);
  await writes(a, 'a', 4);
  const flips = [];
  const p = pair(a, m, { oa: { onUpdate: (i) => flips.push(i.sharing) } });
  p.sa.start(); p.sb.start();
  await pump(p);
  const ia = p.sa.info();
  assert.deepEqual([ia.state, ia.proven, ia.sharing], ['live', true, false]);
  assert.equal(m.node.size(), 0);
  assert.deepEqual(kinds(p.box.sentA), ['hello', 'proof']);
  p.sa.tick();                                                                       // a tick does not start a round for a stranger
  await pump(p);
  assert.deepEqual(kinds(p.box.sentA), ['hello', 'proof', 'sum']);
  assert.equal(p.sb.info().sharing, true);                                           // the stranger may share with the owner (it holds nothing)
  // the owner admits that device — the session notices and offers everything at once
  await a.node.grant('g-m', KEYS[3].pub, 'staff', ['tasks']);
  assert.equal(p.sa.info().sharing, true);
  assert.equal(flips.at(-1), true, 'the view is told at once, before any message moves');
  await pump(p);
  assert.equal(m.node.digest(), a.node.digest());
  // revoked: nothing more goes to it — not the revoke, not the next write
  const sizeM = m.node.size();
  await a.node.revoke('g-m', 0);
  const r = await a.node.put('tasks', 'after', { title: 'secret' });
  assert.equal(r.ok, true);
  await pump(p);
  assert.equal(p.sa.info().sharing, false);
  assert.equal(flips.at(-1), false);
  assert.equal(m.node.size(), sizeM);
  assert.equal(m.node.has(r.hash), false);
});

test('a custom share policy is honoured, and a throwing one shares nothing', async () => {
  const a = dev(0), m = dev(3);
  await writes(a, 'a', 2);
  const p = pair(a, m, { oa: { mayShare: (pub) => pub === KEYS[3].pub } });
  p.sa.start(); p.sb.start();
  await pump(p);
  assert.equal(m.node.digest(), a.node.digest());
  const a2 = dev(0), m2 = dev(3);
  await writes(a2, 'a', 2);
  const q = pair(a2, m2, { oa: { mayShare: () => { throw new Error('policy down'); } } });
  q.sa.start(); q.sb.start();
  await pump(q);
  assert.deepEqual([q.sa.info().proven, q.sa.info().sharing, m2.node.size()], [true, false, 0]);
});

/** One started session for device b, and a way to feed it raw messages as device a would. */
function lone(i = 1, opts = {}) {
  const d = dev(i);
  const sent = [];
  const s = createSyncSession({ node: d.node, keys: d.keys, local: FB, remote: FA, send: (m) => sent.push(JSON.parse(m)), ...opts });
  return { d, s, sent };
}
const helloFrom = (k, over = {}) => JSON.stringify({ t: 'hello', v: 1, from: k.pub, genesis: G, nonce: 'ab'.repeat(16), ...over });
async function proofFor(k, verifierNonce, verifierPub, { proverFp = FA, verifierFp = FB, genesis = G } = {}) {
  const text = bindText(genesis, verifierNonce, k.pub, verifierPub, proverFp, verifierFp);
  return JSON.stringify({ t: 'proof', from: k.pub, sig: await sign(k, utf8(text)) });
}

test('binding: a hello is answered with a proof (again, if it is re-sent); forged, self, changed-identity and foreign peers are refused', async () => {
  const L = lone();
  L.s.start();
  assert.deepEqual(kinds(L.sent), ['hello']);
  assert.equal((await L.s.onMessage(helloFrom(KEYS[0]))).ok, true);
  assert.equal((await L.s.onMessage(helloFrom(KEYS[0]))).ok, true);
  assert.deepEqual(kinds(L.sent), ['hello', 'proof', 'proof']);
  assert.equal(L.sent[1].sig, L.sent[2].sig);
  assert.equal(L.sent[1].from, KEYS[1].pub);
  // the proof is over exactly the bind text, from b's side of this link
  const text = bindText(G, 'ab'.repeat(16), KEYS[1].pub, KEYS[0].pub, FB, FA);
  assert.equal(text, [BIND_TAG, G, 'ab'.repeat(16), KEYS[1].pub, KEYS[0].pub, FB, FA].join('|'));
  assert.equal(L.sent[1].sig, await sign(KEYS[1], utf8(text)));
  // a proof with a forged signature is refused
  assert.deepEqual(await L.s.onMessage(JSON.stringify({ t: 'proof', from: KEYS[0].pub, sig: 'cd'.repeat(64) })), { ok: false, reason: 'proof' });
  assert.equal(L.s.info().state, 'refused');
  assert.equal((await L.s.onMessage(helloFrom(KEYS[0]))).reason, 'refused');

  const S = lone();
  S.s.start();
  assert.deepEqual(await S.s.onMessage(helloFrom(KEYS[1])), { ok: false, reason: 'self' });
  const C = lone();
  C.s.start();
  await C.s.onMessage(helloFrom(KEYS[0]));
  assert.deepEqual(await C.s.onMessage(helloFrom(KEYS[2])), { ok: false, reason: 'peer-changed' });
  const N = lone();
  N.s.start();
  await N.s.onMessage(helloFrom(KEYS[0]));
  assert.deepEqual(await N.s.onMessage(helloFrom(KEYS[0], { nonce: 'cd'.repeat(16) })), { ok: false, reason: 'peer-changed' });
  const P = lone();
  P.s.start();
  await P.s.onMessage(helloFrom(KEYS[0]));
  assert.deepEqual(await P.s.onMessage(await proofFor(KEYS[2], P.sent[0].nonce, KEYS[1].pub)), { ok: false, reason: 'peer-changed' });
  const F = lone();
  F.s.start();
  assert.deepEqual(await F.s.onMessage(helloFrom(KEYS[0], { genesis: KEYS[2].pub })), { ok: false, reason: 'company-mismatch' });
  assert.equal(count(F.sent, 'proof'), 0);
});

test('binding: a valid proof — even ahead of the hello — makes the link live once; a proof for another link or company is refused', async () => {
  const V = lone();
  V.s.start();
  const nonce = V.sent[0].nonce;
  assert.match(nonce, /^[0-9a-f]{32}$/);
  const good = await proofFor(KEYS[0], nonce, KEYS[1].pub);
  assert.deepEqual(await V.s.onMessage(good), { ok: true, t: 'proof' });
  assert.deepEqual([V.s.info().state, V.s.info().proven, V.s.info().peer], ['live', true, KEYS[0].pub]);
  assert.deepEqual(await V.s.onMessage(good), { ok: true, t: 'proof', again: true });
  // the same key, answering THIS session's nonce — but made for another link, the ends swapped, or another company: refused
  for (const [label, opt] of [
    ['other link', { proverFp: FPX('elsewhere') }],
    ['swapped ends', { proverFp: FB, verifierFp: FA }],
    ['other company', { genesis: KEYS[2].pub }],
    ['the right proof', {}],
  ]) {
    const W = lone();
    W.s.start();
    const r = await W.s.onMessage(await proofFor(KEYS[0], W.sent[0].nonce, KEYS[1].pub, opt));
    assert.equal(r.ok ? 'live' : r.reason, label === 'the right proof' ? 'live' : 'proof', label);
  }
  // and a proof answering someone else's nonce (replayed from an earlier link) is refused
  const W = lone();
  W.s.start();
  assert.equal((await W.s.onMessage(await proofFor(KEYS[0], 'ab'.repeat(16), KEYS[1].pub))).reason, 'proof');
});

test('before the peer has proven its key, only hello and proof are heard', async () => {
  const L = lone();
  L.s.start();
  const fake = sha256('x');
  const { a } = await members();
  const env = a.node.bytes(a.node.hashes()[0]);
  for (const m of [{ t: 'have', i: 1, have: [fake] }, { t: 'want', i: 1, hashes: [fake] }, { t: 'sum', fp: fake }, { t: 'env', hex: toHex(env) }]) {
    assert.deepEqual(await L.s.onMessage(JSON.stringify(m)), { ok: false, reason: 'unproven' });
  }
  assert.equal(L.d.node.size(), 0);
  assert.deepEqual(kinds(L.sent), ['hello']);
  assert.equal(L.s.info().strikes, 0);
});

test('parseMessage: the exact grammar of every message, at every bound', () => {
  const h = sha256('h');
  const ok = (m) => assert.deepEqual(parseMessage(JSON.stringify(m)), { ok: true, m }, JSON.stringify(m).slice(0, 80));
  const bad = (m, reason) => assert.equal(parseMessage(typeof m === 'string' ? m : JSON.stringify(m)).reason, reason, String(JSON.stringify(m)).slice(0, 80));
  const hello = { t: 'hello', v: 1, from: KEYS[0].pub, genesis: G, nonce: 'ab'.repeat(16) };
  ok(hello);
  bad({ ...hello, v: 2 }, 'hello');
  bad({ ...hello, from: 'x' }, 'hello');
  bad({ ...hello, from: [KEYS[0].pub] }, 'hello');
  bad({ ...hello, genesis: G.toUpperCase() }, 'hello');
  bad({ ...hello, nonce: 'ab'.repeat(15) }, 'hello');
  bad({ ...hello, extra: 1 }, 'shape');
  const { v, ...noV } = hello;
  bad(noV, 'shape');
  bad({ ...noV, w: v }, 'shape');
  const proof = { t: 'proof', from: KEYS[0].pub, sig: 'cd'.repeat(64) };
  ok(proof);
  bad({ ...proof, from: 'cd'.repeat(32).toUpperCase() }, 'proof');
  bad({ ...proof, sig: 'cd'.repeat(63) }, 'proof');
  const list = (n) => Array.from({ length: n }, (_, i) => sha256('h' + i));
  for (const [t, f] of [['have', 'have'], ['want', 'hashes']]) {
    ok({ t, i: 1, [f]: [] });
    ok({ t, i: 1, [f]: list(LIMITS.list) });
    ok({ t, i: Number.MAX_SAFE_INTEGER, [f]: [h] });
    bad({ t, i: 1, [f]: list(LIMITS.list + 1) }, t);
    bad({ t, i: 0, [f]: [h] }, t);
    bad({ t, i: -3, [f]: [h] }, t);
    bad({ t, i: 1.5, [f]: [h] }, t);
    bad({ t, i: '1', [f]: [h] }, t);
    bad({ t, i: 1, [f]: [h, 'x'] }, t);
    bad({ t, i: 1, [f]: { length: 1 } }, t);
    bad({ t, i: 1, [f]: 'x'.repeat(64) }, t);
  }
  ok({ t: 'sum', fp: h });
  ok({ t: 'sum', fp: '0'.repeat(64) });
  bad({ t: 'sum', fp: h.toUpperCase() }, 'sum');
  bad({ t: 'sum', fp: [h] }, 'sum');
  bad({ t: 'sum', fp: h, n: 1 }, 'shape');
  ok({ t: 'env', hex: 'ab'.repeat(LIMITS.hex / 2) });
  bad({ t: 'env', hex: 'ab'.repeat(LIMITS.hex / 2 + 1) }, 'env');
  bad({ t: 'env', hex: 'abc' }, 'env');
  bad({ t: 'env', hex: 'AB' }, 'env');
  bad({ t: 'env', hex: '' }, 'env');
  bad({ t: 'env', hex: ['ab'] }, 'env');
  for (const t of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'bye', '']) bad({ t, hex: 'ab' }, 'shape');
  bad('{"t":"env","hex":"ab","__proto__":{"x":1}}', 'shape');
  for (const s of ['null', '1', '"env"', '[]', 'true', '{}']) bad(s, 'shape');
  bad('{"t":', 'json');
  bad('', 'json');
  for (const j of [undefined, null, 1, {}, [], new Uint8Array(4), () => 1]) assert.equal(parseMessage(j).reason, 'not-text');
  const sized = (n) => { const s = JSON.stringify(hello); return s + ' '.repeat(n - s.length); };
  assert.equal(parseMessage(sized(LIMITS.raw)).ok, true);
  assert.equal(parseMessage(sized(LIMITS.raw + 1)).reason, 'size');
});

test('a flood is bounded per peer: the token bucket is exact, refills with time, caps at a burst, and survives a broken clock', async () => {
  let now = 1000;
  const L = lone(1, { now: () => now });
  L.s.start();
  const msg = JSON.stringify({ t: 'have', i: 1, have: [] });
  const fire = async (n) => {
    const rs = await Promise.all(Array.from({ length: n }, () => L.s.onMessage(msg)));
    const by = {};
    for (const r of rs) by[r.reason] = (by[r.reason] || 0) + 1;
    return by;
  };
  assert.deepEqual(await fire(3000), { unproven: LIMITS.burst, rate: 3000 - LIMITS.burst });
  assert.deepEqual([L.s.info().in, L.s.info().dropped, L.s.info().strikes], [LIMITS.burst, 3000 - LIMITS.burst, 0]);
  now += 250;                                                                      // a quarter second refills a quarter of the rate
  assert.deepEqual(await fire(LIMITS.rate / 4 + 5), { unproven: LIMITS.rate / 4, rate: 5 });
  now += 3_600_000;                                                                // an hour refills no more than one burst
  assert.deepEqual(await fire(LIMITS.burst + 1), { unproven: LIMITS.burst, rate: 1 });
  now -= 10_000;                                                                   // a clock that runs backwards refills nothing
  assert.deepEqual(await fire(1), { rate: 1 });
  // a clock that returns junk refills nothing — the burst still bounds the peer
  const J = lone(1, { now: () => NaN });
  J.s.start();
  const rs = await Promise.all(Array.from({ length: LIMITS.burst + 3 }, () => J.s.onMessage(msg)));
  assert.equal(rs.filter((r) => r.reason === 'rate').length, 3);
});

test('malformed input costs the peer a strike; past LIMITS.strikes the link is refused as hostile', async () => {
  const L = lone();
  L.s.start();
  for (let i = 0; i < LIMITS.strikes; i++) assert.equal((await L.s.onMessage('{bad' + i)).reason, 'json');
  assert.deepEqual([L.s.info().state, L.s.info().strikes], ['binding', LIMITS.strikes]);
  await L.s.onMessage(7);
  assert.deepEqual([L.s.info().state, L.s.info().reason], ['refused', 'hostile']);
  assert.deepEqual(await L.s.onMessage(helloFrom(KEYS[0])), { ok: false, reason: 'refused' });
});

test('the gate decides every envelope: a forged one is a strike, a duplicate is a replay and not a strike', async () => {
  const { a, b } = await members();
  await writes(a, 'a', 2);
  const p = pair(a, b);
  p.sa.start(); p.sb.start();
  await pump(p);
  const bytes = a.node.bytes(a.node.hashes()[1]);
  const forged = bytes.slice();
  forged[forged.length - 5] ^= 1;                                                  // inside the signature hex: still valid JSON
  assert.equal(p.sb.info().admitted, 2);                                           // b lacked a's two writes (it held the grant)
  const r1 = await p.sb.onMessage(JSON.stringify({ t: 'env', hex: toHex(forged) }));
  assert.equal(r1.ok, false);
  const r2 = await p.sb.onMessage(JSON.stringify({ t: 'env', hex: toHex(bytes) }));
  assert.deepEqual(r2, { ok: false, reason: 'replay' });
  const r3 = await p.sb.onMessage(JSON.stringify({ t: 'env', hex: toHex(utf8('not an envelope')) }));
  assert.equal(r3.reason, 'magic');
  const i = p.sb.info();
  assert.deepEqual([i.refused, i.replay, i.strikes], [2, 1, 2]);
  // a fresh envelope pushed by the peer is admitted and counted
  const fresh = await a.node.put('tasks', 'z', { title: 'z' });
  await pump(p);
  assert.equal(b.node.has(fresh.hash), true);
  assert.equal(p.sb.info().admitted, 3);
});

test('rounds pace themselves: one chunk of at most LIMITS.list in flight, the want is the ack; stale wants are ignored', async () => {
  const { a, b } = await members();
  await bulk(a, 'a', LIMITS.list + 2);                                           // + the grant = list + 3
  const total = a.node.size();
  const p = pair(a, b);
  p.sa.start(); p.sb.start();
  // binding only: deliver until A has sent its first have, then stop
  await stepUntil(p, () => p.box.sentA.some((m) => m.t === 'have'));
  await pump({ ...p, box: { ...p.box, toB: [] } });                                // settle the rest of binding without the have
  assert.equal(count(p.box.sentA, 'have'), 1, 'one chunk in flight until the peer answers');
  await pump(p);
  const haves = p.box.sentA.filter((m) => m.t === 'have');
  assert.deepEqual(haves.map((m) => [m.i, m.have.length]), [[1, LIMITS.list], [2, total - LIMITS.list]]);
  assert.deepEqual(p.box.sentB.filter((m) => m.t === 'want').map((m) => [m.i, m.hashes.length]), [[1, LIMITS.list - 1], [2, total - LIMITS.list]]);
  assert.equal(b.node.fingerprint(), a.node.fingerprint());
  // the round is over: a re-played want (duplicated by the network) sends nothing
  const n = p.box.sentA.length;
  await p.sa.onMessage(JSON.stringify({ t: 'want', i: 2, hashes: haves[1].have }));
  await p.sa.onMessage(JSON.stringify({ t: 'want', i: 1, hashes: haves[0].have }));
  assert.equal(p.box.sentA.length, n);
  // an empty device announces nothing
  const e = pair(dev(0), dev(1, G));
  e.sa.start(); e.sb.start();
  await pump(e);
  assert.equal(count(e.box.sentA, 'have') + count(e.box.sentB, 'have'), 0);
});

test('a want is not a licence: only hashes of the chunk in flight are sent, once', async () => {
  const { a, b } = await members();
  await bulk(a, 'a', LIMITS.list + 5);
  const p = pair(a, b);
  p.sa.start(); p.sb.start();
  await stepUntil(p, () => p.box.sentA.some((m) => m.t === 'have'));
  const first = p.box.sentA.find((m) => m.t === 'have');
  const outside = a.node.hashes().find((h) => !first.have.includes(h));
  const n = p.box.sentA.length;
  await p.sa.onMessage(JSON.stringify({ t: 'want', i: first.i + 7, hashes: [first.have[3]] }));
  assert.equal(p.box.sentA.length, n, 'a want for a chunk id not in flight is ignored');
  await p.sa.onMessage(JSON.stringify({ t: 'want', i: first.i, hashes: [first.have[3], outside, sha256('not held')] }));
  const sent = p.box.sentA.slice(n);
  assert.deepEqual(kinds(sent), ['env', 'have']);                                  // the one in-chunk hash, then the next chunk
  assert.equal(sha256(Uint8Array.from(sent[0].hex.match(/../g), (x) => parseInt(x, 16))), first.have[3]);
});

test('tick: re-sends hello while binding, re-sends the unanswered chunk with the same id; a digest repairs a lost push', async () => {
  const L = lone();
  L.s.start();
  L.s.tick();
  assert.deepEqual(kinds(L.sent), ['hello', 'hello']);
  assert.equal(L.sent[0].nonce, L.sent[1].nonce);
  const { a, b } = await members();
  await writes(a, 'a', 3);
  const p = pair(a, b);
  p.sa.start(); p.sb.start();
  await pump(p, (m) => (JSON.parse(m).t === 'want' ? 0 : 1));                     // every want lost
  const haves = p.box.sentA.filter((m) => m.t === 'have');
  assert.equal(haves.length, 1);
  p.sa.tick();
  const again = p.box.sentA.filter((m) => m.t === 'have');
  assert.deepEqual(again[1], again[0], 'the same chunk, the same id');
  await pump(p);
  assert.equal(b.node.fingerprint(), a.node.fingerprint());
  const r = await a.node.put('tasks', 'lost', { title: 'dropped on the wire' });
  p.box.toB.length = 0;                                                            // the push is lost
  assert.equal(b.node.has(r.hash), false);
  p.sb.tick();                                                                     // b's digest no longer matches a's: a offers a round
  await pump(p);
  assert.equal(b.node.has(r.hash), true);
});

test('a session that is not bound to this device and this link refuses to start; messages before start are not heard', async () => {
  const b = dev(1);
  const base = { node: b.node, keys: b.keys, local: FB, remote: FA, send: () => {} };
  const ok = createSyncSession(base);
  assert.equal((await ok.onMessage(helloFrom(KEYS[0]))).reason, 'not-started');
  assert.equal(ok.start().state, 'binding');
  assert.equal(ok.start().state, 'binding');                                       // idempotent
  const badPub = 'z'.repeat(64);
  for (const over of [
    { send: 1 },
    { node: { ...b.node, pub: badPub }, keys: { ...b.keys, pub: badPub } },
    { node: { ...b.node, genesis: 'x' } },
    { keys: KEYS[2] },
    { local: 'x' },
    { remote: 'sha-256 AB' },
    { remote: FB },
    { node: { ...b.node, onChange: undefined } },
    { keys: { pub: KEYS[1].pub, priv: null } },
  ]) {
    let sends = 0;
    const s = createSyncSession({ ...base, send: () => { sends++; }, ...over });
    const i = s.start();
    if (over.keys && over.keys.priv === null) {
      // the key cannot sign: refused the moment a proof is needed
      assert.equal(i.state, 'binding');
      assert.equal((await s.onMessage(helloFrom(KEYS[0]))).reason, 'unbound');
      continue;
    }
    assert.deepEqual([i.state, i.reason, sends], ['refused', 'unbound', 0], JSON.stringify(Object.keys(over)));
  }
  for (const j of [undefined, null, 1, {}, { node: 1 }]) {
    const i = createSyncSession(j).start();
    assert.deepEqual([i.state, i.reason], ['refused', 'unbound']);
  }
});

test('onUpdate reports every state change; close ends the session for good', async () => {
  const seen = [];
  const { a, b } = await members();
  const p = pair(a, b, { oa: { onUpdate: (i) => seen.push(i.state) } });
  p.sa.start(); p.sb.start();
  await pump(p);
  assert.deepEqual([...new Set(seen)], ['binding', 'live']);
  p.sa.close('bye');
  assert.deepEqual([p.sa.info().state, p.sa.info().reason, seen.at(-1)], ['closed', 'bye', 'closed']);
  assert.deepEqual(await p.sa.onMessage(helloFrom(KEYS[1])), { ok: false, reason: 'closed' });
  const sent = p.box.sentA.length;
  await a.node.put('tasks', 'q', { title: 'after close' });
  p.sa.tick();
  assert.equal(p.box.sentA.length, sent, 'a closed session sends nothing, pushes nothing');
  p.sa.close('again');
  assert.equal(p.sa.info().reason, 'bye');
  const q = pair(dev(0), dev(1));
  q.sa.close({ toString() { throw new Error('x'); } });
  assert.deepEqual([q.sa.info().state, q.sa.info().reason], ['closed', 'closed']);
  const r = pair(dev(0), dev(1));
  r.sa.close('x'.repeat(500));
  assert.equal(r.sa.info().reason.length, 64);
  const t = pair(dev(0), dev(1), { oa: { onUpdate: () => { throw new Error('view down'); } } });
  t.sa.start(); t.sb.start();
  await pump(t);
  assert.equal(t.sa.info().state, 'live');
});

test('the peer\'s hashes are remembered up to LIMITS.known, then forgotten in one go (memory stays bounded)', async () => {
  const a = dev(0), b = dev(1);
  const p = pair(a, b);
  p.sa.start(); p.sb.start();
  await pump(p);
  assert.equal(p.sb.info().known, 0);
  let k = 0;
  const batch = () => JSON.stringify({ t: 'have', i: 1, have: Array.from({ length: LIMITS.list }, () => (k++).toString(16).padStart(64, '0')) });
  for (let i = 0; i < LIMITS.known / LIMITS.list; i++) await p.sb.onMessage(batch());
  assert.equal(p.sb.info().known, LIMITS.known);
  await p.sb.onMessage(JSON.stringify({ t: 'have', i: 1, have: [sha256('one more')] }));
  assert.equal(p.sb.info().known, 1);
});

test('isMember reads the company\'s own role tree: owner, admin, staff yes; revoked, stranger, junk no', async () => {
  const { a } = await members();
  await a.node.grant('g-s', KEYS[2].pub, 'staff', ['tasks']);
  await a.node.grant('g-r', KEYS[4].pub, 'staff', ['tasks']);
  await a.node.revoke('g-r', 0);
  assert.equal(isMember(a.node, G), true);
  assert.equal(isMember(a.node, KEYS[1].pub), true);
  assert.equal(isMember(a.node, KEYS[2].pub), true);
  assert.equal(isMember(a.node, KEYS[4].pub), false);
  assert.equal(isMember(a.node, KEYS[3].pub), false);
  for (const j of [undefined, null, 'x', [G], {}]) assert.equal(isMember(a.node, j), false);
  for (const j of [undefined, null, {}, { genesis: 1 }]) assert.equal(isMember(j, KEYS[1].pub), false);
});

test('bindText: every part checked; a shared key or certificate refused; the layout is fixed', () => {
  const args = [G, 'ab'.repeat(16), KEYS[1].pub, KEYS[0].pub, FA, FB];
  assert.equal(bindText(...args), [BIND_TAG, ...args].join('|'));
  const junk = (x) => [undefined, 'x', x.toUpperCase() === x ? x.toLowerCase() : x.toUpperCase(), x.slice(1), [x], x + ' '];
  for (let i = 0; i < args.length; i++) {
    for (const j of junk(args[i])) {
      if (j === args[i]) continue;
      const a = args.slice();
      a[i] = j;
      assert.equal(bindText(...a), null, i + ':' + String(j).slice(0, 20));
    }
  }
  assert.equal(bindText(G, 'ab'.repeat(16), KEYS[1].pub, KEYS[1].pub, FA, FB), null);
  assert.equal(bindText(G, 'ab'.repeat(16), KEYS[1].pub, KEYS[0].pub, FA, FA), null);
});

// ── 3. THE GLUE, against an in-memory RTCPeerConnection ────────────────────────────────────────────────────────────

class FakeChannel extends EventTarget {
  constructor(label) { super(); this.label = label; this.readyState = 'connecting'; this.peer = null; this.closes = 0; }
  send(data) {
    if (this.readyState !== 'open') throw new Error('InvalidStateError');
    const peer = this.peer;
    setTimeout(() => { if (peer.readyState === 'open') peer.dispatchEvent(new MessageEvent('message', { data })); }, 0);
  }
  close() {
    this.closes++;
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.dispatchEvent(new Event('close'));
    if (this.peer) this.peer.close();
  }
}
/** An RTCPeerConnection stand-in: real-looking SDPs, ICE gathering, a connect step. mode: ok | fail | stall | nogather | reject | nofp | throw */
function fakeRTC(mode = 'ok') {
  const reg = new Map();
  let n = 0;
  return class FakePC extends EventTarget {
    constructor(config) {
      super();
      if (mode === 'throw') throw new Error('no WebRTC here');
      this.config = config;
      this.n = ++n;
      this.ufrag = 'uf' + this.n + 'z';
      this.fp = FPX('pc/' + this.n + '/' + Math.random());
      this.iceGatheringState = 'new';
      this.connectionState = 'new';
      this.localDescription = null;
      this.remoteDescription = null;
      this.channels = [];
      this.closed = false;
      reg.set(this.ufrag, this);
    }
    sdpFor(setup, gathered) {
      const s = chromeSdp({ fp: this.fp, ufrag: this.ufrag, setup, cands: gathered ? 3 : 0 });
      return mode === 'nofp' ? s.replace(/a=fingerprint:[^\r]*\r\n/, '') : s;
    }
    createDataChannel(label) { const c = new FakeChannel(label); this.channels.push(c); return c; }
    async createOffer() { return { type: 'offer', sdp: this.sdpFor('actpass', false) }; }
    async createAnswer() { return { type: 'answer', sdp: this.sdpFor('active', false) }; }
    async setLocalDescription(d) {
      this.localDescription = { type: d.type, sdp: d.sdp };
      if (mode === 'nogather') return;
      this.iceGatheringState = 'gathering';
      setTimeout(() => {
        this.localDescription = { type: d.type, sdp: this.sdpFor(d.type === 'offer' ? 'actpass' : 'active', true) };
        this.iceGatheringState = 'complete';
        this.dispatchEvent(new Event('icegatheringstatechange'));
      }, 3);
    }
    async setRemoteDescription(d) {
      if (mode === 'reject') throw new Error('the browser refused this description');
      this.remoteDescription = { type: d.type, sdp: d.sdp };
      this.remote = reg.get(/a=ice-ufrag:(\S+)/.exec(d.sdp)[1]);
      if (d.type === 'answer') setTimeout(() => this.link(), 3);
    }
    link() {
      const g = this.remote;
      this.state('connecting');
      g.state('connecting');
      if (mode === 'fail') { this.state('failed'); g.state('failed'); return; }
      if (mode === 'stall') return;
      for (const c of this.channels) {
        const twin = new FakeChannel(c.label);
        c.peer = twin;
        twin.peer = c;
        twin.readyState = 'open';
        g.dispatchEvent(Object.assign(new Event('datachannel'), { channel: twin }));
        c.readyState = 'open';
        c.dispatchEvent(new Event('open'));
      }
      this.state('connected');
      g.state('connected');
    }
    state(s) { this.connectionState = s; this.dispatchEvent(new Event('connectionstatechange')); }
    close() { this.closed = true; this.connectionState = 'closed'; }
  };
}
// every connection and attached session a glue test makes is closed after it — pass or fail
const live = new Set();
const keep = (x) => { live.add(x); return x; };
afterEach(() => { for (const x of live) { try { x.close(); } catch { /* not closable */ } } live.clear(); });
const until = async (cond, ms = 4000) => {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 5)); }
  return true;
};

test('host → guest → accept: the channel opens on both ends, each knowing both certificates; attached sessions bind and sync', { timeout: 20000 }, async () => {
  const RTC = fakeRTC();
  const host = keep(await connectAsHost({ RTC, gather: 2000 }));
  assert.equal(host.ok, true);
  assert.equal(host.complete, true);
  assert.equal(host.pc.config.iceServers, ICE_SERVERS);
  assert.deepEqual(ICE_SERVERS, [{ urls: 'stun:stun.l.google.com:19302' }]);
  assert.equal(host.code.slice(0, 7), 'SE1.oz.');
  const offer = await decodeSignal(host.code);
  assert.equal(offer.sdp.split('a=candidate:').length - 1, 3, 'the code carries the gathered candidates');
  const guest = keep(await connectAsGuest(host.code, { RTC, iceServers: [] }));
  assert.equal(guest.ok, true);
  assert.deepEqual(guest.pc.config.iceServers, []);
  assert.equal(guest.code.slice(0, 7), 'SE1.az.');
  assert.deepEqual(await host.accept(guest.code), { ok: true });
  assert.deepEqual(await host.accept(guest.code), { ok: false, reason: 'already-accepted' });
  const [h, g] = await Promise.all([host.channel, guest.channel]);
  assert.equal(h.ok, true);
  assert.equal(g.ok, true);
  assert.equal(h.channel.readyState, 'open');
  assert.equal(g.channel.readyState, 'open');
  assert.equal(h.local, host.pc.fp);
  assert.equal(h.remote, guest.pc.fp);
  assert.deepEqual([g.local, g.remote], [h.remote, h.local]);
  // the two machines' companies, over that channel
  const { a, b } = await members();
  await bulk(a, 'a', 12);
  await writes(b, 'b', 4);
  const states = [];
  const sh = keep(attachSession(h, { node: a.node, keys: a.keys, every: 10, onUpdate: (i) => states.push(i.state) }));
  const sg = keep(attachSession(g, { node: b.node, keys: b.keys, every: 10 }));
  assert.ok(await until(() => a.node.fingerprint() === b.node.fingerprint()), 'synced over the channel');
  assert.deepEqual([sh.info().state, sg.info().state, sh.info().proven, sg.info().proven], ['live', 'live', true, true]);
  assert.ok(states.includes('live'));
  h.channel.close();
  assert.ok(await until(() => sg.info().state === 'closed' && sh.info().state === 'closed'));
  assert.equal(sh.info().reason, 'channel-closed');
  host.close();
  guest.close();
  assert.equal(host.pc.closed && guest.pc.closed, true);
});

test('the glue refuses cleanly: no WebRTC, the wrong kind of code, a refused description, a failed / stalled / closed connection', { timeout: 20000 }, async () => {
  assert.deepEqual(await connectAsHost(), { ok: false, reason: 'no-webrtc' });     // Node has no RTCPeerConnection
  assert.deepEqual(await connectAsHost({}), { ok: false, reason: 'no-webrtc' });
  assert.deepEqual(await connectAsGuest('x', {}), { ok: false, reason: 'no-webrtc' });
  assert.deepEqual(await connectAsGuest('x'), { ok: false, reason: 'no-webrtc' });
  const RTC = fakeRTC();
  const host = keep(await connectAsHost({ RTC }));
  assert.equal(host.ok, true, 'the default gather wait is used when none is given');
  assert.equal((await connectAsGuest(host.code.replace('SE1.oz', 'SE1.az'), { RTC })).reason, 'code-checksum');
  const guest = keep(await connectAsGuest(host.code, { RTC }));
  assert.equal((await connectAsGuest(guest.code, { RTC })).reason, 'wrong-kind');  // an answer pasted where an offer belongs
  assert.equal((await host.accept(host.code)).reason, 'wrong-kind');               // the host's own code pasted back
  assert.equal((await host.accept('nonsense')).reason, 'code-version');
  assert.equal((await host.accept(guest.code)).ok, true);                          // the bad pastes did not use up the code
  assert.equal((await host.channel).ok, true);
  host.close(); guest.close();
  // the browser refuses the description
  const R = fakeRTC('reject');
  const h2 = keep(await connectAsHost({ RTC: R }));
  const ok = fakeRTC();
  const g2 = keep(await connectAsGuest((await connectAsHost({ RTC: ok })).code, { RTC: ok }));
  assert.equal((await h2.accept(g2.code)).reason, 'answer-refused');
  assert.equal((await h2.accept(g2.code)).reason, 'already-accepted');           // a refused reply still used up the code
  g2.close();
  h2.close();
  assert.equal((await connectAsGuest(h2.code, { RTC: R })).reason, 'rtc-fault');
  // ICE never fails/opens: failed, timed out; or closed before it opened
  for (const [mode, want] of [['fail', 'failed'], ['stall', 'timeout']]) {
    const F = fakeRTC(mode);
    const hf = keep(await connectAsHost({ RTC: F, wait: 60 }));
    const gf = keep(await connectAsGuest(hf.code, { RTC: F, wait: 60 }));
    await hf.accept(gf.code);
    assert.deepEqual(await hf.channel, { ok: false, reason: want }, mode);
    assert.deepEqual(await gf.channel, { ok: false, reason: want }, mode + ' (guest)');
  }
  const C = fakeRTC();
  const hc = keep(await connectAsHost({ RTC: C }));
  hc.close();
  assert.deepEqual(await hc.channel, { ok: false, reason: 'closed' });
  assert.equal(hc.pc.closed, true);
  const gc = keep(await connectAsGuest((await connectAsHost({ RTC: C })).code, { RTC: C }));
  gc.close();
  assert.deepEqual(await gc.channel, { ok: false, reason: 'closed' });
  // ICE gathering that never completes: the wait is respected and the code carries what there is
  const NG = fakeRTC('nogather');
  const t0 = Date.now();
  const hn = keep(await connectAsHost({ RTC: NG, gather: 40 }));
  assert.ok(Date.now() - t0 < 1500, 'the gather wait is bounded');
  assert.equal(hn.complete, false);
  assert.equal((await decodeSignal(hn.code)).sdp.includes('a=candidate'), false);
  const t1 = Date.now();
  const gn = keep(await connectAsGuest(hn.code, { RTC: NG, gather: 40 }));
  assert.ok(Date.now() - t1 < 1500);
  assert.equal(gn.complete, false);
  hn.close(); gn.close();
  // a browser whose description has no fingerprint cannot make a code; a constructor that throws is a fault
  const NF = fakeRTC('nofp');
  const hnf = keep(await connectAsHost({ RTC: NF, gather: 200 }));
  assert.equal(hnf.reason, 'sdp');
  assert.equal((await connectAsGuest(host.code, { RTC: NF, gather: 200 })).reason, 'sdp');
  assert.equal((await connectAsHost({ RTC: fakeRTC('throw') })).reason, 'rtc-fault');
});

test('attachSession: ticks until the session ends; a refused peer gets its channel closed; junk gives null', { timeout: 10000 }, async () => {
  const mk = () => {
    const c = new EventTarget();
    c.sent = [];
    c.closes = 0;
    c.send = (m) => c.sent.push(JSON.parse(m));
    c.close = () => { c.closes++; };
    return c;
  };
  const b = dev(1);
  const ch = mk();
  const seen = [];
  const s = keep(attachSession({ channel: ch, local: FB, remote: FA }, { node: b.node, keys: b.keys, every: 5, onUpdate: (i) => seen.push(i.state) }));
  assert.ok(await until(() => ch.sent.length >= 6, 1500), 'hello re-sent on every tick while binding (every 5 ms)');
  ch.dispatchEvent(Object.assign(new Event('message'), { data: helloFrom(KEYS[0], { genesis: KEYS[2].pub }) }));
  assert.ok(await until(() => s.info().state === 'refused'));
  assert.equal(s.info().reason, 'company-mismatch');
  assert.equal(ch.closes, 1, 'the refused peer\'s channel is closed');
  const n = ch.sent.length;
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(ch.sent.length, n, 'no more ticks');
  assert.deepEqual(seen, ['binding', 'refused']);
  // a channel that closes ends the session and its ticks
  const ch2 = mk();
  const s2 = keep(attachSession({ channel: ch2, local: FB, remote: FA }, { node: b.node, keys: b.keys, every: 5 }));
  ch2.dispatchEvent(new Event('close'));
  assert.deepEqual([s2.info().state, s2.info().reason], ['closed', 'channel-closed']);
  const m2 = ch2.sent.length;
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(ch2.sent.length, m2);
  // an unbound attach (no fingerprints) refuses at once, closes the channel, and never ticks
  const ch3 = mk();
  const s3 = keep(attachSession({ channel: ch3 }, { node: b.node, keys: b.keys, every: 5 }));
  assert.deepEqual([s3.info().state, s3.info().reason, ch3.closes], ['refused', 'unbound', 1]);
  for (const j of [undefined, null, 1, {}, { channel: 1 }]) assert.equal(attachSession(j, { node: b.node, keys: b.keys }), null);
});

// ── fuzz: every export is total ────────────────────────────────────────────────────────────────────────────────────

const toxic = { get type() { throw new Error('boom'); }, get sdp() { throw new Error('boom'); }, get node() { throw new Error('boom'); },
  get expect() { throw new Error('boom'); }, get deflate() { throw new Error('boom'); }, get RTC() { throw new Error('boom'); },
  get channel() { throw new Error('boom'); }, get genesis() { throw new Error('boom'); }, get pub() { throw new Error('boom'); },
  toString() { throw new Error('boom'); } };
const JUNK = [undefined, null, 0, -1, NaN, '', 'x', [], {}, [null], toxic, 1n, () => 1, Symbol('s'), new Uint8Array(3), { type: 'offer', sdp: toxic }];

test('fuzz: every export is total on junk — sync ones never throw, async ones never reject', async () => {
  for (const j of JUNK) {
    for (const k of JUNK) {
      assert.doesNotThrow(() => bindText(j, k, j, k, j, k));
      assert.doesNotThrow(() => isMember(j, k));
      await assert.doesNotReject(async () => encodeSignal(j, k));
      await assert.doesNotReject(async () => decodeSignal(j, k));
      await assert.doesNotReject(async () => connectAsGuest(j, k));
      assert.doesNotThrow(() => attachSession(j, k));
    }
    assert.doesNotThrow(() => fingerprintOf(j));
    assert.doesNotThrow(() => checkSdp(j));
    assert.doesNotThrow(() => stripSdp(j));
    assert.doesNotThrow(() => parseMessage(j));
    await assert.doesNotReject(async () => connectAsHost(j));
    const s = createSyncSession(j);
    assert.doesNotThrow(() => s.start());
    await assert.doesNotReject(async () => s.onMessage(j));
    assert.doesNotThrow(() => s.tick());
    assert.doesNotThrow(() => s.close(j));
    assert.doesNotThrow(() => s.info());
  }
  // a live session fed junk and near-miss messages
  const { a, b } = await members();
  const p = pair(a, b);
  p.sa.start(); p.sb.start();
  await pump(p);
  for (const j of JUNK) await assert.doesNotReject(async () => p.sa.onMessage(j));
  const rnd = prng(99);
  const { code } = await encodeSignal({ type: 'offer', sdp: chromeSdp() });
  const templates = [helloFrom(KEYS[1]), JSON.stringify({ t: 'have', i: 1, have: [sha256('q')] }), JSON.stringify({ t: 'env', hex: 'abcd' })];
  for (let i = 0; i < 400; i++) {
    const src = i % 2 ? code : templates[i % templates.length];
    const at = Math.floor(rnd() * src.length);
    const mutated = src.slice(0, at) + String.fromCharCode(Math.floor(rnd() * 128)) + src.slice(at + 1);
    const d = await decodeSignal(mutated);
    assert.equal(typeof d.ok, 'boolean');
    assert.equal(typeof parseMessage(mutated).ok, 'boolean');
    const s = createSyncSession({ node: b.node, keys: b.keys, local: FB, remote: FA, send: () => {} });
    s.start();
    assert.equal(typeof (await s.onMessage(mutated)).ok, 'boolean');
    s.close();
  }
});
