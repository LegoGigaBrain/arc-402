/**
 * On-chain verification utilities for Base mainnet.
 * Ported from arc402-subdomain-worker.
 */

import type { Env } from './types';

const AGENT_REGISTRY_ADDRESS = '0xD5c2851B00090c92Ba7F4723FB548bb30C9B6865';
const DEFAULT_BASE_RPC_URL = 'https://base.llamarpc.com';

function getRpcUrl(env: Env): string {
  return env.BASE_RPC_URL ?? DEFAULT_BASE_RPC_URL;
}

/** Encode the isRegistered(address) call for AgentRegistry */
function encodeIsRegisteredCall(address: string): string {
  const selector = '0x85b68445';
  const paddedAddress = address.slice(2).toLowerCase().padStart(64, '0');
  return selector + paddedAddress;
}

/** Check if a wallet is registered in the on-chain AgentRegistry */
export async function isWalletRegistered(walletAddress: string, env: Env): Promise<boolean> {
  const rpcUrl = getRpcUrl(env);
  const callData = encodeIsRegisteredCall(walletAddress);

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to: AGENT_REGISTRY_ADDRESS, data: callData }, 'latest'],
      id: 1,
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status}`);
  }

  const result = (await response.json()) as { result?: string; error?: { message: string } };
  if (result.error) {
    throw new Error(`RPC error: ${result.error.message}`);
  }

  const hex = result.result ?? '0x';
  return hex !== '0x' && BigInt(hex) !== 0n;
}

/** Read the owner() of an ARC-402 wallet contract */
export async function readOwner(walletAddress: string, env: Env): Promise<string> {
  const rpcUrl = getRpcUrl(env);

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to: walletAddress, data: '0x8da5cb5b' }, 'latest'],
      id: 1,
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status}`);
  }

  const result = (await response.json()) as { result?: string; error?: { message: string } };
  if (result.error) {
    throw new Error(`RPC error: ${result.error.message}`);
  }

  const hex = result.result ?? '0x';
  if (hex === '0x' || hex.length < 66) {
    throw new Error('Invalid owner() response');
  }

  return '0x' + hex.slice(-40);
}
