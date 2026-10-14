// streams.mjs — the work each department's agent sees, and the local data each node verifies on. Pure, total.
//
// PUBLISHED DATA where an openly-licensed dataset exists: brains/shopper.sample.json and brains/real/*.sample.json, one
// file per domain, each stating its citation, licence, label and split in its `source` (built from the raw downloads by
// tools/build-real-brains.mjs). Every one holds only HELD-OUT rows its shipped brain never grew on, so a device that
// re-verifies on them is doing a genuine held-out check. REAL says what each one is — real-world measurements, a lab
// testbed, a label we derived, or a dataset its own authors publish as synthetic — and `real` is true only for the first
// three. Inventory has no open real dataset and stays synthetic.
// The SYNTHETIC generators stay for every domain (the Konomi SLM's realistic-synthetic streams, vendored and credited,
// rule printed in each note): a device draws its OWN sample by seed, so two devices verify a pattern on different data.
// The ground truth `y` travels with each row only so the dashboard can score the agents — the agents never read it.
import { STREAM, loadDomainExt, EXT_META } from '../vendor/konomi/domains-ext.mjs';

export const SYNTHETIC = ['churn', 'fraud', 'credit', 'inventory', 'maintenance', 'intrusion', 'energy'];

const NONE = () => ({ ok: false, rows: [], features: [] });

/** n rows from a domain's synthetic generator under a device's own seed → { ok, features, rows:[{...f, y}], note, real:false }. Total. */
export function sample(domain, seed, n) {
  try {
    if (!SYNTHETIC.includes(domain)) return NONE();
    STREAM.seed = seed >>> 0;
    STREAM.n = Math.max(1, Math.min(20000, Math.floor(n) || 1));
    const ds = loadDomainExt(domain);
    if (ds.ok !== true) return NONE();
    const rows = [];
    for (let i = 0; i < ds.n; i++) {
      const r = {};
      for (const f of ds.features) r[f] = Math.round(ds.cols[f][i] * 1e6) / 1e6;
      r.y = ds.y[i];
      rows.push(r);
    }
    return { ok: true, features: ds.features, rows, note: ds.note, real: false };
  } catch {
    return NONE();
  } finally {
    STREAM.seed = null;
    STREAM.n = null;
  }
}

const FEATURE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
// A sample's feature list: 1–16 distinct names (the pattern limit), none of them the label `y`.
function validFeatures(features) {
  if (!Array.isArray(features)) return false;
  if (features.length < 1) return false;
  if (features.length > 16) return false;
  if (new Set(features).size !== features.length) return false;
  return features.every((f) => typeof f === 'string' && f !== 'y' && FEATURE.test(f));
}

/**
 * A published sample file { source, rows, features, data: [[...features, y]] } → rows [{...features, y}]. Total: junk → [].
 * The file is untrusted until checked: a row whose width, values or label are off (a non-finite value, y not 0 or 1) is
 * dropped, never repaired.
 */
export function realRows(json) {
  try {
    const features = json.features, data = json.data;
    if (!validFeatures(features)) return [];
    if (!Array.isArray(data)) return [];
    const w = features.length, out = [];
    for (const v of data) {
      if (!Array.isArray(v)) continue;
      if (v.length !== w + 1) continue;
      if (!v.every(Number.isFinite)) continue;
      const y = v[w];
      if (y !== 0 && y !== 1) continue;
      const r = {};
      for (let i = 0; i < w; i++) r[features[i]] = v[i];
      r.y = y;
      out.push(r);
    }
    return out;
  } catch {
    return [];
  }
}

/** The sales sample was the first published file; it has the same shape. */
export const shopperRows = realRows;

/**
 * How the company uses a published sample: even rows are its own history (each device verifies — and the Audit agent
 * grows — on these), odd rows are the live door (work no brain ever verified or grew on). Total: junk → both empty.
 */
export function realHalves(rows) {
  try {
    if (!Array.isArray(rows)) return { local: [], door: [] };
    return { local: rows.filter((_, i) => i % 2 === 0), door: rows.filter((_, i) => i % 2 === 1) };
  } catch {
    return { local: [], door: [] };
  }
}

const entry = (o) => Object.freeze(o);
/**
 * Every domain that runs on a PUBLISHED dataset file instead of a generator. Paths are relative to brains/.
 * kind: 'real' (real-world records) · 'real-testbed' (real traffic on a lab testbed, staged attacks) ·
 *       'real-derived-label' (real measurements; the label is a threshold we computed) ·
 *       'published-synthetic' (its own authors publish it as synthetic — NOT real, `real` is false).
 */
export const REAL = Object.freeze({
  shopper: entry({ kind: 'real', real: true, role: 'sales', file: 'shopper.slm.json', sample: 'shopper.sample.json', licence: 'CC BY 4.0',
    dataset: 'Online Shoppers Purchasing Intention Dataset', badge: 'Real data: UCI Online Shoppers sessions (Sakar & Kastro, 2018; CC BY 4.0).' }),
  churn: entry({ kind: 'real', real: true, role: 'service', file: 'real/churn.slm.json', sample: 'real/churn.sample.json', licence: 'CC BY 4.0',
    dataset: 'Iranian Churn', badge: 'Real data: UCI Iranian Churn — real customers of an Iranian telecom operator (2020; CC BY 4.0).' }),
  fraud: entry({ kind: 'real', real: true, role: 'finance', file: 'real/fraud.slm.json', sample: 'real/fraud.sample.json', licence: 'ODbL 1.0 (database) / DbCL 1.0 (contents)',
    dataset: 'Credit Card Fraud Detection (ULB Machine Learning Group / Worldline)', badge: 'Real data: card transactions by European cardholders, September 2013 — PCA-anonymised by the publisher (ULB / Worldline; Dal Pozzolo et al., 2015; ODbL 1.0).' }),
  credit: entry({ kind: 'real', real: true, role: 'finance', file: 'real/credit.slm.json', sample: 'real/credit.sample.json', licence: 'CC BY 4.0',
    dataset: 'Default of Credit Card Clients', badge: 'Real data: UCI Default of Credit Card Clients — a Taiwanese bank, 2005 (Yeh & Lien, 2009; CC BY 4.0).' }),
  maintenance: entry({ kind: 'published-synthetic', real: false, role: 'ops', file: 'real/maintenance.slm.json', sample: 'real/maintenance.sample.json', licence: 'CC BY 4.0',
    dataset: 'AI4I 2020 Predictive Maintenance Dataset', badge: 'Published synthetic data, not real: UCI AI4I 2020 — synthetic by its authors\' own description (Matzka, 2020; CC BY 4.0).' }),
  intrusion: entry({ kind: 'real-testbed', real: true, role: 'systems', file: 'real/intrusion.slm.json', sample: 'real/intrusion.sample.json', licence: 'CC BY 4.0',
    dataset: 'RT-IoT2022', badge: 'Real lab-testbed data: UCI RT-IoT2022 — real IoT network flows, attacks staged by the researchers (2023; CC BY 4.0).' }),
  energy: entry({ kind: 'real-derived-label', real: true, role: 'ops', file: 'real/energy.slm.json', sample: 'real/energy.sample.json', licence: 'CC BY 4.0',
    dataset: 'Individual Household Electric Power Consumption', badge: 'Real meter data, derived label: UCI household power, Sceaux 2006–2010 — "next hour above the 80th-percentile load" is our label (CC BY 4.0).' }),
});

/** What a domain's stream is: a REAL kind, 'synthetic' (generator only) or null (unknown). Total. */
export function kindOf(domain) {
  try {
    if (typeof domain !== 'string') return null;
    if (Object.hasOwn(REAL, domain)) return REAL[domain].kind;
    return SYNTHETIC.includes(domain) ? 'synthetic' : null;
  } catch {
    return null;
  }
}

export const NOTES = Object.fromEntries(SYNTHETIC.map((d) => [d, (EXT_META[d] && EXT_META[d].note) || '']));
