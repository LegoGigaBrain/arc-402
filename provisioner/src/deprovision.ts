import type { Env, DeprovisionRequest } from './types';
import { verifySignature } from './auth';
import {
  getDnsRecord,
  deleteDnsRecord,
  getTunnelByName,
  deleteTunnel,
} from './cloudflare-api';
import { jsonError, jsonResponse, validateSubdomain } from './utils';

const DOMAIN = 'arc402.xyz';

export async function handleDeprovision(request: Request, env: Env): Promise<Response> {
  let body: DeprovisionRequest;
  try {
    body = (await request.json()) as DeprovisionRequest;
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const { subdomain, walletAddress, signature, timestamp } = body;

  if (!subdomain || !walletAddress || !signature || !timestamp) {
    return jsonError(400, 'Missing required fields: subdomain, walletAddress, signature, timestamp');
  }

  const subdomainError = validateSubdomain(subdomain);
  if (subdomainError) return jsonError(400, subdomainError);

  const nowSecs = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSecs - timestamp) > 300) {
    return jsonError(400, 'Timestamp is too old or too far in the future (max 5 minutes)');
  }

  if (!verifySignature(subdomain, timestamp, walletAddress, signature)) {
    return jsonError(401, 'Invalid signature');
  }

  const fqdn = `${subdomain}.${DOMAIN}`;
  const tunnelName = `arc402-${subdomain}`;

  const [dnsRecord, tunnel] = await Promise.all([
    getDnsRecord(env.CF_API_TOKEN, env.CF_ZONE_ID, fqdn),
    getTunnelByName(env.CF_API_TOKEN, env.CF_ACCOUNT_ID, tunnelName),
  ]);

  if (!dnsRecord && !tunnel) {
    return jsonError(404, 'Tunnel not found for this subdomain');
  }

  const errors: string[] = [];

  if (dnsRecord) {
    try {
      await deleteDnsRecord(env.CF_API_TOKEN, env.CF_ZONE_ID, dnsRecord.id);
    } catch (err) {
      errors.push(`DNS delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (tunnel) {
    try {
      await deleteTunnel(env.CF_API_TOKEN, env.CF_ACCOUNT_ID, tunnel.id);
    } catch (err) {
      errors.push(`Tunnel delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (errors.length > 0) {
    return jsonError(502, `Partial failure: ${errors.join('; ')}`);
  }

  return jsonResponse(200, {
    success: true,
    subdomain: fqdn,
    message: 'Tunnel and DNS record deleted',
  });
}
