import type { Env } from './types';
import { handleProvision } from './provision';
import { handleStatus } from './status';
import { handleDeprovision } from './deprovision';
import { jsonError, corsPreflightResponse } from './utils';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return corsPreflightResponse();
    }

    const url = new URL(request.url);
    const { pathname, method } = { pathname: url.pathname, method: request.method };

    // POST /tunnel/provision
    if (method === 'POST' && pathname === '/tunnel/provision') {
      return handleProvision(request, env);
    }

    // GET /tunnel/status/:subdomain
    const statusMatch = pathname.match(/^\/tunnel\/status\/([^/]+)$/);
    if (method === 'GET' && statusMatch) {
      const subdomain = statusMatch[1];
      return handleStatus(subdomain, env);
    }

    // DELETE /tunnel/deprovision
    if (method === 'DELETE' && pathname === '/tunnel/deprovision') {
      return handleDeprovision(request, env);
    }

    // Health check
    if (method === 'GET' && pathname === '/') {
      return new Response(JSON.stringify({ service: 'arc402-provisioner', status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return jsonError(404, `Route not found: ${method} ${pathname}`);
  },
};
