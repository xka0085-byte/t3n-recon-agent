// Blockscout v2 public API client — no API key required.
// Docs: https://docs.blockscout.com/api-reference

const CHAINS: Record<string, string> = {
  eth: "https://eth.blockscout.com",
  base: "https://base.blockscout.com",
  arbitrum: "https://arbitrum.blockscout.com",
  optimism: "https://optimism.blockscout.com",
};

export interface NormalizedTx {
  hash: string;
  timestamp: string; // ISO
  from: string;
  to: string | null;
  valueWei: bigint;
  feeWei: bigint;
  status: string;
}

const WEI = 10n ** 18n;

export function weiToEth(wei: bigint): number {
  return Number(wei) / Number(WEI);
}

export function fmtEth(wei: bigint): string {
  // 6 decimals — enough for reconciliation display
  return (Number(wei) / Number(WEI)).toFixed(6);
}

export function getChainRpc(chain: string): string {
  const base = CHAINS[chain];
  if (!base) throw new Error(`Unsupported chain: ${chain}. Supported: ${Object.keys(CHAINS).join(", ")}`);
  return base;
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Blockscout HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}

function normalize(item: any): NormalizedTx {
  const feeRaw = typeof item.fee === "object" && item.fee !== null ? item.fee.value : item.fee;
  return {
    hash: item.hash,
    timestamp: item.timestamp,
    from: (item.from?.hash ?? "").toLowerCase(),
    to: item.to?.hash ? item.to.hash.toLowerCase() : null,
    valueWei: BigInt(item.value ?? "0"),
    feeWei: BigInt(feeRaw ?? "0"),
    status: item.status ?? "unknown",
  };
}

/**
 * Fetch recent transactions of an address (both directions), following
 * Blockscout pagination up to `maxPages` pages.
 */
export async function fetchAddressTxs(
  chain: string,
  address: string,
  maxPages = 5,
): Promise<NormalizedTx[]> {
  const base = getChainRpc(chain);
  const addr = address.toLowerCase();
  const txs: NormalizedTx[] = [];

  let url: string | null =
    `${base}/api/v2/addresses/${addr}/transactions`;

  for (let page = 0; page < maxPages && url; page++) {
    const data = await getJson(url);
    const items: any[] = data.items ?? [];
    for (const it of items) txs.push(normalize(it));
    // next_page_params is a query-param object, not a URL
    const nxp = data.next_page_params;
    if (!nxp) break;
    const qs = new URLSearchParams(
      Object.entries(nxp).map(([k, v]) => [k, String(v)]),
    ).toString();
    url = `${base}/api/v2/addresses/${addr}/transactions?${qs}`;
  }

  return txs;
}

export { WEI };
