# SOVEREIGN ENTERPRISE

### ▶ Live: **https://sjgant80-hub.github.io/sovereign-enterprise/**
### ▶ The white paper: **https://sjgant80-hub.github.io/sovereign-enterprise/whitepaper.html**
### ▶ The case for your board: **https://sjgant80-hub.github.io/sovereign-enterprise/#case**

**A full AI company on its own devices.** Six AI agents — sales, service, finance, operations, systems and audit — run the company end
to end; two people watch and decide the exceptions; an office hub is the door where the work arrives. Every device is a brain: a verified
pattern library (the Konomi SLM) that answers only inside what it was verified on and abstains outside it. The brains talk to each other
only through signed records on a peer-to-peer spine — a mycelium — and nothing leaves the building.

Open the live page and the company is already working. The page explains itself: **Overview** (what it is, start here, a two-minute
tour), **Live company** (nine devices running the real code — attack it, take devices offline, be the overseer), **How it works** (a real
decision traced step by step, and every part as a diagram), **Blueprint** (every organ, what it connects to, how it is proven), **For your
business** (the agents mapped onto your kind of business, the twelve-week roll-out, the five-year comparison on your own headcount, the
rival that could undercut you, and a brain grown on your own CSV in the browser), **The case** (the printable board brochure), **White
paper**, and **Run your own** (this browser becomes a device in your own company).

## The AI layer — every device a brain

| organ | what it is |
|---|---|
| `brains/` | One brain file per job — buyers, leavers, card fraud, credit, stock-outs, machine failures, intrusions, power overloads — readable rule by rule. Seven of the eight are grown on published datasets (see Data). |
| `src/brain.mjs` | Route → gate → answer from a verified pattern with a receipt, or **abstain**. `adopt` takes a brain only if it re-verifies on this device's own data. |
| `src/mesh.mjs` | How the brains talk: an agent that cannot answer posts a signed **ask**; other agents post signed **replies** from their own brains; second opinions come only from a *different* pattern on another device. No shared memory — every answer the company acts on is a record on the spine. |
| `src/grow.mjs` | A device grows its own brain from its own data (the seed-library ribosome), graded on held-out rows it never grew on, kept only if it clears the gate. |
| `src/train.mjs` | Teach the company your own work: a CSV of your records → a verified brain grown in the browser (csv-forge's reader, vendored). |
| `src/agent.mjs` | What an agent does with an answer: screen → own brain → mesh → second brain for high stakes or low confidence → model tier → act, or the Watch list. Budgets in whole pence. |
| `src/screen.mjs` | Every inbound text screened before any brain reads it: invisible characters, direction tricks, smuggled tag text, injection phrasing. Flagged → quarantined unread. |
| `src/antibody.mjs` | The immune system: a message a person confirms was hostile becomes a signed **antibody** — a hashed fingerprint of its wording, never the message, numbers masked. Every agent re-checks it on its own known-genuine messages (alone and two at a time) and adopts it only if it fires on none: an attack caught once is quarantined everywhere, an over-broad one is refused everywhere. |
| `src/watch.mjs` | The behaviour watch (Gary W. Floyd's BES): a valid key and grant are not enough — each agent's own habits are learned then frozen; one thing every time / clockwork / collapse → scripted, acts off its work or a large and real drift on the same work → hijacked; the AI overseer pauses it, a person clears it. |
| `src/model.mjs` | The model tier, for free text no brain covers: Ollama, OpenAI-compatible, Anthropic (your own key) and in-browser WebLLM adapters that never throw and always time out; the spend checked against the worst case before any paid call; the customer's words fenced as data; answers parsed strictly; every call — made or refused — a flat audit record on the spine (never the key). A model never takes a money or security act alone, and its replies are drafts a person sends. |
| `src/company.mjs` | The company: the agents and what they may touch, the hub, each agent's step (`openStep` → mesh → `closeStep`), what each decision **writes**, hand-offs across scopes, learning by being asked, the regrowth gate, the board. |
| `src/runtime.mjs` | The company running — nine devices, ticks, deadlines, the door re-addressing work of an agent that went offline; the one loop the live page and the headless re-run share. |
| `src/market.mjs` | The board case: owned compute vs renting dedicated GPUs from AWS London vs per-token Bedrock; how far an AI-native rival can cut prices on your cost base. |
| `src/explain.mjs` · `src/adopt.mjs` | The page explains itself: six diagrams, any decision traced step by step, the blueprint, the adoption guide by business type, and the five-year comparison refitted to your own headcount. |

## The spine

The company is a **pure function of the set of signed writes a device holds**. Two devices that have seen the same writes hold the
same company, byte for byte — whatever order the network delivered them in.

| organ | what it is |
|---|---|
| `src/gate.mjs` | Verify-before-parse on raw bytes: size → UTF-8 → magic → guarded parse → exact grammar → **canonical round-trip** → replay → Ed25519. Every envelope (v2) names `prev`, the hash of its writer's previous envelope — a **per-writer hash chain** — and `proveFork` / `proveLink` let anyone check a fork or a continuation from the bytes alone. |
| `src/crdt.mjs` | The materialiser: OR-set records, LWW fields under a total order, RGA text, and the **role tree** (owner → admins → agents/staff with collection scopes; revocation is a sequence cut). Two writes for one (writer, seq) slot go to the one the writer **continued** — so a key stolen later cannot rewrite a slot the device already built on; a fork at the tip goes to the lowest hash; a key that signs two continued histories is **burned** from that slot. Every fork is flagged and reported with its proof, identically everywhere. |
| `src/node.mjs` | One device: its key, its own hash chain (each write names the one before; writes are signed one at a time; a replay restores the chain head), its gated inbox, its view — folded in incrementally (exactly equal to a full rebuild), signatures in a batch checked in parallel. |
| `src/rtc.mjs` | Cross-machine sync with no server: a hand-carried code (stripped SDP, deflated, checksummed), a proof of each device key bound to both DTLS certificates, records only to granted members, have/want/env rounds plus a one-message digest per tick, every byte through the gate. |
| `src/vault.mjs` | The one-true-record as an **RFC 9162 transparency log** — inclusion and consistency proofs anyone can verify. |
| `src/books.mjs` | Double-entry in whole pence on UK nominal codes; trial balance, P&L, balance sheet. |
| `src/lease.mjs` | Crypto-shredding (personal fields sealed per person) and data leases (a fired device's cache locks itself). |
| `src/sim.mjs` | A deterministic hostile network — partitions, drops, duplicates, forged / flipped / replayed / re-wrapped / oversize / junk envelopes, unauthorised writers, a stolen insider key re-signing slots its device already built on, and a thief forging a whole continued history. |
| `src/office.mjs` | The AI-native office cost and capacity kernel behind the white paper. |

## Proof (all re-runnable; CI runs them)

- **`node --test test/*.test.mjs`** — unit, boundary, hostile-input and integration suites.
- **`node tools/run-company.mjs --check`** — re-runs a working day of the full AI company and must reproduce `receipts/company.json`
  byte for byte.
- **`node tools/simulate.mjs --check`** — 16 devices through partitions, drops, duplicates and 90 attacks: one company, receipt reproduced — every slot a stolen key re-signed after the real device built on it kept the real write; the forged continued history burned the key.
- **`node tools/build-real-brains.mjs --check`** — rebuilds every real-data brain from its published dataset, byte for byte. It needs
  the raw datasets first (about 350 MB, not in the repo — the download commands are at the top of that file); not run in CI.
- **`node --test test/watch.sim.test.mjs`** — prints the behaviour watch's measured false-positive and detection rates on the company's own work.
- **`node witness-all.mjs`** — the mutation + fuzz gate over every decision kernel (spine and AI layer).
- **`node tools/model-check.mjs`** — local only, not in CI: the model tier against a real Ollama, scored against the truth.

## Data

Seven of the eight jobs run on published datasets: six real (card transactions, telecom churn, credit defaults, IoT network flows,
household power, web shopping sessions) and one its authors publish as synthetic (AI4I machine data); inventory runs on a synthetic
stream because no open stock-out data exists. Every source, licence and split is in [`NOTICE`](NOTICE) and on each brain's card in the
live page. Protected characteristics (age, sex, marital status, education) are left out of every brain on purpose.

## Threat model, plainly

The gate refuses anything forged, altered, replayed, re-wrapped or malformed; unauthorised writes are stored but never applied. A brain
is never trusted on its publisher's word — every device re-verifies it on its own data, so a poisoned brain dies at the first device that
checks. Hostile text is quarantined before any brain or model reads it. A fired device's writes are refused everywhere and its cached data
locks itself. A **stolen device key** can sign new writes until it is revoked — but it cannot rewrite that device's past: every write names
the one before it (a per-writer hash chain), so a slot the device already built on keeps the real write on every device, and the forgery
is flagged with a proof anyone can check. A thief who forges a whole continued history burns the key from the forked slot — no version of
that history counts after it, the real device's included, and the device must be re-keyed. That is a denial, never a rewrite. A model never acts alone on money or security.

## Honest scope

The brains are interpretable scorecards, not language models: they decide structured cases (is this payment fraud, will this customer
leave, is this machine about to fail) and abstain on anything else. Free text — reading a customer's message, routing it, drafting a reply
— is the model tier's job: measured on this repo's own laptop CPU, a local 7B model routed hand-written customer messages to the right desk
4 times in 5 and drafted fact-free holding replies, but did **not** beat the verified brains on structured cases (churn 7/12 against the
brain's 10/12), which is why the brains decide and the model only reads and drafts. The modelled office in the white paper is a model, not
a client; the people, customers and suppliers in the live company are fictional.

MIT licensed — see [`NOTICE`](NOTICE) for credits: the Konomi architecture and the Konomi SLM's lineage are Thomas Frumkin's; the GEP /
WIPER / BES / Dual-Map lens is Gary W. Floyd's (Lumiea Systems Research Division — ThunderStruck Service, LLC); the independent second
brain and the held-for-a-person verdict draw on his *From GEP Stabilization to Dual-Map Ethical Reasoning*, Derivation v0.2.
