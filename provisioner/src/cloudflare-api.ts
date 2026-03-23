import type { CloudflareApiResponse, TunnelResult, DnsRecord } from './types';

const CF_BASE = 'https://api.cloudflare.com/client/v4';

async function cfFetch<T>(
  apiToken: string,
  path: string,
  options: RequestInit = {}
): Promise<CloudflareApiResponse<T>> {
  const res = await fetch(`${CF_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const data = (await res.json()) as CloudflareApiResponse<T>;
  if (!data.success) {
    const msg = data.errors?.map((e) => `${e.code}: ${e.message}`).join(', ') ?? 'Unknown CF error';
    throw new Error(`Cloudflare API error: ${msg}`);
  }
  return data;
}

/** Create a Named Tunnel */
export async function createTunnel(
  apiToken: string,
  accountId: string,
  name: string
): Promise<TunnelResult> {
  const data = await cfFetch<TunnelResult>(apiToken, `/accounts/${accountId}/cfd_tunnel`, {
    method: 'POST',
    body: JSON.stringify({ name, config_src: 'cloudflare' }),
  });
  return data.result;
}

/** Get the tunnel token (used to run cloudflared) */
export async function getTunnelToken(
  apiToken: string,
  accountId: string,
  tunnelId: string
): Promise<string> {
  const data = await cfFetch<string>(apiToken, `/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`, {
    method: 'GET',
  });
  return data.result;
}

/** Configure tunnel ingress rules */
export async function configureTunnelIngress(
  apiToken: string,
  accountId: string,
  tunnelId: string,
  hostname: string
): Promise<void> {
  await cfFetch<unknown>(
    apiToken,
    `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
    {
      method: 'PUT',
      body: JSON.stringify({
        config: {
          ingress: [
            { hostname, service: 'http://localhost:4402' },
            { service: 'http_status:404' },
          ],
        },
      }),
    }
  );
}

/** Create a DNS CNAME record */
export async function createDnsCname(
  apiToken: string,
  zoneId: string,
  name: string,
  content: string
): Promise<DnsRecord> {
  const data = await cfFetch<DnsRecord>(apiToken, `/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'CNAME',
      name,
      content,
      proxied: true,
      ttl: 1, // auto
    }),
  });
  return data.result;
}

/** Look up a DNS record by name (returns first match or null) */
export async function getDnsRecord(
  apiToken: string,
  zoneId: string,
  name: string
): Promise<DnsRecord | null> {
  const res = await fetch(
    `${CF_BASE}/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(name)}`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
  const data = (await res.json()) as CloudflareApiResponse<DnsRecord[]>;
  if (!data.success) return null;
  return data.result?.[0] ?? null;
}

/** Delete a DNS record by id */
export async function deleteDnsRecord(
  apiToken: string,
  zoneId: string,
  recordId: string
): Promise<void> {
  await cfFetch<unknown>(apiToken, `/zones/${zoneId}/dns_records/${recordId}`, {
    method: 'DELETE',
  });
}

/** Look up a tunnel by name (returns first match or null) */
export async function getTunnelByName(
  apiToken: string,
  accountId: string,
  name: string
): Promise<TunnelResult | null> {
  const res = await fetch(
    `${CF_BASE}/accounts/${accountId}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
  const data = (await res.json()) as CloudflareApiResponse<TunnelResult[]>;
  if (!data.success) return null;
  return data.result?.[0] ?? null;
}

/** Get tunnel connections/status */
export async function getTunnelConnections(
  apiToken: string,
  accountId: string,
  tunnelId: string
): Promise<{ id: string; connections: unknown[] } | null> {
  try {
    const data = await cfFetch<{ id: string; connections: unknown[] }>(
      apiToken,
      `/accounts/${accountId}/cfd_tunnel/${tunnelId}`,
      { method: 'GET' }
    );
    return data.result;
  } catch {
    return null;
  }
}

/** Delete (clean up) a tunnel */
export async function deleteTunnel(
  apiToken: string,
  accountId: string,
  tunnelId: string
): Promise<void> {
  await cfFetch<unknown>(apiToken, `/accounts/${accountId}/cfd_tunnel/${tunnelId}`, {
    method: 'DELETE',
  });
}
