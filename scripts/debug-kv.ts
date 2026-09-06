/** Debug: probe KV state after attest — idempotent replay tells if the write landed. */
import {
  getContractVersion,
  getNodeUrl,
} from "@terminal3/t3n-sdk";
import { createHash } from "node:crypto";
import { connectSession } from "../src/t3n.js";

const ts = () => new Date().toISOString();
const scriptName = `z:${process.env.TENANT_DID_HEX}:recon`;

async function main() {
  const { client, did } = await connectSession("T3N_API_KEY");
  const tenantId = did.slice("did:t3n:".length);
  const script = `z:${tenantId}:recon`;
  const scriptVersion = await getContractVersion(getNodeUrl(), script);
  console.log(`script=${script} v${scriptVersion}`);

  const canonical = [
    "# Recon Report (smoke test)",
    `generated_at: ${new Date().toISOString()}`,
    "rows: 3 | matched: 3 | mismatched: 0",
  ].join("\n");
  // NOTE: canonical differs per run (timestamp) → new digest → NOT idempotent.
  // Use a FIXED canonical to test idempotency against the first smoke run.
  const fixed = "# Recon Report (smoke test)\nrows: 3 | matched: 3 | mismatched: 0";
  const fixedDigest = createHash("sha256").update(fixed).digest("hex");
  console.log(`fixed payload digest: ${fixedDigest}`);

  const payload = {
    report_id: "smoke-001",
    canonical: fixed,
    agent_did: process.env.AGENT_DID ?? "unknown",
    generated_at: "2026-09-06T00:00:00.000Z",
  };

  console.log(`[${ts()}] replay attest-report with fixed payload…`);
  const replay = await client.executeAndDecode({
    contract_id: script,
    contract_version: scriptVersion,
    function_name: "attest-report",
    input: payload,
  });
  console.log("replay result:", JSON.stringify(replay, null, 2));

  console.log(`[${ts()}] get-attestation…`);
  try {
    const got = await client.executeAndDecode({
      contract_id: script,
      contract_version: scriptVersion,
      function_name: "get-attestation",
      input: { report_id: "smoke-001" },
    });
    console.log("get result:", JSON.stringify(got, null, 2));
  } catch (e) {
    console.log("get FAILED:", (e as Error).message.slice(0, 200));
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
