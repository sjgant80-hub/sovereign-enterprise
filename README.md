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
paper**, **Run your own** (this browser becomes a device in your own company), **Plant** (the planter's console: a business's own files become its own brains, its bank, books and customers are bridged, the plan is signed into its company and checked on every agent device, and a signed receipt proves it worked — one click runs it on a demo business), and **Wire it** (the step-by-step afternoon that puts it on an office's own machines, one AI agent per device, ending in a receipt the owner signs).

## The AI layer — every device a brain

| organ | what it is |
|---|---|
| `brains/` | One brain file per job — buyers, leavers, card fraud, credit, stock-outs, machine failures, intrusions, power overloads — readable rule by rule. Seven of the eight are grown on published datasets (see Data). |
| `src/brain.mjs` | Route → gate → answer from a verified pattern with a receipt, or **abstain**. `adopt` takes a brain only if it re-verifies on this device's own data. |
| `src/mesh.mjs` | How the brains talk: an agent that cannot answer posts a signed **ask**; other agents post signed **replies** from their own brains; second opinions come only from a *different* pattern on another device. No shared memory — every answer the company acts on is a record on the spine. |
| `src/grow.mjs` | A device grows its own brain from its own data (the seed-library ribosome), graded on held-out rows it never grew on, kept only if it clears the gate. |
| `src/train.mjs` | Teach the company your own work: a CSV of your records → a verified brain grown in the browser (csv-forge's reader, vendored). |
| `src/plant.mjs` | Planting it in a business: the seed reads the files a business already keeps — each one named with the reason (a yes/no outcome to learn, a log of its own past decisions, or a bank statement, trial balance or customer list, set aside and never learned from) and matched to one of the eight jobs — then grows each job's brain from that file (`src/train.mjs`), starts the rest on the shipped brain (re-checked on the business's own records before it acts) or the Watch list, re-grows a decision log and checks it against the old decisions and what really happened, lists every gap in plain words and seals the plan by its hash. The decision-log re-growth is discombobulator's, vendored. |
| `src/receipt.mjs` | The per-planting receipt: the signed proof a business got better. Per job, on the rows its brain never grew on, the business's own past decisions (or doing nothing) against the brain grown from its file — how often each was right, how many of the cases that mattered each caught, how many the brain answered itself; the five-year cost on its own headcount; the records brought across; the live results read from the spine. Every share re-derives from its counts; refused unless each brain reproduces its own score on its file; reproducible byte for byte; a redacted showcase for the next prospect. |
| `src/sow.mjs` · `ui/plant.mjs` | **Planting into a company, and the planter's console.** The planter's device — the owner's, or an admin's on site or remote after joining by the invite link — signs the sealed plan, each brain grown from the business's own records, a job record saying how to read each file, the confidence floor and a pause for each agent switched off. Every agent may write brains, so each agent device reads which key really wrote every field (`signersOf`, the one reading `signedAs` makes) and reads a planted brain only if the role tree grants that key to plant the job — the owner, a live admin, or the agent that runs it; then it re-checks it on its own copy of the business's records and adopts it only if it does at least as well as the brain it has (`brain.mjs adopt`). Its verdicts come back to the planter on the spine. **Plant** walks it in seven steps: the kind of business and its headcount → its files, each classified with the reason and correctable → Grow (what grew from their records, what stays shipped, what is left to people, the readable rules, the held-out scores, a decision log re-grown with every mismatch) → Tune (agents, confidence floor, the model tier) → Bridge (statement reconciled to the penny, trial balance, customer list; a Sage journal and a CRM file to download; Xero refused in words) → Plant (into a practice company in the tab, or this device's own company or a client's) → the signed receipt, printed for the client, with a redacted showcase copy for the next prospect. One click plants the demo business — the repository's real samples — from cold. |
| `src/agent.mjs` | What an agent does with an answer: screen → own brain → mesh → second brain for high stakes or low confidence → model tier → act, or the Watch list. Budgets in whole pence. |
| `src/screen.mjs` | Every inbound text screened before any brain reads it: invisible characters, direction tricks, smuggled tag text, injection phrasing. Flagged → quarantined unread. |
| `src/antibody.mjs` | The immune system: a message a person confirms was hostile becomes a signed **antibody** — a hashed fingerprint of its wording, never the message, numbers masked. Every agent re-checks it on its own known-genuine messages (alone and two at a time) and adopts it only if it fires on none: an attack caught once is quarantined everywhere, an over-broad one is refused everywhere. |
| `src/watch.mjs` | The behaviour watch (Gary W. Floyd's BES): a valid key and grant are not enough — each agent's own habits are learned then frozen; one thing every time / clockwork / collapse → scripted, acts off its work or a large and real drift on the same work → hijacked; the AI overseer pauses it, a person clears it. |
| `src/model.mjs` | The model tier, for free text no brain covers: Ollama, OpenAI-compatible, Anthropic (your own key) and in-browser WebLLM adapters that never throw and always time out; the spend checked against the worst case before any paid call; the customer's words fenced as data; answers parsed strictly; every call — made or refused — a flat audit record on the spine (never the key). A model never takes a money or security act alone, and its replies are drafts a person sends. |
| `src/company.mjs` | The company: the agents and what they may touch, the hub, each agent's step (`openStep` → mesh → `closeStep`), what each decision **writes**, hand-offs across scopes, learning by being asked, the regrowth gate, the board. |
| `src/shell.mjs` · `ui/wire.mjs` | **One agent on one device, and wiring an office.** The agent step every agent device runs — reply to peers' asks, open its work, ask the mesh, take a second opinion from another device, decide, write within its own grant, hand off the rest — shared by the demo's runtime (the re-run receipt is unchanged) and by a real device in **Wire it → An AI agent** (`createAgentShell`: its own grant, its peers, a pause the behaviour watch set, antibodies it re-checks, approved calls, restart-safe). **Wire it** is the tech person's afternoon: found → recovery cards → invite → roles → hub → one browser profile per agent on the AI box → connect the machines → optional local model (Ollama, exact commands per OS) → a real test case per agent → every device shows the same company mark → the owner signs a **wiring receipt** anyone can check. Each step's status is read from the spine; a printable install sheet. |
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
| `src/store.mjs` | The device's secrets at rest: its Ed25519 key made **non-extractable** and kept as a CryptoKey in IndexedDB (the browser signs with it and hands its bytes to no script); every stored write sealed with AES-256-GCM under a second non-extractable key, the namespace bound in; an append-only log bounded at the newest 20,000 writes plus up to 5,000 grants and revokes kept regardless of age; a tab-only device not opened for 7 days, its tab closed, is deleted; a one-time migration off the old plaintext `localStorage` copies that deletes them only after the sealed copy commits. Limits stated in its header: same-origin code can still *use* the key; full-disk encryption is what protects a stolen disk. |
| `src/recovery.mjs` | Owner recovery cards: the owner key's seed split by **Shamir's secret sharing** over GF(256) into three printed cards, any two of which restore it; each card is checksummed Crockford base32 carrying a mark of the key, so a typo is caught on its own card and mixed, duplicate or mismatched cards are refused. |
| `src/vault.mjs` | The one-true-record as an **RFC 9162 transparency log** — inclusion and consistency proofs anyone can verify. |
| `src/books.mjs` | Double-entry in whole pence on UK nominal codes; trial balance, P&L, balance sheet. |
| `src/bridge.mjs` | Bridges to the systems a business already has. **In:** a bank statement (paid in / paid out, one signed amount, or the bank's debit / credit columns; day-first dates; pound signs, thousands commas, brackets for minus) → rows in whole pence, every unreadable row listed with its reason → journal entries (the bank against the nominal a word rule names, or the suspense account 9998 for a person), reconciled to the penny with every running balance checked; a trial balance → one opening entry that balances, or a refusal saying by how much it is out; a CRM export → the page's CRM records. **Out:** the books as Sage Accounting's journal import (Xero is left out — its layout could not be verified against Xero's own documentation), the CRM as a spreadsheet. A receipt per bridge: the file's hash, the counts, the totals, the result's hash. One CSV reader (csv-forge's), one CSV writer (`src/exportco.mjs`'s). |
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

**Planting, plainly.** An agent device re-checks a planted brain on its own copy of the business's records, given to it in Wire it and kept only while that page is open — a device does not yet keep a business's files at rest, so after a restart it re-checks on the published data it holds (where the business's columns differ, it keeps its shipped brain until it is given the file again). The bridges read, check and convert; they do not post into the company's books — the Finance agent's device sequences every posting into the vault. Xero is not written. On the demo business the shipped brains were grown on the very same published records, so on those records they often score higher and the agent devices keep them: the rule that protects a real business, shown honestly.

MIT licensed — see [`NOTICE`](NOTICE) for credits: the Konomi architecture and the Konomi SLM's lineage are Thomas Frumkin's; the GEP /
WIPER / BES / Dual-Map lens is Gary W. Floyd's (Lumiea Systems Research Division — ThunderStruck Service, LLC); the independent second
brain and the held-for-a-person verdict draw on his *From GEP Stabilization to Dual-Map Ethical Reasoning*, Derivation v0.2.
