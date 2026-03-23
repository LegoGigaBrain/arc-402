const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

export function jsonError(status: number, message: string): Response {
  return jsonResponse(status, { success: false, error: message });
}

export function corsPreflightResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Validates subdomain: alphanumeric + hyphens, 3-50 chars, no leading/trailing hyphens.
 * Returns an error string if invalid, null if valid.
 */
export function validateSubdomain(subdomain: string): string | null {
  if (subdomain.length < 3 || subdomain.length > 50) {
    return 'Subdomain must be 3-50 characters';
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(subdomain) && !/^[a-z0-9]$/.test(subdomain)) {
    return 'Subdomain must be lowercase alphanumeric with hyphens (no leading/trailing hyphens)';
  }
  if (/[^a-z0-9-]/.test(subdomain)) {
    return 'Subdomain must be lowercase alphanumeric with hyphens only';
  }
  return null;
}
