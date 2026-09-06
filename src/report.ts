import { NormalizedTx, NormalizedTokenTransfer, fmtEth, weiToEth } from "./blockscout.js";

export interface ReconOptions {
  address: string;
  chain: string;
  days: number;
}

export interface TokenSummary {
  symbol: string;
  tokenAddress: string;
  txCount: number;
  inflow: number;
  outflow: number;
  net: number;
  counterparties: number;
}

export interface LedgerRow {
  date: string;
  txHash: string;
  direction: "in" | "out";
  counterparty: string;
  asset: string;
  amount: number;
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
  tokens: TokenSummary[];
  ledger: LedgerRow[];
  suspicious: {
    failedTxs: number;
    dustTxs: number;
    singleCounterpartyBurst: { address: string; count: number } | null;
  };
}

export function buildReport(
  txsRaw: NormalizedTx[],
  opts: ReconOptions,
  tokenTransfersRaw: NormalizedTokenTransfer[] = [],
): ReconReport {
  // defensive normalization — never trust the caller to pre-lowercase addresses
  const txs = txsRaw.map((t) => ({
    ...t,
    from: t.from.toLowerCase(),
    to: t.to ? t.to.toLowerCase() : null,
  }));
  const tokenTransfers = tokenTransfersRaw.map((t) => ({
    ...t,
    from: t.from.toLowerCase(),
    to: t.to.toLowerCase(),
  }));
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

  // ---- token (ERC-20/stablecoin) reconciliation ----
  const tokMap = new Map<
    string,
    TokenSummary & { in: number; out: number; cps: Set<string> }
  >();
  const ledger: LedgerRow[] = [];
  for (const t of tokenTransfers) {
    if (new Date(t.timestamp) < windowStart) continue;
    const isFrom = t.from === addr;
    const direction: "in" | "out" = isFrom ? "out" : "in";
    const cp = isFrom ? t.to : t.from;
    const key = `${t.tokenSymbol}|${t.tokenAddress}`;
    const s =
      tokMap.get(key) ??
      {
        symbol: t.tokenSymbol,
        tokenAddress: t.tokenAddress,
        txCount: 0,
        inflow: 0,
        outflow: 0,
        net: 0,
        counterparties: 0,
        in: 0,
        out: 0,
        cps: new Set<string>(),
      };
    s.txCount += 1;
    if (direction === "in") s.in += t.valueHuman; else s.out += t.valueHuman;
    if (cp) s.cps.add(cp);
    tokMap.set(key, s);
    ledger.push({
      date: t.timestamp.slice(0, 10),
      txHash: t.hash,
      direction,
      counterparty: cp,
      asset: t.tokenSymbol,
      // fixed precision — never emit scientific notation into accounting CSVs
      amount: Number(t.valueHuman.toFixed(8)),
    });
  }
  const tokens: TokenSummary[] = [...tokMap.values()]
    .map(({ in: i, out: o, cps, ...rest }) => ({
      ...rest,
      counterparties: cps.size,
      inflow: i,
      outflow: o,
      net: i - o,
    }))
    .sort((a, b) => b.txCount - a.txCount);
  ledger.sort((a, b) => a.date.localeCompare(b.date));

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
    tokens,
    ledger,
    suspicious: { failedTxs: failed, dustTxs: dust, singleCounterpartyBurst: burst },
  };
}

/** Accounting-friendly CSV: one row per token transfer, ISO dates, no thousands separators. */
export function toCsv(r: ReconReport): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [
    "date,tx_hash,direction,counterparty,asset,amount",
    ...r.ledger.map((l) =>
      [l.date, l.txHash, l.direction, l.counterparty, l.asset, l.amount].map(esc).join(","),
    ),
  ];
  return rows.join("\n");
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
  lines.push(`## Token transfers (stablecoins / ERC-20)`);
  lines.push("");
  if (r.tokens.length === 0) {
    lines.push("_None in window._");
  } else {
    lines.push(`| Asset | Txs | Inflow | Outflow | Net | Counterparties |`);
    lines.push(`|---|---|---|---|---|---|`);
    for (const t of r.tokens) {
      lines.push(
        `| ${t.symbol} | ${t.txCount} | ${t.inflow.toFixed(2)} | ${t.outflow.toFixed(2)} | ${t.net.toFixed(2)} | ${t.counterparties} |`,
      );
    }
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
