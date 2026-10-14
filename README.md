# SOVEREIGN ENTERPRISE

### ▶ Live: **https://sjgant80-hub.github.io/sovereign-enterprise/**
### ▶ The white paper: **https://sjgant80-hub.github.io/sovereign-enterprise/whitepaper.html**

A company's whole operational layer — **tasks, chat, CRM, documents, the books, the one-true-record and the people** — running on
the employees' own devices, peer to peer. Every write is signed by the device that made it and checked before it is read. No
per-seat software. Nothing leaves the building.

**The white paper** sets out the AI-native office: AI runs 90% of the work on machines the company owns, five AI-native people
oversee it, and the modelled 50-person office goes from **£12.6m to £2.3m over five years**. Every figure on the page is computed
live by a tested kernel from sourced UK data.

## The spine

The company is a **pure function of the set of signed writes a device holds**. Two devices that have seen the same writes hold the
same company, byte for byte — whatever order the network delivered them in. Partitions, delays and duplicates can't split it;
anti-entropy (each side sends what the other lacks) closes every gap.

| organ | what it is |
|---|---|
| `src/gate.mjs` | Verify-before-parse on raw bytes: size → UTF-8 → magic → guarded parse → exact grammar → **canonical round-trip** → replay → Ed25519 signature. On a gossip mesh ops arrive out of order, so the gate never drops for ordering. |
| `src/crdt.mjs` | The materialiser: OR-set records (a concurrent edit beats a delete), LWW fields under a total order, RGA text, and the **role tree** (owner → admins → staff with collection scopes; revocation is a sequence cut, not a clock). An equivocating writer is resolved the same way everywhere and flagged. |
| `src/vault.mjs` | The one-true-record as an **RFC 9162 transparency log** — inclusion and consistency proofs anyone can verify. Not a blockchain: one legal entity needs an append-only log, not consensus between strangers. |
| `src/books.mjs` | Double-entry in integer pence on UK nominal codes; trial balance, P&L, balance sheet. An entry balances or it does not exist. |
| `src/lease.mjs` | **Crypto-shredding** (personal fields sealed per person; erasure destroys the key, the history still verifies) and **data leases** (a revoked device's cache locks itself). |
| `src/node.mjs` | One device: its key, its signed writes, its gated inbox, its view. Refuses to sign what its own view says it isn't authorised for. |
| `src/sim.mjs` | A deterministic hostile network — partitions, drops, duplicates, forged / flipped / replayed / re-wrapped / oversize / junk envelopes, unauthorised writers and an equivocating insider. |
| `src/office.mjs` | The AI-native office cost and capacity kernel behind the white paper. |

## Proof (all re-runnable; CI runs them)

- **`node --test test/*.test.mjs`** — 76 unit, boundary and hostile-input tests, including 200 random reorderings that must give one
  identical company, every inclusion and consistency proof up to 40 entries, and the RFC 6962 reference roots.
- **`node tools/simulate.mjs --check`** — 16 devices, 12 partitioned rounds, 132 dropped and 88 duplicated deliveries, 90 attacks:
  converges to one company and reproduces its receipt byte for byte (`receipts/sim.json`).
- **`node witness-all.mjs`** — the mutation + fuzz gate over every decision kernel, with each reviewed equivalent justified in
  `witness.baseline.json`.

## Threat model, plainly

The gate refuses anything forged, altered, replayed, re-wrapped or malformed; unauthorised writes are stored but never applied.
A **stolen device key** can do what that device could do until it is revoked, and can contest that key's own past sequence slots
(resolved identically everywhere, the writer flagged). The next organ closes that: per-writer hash chains, so every write commits
to its writer's previous one and a fork of history is provable.

## Run it

Open the live page: the demo office (five devices — take any offline, edit, reconnect; attack the gate) or **Run your own
company** (this tab becomes your device; teammates join by invite link and sync peer to peer between tabs).

MIT licensed — see [`NOTICE`](NOTICE) for credits: the GEP / WIPER / BES / Dual-Map lens is Gary W. Floyd's (Lumiea Systems
Research Division, ThunderStruck Services, LLC); Konomi is Thomas Frumkin's.
