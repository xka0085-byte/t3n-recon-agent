// HTTP service mode — makes the agent deployable/hostable, not just a CLI.
// GET /recon?address=0x...&chain=eth&days=30&token=USDC  → JSON report
// GET /healthz → { status: "ok", agent: <did or "unconfigured"> }
import { createServer, type Server } from "node:http";
import { fetchAddressTxs, fetchTokenTransfers } from "./blockscout.js";
import { buildReport } from "./report.js";
import { connectSession } from "./t3n.js";

export function startServer(port = 8787): Server {
  let agentDid: string | null = null;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", agent: agentDid ?? "unconfigured" }));
      return;
    }

    if (url.pathname !== "/recon") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    const address = url.searchParams.get("address") ?? "";
    const chain = url.searchParams.get("chain") ?? "eth";
    const days = parseInt(url.searchParams.get("days") ?? "30", 10);
    const token = url.searchParams.get("token") ?? undefined;

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid or missing ?address=0x..." }));
      return;
    }

    try {
      const [txs, tt] = await Promise.all([
        fetchAddressTxs(chain, address, 3),
        fetchTokenTransfers(chain, address, 3, token),
      ]);
      const report = buildReport(txs, { address, chain, days }, tt);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(report, null, 2));
    } catch (e: any) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e.message ?? String(e) }));
    }
  });

  // bind the service's identity to a T3N DID at boot (best-effort)
  const boot = async () => {
    try {
      const { did } = await connectSession("T3N_API_KEY");
      agentDid = did;
      console.log(`[server] identity: ${did}`);
    } catch (e: any) {
      console.warn(`[server] identity unavailable: ${e.message}`);
    }
    server.listen(port, () => console.log(`[server] listening on :${port}`));
  };
  void boot();
  return server;
}
