/**
 * POST /register — Subdomain registration with on-chain AgentRegistry verification.
 * Ported from arc402-subdomain-worker.
 */

import type { Env, RegisterRequest } from './types';
import { getDnsRecord, createDnsCname } from './cloudflare-api';
import { isWalletRegistered } from './on-chain';
import { jsonError, jsonResponse, validateSubdomain } from './utils';

const RESERVED_SUBDOMAINS = new Set([
  'www', 'api', 'app', 'mail', 'ftp', 'admin', 'root', 'dev', 'staging',
]);

const DOMAIN = 'arc402.xyz';

// In-memory fallback rate limit
const inMemoryRateLimit = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

async function checkRateLimit(ip: string, kv?: KVNamespace): Promise<boolean> {
  const key = `rl:${ip}`;
  const now = Date.now();

  if (kv) {
    const raw = await kv.get(key, 'json') as { count: number; resetAt: number } | null;
    if (!raw || now > raw.resetAt) {
      await kv.put(key, JSON.stringify({ count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS }), {
        expirationTtl: 3600,
      });
      return true;
    }
    if (raw.count >= RATE_LIMIT_MAX) return false;
    await kv.put(key, JSON.stringify({ count: raw.count + 1, resetAt: raw.resetAt }), {
      expirationTtl: Math.ceil((raw.resetAt - now) / 1000),
    });
    return true;
  }

  // In-memory fallback
  const entry = inMemoryRateLimit.get(key);
  if (!entry || now > entry.resetAt) {
    inMemoryRateLimit.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

function isValidEthAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function isValidTunnelTarget(url: string): boolean {
  return url.startsWith('https://');
}

export async function handleRegister(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const allowed = await checkRateLimit(ip, env.RATE_LIMIT_KV);
  if (!allowed) {
    return jsonError(429, 'Rate limit exceeded: max 5 registrations per hour');
  }

  let body: RegisterRequest;
  try {
    body = (await request.json()) as RegisterRequest;
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const { subdomain, walletAddress, tunnelTarget } = body;

  if (typeof subdomain !== 'string' || !validateSubdomain(subdomain.toLowerCase()) === null) {
    // validateSubdomain returns null when valid
  }
  const normalized = subdomain?.toLowerCase?.() ?? '';
  const subErr = validateSubdomain(normalized);
  if (subErr) return jsonError(400, subErr);
  if (RESERVED_SUBDOMAINS.has(normalized)) {
    return jsonError(400, 'This subdomain is reserved');
  }

  if (typeof walletAddress !== 'string' || !isValidEthAddress(walletAddress)) {
    return jsonError(400, 'Invalid walletAddress: must be a valid Ethereum address (0x...)');
  }

  if (typeof tunnelTarget !== 'string' || !isValidTunnelTarget(tunnelTarget)) {
    return jsonError(400, 'Invalid tunnelTarget: must start with https://');
  }

  // Check KV ownership
  const ownerKey = `owner:${normalized}`;
  if (env.RATE_LIMIT_KV) {
    const existingOwner = await env.RATE_LIMIT_KV.get(ownerKey);
    if (existingOwner && existingOwner.toLowerCase() !== walletAddress.toLowerCase()) {
      return jsonError(409, 'Subdomain is already registered by another wallet');
    }
  }

  // Verify wallet is registered on-chain in AgentRegistry
  const apiToken = env.CF_API_TOKEN || env.CLOUDFLARE_API_TOKEN!;
  const zoneId = env.CF_ZONE_ID || env.CLOUDFLARE_ZONE_ID!;

  let registered: boolean;
  try {
    registered = await isWalletRegistered(walletAddress, env);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonError(502, `Failed to verify wallet registration: ${msg}`);
  }

  if (!registered) {
    return jsonError(403, 'Wallet is not registered in AgentRegistry on Base mainnet');
  }

  // Create or update DNS CNAME
  const fqdn = `${normalized}.${DOMAIN}`;
  const targetHostname = tunnelTarget.replace(/^https?:\/\//, '').replace(/\/$/, '');

  try {
    const existing = await getDnsRecord(apiToken, zoneId, fqdn);
    if (existing) {
      // Update existing record
      await fetch(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${existing.id}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'CNAME',
            name: normalized,
            content: targetHostname,
            proxied: true,
            ttl: 1,
          }),
        }
      );
    } else {
      await createDnsCname(apiToken, zoneId, fqdn, targetHostname);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonError(502, `Failed to create DNS record: ${msg}`);
  }

  // Store ownership in KV
  if (env.RATE_LIMIT_KV) {
    await env.RATE_LIMIT_KV.put(ownerKey, walletAddress);
  }

  return jsonResponse(200, {
    subdomain: fqdn,
    status: 'active',
  });
}
