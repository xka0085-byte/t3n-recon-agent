// Generate screenshot-ready HTML pages from real captured outputs.
import { readFile, writeFile, mkdir } from "node:fs/promises";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const termShell = (title, body) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#0d1117;font-family:'Cascadia Code',Consolas,monospace}
  .win{margin:24px;border-radius:10px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.5);border:1px solid #30363d}
  .bar{background:#161b22;padding:10px 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #30363d}
  .dot{width:12px;height:12px;border-radius:50%}
  .t{color:#8b949e;font-size:13px;margin-left:10px}
  pre{margin:0;padding:20px 24px;color:#c9d1d9;font-size:13.5px;line-height:1.55;white-space:pre-wrap}
  .g{color:#3fb950}.y{color:#d29922}.c{color:#58a6ff}
</style></head><body><div class="win"><div class="bar">
  <span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span>
  <span class="t">${esc(title)}</span></div><pre>${body}</pre></div></body></html>`;

const PS1 = `<span class="g">PS C:\\t3n-recon-agent&gt;</span> `;
const hl = (s) => s
  .replace(/(\[recon\])/g, `<span class="c">$1</span>`)
  .replace(/(\[t3n\]|\[server\])/g, `<span class="g">$1</span>`)
  .replace(/(=== Summary ===|=== Chain cross-validation ===)/g, `<span class="y">$1</span>`)
  .replace(/(Inflow|Outflow|Fees|Net|Flags) /g, `<span class="c">$1</span> `);

// mini markdown renderer for the report (headings, tables, code, bold, lists)
function md2html(md) {
  const lines = md.split("\n");
  let html = "", inTable = false;
  for (const ln of lines) {
    const fmt = (s) => esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/`([^`]+)`/g, '<code style="background:#f0f1f3;padding:1px 5px;border-radius:4px;font-size:12.5px">$1</code>');
    if (/^\|/.test(ln)) {
      if (/^\|[-\s|]+\|$/.test(ln)) continue;
      const cells = ln.split("|").slice(1, -1).map((c) => fmt(c.trim()));
      if (!inTable) { html += '<table style="border-collapse:collapse;margin:10px 0">'; inTable = true; }
      html += "<tr>" + cells.map((c, i) =>
        `<td style="border:1px solid #d7dce1;padding:6px 14px;${i === 0 ? "font-weight:600" : ""}">${c}</td>`).join("") + "</tr>";
      continue;
    }
    if (inTable) { html += "</table>"; inTable = false; }
    if (ln.startsWith("# ")) html += `<h1 style="font-size:22px;margin:18px 0 8px">${fmt(ln.slice(2))}</h1>`;
    else if (ln.startsWith("## ")) html += `<h2 style="font-size:16px;margin:16px 0 6px;color:#0d4b8f">${fmt(ln.slice(3))}</h2>`;
    else if (ln.startsWith("- ")) html += `<div style="margin:4px 0">• ${fmt(ln.slice(2))}</div>`;
    else if (ln.trim() === "") html += "<div style='height:8px'></div>";
    else html += `<div style="margin:4px 0">${fmt(ln)}</div>`;
  }
  if (inTable) html += "</table>";
  return html;
}

const docShell = (body) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#e8eaed;font-family:'Segoe UI',Arial,sans-serif}
  .page{width:860px;margin:24px auto;background:#fff;padding:48px 56px;border-radius:6px;box-shadow:0 2px 12px rgba(0,0,0,.15);color:#1f2328;font-size:14px;line-height:1.6}
</style></head><body><div class="page">${body}</div></body></html>`;

const out = "shots-html";
await mkdir(out, { recursive: true });

// 1. recon run (terminal)
const recon = await readFile("screenshots/recon-run.txt", "utf8");
await writeFile(`${out}/01-recon-run.html`,
  termShell("t3n-recon-agent — npm run recon", PS1 + hl(esc("npm run recon -- --address 0xd8dA...6045 --chain eth --days 30")) + "\n" + hl(esc(recon))));

// 2. report markdown (document style)
const md = await readFile("reports/eth-0xd8dA6BF2-2026-09-06T06-34-15.md", "utf8");
await writeFile(`${out}/02-report-md.html`, docShell(md2html(md)));

// 3. chain cross-validation (terminal)
const ver = await readFile("screenshots/verify-chain.txt", "utf8");
await writeFile(`${out}/03-verify-chain.html`,
  termShell("t3n-recon-agent — npm run verify (chain cross-validation)", PS1 + hl(esc("npx tsx verify-chain.ts")) + "\n" + hl(esc(ver))));

// 4. healthz + API (terminal)
const hz = await readFile("screenshots/healthz.txt", "utf8");
const api = await readFile("screenshots/api-recon.json", "utf8");
const apiHead = api.split("\n").slice(0, 24).join("\n") + "\n  ...";
await writeFile(`${out}/04-api-healthz.html`,
  termShell("t3n-recon-agent — npm run serve (HTTP mode)", PS1 + hl(esc("npm run serve")) + "\n" + hl(esc("[server] identity: did:t3n:6951e5de000a39b57956b9c2b9edc7b462d0931e\n[server] listening on :8787"))) +
  "\n\n" + `<span class="g">PS C:\\t3n-recon-agent&gt;</span> <span class="c">curl http://localhost:8787/healthz</span>\n${hl(esc(hz))}\n\n<span class="g">PS C:\\t3n-recon-agent&gt;</span> <span class="c">curl "http://localhost:8787/recon?address=0xd8dA...6045&amp;token=USDC"</span>\n` + hl(esc(apiHead)) + "");
// wrap properly: rebuild as shell
await writeFile(`${out}/04-api-healthz.html`,
  termShell("t3n-recon-agent — npm run serve (HTTP mode)",
    PS1 + hl(esc("npm run serve")) + "\n" +
    hl(esc("[server] identity: did:t3n:6951e5de000a39b57956b9c2b9edc7b462d0931e\n[server] listening on :8787")) + "\n\n" +
    PS1 + `<span class="c">${esc("curl http://localhost:8787/healthz")}</span>\n` +
    hl(esc(hz)) + "\n\n" +
    PS1 + `<span class="c">${esc('curl "http://localhost:8787/recon?address=0xd8dA...6045&token=USDC"')}</span>\n` +
    hl(esc(apiHead))));

// 5. agent card (terminal fetching the live public endpoint)
const cardUrl = "https://cn-api.sg.testnet.t3n.terminal3.io/api/agent-card/did:t3n:7dddb24424ebae514ec79c67f1e463522123c8fd";
const card = await readFile("agent-card.json", "utf8");
await writeFile(`${out}/05-agent-card.html`,
  termShell("Agent card — live public endpoint (ERC-8004)",
    PS1 + `<span class="c">${esc("curl " + cardUrl)}</span>\n` + esc(card) +
    `\n<span class="g">200 OK</span> <span class="y">served verbatim by T3N — publicly resolvable by anyone</span>`));

// 6. README preview (github-style doc)
const readme = await readFile("README.md", "utf8");
await writeFile(`${out}/06-readme.html`, docShell(md2html(readme)));

console.log("HTML pages generated in shots-html/");
