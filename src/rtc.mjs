// rtc.mjs — cross-machine sync: two devices on DIFFERENT machines meet over a WebRTC data channel, with no server.
//
// Signalling is done BY HAND, the estate's sovereign-p2p pattern: the host makes a short code and sends it to the other
// machine over a channel the two people already trust (Signal, in person); the guest pastes it and sends a reply code
// back. A public STUN server is asked once, by each side, for its public address — it sees an IP and nothing else, and
// no traffic flows through it: no TURN relay, no signalling server, no backend. So a code CONTAINS the sender's public
// address: send it the way you would send a phone number, not on a public channel.
//
// Three layers. The first two are pure and gated (witness); the third is thin browser glue, injectable so it runs in
// Node against an in-memory fake and in the browser against the real RTCPeerConnection.
//
//   1. THE CODE — encodeSignal / decodeSignal. An RTCSessionDescription (ICE gathered) stripped to the lines a data
//      channel needs, deflated when CompressionStream exists, base64url, version prefix + checksum. decode refuses
//      anything malformed, mis-typed, oversize (a deflate bomb stops at LIMITS.sdp) or with a bad checksum — BEFORE
//      WebRTC ever sees it.
//   2. THE SESSION — createSyncSession({ node, send, keys, local, remote }): hello → proof → sync, over any channel that
//      carries strings.
//      BINDING. Each side signs the other's fresh nonce together with BOTH DTLS certificate fingerprints (read from the
//      SDPs this link actually used), both device keys and the company's genesis, with its own device key. A man in
//      the middle of the copy-paste terminates DTLS twice, so the two ends see different fingerprint pairs: nothing he
//      relays verifies, and he can sign a proof only for his own key, never for either device's. The binding proves
//      "the device on this link holds key K". Whether K is IN the company is the company's own role tree (isMember):
//      records are offered only to a proven member, never to whoever happens to hold the code. Receiving needs no trust
//      in the peer — every byte goes through node.receive, the gate (an unauthorised write is stored, never applied).
//      SYNC. Rounds: have (≤ LIMITS.list hashes) → want (what the peer lacks; it doubles as the ack that paces the next
//      chunk, so at most one chunk is in flight) → env (one signed envelope, hex). New writes are pushed as they commit.
//      Each tick, each side sends one sum — the order-independent fingerprint of the set it holds — and a round runs
//      only when the two differ, so a quiet link costs one short message per tick, not a re-announced hash list. Only
//      what the peer lacks is sent. A different genesis is refused.
//      BOUNDS. Message size, list sizes, hex shape, exact message grammar, a per-peer token bucket, a strike count
//      for malformed or gate-refused input. Junk in → a refusal, never a throw.
//   3. THE GLUE — connectAsHost / connectAsGuest / attachSession.
//
// Reused, with credit: fingerprintOf, and the proof-of-key bound to BOTH ends' DTLS fingerprints — from
// sjgant80-hub/fallkard-forge (trade.mjs; its adversarial review found that a key-only proof can be relayed by a device
// paired with two victims). Gathering ICE into one copyable blob, and refusing a malformed or oversized blob before it
// reaches RTCPeerConnection — from sjgant80-hub/fall-os (webrtc.mjs) and sjgant80-hub/fall-federate (signaling.mjs).
// Standards: WebRTC data channels (RFC 8831), ICE (RFC 8445), STUN (RFC 8489), SDP DTLS fingerprints (RFC 8122),
// DEFLATE (RFC 1951), base64url (RFC 4648). MIT.
import { utf8, fromUtf8, toHex, fromHex } from './canon.mjs';
import { sha256 } from './sha256.mjs';
import { sign, verify } from './keys.mjs';

export const SIGNAL_VERSION = 'SE1';
export const BIND_TAG = 'sovereign-enterprise rtc bind v1';
export const ICE_SERVERS = Object.freeze([Object.freeze({ urls: 'stun:stun.l.google.com:19302' })]);
export const LIMITS = Object.freeze({
  sdpIn: 65536,    // a browser's own SDP, before it is stripped
  sdp: 6000,       // a stripped SDP — and the most a deflated code may inflate to (a bomb stops here)
  code: 8192,      // a pasted code, whitespace removed (a max-size SDP, plain, is 8016 characters: it always fits)
  candidates: 24,  // ICE candidates in one SDP
  raw: 16384,      // one data-channel message, in characters
  hex: 8192,       // one envelope, in hex characters (the gate's 4096 bytes)
  list: 128,       // hashes in one have / want
  burst: 2048,     // per-peer token bucket: messages that may arrive at once …
  rate: 2048,      // … and per second after that
  strikes: 32,     // malformed or gate-refused messages tolerated; the next one refuses the peer as hostile
  known: 65536,    // how many of the peer's hashes are remembered (push de-duplication only)
});
const GATHER = 5000;     // ms to wait for ICE gathering before sending what was gathered
const WAIT = 600000;     // ms to wait for the channel to open — a person is carrying the codes between machines
const EVERY = 2000;      // ms between session ticks (re-send what was not answered; start a repair round)

const no = (reason) => ({ ok: false, reason });
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const str = (x, re) => typeof x === 'string' && re.test(x);
const H32 = /^[0-9a-f]{32}$/;
const H64 = /^[0-9a-f]{64}$/;
const H128 = /^[0-9a-f]{128}$/;
const HEXB = /^(?:[0-9a-f]{2})+$/;
const FP = /^sha-256 (?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const FP_LINE = /^a=fingerprint:sha-256 ((?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2})[ \t]*\r?$/gm;

// ── 1. THE CODE ─────────────────────────────────────────────────────────────────────────────────────────────────────

// The SDP lines a data channel needs. Everything else (extmap, msid, ice-options, bandwidth, …) is dropped.
const KEEP = ['v=', 'o=', 's=', 't=', 'c=', 'm=', 'a=group:', 'a=mid:', 'a=ice-ufrag:', 'a=ice-pwd:', 'a=fingerprint:',
  'a=setup:', 'a=sctp-port:', 'a=max-message-size:', 'a=candidate:', 'a=end-of-candidates'];
const ONCE = ['v=', 'o=', 's=', 't=', 'm=', 'a=ice-ufrag:', 'a=ice-pwd:', 'a=setup:'];
const LINE = /^[a-z]=[\x20-\x7e]*$/;
const DC = /^m=application [0-9]+ UDP\/DTLS\/SCTP webrtc-datachannel$/;
const keyOf = (line) => KEEP.find((p) => line.startsWith(p));

/**
 * The one DTLS certificate fingerprint an SDP commits to ('sha-256 AB:CD:…', upper case), or null if it states none, or
 * more than one different one (ambiguous — nothing is bound to a guess). From sjgant80-hub/fallkard-forge trade.mjs.
 */
export function fingerprintOf(sdp) {
  try {
    if (typeof sdp !== 'string' || sdp.length > LIMITS.sdpIn) return null;
    const seen = new Set(Array.from(sdp.matchAll(FP_LINE), (m) => 'sha-256 ' + m[1].toUpperCase()));
    return seen.size === 1 ? [...seen][0] : null;
  } catch {
    return null;
  }
}

/** Is this a stripped data-channel SDP this module will hand to WebRTC? → { ok, fingerprint } or { ok:false, reason }. */
export function checkSdp(sdp) {
  try {
    if (typeof sdp !== 'string') return no('sdp-type');
    if (sdp.length > LIMITS.sdp) return no('sdp-size');
    const lines = sdp.split('\r\n');
    if (lines.pop() !== '' || lines[0] !== 'v=0') return no('sdp-shape');
    const seen = new Map();
    for (const l of lines) {
      const k = LINE.test(l) && keyOf(l);
      if (!k) return no('sdp-line');
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    for (const k of ONCE) if (seen.get(k) !== 1) return no('sdp-once');
    if ((seen.get('a=candidate:') || 0) > LIMITS.candidates) return no('sdp-candidates');
    if (!lines.some((l) => DC.test(l))) return no('sdp-media');
    const fingerprint = fingerprintOf(sdp);
    return fingerprint ? { ok: true, fingerprint } : no('sdp-fingerprint');
  } catch {
    return no('sdp-fault');
  }
}

/** A browser's SDP → only the lines a data channel needs, CRLF-terminated; null if what is left is not usable. */
export function stripSdp(sdp) {
  try {
    if (typeof sdp !== 'string' || sdp.length > LIMITS.sdpIn) return null;
    const out = sdp.split(/\r?\n/).filter((l) => keyOf(l)).join('\r\n') + '\r\n';
    return checkSdp(out).ok ? out : null;
  } catch {
    return null;
  }
}

const checksum = (s) => sha256(s).slice(0, 8);
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function fromB64url(s) {
  try { return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)); } catch { return null; }
}
async function deflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
/** Inflate, stopping as soon as the output passes `cap` bytes → { bytes } or { reason }. */
async function inflate(bytes, cap) {
  try {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > cap) { reader.cancel().catch(() => {}); return { reason: 'sdp-size' }; }
      parts.push(value);
    }
    return { bytes: new Uint8Array(await new Blob(parts).arrayBuffer()) };
  } catch {
    return { reason: 'code-inflate' };
  }
}
const canDeflate = (opts) => (!opts || opts.deflate !== false) && typeof CompressionStream === 'function';

/**
 * An RTCSessionDescription (or { type, sdp }) → { ok, code }: 'SE1.' + type (o|a) + mode (z deflated | p plain) + '.' +
 * base64url body + '.' + 8-hex checksum. opts.deflate === false forces plain. Never throws.
 */
export async function encodeSignal(desc, opts) {
  try {
    const type = desc.type;
    const t = type === 'offer' ? 'o' : type === 'answer' ? 'a' : '';
    if (!t) return no('type');
    const sdp = stripSdp(desc.sdp);
    if (!sdp) return no('sdp');
    const z = canDeflate(opts);
    const head = SIGNAL_VERSION + '.' + t + (z ? 'z' : 'p');
    const body = b64url(z ? await deflate(utf8(sdp)) : utf8(sdp));
    return { ok: true, code: head + '.' + body + '.' + checksum(head + '.' + body) };
  } catch {
    return no('fault');
  }
}

/**
 * A pasted code → { ok, type, sdp, fingerprint } or { ok:false, reason }. Whitespace anywhere is ignored (chat apps wrap
 * lines). opts.expect ('offer' | 'answer') refuses the other kind. Never throws.
 */
export async function decodeSignal(code, opts) {
  try {
    if (typeof code !== 'string') return no('code-type');
    if (code.length > LIMITS.code * 4) return no('code-size');
    const c = code.replace(/\s+/g, '');
    if (c.length > LIMITS.code) return no('code-size');
    const p = c.split('.');
    if (p.length !== 4 || p[0] !== SIGNAL_VERSION) return no('code-version');
    const [v, tm, body, check] = p;
    const type = tm[0] === 'o' ? 'offer' : tm[0] === 'a' ? 'answer' : '';
    const mode = tm[1];
    if (!type || tm.length !== 2 || (mode !== 'z' && mode !== 'p')) return no('code-kind');
    if (check !== checksum(v + '.' + tm + '.' + body)) return no('code-checksum');
    const expect = opts && opts.expect;
    if (expect !== undefined && expect !== type) return no('wrong-kind');
    const bytes = fromB64url(body);
    if (!bytes) return no('code-base64');
    const raw = mode === 'z' ? await inflate(bytes, LIMITS.sdp) : { bytes };
    if (!raw.bytes) return no(raw.reason);
    let sdp;
    try { sdp = fromUtf8(raw.bytes); } catch { return no('code-utf8'); }
    const s = checkSdp(sdp);
    if (!s.ok) return s;
    return { ok: true, type, sdp, fingerprint: s.fingerprint };
  } catch {
    return no('fault');
  }
}

// ── 2. THE SESSION ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The exact text a device signs to prove, on ONE link, that it holds `prover`: the verifier's fresh nonce, both device
 * keys, both DTLS fingerprints and the company. null if any part is malformed, or the two ends share a key or a
 * certificate (nothing is then signed or believed).
 */
export function bindText(genesis, nonce, prover, verifier, proverFp, verifierFp) {
  try {
    if (!str(genesis, H64) || !str(nonce, H32) || !str(prover, H64) || !str(verifier, H64)) return null;
    if (!str(proverFp, FP) || !str(verifierFp, FP)) return null;
    if (prover === verifier || proverFp === verifierFp) return null;
    return [BIND_TAG, genesis, nonce, prover, verifier, proverFp, verifierFp].join('|');
  } catch {
    return null;
  }
}

const SHAPES = Object.freeze({
  hello: ['from', 'genesis', 'nonce', 't', 'v'],
  proof: ['from', 'sig', 't'],
  have: ['have', 'i', 't'],
  want: ['hashes', 'i', 't'],
  env: ['hex', 't'],
  sum: ['fp', 't'],
});
const exactKeys = (o, keys) => Object.keys(o).length === keys.length && keys.every((k) => own(o, k));
const round = (i) => Number.isSafeInteger(i) && i >= 1;
const hashes = (a) => Array.isArray(a) && a.length <= LIMITS.list && a.every((h) => str(h, H64));
function fieldsOk(m) {
  switch (m.t) {
    case 'hello': return m.v === 1 && str(m.from, H64) && str(m.genesis, H64) && str(m.nonce, H32);
    case 'proof': return str(m.from, H64) && str(m.sig, H128);
    case 'have': return round(m.i) && hashes(m.have);
    case 'want': return round(m.i) && hashes(m.hashes);
    case 'sum': return str(m.fp, H64);
    default: return str(m.hex, HEXB) && m.hex.length <= LIMITS.hex;
  }
}

/** One data-channel message → { ok, m } or { ok:false, reason }. Exact grammar; total. */
export function parseMessage(raw) {
  try {
    if (typeof raw !== 'string') return no('not-text');
    if (raw.length > LIMITS.raw) return no('size');
    let m;
    try { m = JSON.parse(raw); } catch { return no('json'); }
    if (!own(SHAPES, m && m.t) || !exactKeys(m, SHAPES[m.t])) return no('shape');
    return fieldsOk(m) ? { ok: true, m } : no(m.t);
  } catch {
    return no('fault');
  }
}

/** Is `pub` in this node's company, by its own view: the owner, or a grant that has not been revoked? Total. */
export function isMember(node, pub) {
  try {
    return pub === node.genesis || node.auth().roster.some((r) => r.to === pub && !r.revoked);
  } catch {
    return false;
  }
}

const randomHex = (n) => toHex(globalThis.crypto.getRandomValues(new Uint8Array(n)));
const DEAD = ['refused', 'closed'];

/**
 * One link between this device and one peer. opts:
 *   node      — this device (src/node.mjs createNode)
 *   send(str) — puts one message on the link
 *   keys      — this device's own keys (keys.pub === node.pub) — the proof is signed with them
 *   local, remote — this link's DTLS fingerprints ('sha-256 AB:…'), local = this side's certificate
 *   mayShare(pub) — may records go to this proven peer? default isMember(node, pub)
 *   now()     — ms clock for the rate bound (default Date.now) · onUpdate(info) — state / stats changed
 * → { start(), onMessage(raw) → Promise<result>, tick(), close(reason), info() }. Never throws.
 */
export function createSyncSession(opts) {
  const st = { state: 'new', reason: '', peer: '', proven: false, sharing: false };
  const stats = { in: 0, out: 0, admitted: 0, replay: 0, refused: 0, dropped: 0, strikes: 0 };
  const known = new Set();
  const nonce = randomHex(16);
  let node = null, send = null, keys = null, local = '', remote = '', mayShare = null, clock = Date.now, onUpdate = null;
  let bound = false;
  try {
    const o = opts;
    ({ node, send, keys, local, remote } = o);
    mayShare = typeof o.mayShare === 'function' ? o.mayShare : (pub) => isMember(node, pub);
    if (typeof o.now === 'function') clock = o.now;
    onUpdate = o.onUpdate;
    bound = typeof send === 'function' && str(node.pub, H64) && str(node.genesis, H64) && keys.pub === node.pub &&
      str(local, FP) && str(remote, FP) && local !== remote;
  } catch {
    bound = false;
  }
  let peerNonce = '', proofSig = '', off = null, queue = Promise.resolve();
  let tokens = LIMITS.burst, last = 0;    // the bucket starts full, so the clock is first read at the first message
  // the announcer's round: a snapshot of what this device holds, offered LIMITS.list hashes at a time
  let snap = [], at = 0, outstanding = 0, seqI = 0;

  const dead = () => DEAD.includes(st.state);
  const info = () => ({ state: st.state, reason: st.reason, peer: st.peer, proven: st.proven, sharing: st.sharing, known: known.size, ...stats });
  function update() { try { if (typeof onUpdate === 'function') onUpdate(info()); } catch { /* a view never breaks the link */ } }
  function out(m) {
    if (dead()) return;
    try { send(JSON.stringify(m)); stats.out++; } catch { /* the link is going away: the close event ends the session */ }
  }
  function end(state, reason) {
    if (!dead()) {
      st.state = state;
      st.reason = reason;
      if (off) { off(); off = null; }
      update();
    }
    return no(st.reason);
  }
  const refuse = (reason) => end('refused', reason);
  function strike() { stats.strikes++; if (stats.strikes > LIMITS.strikes) refuse('hostile'); }
  function remember(h) { if (known.size >= LIMITS.known) known.clear(); known.add(h); }
  function bucket() {
    const t = Number(clock());
    tokens = Math.min(LIMITS.burst, tokens + (Math.max(0, t - last) || 0) * (LIMITS.rate / 1000));
    last = Math.max(last, t) || last;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  }

  // ── announcer: offer everything held, one chunk in flight; the peer's want is the ack ──
  const chunk = () => snap.slice(at, at + LIMITS.list);
  const offer = () => out({ t: 'have', i: outstanding, have: chunk() });
  function next() {
    if (at >= snap.length) { outstanding = 0; return; }
    seqI += 1;
    outstanding = seqI;
    offer();
  }
  function startRound() {
    snap = node.have();
    at = 0;
    next();
  }
  function evaluate() {
    const was = st.sharing;
    let ok = false;
    try { ok = mayShare(st.peer) === true; } catch { ok = false; }
    st.sharing = st.proven && ok;
    if (st.sharing === was) return;
    update();                            // a grant or a revoke changed what this link may carry: tell the view
    if (st.sharing) startRound();
    else outstanding = 0;                // revoked mid-round: the round in flight is abandoned, nothing more is offered
  }
  // a write committed on this device (its own, or from any transport): push it if the peer may have it and lacks it
  function changed(r) {
    try {
      if (st.state !== 'live') return;
      evaluate();
      if (!st.sharing || known.has(r.hash)) return;
      out({ t: 'env', hex: toHex(node.bytes(r.hash)) });
      remember(r.hash);
    } catch { /* a view never breaks the node */ }
  }

  function claim(from) {
    if (from === node.pub) return refuse('self');
    if (!st.peer) st.peer = from;
    return st.peer === from ? null : refuse('peer-changed');
  }
  async function onHello(m) {
    if (m.genesis !== node.genesis) return refuse('company-mismatch');
    const bad = claim(m.from);
    if (bad) return bad;
    if (peerNonce && peerNonce !== m.nonce) return refuse('peer-changed');
    peerNonce = m.nonce;
    if (!proofSig) {
      const text = bindText(node.genesis, m.nonce, node.pub, m.from, local, remote);
      if (!text) return refuse('unbound');
      try { proofSig = await sign(keys, utf8(text)); } catch { return refuse('unbound'); }
    }
    out({ t: 'proof', from: node.pub, sig: proofSig });
    return { ok: true, t: 'hello' };
  }
  async function onProof(m) {
    const bad = claim(m.from);
    if (bad) return bad;
    if (st.proven) return { ok: true, t: 'proof', again: true };
    const text = bindText(node.genesis, nonce, m.from, node.pub, remote, local);
    const good = !!text && (await verify(m.from, m.sig, utf8(text))) === true;
    if (!good) return refuse('proof');
    st.proven = true;
    st.state = 'live';
    evaluate();
    update();
    return { ok: true, t: 'proof' };
  }
  function onHave(m) {
    const lack = [];
    for (const h of m.have) {
      remember(h);
      if (!node.has(h) && !lack.includes(h)) lack.push(h);
    }
    out({ t: 'want', i: m.i, hashes: lack });
    return { ok: true, t: 'have', want: lack.length };
  }
  function onWant(m) {
    if (!st.sharing || m.i !== outstanding) return { ok: true, t: 'want', stale: true };
    const offered = new Set(chunk());
    for (const h of m.hashes) {
      if (!offered.has(h)) continue;     // only what this round offered: a want is not a licence to ask for anything
      out({ t: 'env', hex: toHex(node.bytes(h)) });
      remember(h);
    }
    at += LIMITS.list;
    next();
    return { ok: true, t: 'want' };
  }
  // the peer's digest of what it holds: equal → nothing to do; different, while this side shares and is idle → a round
  function onSum(m) {
    if (st.sharing && !outstanding && m.fp !== node.fingerprint()) startRound();
    return { ok: true, t: 'sum' };
  }
  async function onEnv(m) {
    const bytes = fromHex(m.hex);
    remember(sha256(bytes));             // before the gate: its own commit must not be pushed straight back
    const r = await node.receive(bytes);
    if (r.ok) stats.admitted++;
    else if (r.reason === 'replay') stats.replay++;
    else { stats.refused++; strike(); }
    update();
    return r.ok ? { ok: true, t: 'env', hash: r.hash } : no(r.reason);
  }
  async function handle(m) {
    try {
      if (dead()) return no(st.state);
      if (m.t === 'hello') return await onHello(m);
      if (m.t === 'proof') return await onProof(m);
      if (!st.proven) return no('unproven');
      if (m.t === 'have') return onHave(m);
      if (m.t === 'want') return onWant(m);
      if (m.t === 'sum') return onSum(m);
      return await onEnv(m);
    } catch {
      return no('fault');
    }
  }
  const hello = () => out({ t: 'hello', v: 1, from: node.pub, genesis: node.genesis, nonce });

  return {
    /** Say hello. A session that is not bound to a device key and this link's two fingerprints refuses to start. */
    start() {
      try {
        if (st.state !== 'new') return info();
        if (!bound) { refuse('unbound'); return info(); }
        st.state = 'binding';
        off = node.onChange(changed);
        hello();
        update();
      } catch { refuse('unbound'); }
      return info();
    },
    /** Every message from the peer, raw. Serialised: each is handled after the one before it. */
    onMessage(raw) {
      try {
        if (dead()) return Promise.resolve(no(st.state));
        if (st.state === 'new') return Promise.resolve(no('not-started'));
        if (!bucket()) { stats.dropped++; return Promise.resolve(no('rate')); }
        stats.in++;
        const p = parseMessage(raw);
        if (!p.ok) { strike(); return Promise.resolve(p); }
        const job = queue.then(() => handle(p.m));
        queue = job;
        return job;
      } catch {
        return Promise.resolve(no('fault'));
      }
    },
    /** Called every few seconds: re-send what the peer has not answered, and this device's digest (the repair trigger). */
    tick() {
      try {
        if (st.state === 'binding') { hello(); return; }
        if (st.state !== 'live') return;
        if (outstanding) offer();
        out({ t: 'sum', fp: node.fingerprint() });
      } catch { /* next tick */ }
    },
    close(reason) { end('closed', typeof reason === 'string' ? reason.slice(0, 64) : 'closed'); },
    info,
  };
}

// ── 3. THE GLUE (browser; RTCPeerConnection is injectable as opts.RTC) ────────────────────────────────────────────────

const sdpOf = (d) => (d ? d.sdp : '');
function shut(pc) { try { if (pc) pc.close(); } catch { /* already closed */ } }

/** Resolves true once ICE gathering is complete, or false after `ms` (then the code carries what was gathered). */
function gathered(pc, ms) {
  return new Promise((resolve) => {
    const check = () => {
      if (pc.iceGatheringState !== 'complete') return;
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve(true);
    };
    const timer = setTimeout(() => { pc.removeEventListener('icegatheringstatechange', check); resolve(false); }, ms);
    pc.addEventListener('icegatheringstatechange', check);
    check();
  });
}

/** The channel promise of one connection: armed with the data channel, ended by open / failure / timeout / close. */
function opener(pc, ms) {
  let done = false;
  let timer = null;
  let resolve = null;
  const promise = new Promise((r) => { resolve = r; });
  const end = (r) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    resolve(r);
  };
  const arm = (dcPromise) => {
    timer = setTimeout(() => end(no('timeout')), ms);
    pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed') end(no('failed')); });
    dcPromise.then((dc) => {
      // this link's two certificate fingerprints, read from the descriptions the browser actually used
      const ready = () => end({ ok: true, channel: dc, local: fingerprintOf(sdpOf(pc.localDescription)), remote: fingerprintOf(sdpOf(pc.remoteDescription)) });
      if (dc.readyState === 'open') ready();
      else dc.addEventListener('open', ready);
    });
  };
  return { promise, end, arm };
}

/**
 * Host: make a code for the other machine. → { ok, code, complete, accept(answerCode), channel, close() }.
 * `channel` resolves { ok, channel, local, remote } once the data channel is open, or { ok:false, reason } — never rejects.
 * opts: RTC (default RTCPeerConnection), iceServers (default ICE_SERVERS; [] = same network only), gather, wait (ms).
 */
export async function connectAsHost(opts) {
  let pc = null;
  try {
    const o = opts || {};
    const RTC = o.RTC || globalThis.RTCPeerConnection;
    if (typeof RTC !== 'function') return no('no-webrtc');
    pc = new RTC({ iceServers: o.iceServers || ICE_SERVERS });
    const dc = pc.createDataChannel('sovereign-enterprise', { ordered: true });
    await pc.setLocalDescription(await pc.createOffer());
    const complete = await gathered(pc, o.gather || GATHER);
    const enc = await encodeSignal(pc.localDescription);
    if (!enc.ok) { shut(pc); return enc; }
    const op = opener(pc, o.wait || WAIT);
    let accepted = false;
    return {
      ok: true, role: 'host', code: enc.code, complete, pc, channel: op.promise,
      /** Paste the guest's reply code. One reply per code. */
      async accept(answerCode) {
        try {
          if (accepted) return no('already-accepted');
          const d = await decodeSignal(answerCode, { expect: 'answer' });
          if (!d.ok) return d;
          accepted = true;
          await pc.setRemoteDescription({ type: 'answer', sdp: d.sdp });
          op.arm(Promise.resolve(dc));
          return { ok: true };
        } catch {
          return no('answer-refused');
        }
      },
      close() { op.end(no('closed')); shut(pc); },
    };
  } catch {
    shut(pc);
    return no('rtc-fault');
  }
}

/** Guest: paste the host's code → { ok, code (the reply to send back), complete, channel, close() }. Never throws. */
export async function connectAsGuest(code, opts) {
  let pc = null;
  try {
    const o = opts || {};
    const RTC = o.RTC || globalThis.RTCPeerConnection;
    if (typeof RTC !== 'function') return no('no-webrtc');
    const d = await decodeSignal(code, { expect: 'offer' });
    if (!d.ok) return d;
    pc = new RTC({ iceServers: o.iceServers || ICE_SERVERS });
    const p = pc;
    const dcPromise = new Promise((r) => { p.addEventListener('datachannel', (e) => r(e.channel)); });
    await pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    const complete = await gathered(pc, o.gather || GATHER);
    const enc = await encodeSignal(pc.localDescription);
    if (!enc.ok) { shut(pc); return enc; }
    const op = opener(pc, o.wait || WAIT);
    op.arm(dcPromise);
    return { ok: true, role: 'guest', code: enc.code, complete, pc, channel: op.promise, close() { op.end(no('closed')); shut(pc); } };
  } catch {
    shut(pc);
    return no('rtc-fault');
  }
}

/**
 * Run a sync session over an OPEN channel ({ channel, local, remote } — what `channel` resolved to). opts as for
 * createSyncSession (node, keys, mayShare, onUpdate, now) plus `every` (ms between ticks). The session is started; a
 * refusal or a close stops the ticks and closes the channel. → the session, whose close() also stops its ticks and
 * closes the channel (null if `open` is not an open channel).
 */
export function attachSession(open, opts) {
  try {
    const { channel, local, remote } = open;
    const o = opts || {};
    const user = o.onUpdate;
    let timer = null;
    const stop = () => { clearInterval(timer); try { channel.close(); } catch { /* already closed */ } };
    const s = createSyncSession({
      ...o, local, remote,
      send: (m) => channel.send(m),
      onUpdate: (i) => {
        if (DEAD.includes(i.state)) stop();
        if (typeof user === 'function') user(i);
      },
    });
    channel.addEventListener('message', (e) => { s.onMessage(e.data); });
    channel.addEventListener('close', () => s.close('channel-closed'));
    timer = setInterval(() => s.tick(), o.every || EVERY);
    s.start();
    return { ...s, close(reason) { s.close(reason); stop(); } };
  } catch {
    return null;
  }
}
