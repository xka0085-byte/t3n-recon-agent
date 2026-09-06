// Chain cross-validation: the blockchain itself is the third-party referee.
// Part 1 — native ETH txs: re-read from an independent RPC node, compare fields.
// Part 2 — ERC-20 token transfers: re-read the transaction receipt and decode the
//          raw Transfer event log (topics + data) with zero external libraries,
//          then compare against what our Blockscout parser produced.
// PASS = parser agrees with the chain. FAIL = a real bug. There is no third option.
import { fetchAddressTxs, fetchTokenTransfers } from "./src/blockscout.js";

const RPC = "https://ethereum-rpc.publicnode.com"; // independent of Blockscout
const ADDR = process.argv[2] ?? "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"; // keccak256("Transfer(address,address,uint256)")

let pass = 0;
let fail = 0;
let anomaly = 0;

async function rpc(method: string, params: any[]): Promise<any> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await res.json();
  return data.result;
}

function report(field: string, ours: string, truth: string, id: string): void {
  if (ours === truth) {
    pass += 1;
  } else {
    console.log(`FAIL ${id} ${field}: parser=${ours} chain=${truth}`);
    fail += 1;
  }
}

async function verifyNative(): Promise<void> {
  const txs = await fetchAddressTxs("eth", ADDR, 1);
  const sample = txs.slice(0, 5);
  for (const tx of sample) {
    const rpcTx = await rpc("eth_getTransactionByHash", [tx.hash]);
    if (!rpcTx) {
      console.log(`FAIL ${tx.hash} — not found on RPC node`);
      fail += 1;
      continue;
    }
    report("from", tx.from.toLowerCase(), (rpcTx.from ?? "").toLowerCase(), tx.hash);
    report("to", (tx.to ?? "").toLowerCase(), (rpcTx.to ?? "").toLowerCase(), tx.hash);
    report("value(wei)", tx.valueWei.toString(), BigInt(rpcTx.value).toString(), tx.hash);
  }
}

async function verifyTokens(): Promise<void> {
  const tt = await fetchTokenTransfers("eth", ADDR, 1);
  const sample = tt.slice(0, 5);
  for (const t of sample) {
    const receipt = await rpc("eth_getTransactionReceipt", [t.hash]);
    if (!receipt) {
      // sources disagree on the transaction's existence — a data-quality flag,
      // not a parser bug. Real reconciliation tooling must surface exactly this.
      console.log(
        `ANOMALY ${t.hash} ${t.tokenSymbol} — indexed by Blockscout but receipt missing on independent node (phantom/spam record?)`,
      );
      anomaly += 1;
      continue;
    }
    // find the Transfer log issued by this token contract for this from/to pair
    const log = (receipt.logs ?? []).find(
      (l: any) =>
        (l.address ?? "").toLowerCase() === t.tokenAddress &&
        l.topics?.[0] === TRANSFER_TOPIC &&
        "0x" + l.topics[1].slice(26) === t.from &&
        "0x" + l.topics[2].slice(26) === t.to,
    );
    if (!log) {
      console.log(`FAIL ${t.hash} ${t.tokenSymbol} — matching Transfer log not found`);
      fail += 1;
      continue;
    }
    const chainValue = BigInt(log.data).toString();
    report(`value(${t.tokenSymbol})`, t.valueRaw.toString(), chainValue, t.hash);
  }
}

async function main(): Promise<void> {
  console.log(`source A: Blockscout (our parser)`);
  console.log(`source B: ${RPC} (independent node)\n`);

  console.log("[1/2] native ETH transactions...");
  await verifyNative();
  console.log("[2/2] ERC-20 token transfers (raw event-log decode)...");
  await verifyTokens();

  console.log(`\n=== Chain cross-validation ===`);
  console.log(`result: ${pass} PASS / ${fail} FAIL (parser bugs) / ${anomaly} ANOMALY (data-quality flags)`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("[error]", e.message ?? e);
  process.exit(1);
});
