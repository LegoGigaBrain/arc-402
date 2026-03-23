/**
 * GET /check/:subdomain — Check if a subdomain is available.
 * Ported from arc402-subdomain-worker.
 */

import type { Env } from './types';
import { getDnsRecord } from './cloudflare-api';
import { jsonResponse, jsonError, validateSubdomain } from './utils';

const RESERVED_SUBDOMAINS = new Set([
  'www', 'api', 'app', 'mail', 'ftp', 'admin', 'root', 'dev', 'staging',
]);

const DOMAIN = 'arc402.xyz';

export async function handleCheck(subdomain: string, env: Env): Promise<Response> {
  const normalized = subdomain.toLowerCase();

  const subErr = validateSubdomain(normalized);
  if (subErr) {
    return jsonResponse(200, { available: false, reason: 'invalid' });
  }

  if (RESERVED_SUBDOMAINS.has(normalized)) {
    return jsonResponse(200, { available: false, reason: 'reserved' });
  }

  const apiToken = env.CF_API_TOKEN || env.CLOUDFLARE_API_TOKEN!;
  const zoneId = env.CF_ZONE_ID || env.CLOUDFLARE_ZONE_ID!;

  try {
    const fqdn = `${normalized}.${DOMAIN}`;
    const record = await getDnsRecord(apiToken, zoneId, fqdn);
    return jsonResponse(200, { available: record === null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonError(502, `Failed to check subdomain: ${msg}`);
  }
}
