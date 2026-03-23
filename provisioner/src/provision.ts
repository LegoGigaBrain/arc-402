import type { Env, ProvisionRequest } from './types';
import { verifySignature } from './auth';
import {
  createTunnel,
  getTunnelToken,
  configureTunnelIngress,
  createDnsCname,
  getDnsRecord,
  getTunnelByName,
} from './cloudflare-api';
import { jsonError, jsonResponse, validateSubdomain } from './utils';

const DOMAIN = 'arc402.xyz';

// In-memory rate limit: walletAddress -> list of provision timestamps
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT = 10; // max provisions
const RATE_WINDOW_MS = 60 * 60 * 1000; // per hour

function checkRateLimit(wallet: string): boolean {
  const now = Date.now();
  const times = (rateLimitMap.get(wallet) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (times.length >= RATE_LIMIT) return false;
  times.push(now);
  rateLimitMap.set(wallet, times);
  return true;
}

export async function handleProvision(request: Request, env: Env): Promise<Response> {
  let body: ProvisionRequest;
  try {
    body = (await request.json()) as ProvisionRequest;
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const { subdomain, walletAddress, signature, timestamp } = body;

  // Validate required fields
  if (!subdomain || !walletAddress || !signature || !timestamp) {
    return jsonError(400, 'Missing required fields: subdomain, walletAddress, signature, timestamp');
  }

  // Validate subdomain format
  const subdomainError = validateSubdomain(subdomain);
  if (subdomainError) return jsonError(400, subdomainError);

  // Validate timestamp (within 5 minutes)
  const nowSecs = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSecs - timestamp) > 300) {
    return jsonError(400, 'Timestamp is too old or too far in the future (max 5 minutes)');
  }

  // Verify EIP-191 signature
  if (!verifySignature(subdomain, timestamp, walletAddress, signature)) {
    return jsonError(401, 'Invalid signature');
  }

  // Rate limit check
  if (!checkRateLimit(walletAddress.toLowerCase())) {
    return jsonError(429, 'Rate limit exceeded: max 10 provisions per hour per wallet');
  }

  const fqdn = `${subdomain}.${DOMAIN}`;
  const tunnelName = `arc402-${subdomain}`;

  // Check if DNS record already exists
  const existingDns = await getDnsRecord(env.CF_API_TOKEN, env.CF_ZONE_ID, fqdn);
  if (existingDns) {
    // Check if same tunnel/wallet owns it
    const existingTunnel = await getTunnelByName(env.CF_API_TOKEN, env.CF_ACCOUNT_ID, tunnelName);
    if (existingTunnel) {
      return jsonError(409, 'subdomain already provisioned');
    }
    return jsonError(409, 'subdomain already provisioned');
  }

  // Create the tunnel
  let tunnel;
  try {
    tunnel = await createTunnel(env.CF_API_TOKEN, env.CF_ACCOUNT_ID, tunnelName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(502, `Failed to create tunnel: ${msg}`);
  }

  // Configure ingress
  try {
    await configureTunnelIngress(env.CF_API_TOKEN, env.CF_ACCOUNT_ID, tunnel.id, fqdn);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(502, `Failed to configure tunnel ingress: ${msg}`);
  }

  // Create DNS CNAME
  try {
    await createDnsCname(
      env.CF_API_TOKEN,
      env.CF_ZONE_ID,
      fqdn,
      `${tunnel.id}.cfargotunnel.com`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(502, `Failed to create DNS record: ${msg}`);
  }

  // Get tunnel token
  let token: string;
  try {
    token = await getTunnelToken(env.CF_API_TOKEN, env.CF_ACCOUNT_ID, tunnel.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(502, `Failed to get tunnel token: ${msg}`);
  }

  return jsonResponse(200, {
    success: true,
    tunnelId: tunnel.id,
    token,
    subdomain: fqdn,
  });
}
