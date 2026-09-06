// Push local files to GitHub via Contents API (bypasses git TLS issues on this network).
const TOKEN = process.env.GITHUB_TOKEN;
const OWNER = "xka0085-byte";
const REPO = "t3n-recon-agent";
const BRANCH = "main";

const files = [
  ".gitignore",
  ".env.example",
  "README.md",
  "agent-card.json",
  "auth-test.ts",
  "quickstart.ts",
  "package.json",
  "src/blockscout.ts",
  "src/report.ts",
  "src/t3n.ts",
  "src/index.ts",
  "src/server.ts",
  "tsconfig.json",
  "test/report.test.ts",
  "test/report-edge.test.ts",
  "test/server.test.ts",
  "verify-chain.ts",
  "debug-tx.ts",
  "submission-doc-draft.md",
  "reports/eth-0xd8dA6BF2-2026-09-06T06-34-15.md",
  "reports/eth-0xd8dA6BF2-2026-09-06T06-34-15.csv",
  "reports/eth-0xd8dA6BF2-2026-09-06T06-34-15.attestation.json",
];

const api = (path) => `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json",
  "User-Agent": "recon-push",
};

async function putFile(path, content) {
  let sha;
  const get = await fetch(api(path) + `?ref=${BRANCH}`, { headers });
  if (get.status === 200) sha = (await get.json()).sha;

  const res = await fetch(api(path), {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: `feat: add ${path}`,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${path}: HTTP ${res.status} — ${body.slice(0, 200)}`);
  }
  console.log(`ok: ${path}`);
}

for (const f of files) {
  const content = await (await import("node:fs/promises")).readFile(f, "utf8");
  await putFile(f, content);
}
console.log("ALL DONE");
