/**
 * HTTP endpoint helpers — resolve an agent's endpoint from AgentRegistry
 * and notify it after onchain events (hire, handshake).
 */
import { ethers } from "ethers";
import { AGENT_REGISTRY_ABI } from "./contracts";

export const DEFAULT_REGISTRY_ADDRESS = "0xD5c2851B00090c92Ba7F4723FB548bb30C9B6865";

export interface EndpointNotifyResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * Reads an agent's public HTTP endpoint from AgentRegistry.
 * Returns an empty string if the agent is not registered or has no endpoint.
 */
export async function resolveEndpoint(
  agentAddress: string,
  provider: ethers.Provider,
  registryAddress = DEFAULT_REGISTRY_ADDRESS
): Promise<string> {
  const registry = new ethers.Contract(registryAddress, AGENT_REGISTRY_ABI, provider);
  const agentData = await registry.getAgent(agentAddress);
  return (agentData.endpoint as string) ?? "";
}

/**
 * POSTs a JSON payload to `${endpoint}${path}`.
 * Returns { ok, status } on success, { ok: false, error } on failure.
 * Never throws.
 */
export async function notifyEndpoint(
  endpoint: string,
  path: string,
  payload: Record<string, unknown>
): Promise<EndpointNotifyResult> {
  if (!endpoint) return { ok: false, error: "no endpoint" };
  try {
    const res = await fetch(`${endpoint}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Convenience: resolve an agent's endpoint then POST to /hire.
 */
export async function notifyHire(
  agentAddress: string,
  proposal: Record<string, unknown>,
  provider: ethers.Provider,
  registryAddress = DEFAULT_REGISTRY_ADDRESS
): Promise<EndpointNotifyResult> {
  const endpoint = await resolveEndpoint(agentAddress, provider, registryAddress);
  return notifyEndpoint(endpoint, "/hire", proposal);
}

/**
 * Convenience: resolve an agent's endpoint then POST to /handshake.
 */
export async function notifyHandshake(
  agentAddress: string,
  payload: Record<string, unknown>,
  provider: ethers.Provider,
  registryAddress = DEFAULT_REGISTRY_ADDRESS
): Promise<EndpointNotifyResult> {
  const endpoint = await resolveEndpoint(agentAddress, provider, registryAddress);
  return notifyEndpoint(endpoint, "/handshake", payload);
}

/**
 * Convenience: resolve an agent's endpoint then POST to /hire/accepted.
 */
export async function notifyHireAccepted(
  agentAddress: string,
  payload: Record<string, unknown>,
  provider: ethers.Provider,
  registryAddress = DEFAULT_REGISTRY_ADDRESS
): Promise<EndpointNotifyResult> {
  const endpoint = await resolveEndpoint(agentAddress, provider, registryAddress);
  return notifyEndpoint(endpoint, "/hire/accepted", payload);
}

/**
 * Convenience: resolve an agent's endpoint then POST to /delivery.
 */
export async function notifyDelivery(
  agentAddress: string,
  payload: Record<string, unknown>,
  provider: ethers.Provider,
  registryAddress = DEFAULT_REGISTRY_ADDRESS
): Promise<EndpointNotifyResult> {
  const endpoint = await resolveEndpoint(agentAddress, provider, registryAddress);
  return notifyEndpoint(endpoint, "/delivery", payload);
}

/**
 * Convenience: resolve an agent's endpoint then POST to /delivery/accepted.
 */
export async function notifyDeliveryAccepted(
  agentAddress: string,
  payload: Record<string, unknown>,
  provider: ethers.Provider,
  registryAddress = DEFAULT_REGISTRY_ADDRESS
): Promise<EndpointNotifyResult> {
  const endpoint = await resolveEndpoint(agentAddress, provider, registryAddress);
  return notifyEndpoint(endpoint, "/delivery/accepted", payload);
}

/**
 * Convenience: resolve an agent's endpoint then POST to /dispute.
 */
export async function notifyDispute(
  agentAddress: string,
  payload: Record<string, unknown>,
  provider: ethers.Provider,
  registryAddress = DEFAULT_REGISTRY_ADDRESS
): Promise<EndpointNotifyResult> {
  const endpoint = await resolveEndpoint(agentAddress, provider, registryAddress);
  return notifyEndpoint(endpoint, "/dispute", payload);
}

/**
 * Convenience: resolve an agent's endpoint then POST to /message.
 */
export async function notifyMessage(
  agentAddress: string,
  payload: Record<string, unknown>,
  provider: ethers.Provider,
  registryAddress = DEFAULT_REGISTRY_ADDRESS
): Promise<EndpointNotifyResult> {
  const endpoint = await resolveEndpoint(agentAddress, provider, registryAddress);
  return notifyEndpoint(endpoint, "/message", payload);
}
