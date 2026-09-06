/**
 * Phase B — deploy + smoke-test the z-tenant-recon TEE contract.
 *
 * Steps:
 *   1. Authenticate the tenant session (T3N_API_KEY).
 *   2. Register the compiled WASM under tail "recon" (z:<tid>:recon)
 *      — skipped when CONTRACT_VERSION is already registered.
 *   3. Create/ensure the attestations KV map, ACL-scoped to the contract id.
 *   4. Smoke test: attest-report (in-enclave SHA-256) → compare digest with a
 *      node-side SHA-256 → get-attestation → idempotency replay → tamper test.
 *
 * Run:  npm run tee   (tsx --env-file=.env scripts/tee-contract.ts)
 * Prereq: ../z-tenant-recon built with `cargo build --release --target wasm32-wasip2`.
 *
 * NOTE: re-registering a tail allocates a NEW contract id — record it! The
 * smoke test uses a fresh report id per run, so it is safe to re-run.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TenantClient,
  getContractVersion,
  getNodeUrl,
  type ContractRegisterResult,
} from "@terminal3/t3n-sdk";
import { connectSession } from "../src/t3n.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WASM_PATH = path.resolve(
  __dirname,
  "../../z-tenant-recon/target/wasm32-wasip2/release/z_tenant_recon.wasm",
);
const CONTRACT_TAIL = "recon";
const CONTRACT_VERSION = "0.1.1";
const SMOKE_ID = `smoke-${Date.now()}`;

const ts = () => new Date().toISOString();

async function main() {
  console.log(`[${ts()}] 1/5 authenticating tenant session…`);
  const { client, did: tenantDid } = await connectSession("T3N_API_KEY");
  console.log(`  tenant DID: ${tenantDid}`);
  const tenantId = tenantDid.slice("did:t3n:".length);
  const scriptName = `z:${tenantId}:${CONTRACT_TAIL}`;

  const tenant = new TenantClient({
    environment: "testnet",
    endpoint: getNodeUrl(),
    baseUrl: getNodeUrl(),
    t3n: client,
    tenantDid,
  });

  // ------------------------------------------------------------------
  let contractId: number;
  const currentVersion = await getContractVersion(getNodeUrl(), scriptName).catch(() => null);
  if (currentVersion === CONTRACT_VERSION) {
    console.log(`[${ts()}] 2/5 ${scriptName} already at v${CONTRACT_VERSION} — skipping registration`);
    contractId = Number(process.env.T3N_RECON_CONTRACT_ID ?? 0);
  } else {
    console.log(`[${ts()}] 2/5 reading + registering WASM…`);
    const wasmBytes = await readFile(WASM_PATH);
    console.log(`  wasm: ${WASM_PATH} (${(wasmBytes.length / 1024).toFixed(1)} KB)`);
    const reg: ContractRegisterResult = await tenant.contracts.register({
      tail: CONTRACT_TAIL,
      version: CONTRACT_VERSION,
      wasm: wasmBytes,
    });
    contractId = reg.contract_id;
    console.log(`  registered ${scriptName} v${CONTRACT_VERSION} as contract id ${contractId}`);
  }

  // ------------------------------------------------------------------
  console.log(`[${ts()}] 3/5 ensuring attestations map ACL → contract ${contractId}…`);
  try {
    await tenant.maps.create({
      tail: "attestations",
      visibility: "private",
      writers: { only: [contractId] },
      readers: { only: [contractId] },
    });
    console.log(`  map z:<tid>:attestations created`);
  } catch {
    // Map already exists (e.g. re-register at a new contract id) — repoint ACL.
    await tenant.maps.update("attestations", {
      writers: { only: [contractId] },
      readers: { only: [contractId] },
    });
    console.log(`  map existed — ACL updated to contract ${contractId}`);
  }

  // ------------------------------------------------------------------
  console.log(`[${ts()}] 4/5 smoke test: attest-report inside the enclave…`);
  const scriptVersion = await getContractVersion(getNodeUrl(), scriptName);

  const canonical = [
    "# Recon Report (smoke test)",
    `generated_at: ${new Date().toISOString()}`,
    "rows: 3 | matched: 3 | mismatched: 0",
  ].join("\n");
  const nodeDigest = createHash("sha256").update(canonical).digest("hex");

  const attest = await client.executeAndDecode({
    contract_id: scriptName,
    contract_version: scriptVersion,
    function_name: "attest-report",
    input: {
      report_id: SMOKE_ID,
      canonical,
      agent_did: process.env.AGENT_DID ?? "unknown",
      generated_at: new Date().toISOString(),
    },
  });

  console.log(`  enclave digest: ${attest.digest}`);
  console.log(`  node    digest: ${nodeDigest}`);
  if (attest.digest !== nodeDigest) {
    throw new Error("DIGEST MISMATCH — enclave and node disagree on SHA-256");
  }
  console.log("  ✓ enclave digest matches node digest");

  // Read back through the contract.
  const stored = await client.executeAndDecode({
    contract_id: scriptName,
    contract_version: scriptVersion,
    function_name: "get-attestation",
    input: { report_id: SMOKE_ID },
  });
  if (stored.digest !== nodeDigest) throw new Error("readback digest mismatch");
  console.log("  ✓ get-attestation readback OK");

  // Idempotent replay.
  const replay = await client.executeAndDecode({
    contract_id: scriptName,
    contract_version: scriptVersion,
    function_name: "attest-report",
    input: {
      report_id: SMOKE_ID,
      canonical,
      agent_did: process.env.AGENT_DID ?? "unknown",
      generated_at: new Date().toISOString(),
    },
  });
  if (replay.idempotent !== true) throw new Error("replay should be idempotent");
  console.log("  ✓ idempotent replay OK");

  // Tamper test: same id, different content must be rejected.
  let tamperRejected = false;
  try {
    await client.executeAndDecode({
      contract_id: scriptName,
      contract_version: scriptVersion,
      function_name: "attest-report",
      input: {
        report_id: SMOKE_ID,
        canonical: canonical + "\ntampered: true",
        agent_did: process.env.AGENT_DID ?? "unknown",
        generated_at: new Date().toISOString(),
      },
    });
  } catch (e) {
    tamperRejected = true;
    console.log(`  ✓ tamper rejected: ${(e as Error).message.slice(0, 90)}`);
  }
  if (!tamperRejected) throw new Error("tamper test FAILED — overwrite was allowed");

  // ------------------------------------------------------------------
  console.log(`[${ts()}] 5/5 done.`);
  console.log(`
NEXT STEPS:
  - contract_id ${contractId} (record it! re-registering allocates a new id)
  - switch src/index.ts attestation from node-side hash to contract call
  - run full recon + tests, then push v2 to GitHub`);
}

main().catch((e) => {
  console.error(`[${ts()}] FAILED:`, e);
  process.exit(1);
});
