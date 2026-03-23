# arc402-provisioner

Cloudflare Worker that provisions Cloudflare Tunnels for ARC-402 agents.

Deployed at: `api.arc402.xyz`

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Set the API token secret

```bash
npx wrangler secret put CF_API_TOKEN
# Enter: cfut_WqFmTeAyfD2P4mWpep3JlF2z0NpUdQCiTPljVN8x10dbb9cf
```

### 3. Deploy

```bash
npx wrangler deploy
```

### 4. Local dev

```bash
npx wrangler dev
```

---

## API

### POST /tunnel/provision

Provisions a new Cloudflare Tunnel for the given subdomain.

**Request body:**
```json
{
  "subdomain": "megabrain",
  "walletAddress": "0xa9e0612a...",
  "signature": "0x...",
  "timestamp": 1700000000
}
```

The `signature` is an EIP-191 personal sign of: `arc402-provision:<subdomain>:<timestamp>`

**Success response (200):**
```json
{
  "success": true,
  "tunnelId": "abc123...",
  "token": "eyJ...",
  "subdomain": "megabrain.arc402.xyz"
}
```

After receiving the token, run the tunnel locally:
```bash
cloudflared tunnel run --token <token>
```

**Error responses:**
- `400` — Invalid input (missing fields, bad subdomain, expired timestamp)
- `401` — Invalid signature
- `409` — Subdomain already provisioned
- `429` — Rate limit exceeded (10/hour per wallet)
- `502` — Cloudflare API error

---

### GET /tunnel/status/:subdomain

Returns whether a tunnel exists and is connected. No auth required.

**Response (200):**
```json
{
  "exists": true,
  "connected": false,
  "subdomain": "megabrain.arc402.xyz",
  "tunnelId": "abc123...",
  "dnsRecord": {
    "name": "megabrain.arc402.xyz",
    "content": "abc123....cfargotunnel.com"
  }
}
```

---

### DELETE /tunnel/deprovision

Deletes tunnel + DNS record. Same auth as `/provision`.

**Request body:** Same shape as provision (subdomain, walletAddress, signature, timestamp).

**Success response (200):**
```json
{
  "success": true,
  "subdomain": "megabrain.arc402.xyz",
  "message": "Tunnel and DNS record deleted"
}
```

---

## Auth

Agents sign a message with their wallet key using EIP-191 personal sign:

```
arc402-provision:<subdomain>:<unix_timestamp_seconds>
```

The Worker recovers the signer address from the signature and verifies it matches `walletAddress`. Timestamp must be within ±5 minutes of server time.

## Subdomain Rules

- Lowercase alphanumeric + hyphens only
- 3–50 characters
- No leading or trailing hyphens

## Rate Limits

Max 10 provisions per wallet address per hour (in-memory, resets on Worker restart).

## Tech Stack

- Cloudflare Workers (TypeScript)
- `@noble/curves` + `@noble/hashes` for EIP-191 signature verification (no heavy ethers.js bundle)
- Cloudflare Tunnels API for tunnel creation
- Cloudflare DNS API for CNAME records
