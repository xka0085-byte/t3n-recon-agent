# T3N Agent Build Challenge — Onchain Recon Agent Submission

**Agent DID**: did:t3n:7dddb24424ebae514ec79c67f1e463522123c8fd
**Public agent card (T3N-hosted, ERC-8004)**: https://cn-api.sg.testnet.t3n.terminal3.io/api/agent-card/did:t3n:7dddb24424ebae514ec79c67f1e463522123c8fd
**Organisation**: eidon-labs (did:t3n:5555cf087e069c94110388842f7b4cfb09c4b6a1)
**GitHub repo**: https://github.com/xka0085-byte/t3n-recon-agent
**Contact**: Email: xka0085@gmail.com

## What it does

1. Fetches EVM transaction history for any address from public Blockscout instances (Ethereum / Base / Arbitrum / Optimism — zero explorer API keys).
2. Reconciles native ETH and ERC-20/stablecoin flows (USDC, USDT, ...): per-asset inflow/outflow/net, top counterparties, daily activity, anomaly flags (failed txs, dust, single-counterparty bursts).
3. Exports Markdown (human), JSON (machine), and CSV for accounting import (fixed precision — no scientific notation; a real bug we caught and fixed).
4. Computes the report's SHA-256 hash and binds it to the authenticated T3N DID, producing a .attestation.json tamper-evident audit artifact for every report.
5. Runs as a hosted HTTP service (GET /recon?..., GET /healthz), identity-bound to a T3N DID at boot — deployable post-challenge as-is.

Why enterprises care: reconciliation output that is bound to a verifiable identity can be used for bookkeeping and audit without trusting the messenger.

## Verified run

（截图 01：终端运行 npm run recon，粘贴在这里）

- Command: npm run recon -- --address 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --chain eth --days 30
- Result: 150 txs scanned, report + CSV + attestation written

（截图 02：对账报告，粘贴在这里）

（截图 04：HTTP 服务 /healthz 与 /recon?token=USDC 输出，粘贴在这里）

## Verification (machine-checked, not asserted)

- Type check: npx tsc --noEmit (strict) — 0 errors
- Invariant tests: 17 tests, including mathematical identities hammered with ~900 randomly generated cases — 17/17 pass
- Chain cross-validation: sampled native txs AND ERC-20 transfers re-read from an independent public RPC node; token transfers verified by decoding raw Transfer event logs from receipts (zero web3 libraries). Result: 19 PASS / 0 parser bugs / 1 data-quality anomaly
- Dependencies: npm audit — 0 vulnerabilities

（截图 03：链上交叉验证输出，粘贴在这里）

The anomaly worth mentioning: we surfaced a phantom spam-airdrop record — indexed by Blockscout but missing on the independent node. Detecting exactly this kind of account-vs-chain mismatch is what reconciliation tooling is for.

## Agent card & on-chain identity

The agent is registered and publicly resolvable on T3N (ERC-8004 registration format). Anyone can fetch the card without a key:

（截图 05：agent card 公开端点，粘贴在这里）

Verified via: https://cn-api.sg.testnet.t3n.terminal3.io/api/agent-card/did:t3n:7dddb24424ebae514ec79c67f1e463522123c8fd

## Documentation quality

Full README with run instructions, project layout, identity table, and a "Verification" section where every claim is a reproducible command:

（截图 06：README，粘贴在这里）

（截图 07：GitHub 仓库实拍，粘贴在这里）

## Bugs found during the build (with reproduction + workaround)

1. SDK >= 5.3.0 incompatible with testnet trust manifest
   - Repro: fresh install of latest @terminal3/t3n-sdk, run the Quickstart verbatim → Error: Trust manifest at https://cn-api.sg.testnet.t3n.terminal3.io/api/trust-manifest is malformed.
   - The endpoint returns valid JSON (peer_ids / rtmr3_allowlist / signature, signed 2026-08-27); the SDK's parser expects a different shape. Independent confirmation in the Earn listing comments ("latest ADK version hasn't been compatible with testnet").
   - Workaround: pin @terminal3/t3n-sdk@5.2.0. Suggested fix: align the SDK's manifest schema with the testnet cluster or version the manifest format.

2. Agent identity cannot be minted from a second claim-page key on the same account
   - Repro: claim a fresh key (separate from tenant key) → t3n whoami --api-key <new key> still returns the tenant DID — testnet DID is bound to the sandbox account, not the key.
   - Workaround: mint the agent via the org path: org create → agent create --org ... --name ..., which provisions a proper distinct agent DID + agent API key.

3. Blockscout v2 removed filter=to|from (HTTP 422 Invalid enum) — our client omits the filter. (Minor, external to T3N — included for completeness.)

4. (Our own, caught by our verification suite) CSV amounts could leak scientific notation (1e-7) which breaks accounting imports — fixed with fixed-precision formatting; a regression test now guards it.

## Ease of maintenance / running post-challenge

- Stateless Node service; two runtime dependencies (@terminal3/t3n-sdk, tsx); no database; no explorer keys.
- Adding a chain = one entry in a map (src/blockscout.ts).
- Card updates: any key with agent-cards scope write access can re-run t3n agent host-card; no redeploy needed.
- Decision: we want to continue running it ourselves — please include us in the startup program & listing page. Phase 2 (already scoped) moves report-hash attestation into a TEE contract so the digest is computed inside the enclave.
