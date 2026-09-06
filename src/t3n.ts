import {
  T3nClient,
  setEnvironment,
  loadWasmComponent,
  eth_get_address,
  metamask_sign,
  createEthAuthInput,
  fetchTrustedManifest,
} from "@terminal3/t3n-sdk";

export interface T3nSession {
  client: T3nClient;
  did: string;
}

/**
 * Connect + authenticate a T3N session with the given env-var key.
 * envVarName: "T3N_API_KEY" (tenant) or "AGENT_KEY" (agent identity).
 */
export async function connectSession(envVarName: string): Promise<T3nSession> {
  const key = process.env[envVarName];
  if (!key) throw new Error(`${envVarName} missing in environment (.env)`);

  setEnvironment("testnet");
  const wasmComponent = await loadWasmComponent();
  const address = eth_get_address(key);

  const client = new T3nClient({
    trustAnchor: await fetchTrustedManifest("testnet"),
    wasmComponent,
    handlers: {
      EthSign: metamask_sign(address, undefined, key),
    },
  });

  await client.handshake();
  const did = await client.authenticate(createEthAuthInput(address));
  return { client, did: did.value };
}

export async function sha256Hex(data: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(data).digest("hex");
}
