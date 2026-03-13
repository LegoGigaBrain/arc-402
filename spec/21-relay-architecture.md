# ARC-402 Spec — 21: Relay Architecture

**Status:** DRAFT
**Version:** 1.0.0
**Created:** 2026-03-13

---

## Abstract

ARC-402 is a settlement layer, not a communication layer. Agents need a way to exchange negotiation messages without requiring a direct peer-to-peer connection. The Relay provides this: a simple message router that can be run by anyone — including adversaries — without compromising protocol security.

The core insight: **signed messages make relay trust irrelevant.** If every message is signed by its sender and verified by its recipient, the relay can read, log, delay, or drop messages without being able to forge, modify, or replay them.

---

## The Relay Design Principle

This is a first-class architectural property of ARC-402, not a fallback:

> The relay MUST be treated as an untrusted party. All security properties of ARC-402 are preserved even if the relay is adversarial.

Consequences of this principle:

| Relay action | Protocol response |
|-------------|-------------------|
| Reads all messages | Acceptable — messages contain no secrets (only hashes) |
| Logs all messages | Acceptable — same as above |
| Delays messages | Handled by negotiation TTL + timeout logic |
| Drops messages | Handled by session resumption + retry |
| Replays old messages | Rejected — nonce-based replay protection |
| Modifies message content | Rejected — signature verification fails |
| Forges a message | Impossible — private key not held by relay |
| Claims to be an agent | Impossible — AgentRegistry verification required |

This means **anyone can run a relay** — businesses, individuals, competitors, or users themselves. The protocol does not endorse or certify relays. Multiple relays can coexist. Agents can switch relays mid-session.

---

## Relay Architecture

```
Agent A                    Relay                    Agent B
   │                          │                          │
   │── POST /send ──────────► │                          │
   │   { to: B, payload: ... }│                          │
   │                          │── POST /deliver ────────►│
   │                          │   { from: A, payload: ...│
   │                          │◄── 200 OK ────────────── │
   │◄── 200 { messageId } ─── │                          │
   │                          │                          │
   │── GET /poll ────────────►│                          │
   │◄── 200 { messages: [...] }│                         │
```

### Relay Contract

A relay MUST implement the following interface:

```
POST /send
  Body: { to: address, payload: SignedMessage }
  Response: { messageId: string }

GET /poll?address=0x...&since=<messageId>
  Response: { messages: SignedMessage[] }

GET /status
  Response: { healthy: boolean, version: string }
```

A relay SHOULD implement:

```
DELETE /message/:messageId
  (sender only — authenticated via signature)

GET /session/:sessionId/messages
  (participant only — authenticated via signature)
```

A relay MAY implement WebSocket for push delivery:

```
WS /subscribe?address=0x...
  Pushes: SignedMessage on arrival
```

### What a Relay Does Not Do

- Parse message content
- Validate signatures (that's the recipient's job)
- Route based on message type
- Store messages permanently (relay is ephemeral; on-chain transcript hash is permanent)
- Authenticate senders beyond basic rate limiting

---

## Session Resumption

Agents can go offline mid-negotiation. The session state is locally stored by each party (see `SessionManager` in Spec 14). When a party comes back online:

1. **Poll for missed messages:** `GET /poll?address=0x...&since=<lastSeenMessageId>`
2. **Verify each message:** signature check + nonce ordering
3. **Replay local state machine** from stored session + new messages
4. **Continue negotiation** from current state

### Session Timeout

A negotiation session expires if no progress is made within the TTL specified in the PROPOSE message (`expiresAt` field). After expiry:

- Neither party can accept or counter
- The session is closed with state `EXPIRED`
- No on-chain state was created — nothing to clean up
- Either party may start a fresh session

### Reconnection Protocol

When an agent reconnects after an unexpected disconnect:

```bash
arc402 negotiate session sync <sessionId>
# Fetches all missed messages from relay, replays state, prints current state
```

---

## Relay Discovery

Relays are not on-chain registered. Agents include their preferred relay in their metadata URI (Spec 18 agent metadata):

```json
{
  "relay": "https://relay.arc402.io",
  "relayFallbacks": [
    "https://relay2.arc402.io",
    "https://relay.mycompany.com"
  ]
}
```

When Agent A wants to reach Agent B:

1. A reads B's `metadataURI` from `AgentRegistry`
2. A discovers B's preferred relay from the metadata
3. A sends to that relay addressed to B

If B's relay is unreachable, A tries fallbacks in order. If all fail, A MAY attempt direct HTTP to B's `endpoint`.

---

## Daemon Mode

For high-frequency agent interactions, spawning a CLI process per message is too slow. The relay client supports daemon mode — a persistent process that handles message routing for a running agent.

### Starting the Daemon

```bash
arc402 relay daemon start \
  --relay https://relay.arc402.io \
  --poll-interval 2000 \
  --on-message /path/to/handler.sh
```

The handler script receives each incoming message as JSON on stdin:

```bash
# handler.sh
#!/bin/bash
message=$(cat)
type=$(echo "$message" | jq -r '.type')
case "$type" in
  PROPOSE) arc402 negotiate counter ... ;;
  ACCEPT) arc402 hire ... ;;
  *) echo "unhandled" ;;
esac
```

For production agents, the SDK daemon interface is preferred:

```typescript
const daemon = await ARC402Daemon.start({
  relay: "https://relay.arc402.io",
  pollIntervalMs: 2000,
  onMessage: async (message) => {
    // Handle incoming negotiation message
    const verified = await guard.verify(message);
    if (!verified.valid) return;
    // Process...
  },
});

daemon.stop();
```

### Daemon vs One-Shot

| Mode | Use case |
|------|----------|
| One-shot CLI | Human testing, scripted workflows, CI |
| Daemon | Production agent runtime, high-frequency negotiations |
| SDK daemon | Embedded in application, full programmatic control |

---

## Relay Security Model

### What Relay Operators Know

- Message sender address (included in signed message)
- Message recipient address (routing header)
- Message timestamp and type (signed, not secret)
- Message volume per address

Relay operators do NOT know:

- Private negotiation terms (encrypted in v2; hash-only in v1)
- Whether a specific agreement was eventually executed on-chain
- Agent private keys

### Rate Limiting

Relays SHOULD implement per-address rate limiting to prevent spam:

- Default: 100 messages/minute per sender address
- Burst: 10 messages/second
- Per-session: 50 messages/session

Rate limits are advisory and relay-specific. Agents that hit rate limits SHOULD implement exponential backoff.

### Relay Privacy (v1)

In v1, negotiation message content is not encrypted. The spec hash (keccak256 of the spec document) is included; the spec document itself is not. Price, deadline, and justification fields are visible to the relay.

**v2:** End-to-end encryption between agent keys using ECDH. The relay sees sender, recipient, and ciphertext only.

---

## Reference Relay Implementation

A reference relay is provided at `tools/relay/` in the ARC-402 repository. It is:

- A single-file Node.js server
- Stateless (messages stored in-memory, TTL 24h)
- Deployable as a standalone service or embedded in agent infrastructure
- Licensed under MIT — copy it, fork it, run your own

Running it:

```bash
node tools/relay/server.js --port 3000 --ttl 86400
```

Production operators SHOULD add:
- Persistent message store (Redis or similar)
- TLS termination
- Rate limiting middleware
- Health monitoring

---

## Network Topology

The relay layer is intentionally decentralised. Expected topology at scale:

```
Arc402 Foundation relay (public, no auth, rate-limited)
  │
  ├── Protocol reference implementation
  └── Always-on fallback

Enterprise relays (run by large agent operators)
  │
  ├── Higher rate limits for registered partners
  └── SLA guarantees

Self-hosted relays (run by individual agents)
  │
  ├── No rate limits for own agents
  └── Full control over message storage

Community relays (run by ecosystem participants)
  │
  └── Various policies, disclosed in relay metadata
```

No relay has privileged protocol access. The protocol treats all relays identically: untrusted routers.
