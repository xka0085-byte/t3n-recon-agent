# Onchain Recon Agent (T3N ADK)

Enterprise on-chain reconciliation agent built on the Terminal 3 Network (T3N) ADK.
**Live agent card (T3N-hosted, ERC-8004):**
https://cn-api.sg.testnet.t3n.terminal3.io/api/agent-card/did:t3n:7dddb24424ebae514ec79c67f1e463522123c8fd

## What it does

1. **Fetch** — pulls transaction history for any EVM address from public Blockscout
   instances (Ethereum, Base, Arbitrum, Optimism — no explorer API key required).
2. **Reconcile** — builds a report: inflow / outflow / fees / net, top counterparties,
   daily activity, plus anomaly flags (failed txs, dust transfers, single-counterparty
   bursts).
3. **Attest** — computes the SHA-256 hash of each report and binds it to the
   operator's authenticated T3N DID (`did:t3n:...`), producing a tamper-evident
   audit trail artifact (`.attestation.json`) alongside every report.

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
```

Output: `reports/<chain>-<addr>-<timestamp>.json` + `.md` + `.attestation.json`.

## Project layout

```
src/blockscout.ts   Blockscout v2 client (pagination, normalization)
src/report.ts       Reconciliation engine + Markdown/JSON renderers
src/t3n.ts          T3N session wrapper (tenant / agent modes)
src/index.ts        CLI entry
agent-card.json     ERC-8004 registration card (hosted on T3N)
```

## Identity

| Entity | DID |
|---|---|
| Operator (tenant) | `did:t3n:6951e5de000a39b57956b9c2b9edc7b462d0931e` |
| Organisation | `did:t3n:5555cf087e069c94110388842f7b4cfb09c4b6a1` (eidon-labs) |
| Agent | `did:t3n:7dddb24424ebae514ec79c67f1e463522123c8fd` |

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
