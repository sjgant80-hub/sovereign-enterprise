#!/usr/bin/env node
// build-real-brains.mjs — regenerate every file under brains/real/ from the raw public datasets, deterministically:
// no clock, no ambient randomness (the only randomness is the ribosome's own seeded stream), so running it twice gives
// byte-identical files. `--check` rebuilds in memory and fails unless every file on disk is byte-identical.
//
// raw/ is NOT committed (≈ 370 MB). Fetch it once from the primary sources (each into its own empty folder):
//   mkdir -p raw/churn raw/credit raw/maintenance raw/energy raw/intrusion raw/fraud
//   curl -sSL -o raw/churn/iranian-churn.zip            "https://archive.ics.uci.edu/static/public/563/iranian+churn+dataset.zip"
//   curl -sSL -o raw/credit/default-of-credit-card-clients.csv "https://archive.ics.uci.edu/static/public/350/data.csv"
//   curl -sSL -o raw/maintenance/ai4i2020.zip           "https://archive.ics.uci.edu/static/public/601/ai4i+2020+predictive+maintenance+dataset.zip"
//   curl -sSL -o raw/energy/household-power.zip         "https://archive.ics.uci.edu/static/public/235/individual+household+electric+power+consumption.zip"
//   curl -sSL -o raw/intrusion/rt-iot2022.zip           "https://archive.ics.uci.edu/static/public/942/rt-iot2022.zip"
//   curl -sSL -o raw/fraud/creditcard.arff              "https://www.openml.org/data/v1/download/1673544/creditcard.arff"
//   (cd raw/churn && unzip -o iranian-churn.zip) && (cd raw/maintenance && unzip -o ai4i2020.zip) \
//     && (cd raw/energy && unzip -o household-power.zip) && (cd raw/intrusion && unzip -o rt-iot2022.zip)
// then:  node tools/build-real-brains.mjs            → writes brains/real/*
//        node tools/build-real-brains.mjs --check    → exits 1 unless the files on disk are byte-identical to a rebuild
// Every raw file is pinned by SHA-256 (RAW below): a changed upstream file stops the build instead of silently
// changing a brain. Licences were checked on each dataset's own page (2026-10-14) and are recorded in every file.
//
// The method, per domain (the same for all six):
//   1. load the raw rows, drop exact duplicate records (a duplicate on both sides of a split would leak), encode the
//      chosen features (≤ 16, numeric, simple encodings stated in the source text), label y ∈ {0,1};
//   2. split deterministically into TRAIN and HELD — by time where the data has an order, else 3 rows in every 10 held;
//   3. where the positive class is rare (fraud, maintenance) or the majority (intrusion), fix a stated CASE MIX by
//      thinning the other class with an evenly-spaced deterministic pick — the same mix on both sides;
//   4. grow the brain with src/grow.mjs growPattern on the TRAIN pool only, trying seeds 1–4 and keeping the one with
//      the best growPattern-internal held-out AUC (a split INSIDE train — the HELD split is not looked at to choose);
//   5. grade once on the HELD pool → heldAuc / heldAcc / held (the gate: GATE_AUC in src/brain.mjs);
//   6. brains/real/<domain>.sample.json = up to 1,500 HELD rows (evenly spaced, class-stratified) — rows the brain
//      never grew on, so a device that re-verifies on them is doing a genuine held-out check.
// Credits: growPattern is the seed-library ribosome (sjgant80-hub/seed-library, vendored in vendor/seed-library);
// the pattern shape and answer path are the Konomi SLM's (sjgant80-hub/konomi-slm) — Konomi architecture: Thomas Frumkin.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { growPattern } from '../src/grow.mjs';
import { verifyOn, answer, passesGate } from '../src/brain.mjs';
import { auc as fastAuc } from '../vendor/seed-library/seedlib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAWDIR = join(ROOT, 'raw');
const OUTDIR = join(ROOT, 'brains', 'real');
const SAMPLE_MAX = 1500, TRAIN_MAX = 20000, SEEDS = [1, 2, 3, 4];

const RAW = {
  churn: ['churn/Customer Churn.csv', '90d5fb6bd1630cd4de4b4d28fcf8b4cb92a8f6ab7484605b0799d47386f7dbe1'],
  credit: ['credit/default-of-credit-card-clients.csv', '45bcf4df62ff2e237a74eb155cabfb4bbbc171219a0637daef44fdad07503dd0'],
  maintenance: ['maintenance/ai4i2020.csv', 'dc6630cd9b1f0f853922fad78a1b6436570d3f1ec863f1dd5c4340ac56bc8a8e'],
  energy: ['energy/household_power_consumption.txt', '4259c9d7ece5dbee9ab8d53682baac68d791c864f0f64a52b4043cb3b90894b7'],
  intrusion: ['intrusion/RT_IOT2022', '956956c09c1764584fa08acd0f6876475626bcedcd6a6b1f8c492c2e9a2089ea'],
  fraud: ['fraud/creditcard.arff', 'fdaf12730dc1fc426f318b71349f24f5c5fd00aa1152940be7e7509ae3d89d2a'],
};
const CCBY = 'https://creativecommons.org/licenses/by/4.0/';

// ── small, deterministic helpers ───────────────────────────────────────────────────────────────────────────────
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const n0 = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const pc = (x) => (x * 100).toFixed(2) + '%';
const posOf = (rows) => rows.reduce((a, r) => a + r.y, 0);
function readRaw(domain) {
  const [rel, sha] = RAW[domain];
  const p = join(RAWDIR, rel);
  if (!existsSync(p)) throw new Error(`missing raw/${rel} — run the download commands at the top of this file`);
  const buf = readFileSync(p);
  const got = createHash('sha256').update(buf).digest('hex');
  if (got !== sha) throw new Error(`raw/${rel} has sha256 ${got}, expected ${sha} — upstream changed; re-check before rebuilding`);
  return buf.toString('utf8').replace(/^﻿/, '');
}
function eachLine(text, fn) {             // CRLF-safe, no giant split() array
  let i = 0, n = 0;
  while (i < text.length) {
    let j = text.indexOf('\n', i);
    if (j < 0) j = text.length;
    const line = text.charCodeAt(j - 1) === 13 ? text.slice(i, j - 1) : text.slice(i, j);
    if (line.length) fn(line, n++);
    i = j + 1;
  }
}
function csvRows(text, sep = ',') {
  const out = [];
  eachLine(text, (l) => { if (l.includes('"')) throw new Error('quoted CSV not expected'); out.push(l.split(sep)); });
  return out;
}
function expectHeader(got, want, what) {
  if (got.join('|') !== want.join('|')) throw new Error(`${what}: header changed — got ${got.join(',')}`);
}
const num = (s, what) => { const v = Number(s); if (s === '' || !Number.isFinite(v)) throw new Error('non-numeric ' + what + ': ' + s); return v; };
function dedupe(list, keyOf) {
  const seen = new Set(), out = [];
  for (const it of list) { const k = keyOf(it); if (!seen.has(k)) { seen.add(k); out.push(it); } }
  return { kept: out, dropped: list.length - out.length };
}
// k items spread evenly over the list (index ⌊(j + ½)·n/k⌋) — deterministic, keeps order, distinct when k ≤ n
function evenPick(list, k) {
  if (k >= list.length) return list.slice();
  const out = [];
  for (let j = 0; j < k; j++) out.push(list[Math.floor(((j + 0.5) * list.length) / k)]);
  return out;
}
// fix the positive share of a pool by thinning the OTHER class evenly (null share = keep the natural mix)
function mixTo(rows, share) {
  if (share == null) return rows;
  const P = rows.filter((r) => r.y === 1), N = rows.filter((r) => r.y === 0);
  let kp = P, kn = N;
  if (P.length / rows.length < share) kn = evenPick(N, Math.round((P.length * (1 - share)) / share));
  else kp = evenPick(P, Math.round((N.length * share) / (1 - share)));
  return [...kp, ...kn].sort((a, b) => a.pos - b.pos);
}
// at most `max` rows, class-stratified, evenly spaced
function capStrat(rows, max) {
  if (rows.length <= max) return rows;
  const P = rows.filter((r) => r.y === 1), N = rows.filter((r) => r.y === 0);
  const kp = Math.round((max * P.length) / rows.length);
  return [...evenPick(P, kp), ...evenPick(N, max - kp)].sort((a, b) => a.pos - b.pos);
}
const rowsOf = (pool, features) => pool.map((r) => { const o = {}; for (const f of features) o[f] = r.x[f]; o.y = r.y; return o; });

// ── the six real domains ────────────────────────────────────────────────────────────────────────────────────────
const DOMAINS = [
  {
    id: 'churn', role: 'service', title: 'Customer churn', kind: 'real', real: true, licence: 'CC BY 4.0', licenceUrl: CCBY,
    dataset: 'Iranian Churn', url: 'https://archive.ics.uci.edu/dataset/563/iranian+churn+dataset', doi: '10.24432/C5JW3Z',
    citation: 'Iranian Churn [Dataset]. UCI Machine Learning Repository, 2020. https://doi.org/10.24432/C5JW3Z',
    what: 'real customers of an Iranian telecom operator, sampled at random by the donors from the company database over 12 months',
    label: 'churn=1: the customer had left by the end of month 12 (every feature aggregates months 1–9; months 10–12 are the planning gap)',
    encoding: 'callFailures, complained (0/1), subscriptionMonths, chargeBand (0–9 ordinal, as published), secondsOfUse, callsMade, smsSent, distinctNumbersCalled, contractPlan (Tariff Plan: contractual=1, pay-as-you-go=0), inactive (Status: non-active=1, active=0), customerValue. Age and Age Group are deliberately left out (a protected characteristic).',
    share: null,
    splitText: 'interleaved by row position after de-duplication — 3 rows in every 10 (i mod 10 < 3) are held out; the brain grew only on the other 7',
    load() {
      const rows = csvRows(readRaw('churn'));
      expectHeader(rows[0], ['Call  Failure', 'Complains', 'Subscription  Length', 'Charge  Amount', 'Seconds of Use', 'Frequency of use', 'Frequency of SMS', 'Distinct Called Numbers', 'Age Group', 'Tariff Plan', 'Status', 'Age', 'Customer Value', 'Churn'], 'churn');
      const body = rows.slice(1);
      const { kept, dropped } = dedupe(body, (r) => r.join(','));
      const records = kept.map((c, i) => {
        const v = c.map((s, k) => num(s, 'churn col ' + k));
        return { pos: i, held: i % 10 < 3, y: v[13], x: { callFailures: v[0], complained: v[1], subscriptionMonths: v[2], chargeBand: v[3], secondsOfUse: v[4],
          callsMade: v[5], smsSent: v[6], distinctNumbersCalled: v[7], contractPlan: v[9] === 2 ? 1 : 0, inactive: v[10] === 2 ? 1 : 0, customerValue: r6(v[12]) } };
      });
      return { records, raw: body.length, dropped, features: ['callFailures', 'complained', 'subscriptionMonths', 'chargeBand', 'secondsOfUse', 'callsMade', 'smsSent', 'distinctNumbersCalled', 'contractPlan', 'inactive', 'customerValue'] };
    },
  },
  {
    id: 'credit', role: 'finance', title: 'Card default', kind: 'real', real: true, licence: 'CC BY 4.0', licenceUrl: CCBY,
    dataset: 'Default of Credit Card Clients', url: 'https://archive.ics.uci.edu/dataset/350/default+of+credit+card+clients', doi: '10.24432/C55S3H',
    citation: 'Yeh, I-Cheng. Default of Credit Card Clients [Dataset]. UCI Machine Learning Repository, 2009. https://doi.org/10.24432/C55S3H — introduced in Yeh & Lien, "The comparisons of data mining techniques for the predictive accuracy of probability of default of credit card clients", Expert Systems with Applications 36 (2009), DOI 10.1016/j.eswa.2007.12.020',
    what: 'real credit-card clients of a bank in Taiwan, April–September 2005',
    label: 'default=1: the client defaulted on the payment due in October 2005 ("default payment next month")',
    encoding: 'creditLimit (NT$), payStatusSep…payStatusApr (repayment status Sept→April 2005 as published: −2/−1/0 on-time states, 1–8 months late), billSep/billAug/billJul (bill amounts), paidSep/paidAug/paidJul (amounts paid), utilisationSep = billSep / creditLimit (derived). Sex, education, marital status and age are deliberately left out (protected characteristics); the three oldest bills and payments are left out to stay within 16 features.',
    share: null,
    splitText: 'interleaved by client order after de-duplication — 3 clients in every 10 (i mod 10 < 3) are held out; the brain grew only on the other 7',
    load() {
      const rows = csvRows(readRaw('credit'));
      expectHeader(rows[0], ['ID', ...Array.from({ length: 23 }, (_, k) => 'X' + (k + 1)), 'Y'], 'credit');
      const body = rows.slice(1);
      const { kept, dropped } = dedupe(body, (r) => r.slice(1).join(','));      // the same client record twice (ID aside)
      const records = kept.map((c, i) => {
        const v = c.map((s, k) => num(s, 'credit col ' + k));                   // v[0] = ID, v[k] = Xk, v[24] = Y
        return { pos: i, held: i % 10 < 3, y: v[24], x: { creditLimit: v[1], payStatusSep: v[6], payStatusAug: v[7], payStatusJul: v[8], payStatusJun: v[9], payStatusMay: v[10], payStatusApr: v[11],
          billSep: v[12], billAug: v[13], billJul: v[14], paidSep: v[18], paidAug: v[19], paidJul: v[20], utilisationSep: r6(v[12] / v[1]) } };
      });
      return { records, raw: body.length, dropped, features: ['creditLimit', 'payStatusSep', 'payStatusAug', 'payStatusJul', 'payStatusJun', 'payStatusMay', 'payStatusApr', 'billSep', 'billAug', 'billJul', 'paidSep', 'paidAug', 'paidJul', 'utilisationSep'] };
    },
  },
  {
    id: 'fraud', role: 'finance', title: 'Card fraud', kind: 'real', real: true,
    licence: 'ODbL 1.0 (database) / DbCL 1.0 (contents)', licenceUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    dataset: 'Credit Card Fraud Detection (ULB Machine Learning Group / Worldline)', url: 'https://www.openml.org/d/1597', doi: '',
    citation: 'Andrea Dal Pozzolo, Olivier Caelen, Reid A. Johnson and Gianluca Bontempi, "Calibrating Probability with Undersampling for Unbalanced Classification", IEEE Symposium on Computational Intelligence and Data Mining (CIDM), 2015 — data collected in a research collaboration of Worldline and the Machine Learning Group of ULB; published on Kaggle (mlg-ulb/creditcardfraud) under "Database: Open Database, Contents: Database Contents"; copy taken from OpenML data set 1597 (md5 178bcf9bb1f31a3dfe12d0e577884add)',
    what: 'real card transactions by European cardholders over two days in September 2013; for confidentiality the original fields were released only as PCA components V1–V28 (plus Time and Amount)',
    label: 'fraud=1: the transaction was labelled fraudulent',
    encoding: 'amount (the transaction amount, as published) and the 15 PCA components with the strongest single-feature separation on the TRAINING pool (chosen on train only). The PCA components are anonymised by the publisher and have no business meaning. Time (seconds since the first transaction) is left out.',
    share: 0.10,
    // ODbL 4.3: a Produced Work (the brain grown from this database) carries this notice
    notice: 'Contains information from the Credit Card Fraud Detection database (ULB Machine Learning Group / Worldline), which is made available here under the Open Database License (ODbL) v1.0.',
    splitText: 'by time — the first 70% of transactions (after de-duplication) are the training split, the last 30% the held-out split',
    load() {
      const text = readRaw('fraud');
      const at = text.indexOf('@data');
      const head = text.slice(0, at).split('\n').filter((l) => l.startsWith('@attribute')).map((l) => l.split(/\s+/)[1]);
      expectHeader(head, ['Time', ...Array.from({ length: 28 }, (_, k) => 'V' + (k + 1)), 'Amount', 'Class'], 'fraud');
      const body = [];
      eachLine(text.slice(at + 5), (l) => body.push(l.split(',')));
      const { kept, dropped } = dedupe(body, (r) => r.join(','));
      const cut = Math.floor(kept.length * 0.7);
      const records = kept.map((c, i) => {
        const y = c[30] === "'1'" ? 1 : c[30] === "'0'" ? 0 : NaN;
        if (Number.isNaN(y)) throw new Error('fraud: bad class ' + c[30]);
        const x = { amount: r6(num(c[29], 'Amount')) };
        for (let k = 1; k <= 28; k++) x['V' + k] = r6(num(c[k], 'V' + k));
        return { pos: i, held: i >= cut, y, x, t: num(c[0], 'Time') };
      });
      for (let i = 1; i < records.length; i++) if (records[i].t < records[i - 1].t) throw new Error('fraud: rows are not in time order');
      return { records, raw: body.length, dropped, features: ['amount', ...Array.from({ length: 28 }, (_, k) => 'V' + (k + 1))] };
    },
    // the 15 PCA components that separate the classes best on the TRAINING pool alone, in V order; amount always kept
    select(trainPool, all) {
      const y = trainPool.map((r) => r.y);
      const ranked = all.filter((f) => f !== 'amount')
        .map((f, k) => ({ f, k, sep: Math.abs(fastAuc(trainPool.map((r) => r.x[f]), y) - 0.5) }))
        .sort((a, b) => b.sep - a.sep || a.k - b.k).slice(0, 15).sort((a, b) => a.k - b.k);
      return ['amount', ...ranked.map((r) => r.f)];
    },
  },
  {
    id: 'maintenance', role: 'ops', title: 'Machine failure', kind: 'published-synthetic', real: false, licence: 'CC BY 4.0', licenceUrl: CCBY,
    dataset: 'AI4I 2020 Predictive Maintenance Dataset', url: 'https://archive.ics.uci.edu/dataset/601/ai4i+2020+predictive+maintenance+dataset', doi: '10.24432/C5HS5C',
    citation: 'AI4I 2020 Predictive Maintenance Dataset [Dataset]. UCI Machine Learning Repository, 2020. https://doi.org/10.24432/C5HS5C — introduced in S. Matzka, "Explainable Artificial Intelligence for Predictive Maintenance Applications", 2020 Third International Conference on Artificial Intelligence for Industries (AI4I), DOI 10.1109/AI4I49448.2020.00023',
    what: 'NOT real measurements — its authors publish it as a SYNTHETIC dataset that reflects real predictive-maintenance data, because real data is hard to obtain and publish (10,000 simulated milling operations)',
    label: 'failure=1: the operation ended in a machine failure (the published "Machine failure" flag: any of tool wear, heat dissipation, power, overstrain or random failure)',
    encoding: 'productQuality (Type: L=0, M=1, H=2), airTempK, processTempK, rpm, torqueNm, toolWearMin, plus three derived physical quantities — tempGapK = process − air temperature, powerW = torque × rpm × 2π/60, strainMinNm = tool wear × torque. The five failure-mode flags (TWF, HDF, PWF, OSF, RNF) are left out: they are components of the label.',
    share: 0.10,
    splitText: 'by operation order (UDI) — operations 1–7,000 are the training split, 7,001–10,000 the held-out split',
    load() {
      const rows = csvRows(readRaw('maintenance'));
      expectHeader(rows[0], ['UDI', 'Product ID', 'Type', 'Air temperature [K]', 'Process temperature [K]', 'Rotational speed [rpm]', 'Torque [Nm]', 'Tool wear [min]', 'Machine failure', 'TWF', 'HDF', 'PWF', 'OSF', 'RNF'], 'maintenance');
      const body = rows.slice(1);
      const { kept, dropped } = dedupe(body, (r) => r.slice(2).join(','));
      const Q = { L: 0, M: 1, H: 2 };
      const records = kept.map((c, i) => {
        if (!(c[2] in Q)) throw new Error('maintenance: unknown Type ' + c[2]);
        const air = num(c[3], 'air'), proc = num(c[4], 'process'), rpm = num(c[5], 'rpm'), tq = num(c[6], 'torque'), wear = num(c[7], 'wear');
        return { pos: i, held: num(c[0], 'UDI') > 7000, y: num(c[8], 'failure'), x: { productQuality: Q[c[2]], airTempK: air, processTempK: proc, rpm, torqueNm: tq, toolWearMin: wear,
          tempGapK: r6(proc - air), powerW: r6((tq * rpm * 2 * Math.PI) / 60), strainMinNm: r6(wear * tq) } };
      });
      return { records, raw: body.length, dropped, features: ['productQuality', 'airTempK', 'processTempK', 'rpm', 'torqueNm', 'toolWearMin', 'tempGapK', 'powerW', 'strainMinNm'] };
    },
  },
  {
    id: 'intrusion', role: 'systems', title: 'Network intrusion', kind: 'real-testbed', real: true, licence: 'CC BY 4.0', licenceUrl: CCBY,
    dataset: 'RT-IoT2022', url: 'https://archive.ics.uci.edu/dataset/942/rt-iot2022', doi: '10.24432/C5P338',
    citation: 'B. S. Sharmila and Rohini Nagapadma. RT-IoT2022 [Dataset]. UCI Machine Learning Repository, 2023. https://doi.org/10.24432/C5P338 — described in "Quantized autoencoder (QAE) intrusion detection system for anomaly detection in resource-constrained IoT devices using RT-IoT2022 dataset", Cybersecurity (2023)',
    what: 'real network flows (Zeek + Flowmeter) captured on a real IoT testbed — ThingSpeak-LED, Wipro bulb and MQTT temperature-sensor traffic as normal, and attacks STAGED by the researchers with standard tools (hping3 SYN flood, Slowloris, Nmap scans, ARP poisoning, Metasploit SSH brute force); lab traffic, not a production network',
    label: 'intrusion=1: the flow belongs to a staged attack (Attack_type is anything other than MQTT_Publish, Thing_Speak or Wipro_bulb)',
    encoding: 'flowSeconds, fwdPkts, bwdPkts, fwdDataPkts, bwdDataPkts, pktsPerSec, downUpRatio, synFlags, rstFlags, finFlags, ackFlags, fwdPayloadAvg, bwdPayloadAvg, fwdInitWindow, bwdInitWindow (Zeek flow fields, as published) and isUdp (proto udp=1). Ports, the service name and the scenario index are left out (artefacts of the testbed, not behaviour).',
    share: 0.25,
    splitText: 'by capture order inside each scenario — for every traffic type the first 70% of its flows (by the published per-scenario index, after de-duplication) are the training split and the last 30% the held-out split',
    load() {
      const rows = csvRows(readRaw('intrusion'));
      const H = rows[0];
      const col = (name) => { const k = H.indexOf(name); if (k < 0) throw new Error('intrusion: no column ' + name); return k; };
      if (H[0] !== '' || H[H.length - 1] !== 'Attack_type') throw new Error('intrusion: header changed');
      const MAP = [['flowSeconds', 'flow_duration'], ['fwdPkts', 'fwd_pkts_tot'], ['bwdPkts', 'bwd_pkts_tot'], ['fwdDataPkts', 'fwd_data_pkts_tot'], ['bwdDataPkts', 'bwd_data_pkts_tot'],
        ['pktsPerSec', 'flow_pkts_per_sec'], ['downUpRatio', 'down_up_ratio'], ['synFlags', 'flow_SYN_flag_count'], ['rstFlags', 'flow_RST_flag_count'], ['finFlags', 'flow_FIN_flag_count'],
        ['ackFlags', 'flow_ACK_flag_count'], ['fwdPayloadAvg', 'fwd_pkts_payload.avg'], ['bwdPayloadAvg', 'bwd_pkts_payload.avg'], ['fwdInitWindow', 'fwd_init_window_size'], ['bwdInitWindow', 'bwd_init_window_size']].map(([f, c]) => [f, col(c)]);
      const proto = col('proto'), type = H.length - 1;
      const BENIGN = new Set(['MQTT_Publish', 'Thing_Speak', 'Wipro_bulb']);
      const body = rows.slice(1);
      const { kept, dropped } = dedupe(body, (r) => r.slice(1).join(','));       // identical flows, the scenario index aside
      const byType = new Map();
      for (const c of kept) byType.set(c[type], (byType.get(c[type]) || 0) + 1);
      const seen = new Map();
      const records = kept.map((c, i) => {
        const k = seen.get(c[type]) || 0; seen.set(c[type], k + 1);
        const x = {};
        for (const [f, j] of MAP) x[f] = r6(num(c[j], f));
        x.isUdp = c[proto] === 'udp' ? 1 : 0;
        return { pos: i, held: k >= Math.floor(byType.get(c[type]) * 0.7), y: BENIGN.has(c[type]) ? 0 : 1, x, type: c[type] };
      });
      return { records, raw: body.length, dropped, features: [...MAP.map(([f]) => f), 'isUdp'] };
    },
  },
  {
    id: 'energy', role: 'ops', title: 'Peak load', kind: 'real-derived-label', real: true, licence: 'CC BY 4.0', licenceUrl: CCBY,
    dataset: 'Individual Household Electric Power Consumption', url: 'https://archive.ics.uci.edu/dataset/235/individual+household+electric+power+consumption', doi: '10.24432/C58K54',
    citation: 'Hebrail, Georges and Berard, Alice. Individual Household Electric Power Consumption [Dataset]. UCI Machine Learning Repository, 2006. https://doi.org/10.24432/C58K54',
    what: 'real one-minute meter readings from one household in Sceaux (near Paris), December 2006 – November 2010, aggregated here to hours',
    label: '', // filled in with the measured threshold below
    encoding: 'for hour t: loadKw (mean active power), loadPrevKw (hour t−1), loadSameHourYesterdayKw (the target hour, one day earlier), reactiveKw, voltageV, kitchenWh / laundryWh / heaterAcWh (sub-meters 1–3, Wh in the hour); for the target hour t+1: nextHour (0–23), weekday (Mon=0 … Sun=6), month (1–12). An hour counts only if ≥ 45 of its 60 minutes were measured (the published data has ≈ 1.25% missing minutes).',
    share: null,
    splitText: 'by time — target hours before 1 December 2009 are the training split; the final twelve months (December 2009 – November 2010) are the held-out split',
    load() {
      const text = readRaw('energy');
      const acc = new Map();   // hour key → [count, active, reactive, volts, s1, s2, s3]
      let first = true, raw = 0, missing = 0;
      eachLine(text, (l) => {
        if (first) { expectHeader(l.split(';'), ['Date', 'Time', 'Global_active_power', 'Global_reactive_power', 'Voltage', 'Global_intensity', 'Sub_metering_1', 'Sub_metering_2', 'Sub_metering_3'], 'energy'); first = false; return; }
        raw++;
        const c = l.split(';');
        if (c.slice(2).some((s) => s === '?' || s === '')) { missing++; return; }
        const [d, m, y] = c[0].split('/').map(Number);
        const h = Number(c[1].slice(0, 2));
        const key = Date.UTC(y, m - 1, d, h) / 3600000;
        let a = acc.get(key);
        if (!a) acc.set(key, (a = [0, 0, 0, 0, 0, 0, 0]));
        a[0]++; a[1] += num(c[2], 'gap'); a[2] += num(c[3], 'grp'); a[3] += num(c[4], 'volt'); a[4] += num(c[6], 's1'); a[5] += num(c[7], 's2'); a[6] += num(c[8], 's3');
      });
      const hour = new Map();
      for (const [k, a] of acc) if (a[0] >= 45) hour.set(k, { load: a[1] / a[0], reactive: a[2] / a[0], volts: a[3] / a[0], s1: (a[4] / a[0]) * 60, s2: (a[5] / a[0]) * 60, s3: (a[6] / a[0]) * 60 });
      const BOUNDARY = Date.UTC(2009, 11, 1, 0) / 3600000;
      const trainLoads = [...hour].filter(([k]) => k < BOUNDARY).map(([, v]) => v.load).sort((p, q) => p - q);
      const P80 = trainLoads[Math.floor(0.8 * (trainLoads.length - 1))];
      const keys = [...hour.keys()].sort((p, q) => p - q);
      const records = [];
      for (const t of keys) {
        const now = hour.get(t), prev = hour.get(t - 1), next = hour.get(t + 1), yday = hour.get(t - 23);
        if (!prev || !next || !yday) continue;
        const when = new Date((t + 1) * 3600000);
        records.push({ pos: records.length, held: t + 1 >= BOUNDARY, y: next.load > P80 ? 1 : 0, x: {
          loadKw: r6(now.load), loadPrevKw: r6(prev.load), loadSameHourYesterdayKw: r6(yday.load), reactiveKw: r6(now.reactive), voltageV: r6(now.volts),
          kitchenWh: r6(now.s1), laundryWh: r6(now.s2), heaterAcWh: r6(now.s3), nextHour: when.getUTCHours(), weekday: (when.getUTCDay() + 6) % 7, month: when.getUTCMonth() + 1 } });
      }
      this.label = `peak=1: the NEXT hour's mean household load is above ${r6(P80)} kW — the 80th percentile of hourly load over the training period (Dec 2006 – Nov 2009). DERIVED: the threshold label is ours, computed from the real readings; the dataset itself has no label`;
      const rowsText = `Rows: ${n0(raw)} published one-minute readings (${n0(missing)} with a missing value) → ${n0(acc.size)} clock hours with any reading, `
        + `${n0(hour.size)} with ≥ 45 measured minutes → ${n0(records.length)} usable hourly rows (each needs the hour before, the hour after and the same hour a day earlier)`;
      return { records, raw, dropped: 0, rowsText, features: ['loadKw', 'loadPrevKw', 'loadSameHourYesterdayKw', 'reactiveKw', 'voltageV', 'kitchenWh', 'laundryWh', 'heaterAcWh', 'nextHour', 'weekday', 'month'],
        extra: { minutes: raw, missingMinutes: missing, hoursWithReadings: acc.size, usableHours: hour.size, p80Kw: r6(P80) } };
    },
  },
];

// inventory has no real counterpart: no openly-licensed stock-out dataset was found, so it stays on the synthetic brain
const STILL_SYNTHETIC = {
  inventory: { role: 'ops', title: 'Inventory stockout', real: false, kind: 'synthetic', heldAuc: null, patternId: null, file: 'inventory.slm.json', sample: null,
    licence: 'n/a — realistic-synthetic generator (vendor/konomi/domains-ext.mjs, sjgant80-hub/konomi-slm)', dataset: 'none — no openly-licensed real stock-out dataset found' },
};

// ── the pipeline ────────────────────────────────────────────────────────────────────────────────────────────────
function build(spec) {
  const L = spec.load();
  const all = L.records;
  const train = all.filter((r) => !r.held), held = all.filter((r) => r.held);
  const trainPool = capStrat(mixTo(train, spec.share), TRAIN_MAX);
  const heldPool = mixTo(held, spec.share);
  const features = spec.select ? spec.select(trainPool, L.features) : L.features;
  const trainRows = rowsOf(trainPool, features), heldRows = rowsOf(heldPool, features);
  let best = null, bestSeed = 0;
  for (const s of SEEDS) {        // choose the seed on growPattern's OWN held-out slice of TRAIN — never on the held split
    const g = growPattern(spec.id, trainRows, features, { seed: s });
    if (g.ok && (!best || g.pattern.heldAuc > best.pattern.heldAuc)) { best = g; bestSeed = s; }
  }
  if (!best) throw new Error(spec.id + ': growth failed on every seed');
  const g = best.pattern;
  const outer = verifyOn(g, heldRows);
  const population = spec.share == null ? null : verifyOn(g, rowsOf(held, features));
  const verified = !!best.verified && passesGate(outer.auc);
  const samplePool = capStrat(heldPool, SAMPLE_MAX);
  const sampleRows = rowsOf(samplePool, features);
  const sampleV = verifyOn(g, sampleRows);
  const answered = sampleRows.filter((r) => answer({ [spec.id]: g }, r).verdict === 'VERIFIED').length;
  const P = posOf(all), Pt = posOf(trainPool), Ph = posOf(heldPool), Ps = posOf(samplePool);
  const mixText = spec.share == null ? 'natural class mix (no thinning)'
    : `case mix fixed at ${pc(spec.share)} positive on BOTH sides by thinning the ${P / all.length < spec.share ? 'negative' : 'positive'} class evenly (deterministic, order kept); the population rate is ${pc(P / all.length)}`;
  const capText = trainPool.length < mixTo(train, spec.share).length ? `; training pool thinned evenly to ${n0(trainPool.length)} rows (class-stratified)` : '';
  const sampleText = samplePool.length < heldPool.length ? `${n0(samplePool.length)} of the ${n0(heldPool.length)} held-out rows, evenly spaced and class-stratified` : `all ${n0(heldPool.length)} held-out rows`;
  const isReal = spec.real ? (spec.kind === 'real' ? 'REAL data' : spec.kind === 'real-testbed' ? 'REAL data (lab testbed)' : 'REAL data, DERIVED label') : 'PUBLISHED-SYNTHETIC data (not real)';
  const licenceText = spec.id === 'fraud'
    ? 'Licence: Open Database License v1.0 (ODbL, https://opendatacommons.org/licenses/odbl/1-0/) for the database, Database Contents License v1.0 (DbCL) for its contents — THIS FILE IS A DERIVATIVE DATABASE AND IS ITSELF MADE AVAILABLE UNDER THE ODbL v1.0 (not MIT); attribute the source below.'
    : `Licence: ${spec.licence} (${spec.licenceUrl}) — redistribution of this subset is permitted with attribution.`;
  const source = `${isReal} — ${spec.label}. Source: ${spec.citation}. What it is: ${spec.what}. ${licenceText} `
    + `${L.rowsText || `Rows: ${n0(L.raw)} published, ${n0(L.dropped)} exact duplicate${L.dropped === 1 ? '' : 's'} removed, ${n0(all.length)} usable`} (${n0(P)} positive, base rate ${pc(P / all.length)}). `
    + `Features: ${spec.encoding} Split: ${spec.splitText}; ${mixText}${capText}. The brain grew on ${n0(trainPool.length)} training rows only. `
    + `This file: ${sampleText} — ${n0(samplePool.length)} rows, ${n0(Ps)} positive (${pc(Ps / samplePool.length)}); none were seen in growth.`;
  const note = `${isReal} — ${spec.label.split(':')[0]}. ${spec.dataset} — ${spec.doi ? 'DOI ' + spec.doi + ', ' : ''}${spec.licence}: ${spec.what}. `
    + `Held-out = ${spec.splitText.split(' — ')[0]}${spec.share == null ? '' : `, case mix ${pc(spec.share)} positive (population ${pc(P / all.length)})`}; grown only on the training split.`
    + (spec.notice ? ' ' + spec.notice : '');
  const pattern = {
    model: g.model, domain: spec.id, title: spec.title, role: spec.role, real: spec.real, note,
    features: g.features, rules: g.rules, base: g.base, threshold: g.threshold, spread: g.spread, dist: g.dist,
    heldAuc: outer.auc, heldAcc: outer.acc, held: outer.n, train: trainPool.length, patternId: g.patternId, seed: g.seed, verified,
    lineage: 'Grown by tools/build-real-brains.mjs with src/grow.mjs growPattern — the seed-library ribosome (sjgant80-hub/seed-library, vendored) — on the training split only, graded once on the held-out split. Pattern shape and answer path: the Konomi SLM (sjgant80-hub/konomi-slm). Konomi architecture: Thomas Frumkin.',
    kind: spec.kind, licence: spec.licence,
    provenance: {
      dataset: spec.dataset, citation: spec.citation, url: spec.url, doi: spec.doi, licence: spec.licence, licenceUrl: spec.licenceUrl, notice: spec.notice || null,
      label: spec.label, split: spec.splitText, caseMix: spec.share, rawSha256: RAW[spec.id][1], rawFile: RAW[spec.id][0],
      publishedRows: L.raw, duplicatesRemoved: L.dropped, usableRows: all.length, usablePositives: P, populationBase: r6(P / all.length),
      trainSplitRows: train.length, heldSplitRows: held.length, trainRows: trainPool.length, trainPositives: Pt, heldRows: heldPool.length, heldPositives: Ph,
      heldPopulationAuc: population ? population.auc : null, heldPopulationRows: population ? population.n : null,
      grow: { seedsTried: SEEDS.length, chosenSeed: bestSeed, innerHeldAuc: g.heldAuc, innerHeld: g.held, innerTrain: g.train, innerVerified: !!best.verified },
      sampleRows: samplePool.length, samplePositives: Ps, sampleAuc: sampleV.auc, sampleAcc: sampleV.acc, sampleAnswered: answered,
      ...(L.extra ? { extra: L.extra } : {}),
    },
  };
  const sample = { source, rows: sampleRows.length, features, data: sampleRows.map((r) => [...features.map((f) => r[f]), r.y]) };
  const entry = { role: spec.role, title: spec.title, real: spec.real, kind: spec.kind, heldAuc: outer.auc, patternId: g.patternId,
    file: 'real/' + spec.id + '.slm.json', sample: 'real/' + spec.id + '.sample.json', licence: spec.licence, dataset: spec.dataset };
  return { pattern, sample, entry };
}

function render() {
  const files = {}, index = {};
  for (const spec of DOMAINS) {
    const t0 = Date.now();
    const { pattern, sample, entry } = build(spec);
    files[spec.id + '.slm.json'] = JSON.stringify(pattern, null, 1) + '\n';
    files[spec.id + '.sample.json'] = JSON.stringify(sample) + '\n';
    index[spec.id] = entry;
    const p = pattern.provenance;
    console.error(`${spec.id.padEnd(12)} ${pattern.kind.padEnd(20)} held AUC ${pattern.heldAuc.toFixed(3)} (n=${pattern.held}) · inner ${p.grow.innerHeldAuc.toFixed(3)} seed ${p.grow.chosenSeed}`
      + `${p.heldPopulationAuc === null ? '' : ` · population ${p.heldPopulationAuc.toFixed(3)} (n=${p.heldPopulationRows})`} · sample ${p.sampleRows} rows / ${p.samplePositives} pos, AUC ${p.sampleAuc.toFixed(3)}, answered ${p.sampleAnswered} · verified ${pattern.verified} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  for (const [d, e] of Object.entries(STILL_SYNTHETIC)) index[d] = e;
  const order = ['churn', 'fraud', 'credit', 'inventory', 'maintenance', 'intrusion', 'energy'];
  files['index.json'] = JSON.stringify(Object.fromEntries(order.map((d) => [d, index[d]])), null, 1) + '\n';
  return files;
}

const check = process.argv.includes('--check');
const files = render();
if (check) {
  let same = true;
  for (const [name, body] of Object.entries(files)) {
    const p = join(OUTDIR, name);
    const ok = existsSync(p) && readFileSync(p, 'utf8') === body;
    if (!ok) { same = false; console.error('DIFFERS: brains/real/' + name); }
  }
  console.error(same ? 'brains/real reproduced byte for byte' : 'brains/real does NOT reproduce');
  process.exit(same ? 0 : 1);
}
mkdirSync(OUTDIR, { recursive: true });
for (const [name, body] of Object.entries(files)) writeFileSync(join(OUTDIR, name), body);
console.error('wrote ' + Object.keys(files).length + ' files to brains/real/');
