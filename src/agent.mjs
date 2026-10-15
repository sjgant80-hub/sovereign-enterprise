// agent.mjs — what an AI agent DOES with what its brain says. Pure, total, deterministic.
//
// A full AI company: agents act end to end; humans watch. The rules an agent follows:
//   1. Inbound text that fails the screen is quarantined — the agent never acts on it.
//   2. Its own brain answers (VERIFIED) → act. If the brain ABSTAINS → ask the mesh; a peer's verified answer will do.
//   3. HIGH-STAKES actions (holding a payment, changing credit terms, quarantining a device) — or any low-confidence call —
//      need a SECOND brain to agree (cross-verification; a thing cannot validate itself). Agreement → act.
//      Disagreement or no second brain → the item goes to the watch list, untouched.
//   4. Nothing verified anywhere → the model tier (a local or frontier model, within budget). A model's answer is
//      never trusted for a high-stakes act on its own — it goes to the watch list.
//   5. Nothing at all → the watch list.

export const ACTIONS = Object.freeze({
  churn: { 1: 'retain', 0: 'standard-reply', stakes: 'normal', yes: 'at risk of leaving', role: 'service' },
  shopper: { 1: 'fast-track', 0: 'nurture', stakes: 'normal', yes: 'likely to buy', role: 'sales' },
  fraud: { 1: 'hold-payment', 0: 'release-payment', stakes: 'high', yes: 'looks fraudulent', role: 'finance' },
  credit: { 1: 'upfront-terms', 0: 'standard-terms', stakes: 'high', yes: 'likely to default', role: 'finance' },
  inventory: { 1: 'raise-po', 0: 'no-reorder', stakes: 'normal', yes: 'about to stock out', role: 'ops' },
  maintenance: { 1: 'schedule-service', 0: 'keep-running', stakes: 'normal', yes: 'about to fail', role: 'ops' },
  intrusion: { 1: 'quarantine', 0: 'allow', stakes: 'high', yes: 'an intrusion', role: 'systems' },
  energy: { 1: 'shed-load', 0: 'normal-load', stakes: 'normal', yes: 'about to overload', role: 'ops' },
});

// moneyLimit — whole pence; 0 = no limit. Above it, a person decides any act that commits the company's money, whatever the
// brains say: letting a payment through, extending standard credit terms, raising a purchase order.
export const DEFAULT_POLICY = Object.freeze({ minConfidence: 0.05, moneyLimit: 0 });
export const MONEY_ACTIONS = Object.freeze(['release-payment', 'standard-terms', 'raise-po']);
export const MAX_LIMIT = 1e11;   // £1bn in pence — a policy field, not a balance sheet
const pounds = (p) => '£' + String(Math.floor(p / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (p % 100 ? '.' + String(p % 100).padStart(2, '0') : '');
/** The money limit a policy sets, in pence (0 = none): a whole number from 0 to MAX_LIMIT, anything else is none. */
export function moneyLimitOf(policy) {
  const v = policy && policy.moneyLimit;
  return Number.isSafeInteger(v) && v >= 1 && v <= MAX_LIMIT ? v : 0;
}

// Money and security work is decided only by the agent whose job it is: any job whose calls are high-stakes, or whose
// acts commit the company's money. Another agent that receives such work hands it over; it never decides it.
export const OWNED_ONLY = Object.freeze(Object.keys(ACTIONS).filter((d) => ACTIONS[d].stakes === 'high' || MONEY_ACTIONS.includes(ACTIONS[d][0]) || MONEY_ACTIONS.includes(ACTIONS[d][1])));
/** Is this work decided only by its own agent? (false for any unknown job) */
export const ownedOnly = (domain) => OWNED_ONLY.includes(domain);
/** The other action of a job — what overturning `action` means. null when the job or the action is not known. */
export function opposite(domain, action) {
  const a = Object.prototype.hasOwnProperty.call(ACTIONS, domain) ? ACTIONS[domain] : null;
  if (!a) return null;
  return action === a[0] ? a[1] : action === a[1] ? a[0] : null;
}

const verified = (a) => !!a && a.verdict === 'VERIFIED' && (a.label === 0 || a.label === 1) && typeof a.domain === 'string';

/** The action a label means in a domain (null if the domain is unknown). */
export function actionFor(domain, label) {
  const a = ACTIONS[domain];
  return a ? a[label === 1 ? 1 : 0] : null;
}

/** Does this call need a second brain? High-stakes domains always; any call below the confidence floor too. */
export function needsSecond(domain, confidence, policy) {
  const a = ACTIONS[domain];
  if (!a) return true;
  if (a.stakes === 'high') return true;
  const floor = policy && typeof policy.minConfidence === 'number' ? policy.minConfidence : DEFAULT_POLICY.minConfidence;
  return !(typeof confidence === 'number' && confidence >= floor);
}

/**
 * Decide. Inputs are what the agent has already gathered (and amount — the work's value in pence, for the money limit):
 *   screen — result of screen(text) for any inbound text, or null
 *   own    — this agent's own brain answer
 *   mesh   — the strongest verified reply from another device when own abstained (mesh.mjs pickAnswer): { node, answer } or null
 *   second — a second brain's answer on the same input (for cross-verification), or null
 *   model  — the model tier's answer { label, domain, by } when nothing verified, or null
 * → { state: 'done'|'watch', action, label, domain, by, crossChecked, why }
 */
export function decide(inputs, policy = DEFAULT_POLICY) {
  const d = choose(inputs, policy);
  try {
    const limit = moneyLimitOf(policy);
    if (!limit || d.state !== 'done' || !MONEY_ACTIONS.includes(d.action)) return d;
    const amount = inputs.amount, known = Number.isSafeInteger(amount) && amount >= 0;
    if (known && amount <= limit) return d;
    return { ...d, state: 'watch', why: (known ? pounds(amount) + ' is over the ' + pounds(limit) + ' limit a person set'
      : 'the amount is not known and a ' + pounds(limit) + ' limit is set') + ' — held for a person' };
  } catch {
    return { state: 'watch', action: null, label: null, domain: null, by: 'fault', crossChecked: false, why: 'the agent failed closed' };
  }
}

function choose(inputs, policy) {
  try {
    const { screen, own, mesh, second, model } = inputs || {};
    if (screen && screen.ok === false) {
      return { state: 'watch', action: 'quarantine-input', label: null, domain: null, by: 'screen', crossChecked: false, why: 'inbound text failed the screen: ' + (screen.flags || []).join(', ') };
    }
    let a = null, by = null;
    if (verified(own)) { a = own; by = 'own'; }
    else if (mesh && verified(mesh.answer)) { a = mesh.answer; by = 'mesh:' + mesh.node; }
    if (a) {
      const action = actionFor(a.domain, a.label);
      if (!action) return { state: 'watch', action: null, label: a.label, domain: a.domain, by, crossChecked: false, why: 'no action is defined for this domain' };
      if (!needsSecond(a.domain, a.confidence, policy)) {
        return { state: 'done', action, label: a.label, domain: a.domain, by, crossChecked: false, why: 'verified pattern, clear of its decision line' };
      }
      if (verified(second) && second.domain === a.domain && second.label === a.label) {
        return { state: 'done', action, label: a.label, domain: a.domain, by, crossChecked: true, why: 'a second brain agreed' };
      }
      const why = verified(second) ? 'a second brain disagreed — held for a person' : 'no second brain could confirm — held for a person';
      return { state: 'watch', action, label: a.label, domain: a.domain, by, crossChecked: false, why };
    }
    if (model && (model.label === 0 || model.label === 1) && typeof model.domain === 'string') {
      const action = actionFor(model.domain, model.label);
      const high = ACTIONS[model.domain] && ACTIONS[model.domain].stakes === 'high';
      return { state: high || !action ? 'watch' : 'done', action, label: model.label, domain: model.domain, by: 'model:' + (model.by || 'model'), crossChecked: false,
        why: high ? 'a model answered a high-stakes call — held for a person' : 'no verified pattern; the model tier answered' };
    }
    return { state: 'watch', action: null, label: null, domain: null, by: 'none', crossChecked: false, why: 'no brain covered it and no model tier is connected' };
  } catch {
    return { state: 'watch', action: null, label: null, domain: null, by: 'fault', crossChecked: false, why: 'the agent failed closed' };
  }
}

/** Budget (the-wallet rule): a limb call is allowed only if it fits what is left. Integer pence. */
export function canSpend(budget, spent, cost) {
  if (!Number.isSafeInteger(budget) || !Number.isSafeInteger(spent) || !Number.isSafeInteger(cost)) return false;
  if (budget < 0 || spent < 0 || cost < 0) return false;
  return spent + cost <= budget;
}

/** Score an agent's finished decisions against the ground truth it never saw. → { done, correct, accuracy, watched } */
export function scorecard(decisions) {
  let done = 0, correct = 0, watched = 0;
  for (const d of Array.isArray(decisions) ? decisions : []) {
    if (!d || typeof d !== 'object') continue;
    if (d.state === 'watch') { watched++; continue; }
    if (d.state !== 'done' || (d.truth !== 0 && d.truth !== 1)) continue;
    done++;
    if (d.label === d.truth) correct++;
  }
  return { done, correct, watched, accuracy: done ? correct / done : 0 };
}
