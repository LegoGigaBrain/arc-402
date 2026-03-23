export interface ProvisionRequest {
  subdomain: string;
  walletAddress: string;
  signature: string;
  timestamp: number;
}

export interface DeprovisionRequest {
  subdomain: string;
  walletAddress: string;
  signature: string;
  timestamp: number;
}

export interface TunnelInfo {
  tunnelId: string;
  name: string;
  walletAddress: string;
  subdomain: string;
}

export interface Env {
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  CF_ZONE_ID: string;
  RATE_LIMIT_KV?: KVNamespace;
  BASE_RPC_URL?: string;
  CLOUDFLARE_API_TOKEN?: string;  // Legacy binding name from old worker
  CLOUDFLARE_ZONE_ID?: string;    // Legacy binding name from old worker
}

export interface RegisterRequest {
  subdomain: string;
  walletAddress: string;
  tunnelTarget: string;
}

export interface TransferRequest {
  subdomain: string;
  newWalletAddress: string;
}

export interface CloudflareApiError {
  code: number;
  message: string;
}

export interface CloudflareApiResponse<T> {
  success: boolean;
  result: T;
  errors: CloudflareApiError[];
  messages: string[];
}

export interface TunnelResult {
  id: string;
  name: string;
  remote_config: boolean;
  token?: string;
}

export interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
}
