// Debug: compare our Blockscout-parsed token transfer vs the raw RPC receipt log.
import { fetchTokenTransfers } from "./src/blockscout.js";

const RPC = "https://ethereum-rpc.publicnode.com";
const ADDR = process.argv[2] ?? "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const HASHES = process.argv.slice(3);

async function rpc(method: string, params: any[]): Promise<any> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await res.json()).result;
}

const tt = await fetchTokenTransfers("eth", ADDR, 1);
for (const t of tt.filter((x) => HASHES.includes(x.hash))) {
  console.log("--- parsed record ---");
  console.log(JSON.stringify(t, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  const receipt = await rpc("eth_getTransactionReceipt", [t.hash]);
  console.log("receipt found:", !!receipt);
  if (receipt) {
    for (const l of receipt.logs) {
      console.log("log addr:", l.address, "topic0:", l.topics[0]);
      if (l.topics?.[1]) console.log("  log from:", "0x" + l.topics[1].slice(26));
      if (l.topics?.[2]) console.log("  log to:  ", "0x" + l.topics[2].slice(26));
      if (l.data && l.data !== "0x") console.log("  log data:", BigInt(l.data).toString());
    }
  }
}
