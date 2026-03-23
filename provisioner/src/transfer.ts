/**
 * POST /transfer — Transfer subdomain ownership between wallets.
 * Verifies both wallets share the same owner() on-chain.
 * Ported from arc402-subdomain-worker.
 */

import type { Env, TransferRequest } from './types';
import { readOwner } from './on-chain';
import { jsonError, jsonResponse, validateSubdomain } from './utils';

function isValidEthAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

export async function handleTransfer(request: Request, env: Env): Promise<Response> {
  let body: TransferRequest;
  try {
    body = (await request.json()) as TransferRequest;
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const { subdomain, newWalletAddress } = body;

  if (typeof subdomain !== 'string') {
    return jsonError(400, 'Invalid subdomain');
  }
  const normalized = subdomain.toLowerCase();
  const subErr = validateSubdomain(normalized);
  if (subErr) return jsonError(400, subErr);

  if (typeof newWalletAddress !== 'string' || !isValidEthAddress(newWalletAddress)) {
    return jsonError(400, 'Invalid newWalletAddress: must be a valid Ethereum address (0x...)');
  }

  if (!env.RATE_LIMIT_KV) {
    return jsonError(503, 'KV unavailable');
  }

  const ownerKey = `owner:${normalized}`;
  const oldWalletAddress = await env.RATE_LIMIT_KV.get(ownerKey);

  if (!oldWalletAddress) {
    return jsonError(404, 'Subdomain not registered');
  }

  if (oldWalletAddress.toLowerCase() === newWalletAddress.toLowerCase()) {
    return jsonError(409, 'Already owned by this wallet');
  }

  // Verify both wallets share the same owner
  let oldOwner: string;
  let newOwner: string;
  try {
    [oldOwner, newOwner] = await Promise.all([
      readOwner(oldWalletAddress, env),
      readOwner(newWalletAddress, env),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonError(502, `Failed to read wallet owner: ${msg}`);
  }

  if (oldOwner.toLowerCase() !== newOwner.toLowerCase()) {
    return jsonError(
      403,
      `Transfer denied: old wallet owner (${oldOwner}) does not match new wallet owner (${newOwner})`
    );
  }

  await env.RATE_LIMIT_KV.put(ownerKey, newWalletAddress);

  return jsonResponse(200, {
    subdomain: `${normalized}.arc402.xyz`,
    newWalletAddress,
    status: 'transferred',
  });
}
