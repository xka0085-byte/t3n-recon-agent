# Onchain Recon Agent (T3N ADK)

Enterprise on-chain reconciliation agent built on the Terminal 3 Network (T3N) ADK.
**Live agent card (T3N-hosted, ERC-8004):**
https://cn-api.sg.testnet.t3n.terminal3.io/api/agent-card/did:t3n:7dddb24424ebae514ec79c67f1e463522123c8fd

## What it does

1. **Fetch** — pulls transaction history for any EVM address from public Blockscout
   instances (Ethereum, Base, Arbitrum, Optimism — no explorer API key required).
2. **Reconcile** — native ETH **and ERC-20 / stablecoin** flows (USDC, USDT, …):
   inflow / outflow / fees / net per asset, top counterparties, daily activity,
   plus anomaly flags (failed txs, dust transfers, single-counterparty bursts).
3. **Export** — Markdown (human), JSON (machine), **CSV (accounting import — fixed
   precision, no scientific notation)**.
4. **Attest** — computes the SHA-256 hash of each report and binds it to the
   operator's authenticated T3N DID (`did:t3n:...`), producing a tamper-evident
   audit trail artifact (`.attestation.json`) alongside every report.
5. **Serve** — `npm run serve` exposes `GET /recon?address=…&chain=…&days=…&token=…`
   and `GET /healthz` so the agent can run as a hosted service other systems call;
   the service binds itself to a T3N DID at boot.

Every enterprise consuming reconciliation output needs exactly this: a report whose
integrity is bound to a verifiable identity. Phase 2 (in progress) moves the
attestation into a TEE contract so the hash is computed inside the enclave.

## Stack

- Node.js 22 + TypeScript (ESM), `tsx` runner
- `@terminal3/t3n-sdk` **5.2.0** — see Known Issues below
- Data source: Blockscout v2 public API (keyless)

## Run

```bash
npm install
cp .env.example .env   # then fill T3N_API_KEY (from https://go.terminal3.io/adk-community)
npm run recon -- --address 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --chain eth --days 30
npm run recon -- --address 0x... --token USDC          # stablecoin-only reconciliation
npm run serve                                           # HTTP mode: :8787/recon?address=…&chain=…&days=…&token=…
```

Output: `reports/<chain>-<addr>-<timestamp>.json` + `.md` + `.csv` + `.attestation.json`.

## Project layout

```
src/blockscout.ts   Blockscout v2 client (native txs + ERC-20 token transfers, pagination)
src/report.ts       Reconciliation engine + Markdown/JSON/CSV renderers
src/t3n.ts          T3N session wrapper (tenant / agent modes)
src/index.ts        CLI entry (--serve switches to HTTP mode)
src/server.ts       HTTP service: /recon + /healthz, DID-bound at boot
agent-card.json     ERC-8004 registration card (hosted on T3N)
```

## Identity

| Entity | DID |
|---|---|
| Operator (tenant) | `did:t3n:6951e5de000a39b57956b9c2b9edc7b462d0931e` |
| Organisation | `did:t3n:5555cf087e069c94110388842f7b4cfb09c4b6a1` (eidon-labs) |
| Agent | `did:t3n:7dddb24424ebae514ec79c67f1e463522123c8fd` |

## Verification (machine-checked, not asserted)

- **Type check**: `npx tsc --noEmit` (strict) — 0 errors
- **Invariant tests**: `npx tsx --test test/*.test.ts` — 17 tests: mathematical
  identities (`net ≡ inflow − outflow`), ~900 randomly generated cases, plus edge
  cases (checksummed addresses, zero-day windows, self-transfers, CSV escaping,
  counterparty bursts, HTTP endpoints) — **17/17 pass**
- **Chain cross-validation**: `npx tsx verify-chain.ts` — sampled native txs AND
  ERC-20 transfers are re-read from an independent public RPC node; token transfers
  are verified by decoding the **raw Transfer event logs** from transaction receipts
  (zero web3 libraries). Result: **19 PASS / 0 parser bugs / 1 data-quality anomaly**
  (a spam-airdrop record indexed by Blockscout but missing on the independent node —
  exactly the kind of phantom entry a reconciliation tool must surface).
- **Dependencies**: `npm audit` — 0 vulnerabilities

Verification earned its keep: running it for the first time caught two real issues —
a token-address field drift in the Blockscout API (`address_hash` vs `address`) and a
missing defensive normalization that mis-classified directions for checksummed inputs.
Both are fixed; the tests that caught them are permanent.

Tests prove what they cover, nothing more — but every claim above is a command you
can run yourself and a deterministic pass/fail you can reproduce.

## Known Issues (bugs found & workarounds)

1. **SDK ≥ 5.3.0 fails on testnet trust manifest** — `fetchTrustedManifest("testnet")`
   throws `Trust manifest ... is malformed` because the SDK's expected manifest shape
   diverged from what the testnet cluster serves (manifest `signed_at` 2026-08-27).
   Community reports on the Superteam Earn listing confirm ("latest ADK version hasn't
   been compatible with testnet").
   **Workaround:** pin `@terminal3/t3n-sdk@5.2.0`.
2. **CLI `whoami` ignores key identity on org flows** — both tenant and freshly
   claimed agent keys resolve to the *same* `did:t3n` when authenticated through the
   same sandbox account; DID appears bound to the account, not the key. The
   org-owned path (`org create` → `agent create`) is the working way to mint a
   distinct agent identity.
3. **Blockscout v2 dropped the `filter=to|from` enum** — requests with it now return
   HTTP 422. Omitted; the default response already includes both directions.

## Maintenance note

- No explorer API keys, no database, single dependency pair (`t3n-sdk`, `tsx`).
- Chains are added by editing one map in `src/blockscout.ts`.
- Handover: any maintainer needs only the org DID + a key with `agent-cards`
  scope write access to update the card; recon logic is stateless.

## Phase B v2 — attestation inside the TEE enclave (z-tenant-recon)

v2 closes v1's trust gap: the report digest is no longer computed in Node.
The [`z-tenant-recon`](../z-tenant-recon) TEE contract (Rust → WASM,
`wasm32-wasip2`) receives the canonical report text and:

1. computes SHA-256 **inside the T3N enclave**,
2. records an immutable attestation in tenant KV `z:<tid>:attestations`
   (same `report_id` + different content → hard reject; identical → idempotent),
3. pins the 32-byte digest into the KV transaction's claims via
   `kv-store.set-claims-digest` — audit receipts are offline-verifiable
   against the T3N Merkle root.

Deploy + smoke test (4 checks: digest parity, readback, idempotency, tamper):

```
cargo build --release --target wasm32-wasip2   # in ../z-tenant-recon
npm run tee                                    # register + verify
npm run recon -- --address 0x...               # recon → TEE attestation
```

Attestation artifacts now carry `"engine": "tee-contract"` with the contract
name/version, enclave digest and KV location; the node-side fallback path is
marked `"engine": "node-fallback"` so verifiers can tell them apart.
