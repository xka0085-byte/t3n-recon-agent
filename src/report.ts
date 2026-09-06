import { NormalizedTx, fmtEth, weiToEth } from "./blockscout.js";

export interface ReconOptions {
  address: string;
  chain: string;
  days: number;
}

export interface ReconReport {
  meta: {
    address: string;
    chain: string;
    window: { from: string; to: string };
    generatedAt: string;
    txScanned: number;
    txInWindow: number;
  };
  totals: {
    inflowEth: number;
    outflowEth: number;
    feesEth: number;
    netEth: number;
  };
  counterparties: { address: string; txCount: number; volumeEth: number; direction: "in" | "out" }[];
  daily: { date: string; count: number; inflowEth: number; outflowEth: number }[];
  largestTx: { hash: string; valueEth: number; direction: "in" | "out"; timestamp: string } | null;
  suspicious: {
    failedTxs: number;
    dustTxs: number;
    singleCounterpartyBurst: { address: string; count: number } | null;
  };
}

export function buildReport(txs: NormalizedTx[], opts: ReconOptions): ReconReport {
  const addr = opts.address.toLowerCase();
  const now = new Date();
  const windowStart = new Date(now.getTime() - opts.days * 24 * 3600 * 1000);

  const inWindow = txs.filter((t) => new Date(t.timestamp) >= windowStart);
  // fallback: if pagination didn't reach the window start, use what we have
  const scope = inWindow.length > 0 ? inWindow : txs;

  let inflow = 0n, outflow = 0n, fees = 0n, failed = 0, dust = 0;
  const cpMap = new Map<string, { count: number; volume: bigint; direction: "in" | "out" }>();
  const dayMap = new Map<string, { count: number; in: bigint; out: bigint }>();
  let largest: ReconReport["largestTx"] = null;

  const DUST_WEI = 10n ** 14n; // < 0.0001 ETH

  for (const t of scope) {
    const isFrom = t.from === addr;
    const cp = isFrom ? t.to : t.from;
    const direction: "in" | "out" = isFrom ? "out" : "in";

    fees += t.feeWei;
    if (t.status !== "ok" && t.status !== "success" && t.status !== "unknown") failed += 1;
    if (t.valueWei > 0n && t.valueWei < DUST_WEI) dust += 1;

    if (direction === "in") inflow += t.valueWei; else outflow += t.valueWei;

    if (cp) {
      const prev = cpMap.get(cp) ?? { count: 0, volume: 0n, direction };
      prev.count += 1;
      prev.volume += t.valueWei;
      cpMap.set(cp, prev);
    }

    const day = t.timestamp.slice(0, 10);
    const d = dayMap.get(day) ?? { count: 0, in: 0n, out: 0n };
    d.count += 1;
    if (direction === "in") d.in += t.valueWei; else d.out += t.valueWei;
    dayMap.set(day, d);

    if (!largest || t.valueWei > WEI_PLACEHOLDER(largest.valueEth)) {
      largest = {
        hash: t.hash,
        valueEth: weiToEth(t.valueWei),
        direction,
        timestamp: t.timestamp,
      };
    }
  }

  // burst detection: single counterparty with >= 8 txs in window
  let burst: ReconReport["suspicious"]["singleCounterpartyBurst"] = null;
  for (const [address, v] of cpMap) {
    if (v.count >= 8 && (!burst || v.count > burst.count)) burst = { address, count: v.count };
  }

  const counterparties = [...cpMap.entries()]
    .map(([address, v]) => ({
      address,
      txCount: v.count,
      volumeEth: weiToEth(v.volume),
      direction: v.direction,
    }))
    .sort((a, b) => b.txCount - a.txCount)
    .slice(0, 20);

  const daily = [...dayMap.entries()]
    .map(([date, v]) => ({ date, count: v.count, inflowEth: weiToEth(v.in), outflowEth: weiToEth(v.out) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    meta: {
      address: addr,
      chain: opts.chain,
      window: { from: windowStart.toISOString(), to: now.toISOString() },
      generatedAt: now.toISOString(),
      txScanned: txs.length,
      txInWindow: inWindow.length,
    },
    totals: {
      inflowEth: weiToEth(inflow),
      outflowEth: weiToEth(outflow),
      feesEth: weiToEth(fees),
      netEth: weiToEth(inflow - outflow),
    },
    counterparties,
    daily,
    largestTx: largest,
    suspicious: { failedTxs: failed, dustTxs: dust, singleCounterpartyBurst: burst },
  };
}

// helper: convert eth number back to wei-approx for comparison
function WEI_PLACEHOLDER(eth: number): bigint {
  return BigInt(Math.round(eth * 1e6)) * 10n ** 12n;
}

export function toMarkdown(r: ReconReport): string {
  const lines: string[] = [];
  lines.push(`# On-chain Reconciliation Report`);
  lines.push("");
  lines.push(`- **Address**: \`${r.meta.address}\``);
  lines.push(`- **Chain**: ${r.meta.chain}`);
  lines.push(`- **Window**: ${r.meta.window.from} → ${r.meta.window.to}`);
  lines.push(`- **Tx scanned / in-window**: ${r.meta.txScanned} / ${r.meta.txInWindow}`);
  lines.push(`- **Generated**: ${r.meta.generatedAt}`);
  lines.push("");
  lines.push(`## Totals`);
  lines.push("");
  lines.push(`| Metric | ETH |`);
  lines.push(`|---|---|`);
  lines.push(`| Inflow | ${r.totals.inflowEth.toFixed(6)} |`);
  lines.push(`| Outflow | ${r.totals.outflowEth.toFixed(6)} |`);
  lines.push(`| Fees paid | ${r.totals.feesEth.toFixed(6)} |`);
  lines.push(`| Net | ${r.totals.netEth.toFixed(6)} |`);
  lines.push("");
  lines.push(`## Daily activity`);
  lines.push("");
  lines.push(`| Date | Txs | Inflow | Outflow |`);
  lines.push(`|---|---|---|---|`);
  for (const d of r.daily) {
    lines.push(`| ${d.date} | ${d.count} | ${d.inflowEth.toFixed(6)} | ${d.outflowEth.toFixed(6)} |`);
  }
  lines.push("");
  lines.push(`## Top counterparties`);
  lines.push("");
  lines.push(`| Address | Txs | Volume (ETH) | Direction |`);
  lines.push(`|---|---|---|---|`);
  for (const c of r.counterparties) {
    lines.push(`| \`${c.address}\` | ${c.txCount} | ${c.volumeEth.toFixed(6)} | ${c.direction} |`);
  }
  lines.push("");
  lines.push(`## Flags`);
  lines.push("");
  lines.push(`- Failed txs: ${r.suspicious.failedTxs}`);
  lines.push(`- Dust txs (<0.0001 ETH): ${r.suspicious.dustTxs}`);
  if (r.suspicious.singleCounterpartyBurst) {
    lines.push(`- ⚠ Burst: ${r.suspicious.singleCounterpartyBurst.count} txs with \`${r.suspicious.singleCounterpartyBurst.address}\``);
  }
  return lines.join("\n");
}

export { fmtEth };
