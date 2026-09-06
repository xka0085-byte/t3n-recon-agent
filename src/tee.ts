/**
 * Phase B v2 — attestation via the z-tenant-recon TEE contract.
 *
 * The report digest is computed INSIDE the T3N enclave by the registered
 * contract (z:<tid>:recon, contract_id from T3N_RECON_CONTRACT_ID), not in
 * Node. The digest is recorded in the tenant KV map `z:<tid>:attestations`
 * and pinned into the KV transaction claims (Merkle leaf) via
 * set-claims-digest — audit receipts are offline-verifiable against the
 * T3N Merkle root.
 *
 * Fallback: if the contract call fails, callers may fall back to node-side
 * hashing (v1 behaviour) but MUST mark the attestation as `engine: "node"`.
 */
import {
  getContractVersion,
  getNodeUrl,
} from "@terminal3/t3n-sdk";
import type { T3nClient } from "@terminal3/t3n-sdk";

export const CONTRACT_TAIL = "recon";

export interface AttestInput {
  reportId: string;
  /** Canonical report text — hashed inside the enclave. */
  canonical: string;
  agentDid: string;
  generatedAt: string;
}

export interface TeeAttestation {
  engine: "tee-contract";
  contract: string;
  contractVersion: string;
  digest: string;
  map: string;
  key: string;
  tenantDid: string;
  agentDid: string;
  generatedAt: string;
  idempotent: boolean;
}

/** Build the canonical `z:<tid>:<tail>` name from a tenant DID. */
export function contractName(tenantDid: string): string {
  return `z:${tenantDid.slice("did:t3n:".length)}:${CONTRACT_TAIL}`;
}

/**
 * Attest a report through the TEE contract. Throws on contract error —
 * callers decide whether to fall back to node-side hashing.
 */
export async function attestViaContract(
  client: T3nClient,
  tenantDid: string,
  input: AttestInput,
): Promise<TeeAttestation> {
  const contract = contractName(tenantDid);
  const contractVersion = await getContractVersion(getNodeUrl(), contract);

  const result = (await client.executeAndDecode({
    contract_id: contract,
    contract_version: contractVersion,
    function_name: "attest-report",
    input: {
      report_id: input.reportId,
      canonical: input.canonical,
      agent_did: input.agentDid,
      generated_at: input.generatedAt,
    },
  })) as {
    digest: string;
    map: string;
    key: string;
    tenant_did: string;
    idempotent?: boolean;
  };

  return {
    engine: "tee-contract",
    contract,
    contractVersion,
    digest: result.digest,
    map: result.map,
    key: result.key,
    tenantDid: result.tenant_did,
    agentDid: input.agentDid,
    generatedAt: input.generatedAt,
    idempotent: result.idempotent === true,
  };
}
