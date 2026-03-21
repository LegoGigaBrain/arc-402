/**
 * Shared endpoint-notify helper for CLI commands.
 * Resolves an agent's registered HTTP endpoint from AgentRegistry
 * and POSTs lifecycle events after onchain transactions.
 */
import { ethers } from "ethers";
import { AGENT_REGISTRY_ABI } from "./abis";

export const DEFAULT_REGISTRY_ADDRESS = "0xD5c2851B00090c92Ba7F4723FB548bb30C9B6865";

/**
 * Reads an agent's public HTTP endpoint from AgentRegistry.
 * Returns empty string if not registered or no endpoint.
 */
export async function resolveAgentEndpoint(
  address: string,
  provider: ethers.Provider,
  registryAddress = DEFAULT_REGISTRY_ADDRESS
): Promise<string> {
  const registry = new ethers.Contract(registryAddress, AGENT_REGISTRY_ABI, provider);
  const agentData = await registry.getAgent(address);
  return (agentData.endpoint as string) ?? "";
}

/**
 * POSTs JSON payload to {endpoint}{path}. Returns true on success.
 * Never throws — logs a warning on failure.
 */
export async function notifyAgent(
  endpoint: string,
  path: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  if (!endpoint) return false;
  try {
    const res = await fetch(`${endpoint}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (err) {
    console.warn(`Warning: endpoint notify failed (${endpoint}${path}): ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
