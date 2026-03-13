# ARC-402 Reference Relay

A minimal, untrusted message relay for the ARC-402 negotiation layer (Spec 21).

## Design Principle

The relay is **explicitly untrusted**. All messages are signed by their sender; the relay cannot forge, modify, or replay them. Anyone can run a relay — including adversaries — without compromising protocol security.

## Running

```bash
node tools/relay/server.js --port 3000 --ttl 86400
```

Options:
- `--port` — TCP port to listen on (default: 3000)
- `--ttl` — Message TTL in seconds (default: 86400 = 24 hours)

## API

### POST /send

Send a message to an address.

```json
Request:  { "to": "0x...", "payload": { ... } }
Response: { "messageId": "abc123..." }
```

### GET /poll?address=0x...&since=\<messageId\>

Fetch messages for an address. `since` is optional — omit to get all stored messages.

```json
Response: { "messages": [ { "messageId": "...", "from": "0x...", "to": "0x...", "payload": {...}, "timestamp": 1234567890 } ] }
```

### GET /status

Health check.

```json
Response: { "healthy": true, "version": "1.0.0", "ttlSeconds": 86400 }
```

## Rate Limiting

- 100 messages/minute per sender address
- Burst is included in the per-minute window
- Clients that exceed the limit receive HTTP 429

## Security Model

| Relay action | Protocol response |
|---|---|
| Reads all messages | Acceptable — messages contain only hashes |
| Delays messages | Handled by negotiation TTL |
| Drops messages | Handled by session resumption + retry |
| Replays old messages | Rejected by recipient — nonce-based |
| Modifies message | Rejected by recipient — signature fails |

## Production Deployment

For production use, operators should add:
- Persistent message store (Redis, Postgres, etc.)
- TLS termination (nginx, Caddy, etc.)
- Authentication for higher rate limits
- Metrics and health monitoring

The reference implementation is intentionally minimal. Fork it freely.

## CLI Integration

```bash
# Send a message
arc402 relay send --to 0xABCD... --payload '{"type":"PROPOSE",...}' --relay http://localhost:3000

# Poll for messages
arc402 relay poll --address 0xABCD... --relay http://localhost:3000

# Start daemon (persistent polling + handler)
arc402 relay daemon start \
  --relay http://localhost:3000 \
  --poll-interval 2000 \
  --on-message /path/to/handler.sh

# Stop daemon
arc402 relay daemon stop
```
