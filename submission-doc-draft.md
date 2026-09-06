# T3N Agent Build Challenge — Submission Draft

(把本文件内容原样粘到 Google Doc，设为"任何人有链接可查看"，再补截图)

## Agent

**Onchain Recon Agent** — an enterprise on-chain reconciliation agent built with the T3N ADK.

- **Agent DID**: `did:t3n:7dddb24424ebae514ec79c67f1e463522123c8fd`
- **Public agent card (T3N-hosted, ERC-8004)**:
  https://cn-api.sg.testnet.t3n.terminal3.io/api/agent-card/did:t3n:7dddb24424ebae514ec79c67f1e463522123c8fd
- **Organisation**: eidon-labs (`did:t3n:5555cf087e069c94110388842f7b4cfb09c4b6a1`)
- **GitHub repo**: <粘贴你的公开 repo 链接>

## What it does

1. Fetches EVM transaction history for any address from public Blockscout instances
   (Ethereum / Base / Arbitrum / Optimism — zero explorer API keys).
2. Reconciles **native ETH and ERC-20/stablecoin flows** (USDC, USDT, …): per-asset
   inflow/outflow/net, top counterparties, daily activity, anomaly flags (failed
   txs, dust, single-counterparty bursts).
3. Exports Markdown (human), JSON (machine), and **CSV for accounting import**
   (fixed precision — no scientific notation; a real bug we caught and fixed).
4. Computes the report's SHA-256 hash and binds it to the authenticated T3N DID,
   producing a `.attestation.json` tamper-evident audit artifact for every report.
5. Runs as a **hosted HTTP service** (`GET /recon?…`, `GET /healthz`), identity-bound
   to a T3N DID at boot — deployable post-challenge as-is.

Why enterprises care: reconciliation output that is bound to a verifiable identity
can be used for bookkeeping and audit without trusting the messenger.

## Verified run (screenshot placeholders — 每个都截一张图)

1. `t3n whoami` → DID returned（截图：终端输出）
2. `npm run recon -- --address 0xd8dA...6045 --chain eth --days 30`
   → 150 txs scanned, report + attestation written（截图：终端 Summary + reports/ 目录）
3. Report preview（截图：Markdown 报告的 Totals / Flags 部分）
4. Agent card publicly resolvable（截图：浏览器打开 agent card URL）
5. `t3n agent registry did:t3n:7dddb2...`（截图：registry 记录）

## Bugs found during the build (with reproduction + workaround)

1. **SDK ≥ 5.3.0 incompatible with testnet trust manifest**
   - Repro: fresh install of latest `@terminal3/t3n-sdk`, run the Quickstart verbatim →
     `Error: Trust manifest at https://cn-api.sg.testnet.t3n.terminal3.io/api/trust-manifest is malformed.`
   - The endpoint returns valid JSON (`peer_ids` / `rtmr3_allowlist` / `signature`,
     signed 2026-08-27); the SDK's parser expects a different shape. Independent
     confirmation in the Earn listing comments ("latest ADK version hasn't been
     compatible with testnet").
   - Workaround: pin `@terminal3/t3n-sdk@5.2.0`. Suggested fix: align the SDK's
     manifest schema with the testnet cluster or version the manifest format.
2. **Agent identity cannot be minted from a second claim-page key on the same account**
   - Repro: claim a fresh key (separate from tenant key) → `t3n whoami --api-key <new key>`
     still returns the *tenant* DID — testnet DID is bound to the sandbox account, not the key.
   - Workaround: mint the agent via the org path: `org create` → `agent create --org ... --name ...`
     which provisions a proper distinct agent DID + agent API key.
3. **Blockscout v2 removed `filter=to|from`** (HTTP 422 Invalid enum) — noted because
   the ADK Quickstart material elsewhere implies the older explorer behavior; our
   client omits the filter. (Minor, external to T3N — included for completeness.)

## Ease of maintenance / running post-challenge

- Stateless Node service; two runtime dependencies (`t3n-sdk`, `tsx`); no database;
  no explorer keys.
- Adding a chain = one entry in a map (`src/blockscout.ts`).
- Card updates: any key with `agent-cards` scope write access can re-run
  `t3n agent host-card`; no redeploy needed.
- **Decision: we want to continue running it.** Please include us in the startup
  program / listing page. Phase 2 (already scoped) moves report-hash attestation
  into a TEE contract so the digest is computed inside the enclave.

## Contact

- Telegram / email: <你的联系方式>
