// Property-based tests: mathematical invariants over randomly generated data.
// These are not "AI asserts X" — they are identities that must hold for ANY input.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, toCsv, toMarkdown } from "../src/report.js";
import type { NormalizedTx, NormalizedTokenTransfer } from "../src/blockscout.js";

// deterministic PRNG so failures are reproducible
let seed = 20260906;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) % 2 ** 31;
  return seed / 2 ** 31;
}
function rndBig(max: bigint): bigint {
  return BigInt(Math.floor(rnd() * 1e9)) * (max / 10n ** 9n) + BigInt(Math.floor(rnd() * 1e9));
}

const ADDR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function genTx(i: number): NormalizedTx {
  const isFrom = rnd() > 0.5;
  const value = rndBig(10n ** 20n); // up to 100 ETH
  return {
    hash: `0x${i.toString(16).padStart(64, "0")}`,
    timestamp: new Date(Date.UTC(2026, 8, (i % 28) + 1)).toISOString(),
    from: isFrom ? ADDR : OTHER,
    to: isFrom ? OTHER : ADDR,
    valueWei: value,
    feeWei: rndBig(10n ** 15n),
    status: "ok",
  };
}

function genTT(i: number): NormalizedTokenTransfer {
  const isFrom = rnd() > 0.5;
  return {
    hash: `0x${(i + 1000).toString(16).padStart(64, "0")}`,
    timestamp: new Date(Date.UTC(2026, 8, (i % 28) + 1)).toISOString(),
    from: isFrom ? ADDR : OTHER,
    to: isFrom ? OTHER : ADDR,
    tokenSymbol: `T${i % 5}`,
    tokenAddress: `0x${(i % 5).toString(16).padStart(40, "c")}`,
    decimals: 18,
    valueRaw: rndBig(10n ** 22n),
    valueHuman: 0, // recomputed below
  };
}

test("invariant: net ≡ inflow − outflow (300 random cases)", () => {
  for (let k = 0; k < 300; k++) {
    const txs = Array.from({ length: 1 + Math.floor(rnd() * 50) }, (_, i) => genTx(i));
    const r = buildReport(txs, { address: ADDR, chain: "eth", days: 365 });
    assert.ok(
      Math.abs(r.totals.netEth - (r.totals.inflowEth - r.totals.outflowEth)) < 1e-9,
      `case ${k}: net != inflow - outflow`,
    );
  }
});

test("invariant: token net ≡ token inflow − outflow, per asset (300 random cases)", () => {
  for (let k = 0; k < 300; k++) {
    const tt = Array.from({ length: 1 + Math.floor(rnd() * 50) }, (_, i) => {
      const t = genTT(i);
      t.valueHuman = Number(t.valueRaw) / 10 ** t.decimals;
      return t;
    });
    const r = buildReport([], { address: ADDR, chain: "eth", days: 365 }, tt);
    for (const t of r.tokens) {
      assert.ok(
        Math.abs(t.net - (t.inflow - t.outflow)) < 1e-6,
        `case ${k} asset ${t.symbol}: net != in - out`,
      );
    }
  }
});

test("invariant: CSV ledger rows ≡ JSON ledger rows, and no scientific notation", () => {
  const tt = Array.from({ length: 80 }, (_, i) => {
    const t = genTT(i);
    t.valueHuman = Number(t.valueRaw) / 10 ** t.decimals;
    return t;
  });
  const r = buildReport([], { address: ADDR, chain: "eth", days: 365 }, tt);
  const csv = toCsv(r);
  const lines = csv.trim().split("\n").slice(1); // drop header
  assert.equal(lines.length, r.ledger.length, "CSV row count must equal ledger length");
  for (const line of lines) {
    const amount = line.split(",")[5];
    assert.ok(!/e/i.test(amount), `scientific notation leaked into CSV: ${amount}`);
  }
});

test("invariant: direction is correct — 'out' rows always have from == address", () => {
  for (let k = 0; k < 100; k++) {
    const txs = Array.from({ length: 20 }, (_, i) => genTx(i + k * 20));
    const r = buildReport(txs, { address: ADDR, chain: "eth", days: 365 });
    const outRows = r.ledger.filter((l) => l.direction === "out");
    for (const row of outRows) {
      assert.equal(row.counterparty !== ADDR, true);
    }
  }
});

test("invariant: markdown totals match JSON totals", () => {
  const txs = Array.from({ length: 30 }, (_, i) => genTx(i));
  const r = buildReport(txs, { address: ADDR, chain: "eth", days: 365 });
  const md = toMarkdown(r);
  const inflowLine = md.split("\n").find((l) => l.startsWith("| Inflow"))!;
  assert.ok(inflowLine.includes(r.totals.inflowEth.toFixed(6)), "markdown inflow mismatch");
});

test("boundary: empty inputs must not crash and must produce zero totals", () => {
  const r = buildReport([], { address: ADDR, chain: "eth", days: 30 }, []);
  assert.equal(r.totals.inflowEth, 0);
  assert.equal(r.totals.outflowEth, 0);
  assert.equal(r.totals.netEth, 0);
  assert.equal(r.ledger.length, 0);
});
