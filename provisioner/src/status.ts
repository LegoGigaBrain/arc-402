import type { Env } from './types';
import { getDnsRecord, getTunnelByName, getTunnelConnections } from './cloudflare-api';
import { jsonError, jsonResponse } from './utils';

const DOMAIN = 'arc402.xyz';

export async function handleStatus(subdomain: string, env: Env): Promise<Response> {
  if (!subdomain) {
    return jsonError(400, 'Missing subdomain');
  }

  const fqdn = `${subdomain}.${DOMAIN}`;
  const tunnelName = `arc402-${subdomain}`;

  const [dnsRecord, tunnel] = await Promise.all([
    getDnsRecord(env.CF_API_TOKEN, env.CF_ZONE_ID, fqdn),
    getTunnelByName(env.CF_API_TOKEN, env.CF_ACCOUNT_ID, tunnelName),
  ]);

  if (!dnsRecord && !tunnel) {
    return jsonResponse(200, {
      exists: false,
      connected: false,
      subdomain: fqdn,
    });
  }

  let connected = false;
  if (tunnel) {
    const info = await getTunnelConnections(env.CF_API_TOKEN, env.CF_ACCOUNT_ID, tunnel.id);
    connected = Array.isArray((info as any)?.connections) && (info as any).connections.length > 0;
  }

  return jsonResponse(200, {
    exists: true,
    connected,
    subdomain: fqdn,
    tunnelId: tunnel?.id ?? null,
    dnsRecord: dnsRecord ? { name: dnsRecord.name, content: dnsRecord.content } : null,
  });
}
