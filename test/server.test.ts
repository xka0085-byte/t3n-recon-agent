// HTTP service tests: endpoints, error handling, identity binding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../src/server.js";

const PORT = 8899;
const BASE = `http://localhost:${PORT}`;
const server = startServer(PORT);

test("server: /healthz reports ok and carries identity when configured", async () => {
  await new Promise((r) => setTimeout(r, 800)); // allow boot

  const res = await fetch(`${BASE}/healthz`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
  // identity may be a DID (env configured) or "unconfigured" — both are valid strings
  assert.ok(typeof body.agent === "string" && body.agent.length > 0);
});

test("server: /recon returns a structurally valid report", async () => {
  const res = await fetch(
    `${BASE}/recon?address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045&chain=eth&days=7`,
  );
  assert.ok([200, 502].includes(res.status)); // 200 = data, 502 = upstream outage (honest failure)
  const body = await res.json();
  if (res.status === 200) {
    assert.ok(body.meta && body.totals && Array.isArray(body.tokens) && Array.isArray(body.ledger));
    assert.equal(body.meta.chain, "eth");
  } else {
    assert.ok(typeof body.error === "string");
  }
});

test("server: rejects invalid address with 400", async () => {
  const res = await fetch(`${BASE}/recon?address=notanaddress`);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.includes("address"));
});

test("server: unknown route returns 404", async () => {
  const res = await fetch(`${BASE}/nope`);
  assert.equal(res.status, 404);
});

test("close", () => {
  server.close();
});
