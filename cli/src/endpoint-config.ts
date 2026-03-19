import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const ARC402_DIR = path.join(os.homedir(), ".arc402");
export const ENDPOINT_CONFIG_PATH = path.join(ARC402_DIR, "endpoint.json");
export const DEFAULT_LOCAL_INGRESS_TARGET = "http://127.0.0.1:4402";
export const DEFAULT_TUNNEL_MODE = "host-cloudflared" as const;

export interface EndpointConfig {
  version: 1;
  agentName: string;
  hostname: string;
  publicUrl: string;
  localIngressTarget: string;
  tunnelMode: "host-cloudflared";
  tunnelTarget?: string;
  walletAddress?: string;
  subdomainApi?: string;
  notes?: string;
  claimedAt?: string;
  updatedAt: string;
}

export function endpointConfigExists(): boolean {
  return fs.existsSync(ENDPOINT_CONFIG_PATH);
}

export function loadEndpointConfig(): EndpointConfig | null {
  if (!endpointConfigExists()) return null;
  try {
    return JSON.parse(fs.readFileSync(ENDPOINT_CONFIG_PATH, "utf-8")) as EndpointConfig;
  } catch {
    return null;
  }
}

export function saveEndpointConfig(config: EndpointConfig): void {
  fs.mkdirSync(ARC402_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(ENDPOINT_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export function normalizeAgentName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export function buildHostname(agentName: string): string {
  return `${normalizeAgentName(agentName)}.arc402.xyz`;
}

export function buildPublicUrl(hostname: string): string {
  return `https://${hostname}`;
}

export function buildEndpointConfig(input: {
  agentName: string;
  localIngressTarget?: string;
  tunnelMode?: "host-cloudflared";
  tunnelTarget?: string;
  walletAddress?: string;
  subdomainApi?: string;
  notes?: string;
  claimedAt?: string;
  existing?: EndpointConfig | null;
}): EndpointConfig {
  const normalizedName = normalizeAgentName(input.agentName);
  const hostname = buildHostname(normalizedName);
  const now = new Date().toISOString();
  return {
    version: 1,
    agentName: normalizedName,
    hostname,
    publicUrl: buildPublicUrl(hostname),
    localIngressTarget: input.localIngressTarget ?? input.existing?.localIngressTarget ?? DEFAULT_LOCAL_INGRESS_TARGET,
    tunnelMode: input.tunnelMode ?? input.existing?.tunnelMode ?? DEFAULT_TUNNEL_MODE,
    tunnelTarget: input.tunnelTarget ?? input.existing?.tunnelTarget,
    walletAddress: input.walletAddress ?? input.existing?.walletAddress,
    subdomainApi: input.subdomainApi ?? input.existing?.subdomainApi,
    notes: input.notes ?? input.existing?.notes,
    claimedAt: input.claimedAt ?? input.existing?.claimedAt,
    updatedAt: now,
  };
}
