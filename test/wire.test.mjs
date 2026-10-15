// wire.test.mjs — the Wire it view: its renderers (balanced, escaped, saying what each state means) and its controller, driven
// with a fake page over REAL devices: the owner grants, the hub sends real test cases, an agent device runs its agent through
// src/shell.mjs and decides them, every device checks in at a roll call, and the owner signs a receipt anyone can check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as U from '../ui/wire.mjs';
import { createNode, pull } from '../src/node.mjs';
import { fromSeed } from '../src/keys.mjs';
import { sha256Bytes } from '../src/sha256.mjs';
import { AGENTS, HUB } from '../src/company.mjs';
import { wiringView, wiringChecklist, verifyWiringReceipt } from '../src/shell.mjs';

const fetchJson = async (u) => JSON.parse(readFileSync(new URL('../' + u, import.meta.url), 'utf8'));
function balanced(html) {
  const VOID = new Set(['br', 'input', 'img', 'hr', 'meta', 'link', 'line', 'rect', 'circle']);
  const stack = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g)) {
    const tag = m[2].toLowerCase();
    if (m[1]) { if (stack.pop() !== tag) return 'mismatched </' + tag + '>'; }
    else if (!m[3] && !VOID.has(tag)) stack.push(tag);
  }
  return stack.length ? 'unclosed <' + stack.at(-1) + '>' : '';
}
const ids = (html) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const EVIL = '<img src=x onerror=alert(1)>';

async function office(names) {
  const k = {}, nodes = {};
  for (const n of names) k[n] = await fromSeed(sha256Bytes('wire-test/' + n));
  for (const n of names) nodes[n] = createNode({ keys: k[n], genesis: k.owner.pub, name: n });
  const sync = async () => { for (let i = 0; i < 2; i++) for (const a of names) for (const b of names) if (a !== b) await pull(nodes[a], nodes[b]); };
  return { k, nodes, sync };
}
/** A fake page around one device. */
function page(o, who, extra = {}) {
  const store = new Map(), downloads = [], printed = [];
  let renders = 0;
  const env = { node: () => o.nodes[who], keys: () => o.k[who], store: { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => store.set(k, v) }, fetchJson,
    peers: () => [], link: () => 'https://example.org/#join=' + o.k.owner.pub, origin: 'https://example.org', os: 'linux', now: () => 1760000000000,
    print: (h) => printed.push(h), download: (n, t) => downloads.push([n, t]), render: () => { renders++; }, probeModel: async () => ({ ok: false, why: 'nothing on port 11434' }), ...extra };
  const fields = {};
  const read = (id) => fields[id];
  return { w: U.createWire(env), env, store, downloads, printed, fields, read, renders: () => renders };
}

test('renderers: the office picture, the steps per system, the role words — balanced and escaped', () => {
  const svg = U.officeSvg();
  assert.equal(balanced(svg), '');
  assert.match(svg, /^<svg class="wr-office" viewBox="0 0 640 250" role="img" aria-label="/);
  for (const a of AGENTS) assert.ok(svg.includes('>' + a.name.replace(' agent', '') + '<'), a.id);
  for (const os of ['windows', 'mac', 'linux']) {
    const h = U.modelStepsHtml(os, 'https://example.org');
    assert.equal(balanced(h), '');
    assert.ok(h.includes('ollama pull qwen2.5:7b'));
  }
  assert.ok(U.modelStepsHtml('linux', 'https://example.org').includes('Environment=&quot;OLLAMA_ORIGINS=https://example.org&quot;'));
  assert.ok(!U.modelStepsHtml('mac', 'https://x.org"><script>').includes('<script>'));
  assert.deepEqual(U.deviceRole({ owner: true, devices: [] }), { role: 'owner', agent: '' });
  const me = 'b'.repeat(64);
  assert.deepEqual(U.deviceRole({ me, devices: [{ pub: me, role: 'staff' }, { pub: me, role: 'agent', agent: 'ops' }] }), { role: 'agent', agent: 'ops' });
  assert.deepEqual(U.deviceRole({ me, devices: [{ pub: me, role: 'staff' }, { pub: me, role: 'hub' }] }), { role: 'hub', agent: '' });
  assert.deepEqual(U.deviceRole({ me, devices: [{ pub: me, role: 'admin' }] }), { role: 'admin', agent: '' });
  assert.deepEqual(U.deviceRole({ me, devices: [{ pub: 'c'.repeat(64), role: 'admin' }] }), { role: '', agent: '' });
  assert.deepEqual(U.deviceRole(null), { role: '', agent: '' });
  assert.equal(U.pickModel(['llama3.2', 'qwen2.5:7b']), 'qwen2.5:7b');
  assert.equal(U.pickModel(['llama3.2']), 'llama3.2');
  assert.equal(U.pickModel([]), 'qwen2.5:7b');
  assert.equal(U.pickModel(null), 'qwen2.5:7b');
  assert.match(U.WIRE_CSS, /@media print\{body\.print-sheet/);
});

test('renderWire with no company here: says where wiring starts, and still offers the install sheet', () => {
  for (const s of [undefined, null, {}, { hasNode: false, store: 'This browser gives this page no IndexedDB' + EVIL }]) {
    const h = U.renderWire(s);
    assert.equal(balanced(h), '');
    assert.match(h, /No company on this device yet/);
    assert.match(h, /data-act="wire-print"/);
    assert.ok(!h.includes(EVIL));
  }
  assert.match(U.renderWire({ hasNode: false, plan: { people: 2, agents: ['ops'] } }), /About 49 minutes/);
  assert.equal(U.renderWire({ hasNode: true, get view() { throw new Error('x'); } }), '<p class="bad">This view could not be drawn. Reload the page.</p>');
  const sheet = U.installSheetHtml(undefined);
  assert.equal(balanced(sheet), '');
  assert.match(sheet, /found it first, on the owner’s laptop/);
  assert.equal((sheet.match(/<tr>/g) || []).length, 12, 'eleven steps and the header');
  assert.equal(U.installSheetHtml({ get view() { throw new Error('x'); } }), '<p>The install sheet could not be made.</p>');
});

test('the controller, end to end on real devices: grant, hub test work, an agent run here, a roll call, a signed receipt anyone can check', async () => {
  const o = await office(['owner', 'hub', 'finance', 'audit', 'clerk']);
  const P = { owner: page(o, 'owner'), hub: page(o, 'hub'), finance: page(o, 'finance'), audit: page(o, 'audit'), clerk: page(o, 'clerk') };
  // the owner's view before anything is granted
  let s = P.owner.w.state();
  assert.equal(s.hasNode, true);
  assert.deepEqual(s.role, { role: 'owner', agent: '' });
  assert.equal(s.checklist.next, 'cards');
  let h = U.renderWire(s);
  assert.equal(balanced(h), '');
  assert.deepEqual(ids(h).filter((x, i, a) => a.indexOf(x) !== i), [], 'no id twice');
  assert.match(h, /Devices — granted by you, the owner/);
  assert.ok(h.includes('class="wr-step next" id="wr-cards"'));
  // each device chooses what it will be
  P.finance.fields['wire-agent'] = 'finance';
  await P.finance.w.act('wire-want', { dataset: { role: 'agent' } }, P.finance.read);
  assert.deepEqual(JSON.parse(P.finance.store.get('se.wire.want')), { role: 'agent', agent: 'finance' });
  assert.match(P.finance.w.state().say, /the Finance agent/);
  assert.equal(P.finance.w.state().agent.granted, false);
  assert.match(U.renderWire(P.finance.w.state()), /Waiting for a grant/);
  P.audit.fields['wire-agent'] = 'audit';
  await P.audit.w.act('wire-want', { dataset: { role: 'agent' } }, P.audit.read);
  await P.hub.w.act('wire-want', { dataset: { role: 'hub' } }, P.hub.read);
  await P.clerk.w.act('wire-want', { dataset: { role: 'boss' } }, P.clerk.read);
  assert.deepEqual(P.clerk.w.state().want, { role: '', agent: '' });
  // the owner grants: by pasted key, and refuses what cannot be right
  const grant = async (pub, role) => { P.owner.fields['wire-key'] = pub; P.owner.fields['wire-role'] = role; await P.owner.w.act('wire-grant', { dataset: {} }, P.owner.read); return P.owner.w.state().say; };
  assert.match(await grant('not a key', 'staff'), /^Not granted: that is not a device key/);
  assert.match(await grant(o.k.owner.pub, 'staff'), /^Not granted: that is the owner’s own key/);
  assert.match(await grant(o.k.hub.pub.toUpperCase(), 'hub'), /^Granted /, 'a key pasted in capitals is still the key');
  assert.match(await grant(o.k.hub.pub, 'hub'), /already holds that role/);
  assert.match(await grant(o.k.finance.pub, 'agent:finance'), /as the Finance agent/);
  assert.match(await grant(o.k.audit.pub, 'agent:audit'), /as the Audit agent/);
  // a device that reached the owner without a grant is offered with a one-click grant
  const near = page(o, 'owner', { peers: () => [{ pub: o.k.clerk.pub, via: 'a machine link' }, { pub: o.k.clerk.pub, via: 'another tab' }, { pub: o.k.hub.pub, via: 'x' }, { pub: 'junk', via: 'x' }] });
  s = near.w.state();
  assert.deepEqual(s.pending.map((p) => p.pub), [o.k.clerk.pub], 'one entry per key; granted and malformed keys left out');
  assert.equal(s.checklist.steps.find((x) => x.id === 'invite').status, 'done');
  near.fields['role:' + o.k.clerk.pub] = 'staff';
  await near.w.act('wire-grant', { dataset: { pub: o.k.clerk.pub } }, near.read);
  assert.match(near.w.state().say, /^Granted /);
  await o.sync();
  // a person's device cannot grant
  P.clerk.fields['wire-key'] = 'f'.repeat(64); P.clerk.fields['wire-role'] = 'staff';
  await P.clerk.w.act('wire-grant', { dataset: {} }, P.clerk.read);
  assert.equal(P.clerk.w.state().say, 'Only the owner or an admin can grant a device.');
  // the hub sends a real test case to each agent device
  assert.deepEqual(P.hub.w.state().hub, { agents: 2, sent: 0 });
  await P.hub.w.act('wire-test', { dataset: {} }, P.hub.read);
  assert.match(P.hub.w.state().say, /^Sent 1 test case: e\d{9} → Finance agent\./, 'the Audit agent decides no work of its own');
  assert.equal(P.hub.w.state().hub.sent, 1);
  await o.sync();
  // the agent devices start their agents here; the Finance agent decides the test case, the Audit agent confirms it
  await P.finance.w.act('wire-run', { dataset: {} }, P.finance.read);
  await P.audit.w.act('wire-run', { dataset: {} }, P.audit.read);
  assert.equal(P.finance.w.running, true);
  assert.equal(P.finance.store.get('se.wire.auto'), 'finance');
  for (let i = 0; i < 4; i++) { await P.finance.w.beat(); await P.audit.w.beat(); await o.sync(); }
  const st = P.finance.w.state().agent.status;
  assert.equal(st.state, 'running');
  assert.equal(st.decisions, 1);
  assert.deepEqual(st.brains, ['credit', 'fraud']);
  const d = o.nodes.owner.list('decisions')[0];
  assert.equal(d.agent, 'finance');
  assert.equal(o.nodes.owner.list('inbox')[0].status, 'done');
  h = U.renderWire(P.finance.w.state());
  assert.equal(balanced(h), '');
  assert.match(h, /Run the Finance agent on this device/);
  assert.match(h, /decided by this device/);
  // the owner calls the roll; every device checks in with the company it holds
  await P.owner.w.act('wire-cards', { dataset: {} }, P.owner.read);
  await P.owner.w.act('wire-roll', { dataset: {} }, P.owner.read);
  await o.sync();
  for (const p of Object.values(P)) await p.w.beat();
  await o.sync();
  const v = wiringView(o.nodes.owner);
  assert.deepEqual(Object.keys(v.checkins).sort(), [o.k.owner.pub, o.k.hub.pub, o.k.finance.pub, o.k.audit.pub, o.k.clerk.pub].sort());
  assert.deepEqual(v.checkins[o.k.finance.pub].role, 'agent');
  assert.equal(v.checkins[o.k.finance.pub].agent, 'finance');
  assert.ok(Object.values(v.checkins).every((c) => c.mark === v.mark), 'every device holds the same company');
  // no new roll call: nobody writes again
  const size = o.nodes.owner.size();
  for (const id of ['owner', 'hub', 'clerk']) await P[id].w.beat();
  assert.equal(o.nodes.owner.size(), size);
  // a name changed: that device checks in again
  P.clerk.fields['wire-name'] = 'Front desk ' + EVIL;
  await P.clerk.w.act('wire-name', { dataset: {} }, P.clerk.read);
  await P.clerk.w.beat();
  await o.sync();
  assert.equal(wiringView(o.nodes.owner).checkins[o.k.clerk.pub].name, ('Front desk ' + EVIL).slice(0, 40));
  // the plan, then the receipt
  P.owner.fields['wire-people'] = '1';
  P.owner.fields['plan:finance'] = true; P.owner.fields['plan:audit'] = true;
  await P.owner.w.act('wire-plan', { dataset: {} }, P.owner.read);
  assert.deepEqual(JSON.parse(P.owner.store.get('se.wire.plan')), { people: 1, agents: ['finance', 'audit'] });
  s = P.owner.w.state();
  assert.deepEqual(s.checklist.steps.filter((x) => x.status !== 'done').map((x) => x.id), ['model', 'receipt']);
  h = U.renderWire(s);
  assert.ok(!h.includes(EVIL) && h.includes('Front desk &lt;img'), 'a device name is shown escaped');
  await P.owner.w.act('wire-sign', { dataset: {} }, P.owner.read);
  assert.match(P.owner.w.state().say, /^Signed by the owner’s key: 4 devices, 4 showing this company\./);
  s = P.owner.w.state();
  assert.equal(s.checklist.complete, true);
  await P.owner.w.act('wire-save', { dataset: {} }, P.owner.read);
  assert.equal(P.owner.downloads.length, 1);
  const [name, text] = P.owner.downloads[0];
  const receipt = JSON.parse(text);
  assert.equal(name, 'wiring-receipt-' + receipt.hash.slice(0, 16) + '.json');
  assert.deepEqual(await verifyWiringReceipt(receipt), { ok: true, company: o.k.owner.pub, at: receipt.at, devices: 4, same: 4 });
  // anyone checks it on the page; a changed one is caught
  P.clerk.fields['wire-verify-in'] = text;
  await P.clerk.w.act('wire-verify', { dataset: {} }, P.clerk.read);
  assert.match(P.clerk.w.state().verifyOut, /^Genuine: signed by the owner of company /);
  P.clerk.fields['wire-verify-in'] = text.replace('"agent"', '"agentx"');
  await P.clerk.w.act('wire-verify', { dataset: {} }, P.clerk.read);
  assert.equal(P.clerk.w.state().verifyOut, 'Not genuine: it was changed after it was signed.');
  P.clerk.fields['wire-verify-in'] = 'not json';
  await P.clerk.w.act('wire-verify', { dataset: {} }, P.clerk.read);
  assert.equal(P.clerk.w.state().verifyOut, 'Not genuine: it is not a wiring receipt.');
  // only the owner signs
  await P.clerk.w.act('wire-sign', { dataset: {} }, P.clerk.read);
  assert.equal(P.clerk.w.state().say, 'Only the owner’s device signs the wiring receipt.');
  // the install sheet, from the real state
  await P.owner.w.act('wire-print', { dataset: {} }, P.owner.read);
  const sheet = P.owner.printed[0];
  assert.equal(balanced(sheet), '');
  assert.ok(sheet.includes(o.k.owner.pub.slice(0, 8)) && sheet.includes('https://example.org/#join='));
  assert.ok(sheet.includes('sudo systemctl edit ollama.service'), 'the commands for this machine');
  // stopping the agent; a restart of the page starts it again by itself
  await P.finance.w.act('wire-stop', { dataset: {} }, P.finance.read);
  assert.equal(P.finance.w.running, false);
  assert.equal(P.finance.store.get('se.wire.auto'), '');
  const again = page(o, 'finance');
  again.store.set('se.wire.want', JSON.stringify({ role: 'agent', agent: 'finance' }));
  again.store.set('se.wire.auto', 'finance');
  await again.w.beat();
  assert.equal(again.w.running, true, 'an AI box that restarts runs its agent again with no click');
});

test('the behaviour watch on the owner’s device: an agent acting off its own work is paused, shown, and cleared by a person', async () => {
  const o = await office(['owner', 'finance', 'clerk']);
  await o.nodes.owner.grant('agent-finance', o.k.finance.pub, 'agent', [...AGENTS.find((a) => a.id === 'finance').cols, 'wire', 'model']);
  await o.nodes.owner.grant('staff-clerk', o.k.clerk.pub, 'staff', ['tasks', 'wire']);
  await o.sync();
  for (let i = 1; i <= 3; i++) await o.nodes.finance.put('decisions', 'd' + i, { agent: 'finance', event: 'e00000' + i, domain: 'fraud', action: 'shed-load', state: 'done', by: 'own', cross: true, channel: 'fraud' });
  await o.sync();
  let now = 1760000000000;
  const P = page(o, 'owner', { now: () => now });
  await P.w.beat();
  const c = o.nodes.owner.list('control').find((r) => r.id === 'finance');
  assert.equal(c.paused, true);
  assert.equal(c.by, 'the behaviour watch');
  assert.equal(c.watch, 'hijacked');
  let s = P.w.state();
  assert.match(s.say, /^The behaviour watch paused the Finance agent: it stopped behaving like itself/);
  assert.deepEqual(s.control.finance, { paused: true, by: 'the behaviour watch', watch: 'hijacked' });
  const h = U.renderWire(s);
  assert.equal(balanced(h), '');
  assert.match(h, /paused by the behaviour watch: the watch read it as hijacked/);
  assert.match(h, /data-act="wire-clear" data-agent="finance"/);
  // a person's device cannot clear it
  const C = page(o, 'clerk');
  await C.w.act('wire-clear', { dataset: { agent: 'finance' } }, C.read);
  assert.equal(C.w.state().say, 'Only the owner or an admin clears a paused agent.');
  await P.w.act('wire-clear', { dataset: { agent: 'nobody' } }, P.read);
  assert.equal(P.w.state().say, 'Only the owner or an admin clears a paused agent.');
  // the owner clears it: judged afresh from its next decision, so the watch does not pause it again for the old ones
  await P.w.act('wire-clear', { dataset: { agent: 'finance' } }, P.read);
  assert.match(P.w.state().say, /^Cleared: the Finance agent works again/);
  const cl = o.nodes.owner.list('control').find((r) => r.id === 'finance');
  assert.deepEqual([cl.paused, cl.cleared, cl.rebaseline, cl.by], [false, 'd3', false, 'Owner']);
  now += U.WATCH_MS;
  await P.w.beat();
  assert.equal(o.nodes.owner.list('control').find((r) => r.id === 'finance').paused, false);
  assert.doesNotMatch(U.renderWire(P.w.state()), /wire-clear/);
  // not before the next watch is due
  await o.nodes.finance.put('decisions', 'd9', { agent: 'finance', event: 'e000009', domain: 'fraud', action: 'shed-load', state: 'done', by: 'own', cross: true, channel: 'fraud' });
  await o.sync();
  now += U.WATCH_MS - 1;
  await P.w.beat();
  assert.equal(o.nodes.owner.list('control').find((r) => r.id === 'finance').paused, false, 'the watch runs every ' + U.WATCH_MS + ' ms, not on every beat');
  now += 1;
  await P.w.beat();
  assert.equal(o.nodes.owner.list('control').find((r) => r.id === 'finance').paused, true, 'a new act off its work, after the clearance: paused again');
});

test('the controller never throws: no device, junk env, a model probe, the OS', async () => {
  for (const env of [undefined, null, {}, { node: () => { throw new Error('x'); } }]) {
    const w = U.createWire(env);
    assert.equal(w.state().hasNode, false);
    await w.beat();
    for (const a of ['wire-grant', 'wire-sign', 'wire-test', 'wire-run', 'wire-print', 'wire-verify', 'nope']) await assert.doesNotReject(w.act(a, null));
  }
  const o = await office(['owner']);
  const p = page(o, 'owner', { probeModel: async () => ({ ok: true, models: ['llama3.2', 'qwen2.5:7b'] }) });
  await p.w.act('wire-model', { dataset: {} }, p.read);
  assert.deepEqual(p.w.state().model, { checked: true, ok: true, models: ['llama3.2', 'qwen2.5:7b'], why: '' });
  assert.match(U.renderWire(p.w.state()), /will use qwen2\.5:7b/);
  const q = page(o, 'owner', { probeModel: async () => ({ ok: false, models: [], why: 'Nothing answered at localhost:11434.' }) });
  await q.w.act('wire-model', { dataset: {} }, q.read);
  assert.equal(q.w.state().model.ok, false);
  assert.match(U.renderWire(q.w.state()), /Nothing answered at localhost:11434\./);
  q.fields['wire-os'] = 'mac';
  await q.w.act('wire-os', { dataset: {} }, q.read);
  assert.equal(q.w.state().os, 'mac');
  q.fields['wire-os'] = 'amiga';
  await q.w.act('wire-os', { dataset: {} }, q.read);
  assert.equal(q.w.state().os, 'mac');
  assert.match(U.renderWire(q.w.state()), /launchctl setenv OLLAMA_ORIGINS/);
  const bad = page(o, 'owner', { probeModel: async () => { throw new Error('blocked by the browser'); } });
  await bad.w.act('wire-model', { dataset: {} }, bad.read);
  assert.equal(bad.w.state().say, 'That did not work: blocked by the browser');
  assert.ok(bad.renders() > 0, 'every action repaints');
});
