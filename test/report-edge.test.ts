// Edge-case tests for the reconciliation engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, toCsv } from "../src/report.js";
import type { NormalizedTx, NormalizedTokenTransfer } from "../src/blockscout.js";

const ADDR_LOWER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ADDR_MIXED = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // checksummed-style
const OTHER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function tx(from: string, to: string, value: bigint, day: number): NormalizedTx {
  return {
    hash: `0x${Math.abs(day).toString(16).padStart(64, "0")}`,
    timestamp: new Date(Date.UTC(2026, 8, Math.min(28, Math.max(1, day)))).toISOString(),
    from,
    to,
    valueWei: value,
    feeWei: 1000n,
    status: "ok",
  };
}

test("checksummed (mixed-case) address is normalized — direction still correct", () => {
  const txs = [tx(ADDR_MIXED, OTHER, 5n, 10), tx(OTHER, ADDR_MIXED, 7n, 11)];
  const r = buildReport(txs, { address: ADDR_MIXED, chain: "eth", days: 365 });
  // outflow = the tx where mixed-case addr was sender = 5
  assert.equal(r.totals.outflowEth, 5e-18);
  assert.equal(r.totals.inflowEth, 7e-18);
  assert.equal(r.meta.address, ADDR_LOWER);
});

test("days=0 edge: no txs in a zero-day window falls back to scanned txs, never crashes", () => {
  const txs = [tx(OTHER, ADDR_LOWER, 1n, 1)];
  const r = buildReport(txs, { address: ADDR_LOWER, chain: "eth", days: 0 });
  assert.ok(r.totals.inflowEth >= 0);
  assert.ok(Number.isFinite(r.totals.netEth));
});

test("failed and non-standard status txs are counted as failed flags", () => {
  const ok = tx(OTHER, ADDR_LOWER, 1n, 1);
  const bad = { ...tx(OTHER, ADDR_LOWER, 2n, 2), status: "error" };
  const r = buildReport([ok, bad], { address: ADDR_LOWER, chain: "eth", days: 365 });
  assert.equal(r.suspicious.failedTxs, 1);
});

test("counterparty burst flag fires at >= 8 txs from one address", () => {
  const txs = Array.from({ length: 10 }, (_, i) =>
    tx(OTHER, ADDR_LOWER, BigInt(i + 1) * 10n ** 18n, i + 1),
  );
  const r = buildReport(txs, { address: ADDR_LOWER, chain: "eth", days: 365 });
  assert.ok(r.suspicious.singleCounterpartyBurst);
  assert.equal(r.suspicious.singleCounterpartyBurst!.count, 10);
});

test("CSV escaping: values containing commas/quotes are quoted correctly", () => {
  const r = buildReport([], { address: ADDR_LOWER, chain: "eth", days: 365 }, []);
  const tt: NormalizedTokenTransfer = {
    hash: "0x" + "1".repeat(64),
    timestamp: "2026-09-01T00:00:00Z",
    from: OTHER,
    to: ADDR_LOWER,
    tokenSymbol: 'WEIRD, "TOKEN"',
    tokenAddress: OTHER,
    decimals: 18,
    valueRaw: 1500000000000000000n,
    valueHuman: 1.5,
  };
  const r2 = buildReport([], { address: ADDR_LOWER, chain: "eth", days: 365 }, [tt]);
  const csv = toCsv(r2);
  const rows = csv.trim().split("\n");
  assert.equal(rows.length, 2); // header + 1 row
  assert.ok(rows[1].includes('"WEIRD, ""TOKEN"""'), "CSV escaping broken");
});

test("self-transfer (from == to == address) is counted as outflow, never as both", () => {
  const self = tx(ADDR_LOWER, ADDR_LOWER, 3n, 5);
  const r = buildReport([self], { address: ADDR_LOWER, chain: "eth", days: 365 });
  assert.equal(r.totals.outflowEth, 3e-18);
  assert.equal(r.totals.inflowEth, 0);
});
