// evidence.mjs — what the numbers do and do not prove, and any decision re-run from the signed record.
//
// An outside review (2026-10-15) asked three fair questions of the receipt, and this kernel answers each in numbers:
//   1. "Right 90.3%" means little on a rare event: doing nothing can score higher. So every job carries its whole
//      confusion matrix (caught, false alarms, correctly left, missed), 95% intervals (Wilson) on how often the brain and
//      doing nothing were right, and an exact test against doing nothing on the SAME cases. Doing nothing (always "no")
//      is right where the brain is wrong only on its false alarms, and wrong where the brain is right only on what it
//      caught — so the brain beats doing nothing on accuracy exactly when caught > false alarms, and the sign test on
//      those two counts says whether the difference is evidence or noise.
//   2. "Independent second brain" is a claim about error correlation, not about having two answers. So for the money and
//      security jobs: how often the two agreed and were BOTH wrong (joint failure), how often the second disagreed and
//      the first was in fact wrong (a catch), and how often it disagreed with a first brain that was right (a false alarm
//      that cost a person's time).
//   3. A receipt hash proves only that its own fields hang together. verifyDecision re-derives a decision from the
//      signed record alone: the decision signed by the agent it names, the work it decided, and every signed version of a
//      brain for that job — re-running the brain on the input must reproduce the receipt the agent signed. Nothing is
//      taken from the agent's word.
// Pure and total: junk in → a refusal or zeros, never a throw.
import { answer, fromRecord } from './brain.mjs';
import { ACTIONS } from './agent.mjs';
import { JOBS } from './company.mjs';
import { signersOf, AGENT_GRANT } from './shell.mjs';

const isBit = (x) => x === 0 || x === 1;
const list = (x) => (Array.isArray(x) ? x : []);

/** 95% Wilson score interval for k successes in n trials → { lo, hi } in [0, 1]; n = 0 → { lo: 0, hi: 1 }. */
export function wilson(k, n, z = 1.96) {
  if (!Number.isSafeInteger(k) || !Number.isSafeInteger(n) || n < 1 || k < 0 || k > n) return { lo: 0, hi: 1 };
  const p = k / n, z2 = z * z, den = 1 + z2 / n;
  const mid = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / den;
  return { lo: Math.max(0, mid - half), hi: Math.min(1, mid + half) };
}

export const EXACT_MAX = 1000;   // the exact test up to this many pairs; beyond it, the normal approximation
/** Two-sided sign test: wins vs losses (ties left out) → p, the chance of a split at least this uneven if the two were
 *  equally good. Exact (binomial) up to EXACT_MAX pairs, then the normal approximation with continuity correction. */
export function signTest(wins, losses) {
  if (!Number.isSafeInteger(wins) || !Number.isSafeInteger(losses) || wins < 0 || losses < 0) return 1;
  const n = wins + losses;
  if (n === 0) return 1;
  const k = Math.min(wins, losses);
  if (n > EXACT_MAX) return Math.min(1, erfc(Math.max(0, (n - 2 * k - 1) / Math.sqrt(2 * n))));
  let tail = 0, c = 2 ** -n;                             // C(n, 0) · 2^-n, then each next term
  for (let i = 0; i <= k; i++) {
    tail += c;
    c = (c * (n - i)) / (i + 1);
  }
  return Math.min(1, 2 * tail);
}
/** The complementary error function for x ≥ 0 (Abramowitz & Stegun 7.1.26, error below 1.5e-7) — the large-sample test. */
function erfc(x) {
  const t = 1 / (1 + 0.3275911 * x);
  return t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
}

/** The confusion matrix of the finished calls (state done, a yes/no answer and a known outcome). */
export function confusion(entries) {
  const out = { tp: 0, fp: 0, tn: 0, fn: 0, n: 0 };
  for (const x of list(entries)) {
    if (!x || x.state !== 'done' || !isBit(x.label) || !isBit(x.truth)) continue;
    out.n++;
    if (x.label === 1) out[x.truth === 1 ? 'tp' : 'fp']++;
    else out[x.truth === 0 ? 'tn' : 'fn']++;
  }
  return out;
}

export const ALPHA = 0.05;
/** The brain against doing nothing (always "no") on the same finished calls. → { n, brainRight, nothingRight, wins,
 *  losses, p, verdict: 'better' | 'worse' | 'no evidence either way', brain: {lo,hi}, nothing: {lo,hi} } */
export function versusNothing(c) {
  const m = c && typeof c === 'object' ? c : {};
  const n = Number.isSafeInteger(m.n) ? m.n : 0;
  const tp = m.tp | 0, fp = m.fp | 0, tn = m.tn | 0;
  const brainRight = tp + tn, nothingRight = tn + fp;
  const p = signTest(tp, fp);
  const verdict = p >= ALPHA ? 'no evidence either way' : tp > fp ? 'better' : 'worse';
  return { n, brainRight, nothingRight, wins: tp, losses: fp, p, verdict, brain: wilson(brainRight, n), nothing: wilson(nothingRight, n) };
}

/** Per job: the confusion matrix, how many were held for a person, and the brain against doing nothing. */
export function jobEvidence(ledger) {
  const out = {};
  const L = list(ledger).filter((x) => x && typeof x === 'object');
  for (const domain of Object.keys(JOBS)) {
    const mine = L.filter((x) => (x.channel || x.domain) === domain);
    if (!mine.length) continue;
    const c = confusion(mine);
    const stakes = ACTIONS[domain] ? ACTIONS[domain].stakes : 'normal';
    out[domain] = { job: JOBS[domain], ...c, held: mine.filter((x) => x.state === 'watch').length, versus: versusNothing(c), stakes,
      accept: acceptance(c, stakes), breakEven: costWeighed(c).breakEven };
  }
  return out;
}

/** What the second brain added on the money and security jobs, judged against what really happened. A call is
 *  'agreed' when a second brain confirmed it, 'disagreed' when one answered differently (held for a person). */
export function secondOpinion(ledger) {
  const out = { asked: 0, agreed: 0, agreedWrong: 0, disagreed: 0, caught: 0, falseAlarm: 0, noSecond: 0 };
  for (const x of list(ledger)) {
    if (!x || typeof x !== 'object') continue;
    const a = ACTIONS[x.channel || x.domain];
    if (!a || a.stakes !== 'high' || !isBit(x.label) || !isBit(x.truth)) continue;
    if (x.state === 'done' && x.crossChecked === true) {
      out.asked++; out.agreed++;
      if (x.label !== x.truth) out.agreedWrong++;
    } else if (x.state === 'watch' && /disagreed/.test(String(x.why || ''))) {
      out.asked++; out.disagreed++;
      if (x.label !== x.truth) out.caught++; else out.falseAlarm++;
    } else if (x.state === 'watch') out.noSecond++;
  }
  return out;
}

// ── may a job run unattended, and is it worth it ────────────────────────────────────────────────────────────────────
/** The floors a job must clear before it runs unattended (the review asked for per-job acceptance criteria). Every job
 *  must beat doing nothing on its own finished calls; a money or security job must also catch enough of the real cases
 *  (recall) and be right often enough when it flags one (precision) — each judged on the LOWER end of its 95% interval,
 *  so a handful of lucky calls cannot pass. A business may raise them; these are the defaults. */
export const FLOORS = Object.freeze({ high: Object.freeze({ recall: 0.5, precision: 0.5 }), normal: Object.freeze({ recall: 0, precision: 0 }) });
const rate = (k, n) => ({ k, n, ...wilson(k, n) });
/**
 * acceptance(c, stakes, floors) → { pass, why: [reasons it fails], versus, recall, precision } for one job's confusion
 * matrix. A job that does not pass runs in proposal mode: its agent proposes and a person decides each call.
 */
export function acceptance(c, stakes, floors = FLOORS) {
  const m = c && typeof c === 'object' ? c : {};
  const tp = m.tp | 0, fp = m.fp | 0, fn = m.fn | 0;
  const kind = stakes === 'high' ? 'high' : 'normal';
  const f = (floors && floors[kind]) || FLOORS[kind];
  const versus = versusNothing(m);
  const recall = rate(tp, tp + fn), precision = rate(tp, tp + fp);
  const why = [];
  if (versus.verdict !== 'better') why.push(versus.verdict === 'worse' ? 'worse than doing nothing' : 'not yet shown better than doing nothing');
  if (recall.lo < f.recall) why.push('catches too few of the real cases to be sure (at least ' + Math.round(f.recall * 100) + '% needed; as low as ' + Math.round(recall.lo * 100) + '% on this evidence)');
  if (precision.lo < f.precision) why.push('too many of its flags could be false (at least ' + Math.round(f.precision * 100) + '% right needed; as low as ' + Math.round(precision.lo * 100) + '% on this evidence)');
  return { pass: why.length === 0, why, versus, recall, precision };
}

/**
 * costWeighed(c, costs) — the calls weighed by what a mistake costs, not counted. Against doing nothing, the agents avoid
 * a missed case with every catch (tp) and add a false alarm with every false flag (fp): they come out ahead whenever a
 * missed case costs more than fp / tp false alarms. That BREAK-EVEN ratio needs no price: breakEven = fp / tp (0 when it
 * never raised a false alarm; null when it caught nothing — then no cost ratio makes it worth it). Given costs
 * { miss, falseAlarm } in whole pence, it also prices the agents, doing nothing and flagging everything on these calls.
 * → { tp, fp, fn, tn, breakEven, priced: null | { agents, nothing, everything, saving } }
 */
export function costWeighed(c, costs) {
  const m = c && typeof c === 'object' ? c : {};
  const tp = m.tp | 0, fp = m.fp | 0, fn = m.fn | 0, tn = m.tn | 0;
  const breakEven = tp > 0 ? fp / tp : null;
  const k = costs && typeof costs === 'object' ? costs : {};
  const ok = (x) => Number.isSafeInteger(x) && x >= 0;
  const priced = ok(k.miss) && ok(k.falseAlarm)
    ? { agents: fn * k.miss + fp * k.falseAlarm, nothing: (tp + fn) * k.miss, everything: (fp + tn) * k.falseAlarm, saving: tp * k.miss - fp * k.falseAlarm }
    : null;
  return { tp, fp, fn, tn, breakEven, priced };
}

// ── re-run a decision from the signed record ───────────────────────────────────────────────────────────────────────
const env = (node, h) => { try { return JSON.parse(new TextDecoder().decode(node.bytes(h))); } catch { return null; } };

/**
 * verifyDecision(node, decisionId) → { ok, why, ... } from this device's own copy of the signed record. The decision
 * must be signed by the key the role tree grants the agent it names (src/shell.mjs), the work it decided must be on the
 * record, and some signed version of a brain for that job, run on that work's input, must reproduce exactly the receipt
 * the agent signed. ok carries { agent, event, domain, patternId, brainBy (who signed that brain version), label, input }.
 * A decision no brain made (the screen, the model tier) has no brain receipt to re-run, and says so.
 */
export function verifyDecision(node, decisionId) {
  try {
    const d = node.list('decisions').find((r) => r.id === decisionId);
    if (!d) return { ok: false, why: 'no such decision on this device' };
    const v = node.view();
    const agents = new Map();   // every key the role tree has granted an agent's scope — a decision on the record was authorised when written
    for (const r of v.roster) { const m = r.role === 'agent' ? AGENT_GRANT.exec(r.grant) : null; if (m) agents.set(r.to, m[1]); }
    if (agents.get(signersOf(node, 'decisions').get(d.id)) !== d.agent) return { ok: false, why: 'the decision is not signed by the agent it names' };
    if (!/^[0-9a-f]{16}$/.test(String(d.receipt || ''))) {
      return { ok: false, why: 'no brain receipt to re-run: it was decided ' + (d.by === 'screen' ? 'by the screen' : String(d.by).startsWith('model:') ? 'by the model tier' : 'without a verified brain') };
    }
    const work = node.list('inbox').find((r) => r.id === d.event);
    if (!work) return { ok: false, why: 'the work it decided is not on this device' };
    let input = null;
    try { input = JSON.parse(work.features); } catch { input = null; }
    if (!input || typeof input !== 'object') return { ok: false, why: 'the work it decided has no readable input' };
    const domain = String(d.domain || '');
    const tried = new Set();
    for (const h of node.hashes()) {
      const e = env(node, h) || {};
      const op = e.op || {};
      // only a brain version the role tree authorised: a key with no right to write brains cannot plant one that "verifies"
      const p = op.c === 'brain' && v.auth.can(e.from, 'brain', op.l, e.seq) ? fromRecord(op.f) : null;   // fromRecord refuses anything not a whole pattern
      if (p === null || p.domain !== domain || tried.has(p.patternId)) continue;
      tried.add(p.patternId);
      const a = answer({ [domain]: p }, input);
      if (a.verdict === 'VERIFIED' && a.receipt.receiptHash.slice(0, 16) === d.receipt) {
        return { ok: true, why: 're-ran the signed brain on the signed input: the same receipt the agent signed', agent: d.agent, event: d.event, domain,
          patternId: p.patternId, brainBy: agents.get(e.from) || (e.from === node.genesis ? 'owner' : 'admin'), label: a.label, input: a.receipt.input };
      }
    }
    return { ok: false, why: tried.size ? 'no signed version of a ' + domain + ' brain reproduces this receipt (' + tried.size + ' tried)' : 'no signed brain for ' + (domain || 'this job') + ' is on this device' };
  } catch { return { ok: false, why: 'the decision could not be checked' }; }
}
