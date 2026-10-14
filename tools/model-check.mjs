#!/usr/bin/env node
// model-check.mjs — a REAL integration check of the model tier (src/model.mjs) against the local Ollama.
//
//   node tools/model-check.mjs [--url http://localhost:11434] [--model qwen2.5:7b] [--n 12] [--timeout 120000] [--json]
//                              [--only cases|routes] [--desks customer|agents]
//
// --desks: what the router is told each department handles. 'customer' (default) = DESKS below, written in the words a
// customer uses; 'agents' = the AGENTS job lines from company.mjs (written about the agents' internal work).
//
// 1. Lists the installed models (/api/tags) and picks a small chat model (or --model).
// 2. Case prompts: n unseen cases each from a normal-stakes domain (churn) and a high-stakes one (fraud), drawn from the
//    company's own seeded streams with their ground truth. Each goes through ask() exactly as an agent would call it;
//    the parsed label is scored against the truth, beside the verified brain's answer on the same case, and decide()
//    shows what the agent would do with it (a model's fraud call is always held for the watchers).
// 3. Route prompts: hand-written customer messages (the expected department is this tool's own labelling, stated
//    plainly) plus every hostile message the company uses — those must be stopped by the screen before any model call.
// 4. Checks one audit record against the spine's own grammar (gate.validOp) — the record a device would sign.
// 5. Probes whether the LIVE page's origin may call this Ollama (a CORS preflight from https://sjgant80-hub.github.io).
// Nothing here is mocked. If Ollama is not reachable this stops loudly (exit 2) — it never falls back to a cloud model.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ollama, ask } from '../src/model.mjs';
import { decide, ACTIONS } from '../src/agent.mjs';
import { answer } from '../src/brain.mjs';
import { sample } from '../src/streams.mjs';
import { AGENTS, HOSTILE_TEXT } from '../src/company.mjs';
import { validOp } from '../src/gate.mjs';
import { DESKS } from '../src/runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d; };
const URL_ = String(arg('--url', 'http://localhost:11434')).replace(/\/+$/, '');
const N = Math.max(1, Math.min(200, Number(arg('--n', 12)) || 12));
const TIMEOUT = Math.max(1000, Math.min(600000, Number(arg('--timeout', 120000)) || 120000));
const JSON_OUT = process.argv.includes('--json');
const ONLY = arg('--only', '');
const DESK_MODE = arg('--desks', 'customer') === 'agents' ? 'agents' : 'customer';
// The five customer-facing departments, described in a customer's words — the runtime's own DESKS (one source).
const PAGES_ORIGIN = 'https://sjgant80-hub.github.io';
const PREFER = ['qwen2.5:7b', 'llama3.2:3b', 'llama3.2:1b', 'qwen2.5:3b', 'qwen2.5:14b'];
const say = (...a) => { if (!JSON_OUT) console.log(...a); };

async function tags() {
  try {
    const r = await fetch(URL_ + '/api/tags', { signal: AbortSignal.timeout(5000) });
    if (r.status !== 200) return { ok: false, why: 'http ' + r.status };
    const j = await r.json();
    return { ok: true, models: (j.models || []).map((m) => ({ name: m.name, size: m.details && m.details.parameter_size, caps: m.capabilities || [] })) };
  } catch (e) { return { ok: false, why: String(e && e.cause ? e.cause.code || e.cause.message : e && e.message) }; }
}

async function corsProbe() {
  try {
    const r = await fetch(URL_ + '/api/chat', { method: 'OPTIONS', signal: AbortSignal.timeout(5000),
      headers: { origin: PAGES_ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    return { status: r.status, allowOrigin: r.headers.get('access-control-allow-origin') || '', allowPrivateNetwork: r.headers.get('access-control-allow-private-network') || '' };
  } catch (e) { return { status: 0, allowOrigin: '', error: String(e && e.message) }; }
}

const t = await tags();
if (!t.ok) {
  console.error('✗ LOCAL MODEL DOWN — no Ollama at ' + URL_ + ' (' + t.why + '). Bring it up (start Ollama) and re-run. No cloud fallback.');
  process.exit(2);
}
const chat = t.models.filter((m) => !m.caps.includes('embedding') && (m.caps.includes('completion') || !m.caps.length));
const want = arg('--model', null);
const pick = want ? chat.find((m) => m.name === want) : PREFER.map((p) => chat.find((m) => m.name === p)).find(Boolean) || chat[0];
say('Ollama at ' + URL_ + ' — ' + t.models.length + ' models installed: ' + t.models.map((m) => m.name + (m.size ? ' (' + m.size + ')' : '')).join(', '));
if (!pick) { console.error('✗ no chat model installed' + (want ? ' named ' + want : '') + ' — `ollama pull qwen2.5:7b` and re-run.'); process.exit(2); }
say('Using ' + pick.name + ' (' + (pick.size || '?') + ')\n');

const adapter = ollama({ url: URL_, model: pick.name, timeoutMs: TIMEOUT });
const brainOf = (d) => { const p = JSON.parse(readFileSync(join(HERE, '..', 'brains', d + '.slm.json'), 'utf8')); return { [d]: p }; };

// ── warm-up (loading the model into memory is not a per-call cost) ──
const w0 = Date.now();
const warm = await adapter.call({ system: 'Reply with the digit 1.', prompt: '1', maxTokens: 4 });
say('warm-up: ' + (warm.ok ? 'ok' : 'FAILED ' + warm.why) + ' in ' + (Date.now() - w0) + ' ms (model load)\n');

// ── 2. case prompts ──
const cases = {};
for (const [domain, agent, seed] of ONLY === 'routes' ? [] : [['churn', 'service', 424242], ['fraud', 'finance', 515151]]) {
  const rows = sample(domain, seed, N).rows;
  const lib = brainOf(domain);
  const out = { domain, stakes: ACTIONS[domain].stakes, n: rows.length, parsed: 0, correct: 0, brainAnswered: 0, brainCorrect: 0, done: 0, watch: 0, ms: [], raw: [] };
  say('── ' + domain + ' (' + ACTIONS[domain].stakes + ' stakes) — ' + rows.length + ' unseen cases, 1 = "' + ACTIONS[domain].yes + '"');
  for (const row of rows) {
    const { y, ...features } = row;
    const r = await ask({ adapter, task: { type: 'case', agent, domain, features }, budget: 0, spent: 0 });
    const b = answer(lib, features);
    const d = decide({ own: { verdict: 'ABSTAIN' }, mesh: null, model: r.model });
    out.ms.push(r.audit.ms);
    if (r.ok) { out.parsed++; if (r.label === y) out.correct++; }
    else out.raw.push(r.audit.answer || r.why);
    if (b.verdict === 'VERIFIED') { out.brainAnswered++; if (b.label === y) out.brainCorrect++; }
    if (d.state === 'done') out.done++; else out.watch++;
    say('  truth ' + y + ' · model ' + (r.ok ? r.label : '—  (' + (r.audit.answer || r.why).slice(0, 40) + ')') + ' · brain ' + (b.verdict === 'VERIFIED' ? b.label : 'abstain') +
      ' · agent → ' + d.state + (d.action ? ' ' + d.action : '') + ' · ' + r.audit.ms + ' ms · ' + r.audit.tokensIn + '→' + r.audit.tokensOut + ' tok · ' + r.pence + 'p');
  }
  out.msMedian = out.ms.slice().sort((a, b) => a - b)[Math.floor(out.ms.length / 2)];
  say('  model: parsed ' + out.parsed + '/' + out.n + ', right ' + out.correct + '/' + out.parsed + ' · verified brain: answered ' + out.brainAnswered + '/' + out.n + ', right ' + out.brainCorrect + '/' + out.brainAnswered +
    ' · agent acted on ' + out.done + ', held ' + out.watch + ' for the watchers · median ' + out.msMedian + ' ms\n');
  delete out.ms;
  cases[domain] = out;
}

// ── 3. route prompts ──
const departments = DESK_MODE === 'agents' ? AGENTS.filter((a) => a.domains.length) : DESKS;
const MESSAGES = [   // this tool's own labelling of five hand-written messages — a smoke test, not a benchmark
  ['My bill went up again this month, why? I am thinking of cancelling.', 'service'],
  ['Can we increase the credit limit on our trade account to 60-day terms?', 'finance'],
  ['The packing machine on line 3 is vibrating badly and running hot.', 'ops'],
  ['Someone keeps trying to log in to our admin account from an unknown address.', 'systems'],
  ['Do you have the oak dining table in stock? I would like to order two.', 'sales'],
];
const routes = [];
say('── routing ' + MESSAGES.length + ' customer messages to ' + departments.map((d) => d.id).join(' / ') + ' (department descriptions: ' + DESK_MODE + ')');
for (const [text, expect] of ONLY === 'cases' ? [] : MESSAGES) {
  const r = await ask({ adapter, task: { type: 'route', agent: 'door', text, departments }, budget: 0, spent: 0 });
  routes.push({ text, expect, ok: r.ok, department: r.route ? r.route.department : null, reply: r.route ? r.route.reply : null, ms: r.audit.ms, why: r.why, raw: r.ok ? '' : r.audit.answer });
  say('  "' + text.slice(0, 60) + '"\n     → ' + (r.ok ? r.route.department + (r.route.department === expect ? ' ✓' : ' (this tool expected ' + expect + ')') + ' · ' + r.audit.ms + ' ms\n     reply: ' + r.route.reply : 'REFUSED — ' + r.why + ' :: ' + r.audit.answer));
}
const hostile = [];
for (const text of HOSTILE_TEXT) {
  let calls = 0;
  const spy = { ...adapter, call: (q) => { calls++; return adapter.call(q); } };
  const r = await ask({ adapter: spy, task: { type: 'route', agent: 'door', text, departments }, budget: 0, spent: 0 });
  hostile.push({ ok: r.ok, calls, why: r.why });
}
const stopped = hostile.filter((h) => !h.ok && h.calls === 0).length;
say('  hostile messages: ' + stopped + '/' + hostile.length + ' stopped by the screen before any model call\n');

// ── 4. the audit record against the spine's grammar ──
const sampleCall = await ask({ adapter, task: { type: 'case', agent: 'service', domain: 'churn', features: (({ y, ...f }) => f)(sample('churn', 7, 1).rows[0]) }, budget: 0, spent: 0 });
const legal = validOp({ k: 'put', c: 'model_calls', id: 'mc-check-1', l: 1, f: sampleCall.audit });
say('── one audit record (spine-legal: ' + legal + ')\n' + JSON.stringify(sampleCall.audit, null, 1).split('\n').map((l) => '  ' + l).join('\n') + '\n');

// ── 5. can the LIVE page reach this Ollama? ──
const cors = await corsProbe();
const reachable = cors.status === 204 && (cors.allowOrigin === PAGES_ORIGIN || cors.allowOrigin === '*');
say('── CORS from ' + PAGES_ORIGIN + ': preflight ' + cors.status + (cors.allowOrigin ? ' · allow-origin ' + cors.allowOrigin : '') +
  (reachable ? ' — the live page may call this Ollama' : ' — the live page CANNOT call this Ollama: set OLLAMA_ORIGINS=' + PAGES_ORIGIN + ' and restart Ollama'));

const routed = routes.filter((r) => r.ok).length, matched = routes.filter((r) => r.department === r.expect).length;
if (routes.length) say('routing: parsed ' + routed + '/' + routes.length + ', matched this tool\'s labels ' + matched + '/' + routes.length);
const summary = { ollama: URL_, model: pick.name, size: pick.size || '', warmupOk: warm.ok, desks: DESK_MODE, cases, routes, hostileStoppedBeforeCall: stopped, hostileTotal: hostile.length,
  auditSpineLegal: legal, cors: { ...cors, livePageCanCall: reachable } };
if (JSON_OUT) console.log(JSON.stringify(summary, null, 2));
process.exit(warm.ok && legal ? 0 : 1);
