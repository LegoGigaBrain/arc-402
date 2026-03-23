/**
 * arc402-provisioner — Merged Worker
 *
 * Subdomain registration (from arc402-subdomain-worker):
 *   POST /register        — Register subdomain with on-chain AgentRegistry check
 *   GET  /check/:sub      — Check subdomain availability
 *   POST /transfer        — Transfer subdomain between wallets (same owner)
 *
 * Tunnel provisioning (new):
 *   POST   /tunnel/provision      — Create CF tunnel + DNS, return token
 *   GET    /tunnel/status/:sub    — Check tunnel connectivity
 *   DELETE /tunnel/deprovision    — Delete tunnel + DNS
 *
 * Health:
 *   GET /health — Health check
 */

import type { Env } from './types';
import { handleProvision } from './provision';
import { handleStatus } from './status';
import { handleDeprovision } from './deprovision';
import { handleRegister } from './register';
import { handleCheck } from './check';
import { handleTransfer } from './transfer';
import { jsonError, jsonResponse, corsPreflightResponse } from './utils';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return corsPreflightResponse();
    }

    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    // === Health ===
    if (method === 'GET' && (pathname === '/health' || pathname === '/')) {
      return jsonResponse(200, {
        service: 'arc402-provisioner',
        version: '2.0.0',
        status: 'ok',
        endpoints: [
          'POST /register',
          'GET /check/:subdomain',
          'POST /transfer',
          'POST /tunnel/provision',
          'GET /tunnel/status/:subdomain',
          'DELETE /tunnel/deprovision',
        ],
      });
    }

    // === Subdomain registration (from old worker) ===
    if (method === 'POST' && pathname === '/register') {
      return handleRegister(request, env);
    }

    const checkMatch = pathname.match(/^\/check\/([^/]+)$/);
    if (method === 'GET' && checkMatch) {
      return handleCheck(checkMatch[1], env);
    }

    if (method === 'POST' && pathname === '/transfer') {
      return handleTransfer(request, env);
    }

    // === Tunnel provisioning (new) ===
    if (method === 'POST' && pathname === '/tunnel/provision') {
      return handleProvision(request, env);
    }

    const statusMatch = pathname.match(/^\/tunnel\/status\/([^/]+)$/);
    if (method === 'GET' && statusMatch) {
      return handleStatus(statusMatch[1], env);
    }

    if (method === 'DELETE' && pathname === '/tunnel/deprovision') {
      return handleDeprovision(request, env);
    }

    return jsonError(404, `Route not found: ${method} ${pathname}`);
  },
};
