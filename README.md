# SOVEREIGN ENTERPRISE

### ▶ Live: **https://sjgant80-hub.github.io/sovereign-enterprise/**
### ▶ The white paper: **https://sjgant80-hub.github.io/sovereign-enterprise/whitepaper.html**

**A full AI company on its own devices.** Six AI agents — sales, service, finance, operations, systems and audit — run the company end
to end; two humans watch. Every device is a brain: a verified pattern library (the Konomi SLM) that answers only inside what it was
verified on and abstains outside it. The brains share what they learn over a signed peer-to-peer spine — a mycelium — and nothing
leaves the building.

Open the live page and the company is already working: work arrives at the door, the agents decide, write into the CRM, the tasks,
the books and the vault, ask each other when they don't know, learn what they keep being asked, and regrow on the outcomes that come
back. Money and security calls need a second, independent brain to agree; anything no brain can confirm waits on the **Watch** list for
a human. Attack it: send a hostile message, poison a brain, forge a write, fire an agent, take the Audit agent offline.

**The white paper** sets out the AI-native office — AI runs 90% of the work on machines the company owns, five AI-native people oversee
it, the modelled 50-person office goes from **£12.6m to £2.3m over five years** — and the full AI company beyond it, with the measured
results of a working day re-run from scratch.

## The AI layer — every device a brain

| organ | what it is |
|---|---|
| `brains/*.slm.json` | One dedicated brain file per job (sales, churn, fraud, credit, inventory, maintenance, intrusion, energy) — the Konomi SLM's verified patterns, readable rule by rule. Sales is grown on real data (UCI Online Shoppers). |
| `src/brain.mjs` | Route → gate → answer from a verified pattern, or **abstain**; every answer carries a receipt. `adopt` takes a brain only if it re-verifies on this device's own data. `meshRoute` asks the other devices. `secondOpinion` accepts only an *independent* pattern on another device — a copy of the same brain is not a check. |
| `src/grow.mjs` | A device **grows** its own brain from its own data (the seed-library ribosome), graded on held-out rows it never grew on, kept only if it clears the gate. |
| `src/agent.mjs` | What an agent does with an answer: screen → own brain → mesh → second brain for high stakes or low confidence → act, or the watch list. Budgets in integer pence. |
| `src/screen.mjs` | Every inbound text is screened before any brain reads it: invisible characters, direction tricks, smuggled tag text, injection phrasing. Flagged → quarantined unread. |
| `src/company.mjs` | The company: who the agents are and what they may touch, the door, each agent's step, what each decision **writes** (CRM, tasks, payments, purchase orders, journal postings, security), hand-offs across scopes, learning by being asked, the regrowth gate, the board. |
| `src/runtime.mjs` | The company running — the one loop the live page and the headless re-run share. |

## The spine

The company is a **pure function of the set of signed writes a device holds**. Two devices that have seen the same writes hold the
same company, byte for byte — whatever order the network delivered them in.

| organ | what it is |
|---|---|
| `src/gate.mjs` | Verify-before-parse on raw bytes: size → UTF-8 → magic → guarded parse → exact grammar → **canonical round-trip** → replay → Ed25519. |
| `src/crdt.mjs` | The materialiser: OR-set records, LWW fields under a total order, RGA text, and the **role tree** (owner → admins → agents/staff with collection scopes; revocation is a sequence cut). Equivocation is resolved identically everywhere and flagged. |
| `src/node.mjs` | One device: its key, its signed writes, its gated inbox, its view — folded in incrementally (exactly equal to a full rebuild), signatures in a batch checked in parallel. |
| `src/vault.mjs` | The one-true-record as an **RFC 9162 transparency log** — inclusion and consistency proofs anyone can verify; every prefix root in one O(n log n) pass. |
| `src/books.mjs` | Double-entry in integer pence on UK nominal codes; trial balance, P&L, balance sheet. |
| `src/lease.mjs` | Crypto-shredding (personal fields sealed per person) and data leases (a fired device's cache locks itself). |
| `src/sim.mjs` | A deterministic hostile network — partitions, drops, duplicates, forged / flipped / replayed / re-wrapped / oversize / junk envelopes, unauthorised writers, an equivocating insider. |
| `src/office.mjs` | The AI-native office cost and capacity kernel behind the white paper. |

## Proof (all re-runnable; CI runs them)

- **`node --test test/*.test.mjs`** — the unit, boundary, hostile-input and integration suites: the brains, the agents, the screen,
  growth, the company kernel, a working day of the AI company with every intervention, and the spine.
- **`node tools/run-company.mjs --check`** — re-runs a working day of the full AI company (480 pieces of work, a hostile message, a
  poisoned brain, the Audit agent offline, a human's choice carried out, an agent fired) and must reproduce `receipts/company.json`
  byte for byte: 77.7% done end to end by agents, 76.7% of agent calls right against outcomes they never saw, every device converged,
  books balanced, vault audited.
- **`node tools/simulate.mjs --check`** — 16 devices, partitions, drops, duplicates, 90 attacks: one company, receipt reproduced.
- **`node witness-all.mjs`** — the mutation + fuzz gate over every decision kernel (spine and AI layer), each reviewed equivalent
  justified in `witness.baseline.json`.

## Threat model, plainly

The gate refuses anything forged, altered, replayed, re-wrapped or malformed; unauthorised writes are stored but never applied. A
brain is never trusted on its publisher's word — every device re-verifies it on its own data, so a poisoned brain dies at the first
device that checks. Hostile text is quarantined before any brain reads it. A **stolen device key** can do what that device could do
until it is revoked, and can contest that key's own past sequence slots (resolved identically everywhere, the writer flagged); the next
organ closes that with per-writer hash chains.

## Honest scope

The brains are interpretable scorecards, not language models: they decide structured cases (is this payment fraud, will this customer
leave, is this machine about to fail) and abstain on anything else. Sales runs on real data; the other seven streams are
realistic-synthetic, each generated from a stated rule plus seeded noise. The "model tier" (a local or frontier language model for what
no brain covers) is wired into the decision rules but not connected on the live page — what no brain can confirm goes to a human.

MIT licensed — see [`NOTICE`](NOTICE) for credits: the Konomi architecture and the Konomi SLM's lineage are Thomas Frumkin's; the GEP /
WIPER / BES / Dual-Map lens is Gary W. Floyd's (Lumiea Systems Research Division — ThunderStruck Service, LLC); the independent second brain and the held-for-a-human verdict draw on his *From GEP Stabilization to Dual-Map Ethical Reasoning*, Derivation v0.2.
