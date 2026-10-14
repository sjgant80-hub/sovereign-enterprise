// streams.mjs — the work each department's agent sees, and the local data each node verifies on.
//
// Seven domains come from the Konomi SLM's realistic-synthetic generators (vendored, credited, rule printed in each
// note): a device draws its OWN sample by seed, so two devices verify a pattern on different data. The ground truth
// `y` travels with each row only so the dashboard can score the agents — the agents never read it.
// Sales runs on REAL data: held-out (Nov–Dec) sessions of the UCI Online Shoppers dataset (CC BY 4.0).
import { STREAM, loadDomainExt, EXT_META } from '../vendor/konomi/domains-ext.mjs';

export const SYNTHETIC = ['churn', 'fraud', 'credit', 'inventory', 'maintenance', 'intrusion', 'energy'];

/** n rows from a domain's generator under a device's own seed → { ok, features, rows:[{...f, y}], note, real:false } */
export function sample(domain, seed, n) {
  if (!SYNTHETIC.includes(domain)) return { ok: false, rows: [], features: [] };
  STREAM.seed = seed >>> 0;
  STREAM.n = Math.max(1, Math.min(20000, Math.floor(n) || 1));
  try {
    const ds = loadDomainExt(domain);
    if (!ds || !ds.ok) return { ok: false, rows: [], features: [] };
    const rows = [];
    for (let i = 0; i < ds.n; i++) {
      const r = {};
      for (const f of ds.features) r[f] = Math.round(ds.cols[f][i] * 1e6) / 1e6;
      r.y = ds.y[i];
      rows.push(r);
    }
    return { ok: true, features: ds.features, rows, note: ds.note, real: false };
  } finally {
    STREAM.seed = null;
    STREAM.n = null;
  }
}

/** The real UCI sample (brains/shopper.sample.json) → rows. */
export function shopperRows(json) {
  if (!json || !Array.isArray(json.features) || !Array.isArray(json.data)) return [];
  return json.data.map((v) => { const r = {}; json.features.forEach((f, i) => { r[f] = v[i]; }); r.y = v[json.features.length]; return r; });
}

export const NOTES = Object.fromEntries(SYNTHETIC.map((d) => [d, (EXT_META[d] && EXT_META[d].note) || '']));
