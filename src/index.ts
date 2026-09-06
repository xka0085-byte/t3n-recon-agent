import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fetchAddressTxs, fetchTokenTransfers } from "./blockscout.js";
import { buildReport, toMarkdown, toCsv } from "./report.js";
import { startServer } from "./server.js";
import { connectSession } from "./t3n.js";
import { attestViaContract, type TeeAttestation } from "./tee.js";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  if (hasFlag("serve")) {
    startServer(parseInt(arg("port", "8787")!, 10));
    return; // server keeps the process alive
  }

  const address = arg("address");
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    console.error("Usage: npm run recon -- --address 0x... [--chain eth] [--days 30] [--pages 5]");
    process.exit(1);
  }
  const chain = arg("chain", "eth")!;
  const days = parseInt(arg("days", "30")!, 10);
  const pages = parseInt(arg("pages", "5")!, 10);

  console.log(`[recon] fetching ${chain} txs for ${address} (up to ${pages} pages)...`);
  const [txs, tt] = await Promise.all([
    fetchAddressTxs(chain, address, pages),
    fetchTokenTransfers(chain, address, Math.min(pages, 3), arg("token")),
  ]);
  console.log(`[recon] got ${txs.length} txs, ${tt.length} token transfers`);

  const report = buildReport(txs, { address, chain, days }, tt);
  const markdown = toMarkdown(report);

  mkdirSync("reports", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = `reports/${chain}-${address.slice(0, 10)}-${stamp}`;
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${base}.md`, markdown);
  writeFileSync(`${base}.csv`, toCsv(report));
  console.log(`[recon] report saved: ${base}.json / ${base}.md / ${base}.csv`);

  // --- T3N audit trail (Phase B v2) -------------------------------------
  // The report digest is computed INSIDE the T3N enclave by the
  // z-tenant-recon TEE contract, stored in tenant KV, and pinned to the
  // transaction's Merkle leaf — offline-verifiable audit receipts.
  // Fallback (marked engine:"node") keeps the tool usable if T3N is down.
  if (process.env.T3N_API_KEY) {
    try {
      const { client, did } = await connectSession("T3N_API_KEY");
      const reportId = `${chain}-${address.slice(0, 10)}-${stamp}`;
      const tee = await attestViaContract(client, did, {
        reportId,
        canonical: markdown,
        agentDid: process.env.AGENT_DID ?? did,
        generatedAt: report.meta.generatedAt,
      });
      const attestation: Record<string, unknown> = {
        engine: tee.engine,
        did: tee.tenantDid,
        agentDid: tee.agentDid,
        reportId: tee.map ? `${tee.map}/${tee.key}` : reportId,
        reportHash: `sha256:${tee.digest}`,
        contract: tee.contract,
        contractVersion: tee.contractVersion,
        idempotent: tee.idempotent,
        chain,
        address,
        generatedAt: report.meta.generatedAt,
      };
      writeFileSync(`${base}.attestation.json`, JSON.stringify(attestation, null, 2));
      console.log(`[t3n] TEE attestation written: ${base}.attestation.json`);
      console.log(`[t3n] enclave digest: sha256:${tee.digest}`);
      console.log(`[t3n] stored in ${tee.map} (${tee.key})${tee.idempotent ? " — idempotent replay" : ""}`);
    } catch (e: any) {
      // Fallback: node-side hash only, clearly marked as NOT enclave-attested.
      console.warn(`[t3n] TEE attestation failed (${e.message?.slice(0, 120)}) — falling back to node-side hash`);
      try {
        const reportHash = createHash("sha256").update(markdown).digest("hex");
        const fallback = {
          engine: "node-fallback",
          reportHash: `sha256:${reportHash}`,
          chain,
          address,
          generatedAt: report.meta.generatedAt,
        };
        writeFileSync(`${base}.attestation.json`, JSON.stringify(fallback, null, 2));
        console.log(`[t3n] fallback attestation written: ${base}.attestation.json`);
      } catch (e2: any) {
        console.warn(`[t3n] attestation skipped entirely: ${e2.message}`);
      }
    }
  }

  // console summary
  console.log("\n=== Summary ===");
  console.log(`Inflow : ${report.totals.inflowEth.toFixed(6)} ETH`);
  console.log(`Outflow: ${report.totals.outflowEth.toFixed(6)} ETH`);
  console.log(`Fees   : ${report.totals.feesEth.toFixed(6)} ETH`);
  console.log(`Net    : ${report.totals.netEth.toFixed(6)} ETH`);
  console.log(`Flags  : failed=${report.suspicious.failedTxs} dust=${report.suspicious.dustTxs}`);
}

main().catch((e) => {
  console.error("[error]", e.message ?? e);
  process.exit(1);
});
