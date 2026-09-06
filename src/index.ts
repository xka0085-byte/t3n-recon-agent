import { mkdirSync, writeFileSync } from "node:fs";
import { fetchAddressTxs } from "./blockscout.js";
import { buildReport, toMarkdown } from "./report.js";
import { connectSession, sha256Hex } from "./t3n.js";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
}

async function main() {
  const address = arg("address");
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    console.error("Usage: npm run recon -- --address 0x... [--chain eth] [--days 30] [--pages 5]");
    process.exit(1);
  }
  const chain = arg("chain", "eth")!;
  const days = parseInt(arg("days", "30")!, 10);
  const pages = parseInt(arg("pages", "5")!, 10);

  console.log(`[recon] fetching ${chain} txs for ${address} (up to ${pages} pages)...`);
  const txs = await fetchAddressTxs(chain, address, pages);
  console.log(`[recon] got ${txs.length} txs`);

  const report = buildReport(txs, { address, chain, days });
  const markdown = toMarkdown(report);

  mkdirSync("reports", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = `reports/${chain}-${address.slice(0, 10)}-${stamp}`;
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${base}.md`, markdown);
  console.log(`[recon] report saved: ${base}.json / ${base}.md`);

  // T3N audit trail: bind report hash to our authenticated DID.
  // Phase B will move this attestation into a TEE contract.
  if (process.env.T3N_API_KEY) {
    try {
      const { did } = await connectSession("T3N_API_KEY");
      const reportHash = await sha256Hex(JSON.stringify(report));
      const attestation = {
        did,
        reportHash: `sha256:${reportHash}`,
        chain,
        address,
        generatedAt: report.meta.generatedAt,
      };
      writeFileSync(`${base}.attestation.json`, JSON.stringify(attestation, null, 2));
      console.log(`[t3n] attestation written: ${base}.attestation.json`);
      console.log(`[t3n] signed-in identity: ${did}`);
    } catch (e: any) {
      console.warn(`[t3n] attestation skipped: ${e.message}`);
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
