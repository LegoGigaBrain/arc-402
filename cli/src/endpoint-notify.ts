/**
 * Shared endpoint-notify helper for CLI commands.
 * Resolves an agent's registered HTTP endpoint from AgentRegistry
 * and POSTs lifecycle events after onchain transactions.
 */
import { ethers } from "ethers";
import { AGENT_REGISTRY_ABI } from "./abis";
import * as dns from "dns/promises";

export const DEFAULT_REGISTRY_ADDRESS = "0xD5c2851B00090c92Ba7F4723FB548bb30C9B6865";

// ─── SSRF protection ──────────────────────────────────────────────────────────

const RFC1918_RANGES = [
  // 10.0.0.0/8
  (n: number) => (n >>> 24) === 10,
  // 172.16.0.0/12
  (n: number) => (n >>> 24) === 172 && ((n >>> 16) & 0xff) >= 16 && ((n >>> 16) & 0xff) <= 31,
  // 192.168.0.0/16
  (n: number) => (n >>> 24) === 192 && ((n >>> 16) & 0xff) === 168,
];

function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) | parseInt(octet, 10), 0) >>> 0;
}

function isPrivateIp(ip: string): boolean {
  // IPv6 non-loopback — block (only allow ::1)
  if (ip.includes(":")) {
    return ip !== "::1";
  }
  const n = ipToInt(ip);
  // Loopback 127.0.0.0/8
  if ((n >>> 24) === 127) return true;
  // Link-local 169.254.0.0/16 (includes AWS metadata 169.254.169.254)
  if ((n >>> 24) === 169 && ((n >>> 16) & 0xff) === 254) return true;
  return RFC1918_RANGES.some((fn) => fn(n));
}

/**
 * Validates that an endpoint URL is safe to connect to (SSRF protection).
 * Allows HTTPS (any host) and HTTP only for localhost/127.0.0.1.
 * Blocks RFC 1918, link-local, loopback non-localhost, and AWS metadata IPs.
 */
export async function validateEndpointUrl(endpoint: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error(`Invalid endpoint URL: ${endpoint}`);
  }

  const { protocol, hostname } = parsed;
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

  if (protocol !== "https:" && !(protocol === "http:" && isLocalhost)) {
    throw new Error(`Endpoint must use HTTPS (or HTTP for localhost). Got: ${endpoint}`);
  }

  // Resolve hostname and check resolved IPs
  if (!isLocalhost) {
    let addresses: string[];
    try {
      addresses = await dns.resolve(hostname);
    } catch {
      // If DNS fails, let the fetch fail naturally; don't block
      return;
    }
    for (const addr of addresses) {
      if (isPrivateIp(addr)) {
        throw new Error(`Endpoint resolves to a private/reserved IP (${addr}) — blocked for security`);
      }
    }
  }
}

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
 * Validates endpoint URL for SSRF before connecting.
 * If signingKey is provided, signs the payload and adds X-ARC402-Signature / X-ARC402-Signer headers.
 */
export async function notifyAgent(
  endpoint: string,
  path: string,
  payload: Record<string, unknown>,
  signingKey?: string
): Promise<boolean> {
  if (!endpoint) return false;
  try {
    await validateEndpointUrl(endpoint);
  } catch (err) {
    console.warn(`Warning: endpoint notify blocked (${endpoint}${path}): ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
  try {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (signingKey) {
      const wallet = new ethers.Wallet(signingKey);
      const signature = await wallet.signMessage(body);
      headers["X-ARC402-Signature"] = signature;
      headers["X-ARC402-Signer"] = wallet.address;
    }
    const res = await fetch(`${endpoint}${path}`, {
      method: "POST",
      headers,
      body,
    });
    return res.ok;
  } catch (err) {
    console.warn(`Warning: endpoint notify failed (${endpoint}${path}): ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
