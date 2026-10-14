// watch-work.mjs — a test helper (not a test file): the company's door and agents WITHOUT the signed spine, so the
// behaviour watch can be measured over many seeds in seconds. Every decision is made by the company's own kernels — the
// real brain files and real-data samples (as runtime.boot loads them), the real door (company.pickEvent), the real open
// and close of a piece of work (company.openStep / afterMesh / closeStep), the real mesh (mesh.askRecord / replyFor /
// pickAnswer / pickSecond, every other agent replying from its own library), learning by being asked (brain.adopt
// re-verifies on the agent's own rows) — so the honest streams are what the running company writes to 'decisions',
// field for field. Like the runtime, a call that waits on the mesh closes a few door events later, after calls the agent's
// own brain answered at once: decisions reach the spine out of door order. What it leaves out, and says so: the signing
// and sync (they do not change a decision), regrowth on outcomes (it moves a brain's labels slowly), and the model tier
// (off in the headless re-run too).
import { readFileSync } from 'node:fs';
import { AGENTS, OWNER_OF, pickEvent, openStep, afterMesh, closeStep, shouldLearn } from '../src/company.mjs';
import { askRecord, replyFor, pickAnswer, pickSecond } from '../src/mesh.mjs';
import { adopt } from '../src/brain.mjs';
import { growPattern } from '../src/grow.mjs';
import { sample, shopperRows } from '../src/streams.mjs';
import { prng } from '../src/sim.mjs';
import { seedFor } from '../src/runtime.mjs';

const read = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const index = read('brains/index.json');
const FACTORY = Object.fromEntries(Object.entries(index).map(([d, m]) => [d, read('brains/' + m.file)]));
const SHOP = shopperRows(read('brains/shopper.sample.json'));
const POOLS = { shopper: SHOP.filter((_, i) => i % 2 === 1) };
const REAL = {};
for (const [d, m] of Object.entries(index)) {
  if (!m.sample || d === 'shopper') continue;
  const rows = shopperRows(read('brains/' + m.sample));
  REAL[d] = rows.filter((_, i) => i % 2 === 0);          // the company's own history
  POOLS[d] = rows.filter((_, i) => i % 2 === 1);         // the live door
}
for (const d of Object.keys(OWNER_OF)) if (!POOLS[d]) POOLS[d] = sample(d, 900001 + d.length * 7919, 400).rows;
const LOCAL = new Map();
const localRows = (id, d, n = 600) => {
  const k = id + '/' + d + '/' + n;
  if (!LOCAL.has(k)) LOCAL.set(k, REAL[d] ? REAL[d] : d === 'shopper' ? SHOP.filter((_, i) => i % 2 === 0) : sample(d, seedFor(id, d), n).rows);
  return LOCAL.get(k);
};
const ADOPTS = new Map();
const adoptsHere = (id, d) => {
  const k = id + '/' + d;
  if (!ADOPTS.has(k)) ADOPTS.set(k, adopt(FACTORY[d], localRows(id, d)).adopt);
  return ADOPTS.get(k);
};
const AUDIT = {};          // the Audit agent grows its own independent brains once (the seeds the runtime uses)
for (const d of AGENTS.find((a) => a.id === 'audit').grows) {
  const g = growPattern(d, localRows('audit', d, 700), FACTORY[d].features, { seed: seedFor('audit', d), grownBy: 'audit' });
  if (g.verified) AUDIT[d] = g.pattern;
}
export const WORKER_IDS = AGENTS.filter((a) => a.domains.length).map((a) => a.id);
const AGENT_IDS = AGENTS.map((a) => a.id);

/**
 * A working stretch of the company: `events` pieces of work through the door under `seed`.
 * opts.paused — agent ids paused by the humans (their work is routed exactly as runtime.route routes it).
 * opts.override(agentId, rec, rnd, i) — replace an agent's decision record (an attacker holding that agent's key).
 * → records in write order: { id, agent, event, domain, action, state, by, cross, second, conf, channel }.
 */
export function work(seed, events, opts = {}) {
  const rnd = prng(seed);
  const lag = prng((seed ^ 0x1a6) >>> 0);                 // how long a mesh ask takes to come back, in door events
  const paused = new Set(opts.paused || []);
  const libs = {}, asks = {};
  for (const a of AGENTS) { libs[a.id] = {}; asks[a.id] = {}; for (const d of a.domains) if (adoptsHere(a.id, d)) libs[a.id][d] = FACTORY[d]; }
  Object.assign(libs.audit, AUDIT);
  const available = (id) => !!id && WORKER_IDS.includes(id) && !paused.has(id);
  // every other agent device replies from its own library — except a paused one, which (as in runtime.agentTick) does not tick
  const replies = (rec, from) => AGENT_IDS.filter((x) => x !== from && !paused.has(x)).map((x) => replyFor({ ...rec, id: 'q' }, libs[x], x)).filter(Boolean);
  const out = [], pending = [];
  let written = 0;
  const finish = (at, event, o, gathered) => {
    const { decision: d } = closeStep({ agentId: at, event, scr: o.scr, own: o.own, fault: o.fault, ...gathered });
    let rec = { id: 'd' + String(++written).padStart(8, '0') + '-' + at, agent: at, event: event.id, domain: d.domain || '', action: d.action || '', state: d.state,
      by: d.by, cross: !!d.crossChecked, second: d.secondBy || '', conf: d.conf | 0, channel: event.domain };
    if (opts.override) rec = opts.override(at, rec, rnd, written) || rec;
    out.push(rec);
  };
  const second = (at, event, o, first, mesh) => {
    const exclude = [...new Set([at, first.node])];
    const rec = askRecord({ kind: 'second', item: event.id, from: at, features: event.features, domain: first.answer.domain, pattern: first.answer.receipt.patternId, exclude });
    const s = rec ? pickSecond(replies(rec, at).filter((r) => !exclude.includes(r.by)), first.answer.domain, first.answer.receipt.patternId, exclude) : null;
    return { mesh, second: s ? s.answer : null, secondBy: s ? s.node : '' };
  };
  const settle = (n) => {                                  // close the calls whose replies are back by door event n
    pending.sort((a, b) => a.due - b.due || a.n - b.n);
    while (pending.length && pending[0].due <= n) {
      const p = pending.shift();
      if (p.stage === 'mesh') {
        const rec = askRecord({ kind: 'answer', item: p.event.id, from: p.at, features: p.event.features });
        const mesh = rec ? pickAnswer(replies(rec, p.at)) : null;
        if (mesh) {
          const dom = mesh.answer.domain;
          asks[p.at][dom] = (asks[p.at][dom] || 0) + 1;
          if (shouldLearn(asks[p.at], dom, libs[p.at])) { asks[p.at][dom] = 0; if (adoptsHere(p.at, dom)) libs[p.at][dom] = FACTORY[dom]; }
        }
        if (afterMesh(mesh) === 'second') { pending.push({ ...p, stage: 'second', mesh, due: n + 3 + Math.floor(lag() * 4) }); continue; }
        finish(p.at, p.event, p.o, { mesh });
      } else finish(p.at, p.event, p.o, second(p.at, p.event, p.o, p.o.first || p.mesh, p.mesh || null));
    }
  };
  for (let n = 0; n < events; n++) {
    settle(n);
    const ev = pickEvent(rnd, POOLS, n);
    const at = available(ev.landsAt) ? ev.landsAt : available(OWNER_OF[ev.domain]) ? OWNER_OF[ev.domain] : WORKER_IDS.find(available);
    if (!at) continue;
    const o = openStep({ agentId: at, event: ev, library: libs[at] });
    if (o.next === 'final') finish(at, ev, o, {});
    else pending.push({ stage: o.next, at, event: ev, o, n, due: n + 3 + Math.floor(lag() * 4) });
  }
  settle(Infinity);
  return out;
}
