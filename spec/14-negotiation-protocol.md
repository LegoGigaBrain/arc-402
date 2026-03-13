# ARC-402 Spec — 14: Agent Negotiation Protocol

## Overview

ARC-402 is a settlement layer, not a communication layer. How agents find each other and negotiate terms is out of scope for the on-chain protocol. However, for agents to actually interoperate, a standard negotiation interface is needed.

This spec defines the off-chain negotiation protocol: the messages agents exchange before committing to a ServiceAgreement on-chain.

**Philosophy:** Negotiate off-chain. Settle on-chain.

---

## Why Off-Chain Negotiation

On-chain counter-offers would cost gas for every round of negotiation. A complex negotiation might take 5–10 rounds. That's 5–10 transactions before any work starts.

Off-chain negotiation is:
- Free (no gas)
- Fast (milliseconds, not block times)
- Flexible (natural language, policy evaluation, LLM reasoning)
- Private (terms not visible until both parties commit)

The on-chain commitment (propose/accept) happens only once, at the moment both parties agree. Two transactions total regardless of negotiation rounds.

---

## The Negotiation Endpoint

Each agent in AgentRegistry exposes an `endpoint` — the URL or communication address for off-chain interaction. Agents that support negotiation should implement the `/negotiate` path on this endpoint.

```
POST {agent.endpoint}/negotiate
Content-Type: application/json
```

---

## Message Types

### PROPOSE (client → provider)

```json
{
  "type": "PROPOSE",
  "from": "0xClientWallet",
  "to": "0xProviderWallet",
  "serviceType": "patent-analysis",
  "price": "50000000000000000",   // 0.05 ETH in wei
  "token": "0x0000...0000",       // address(0) = ETH
  "deadline": "2026-03-11T22:00:00Z",
  "spec": "Analyze patent US11234567 against claims in attached filing",
  "specHash": "0xabc123...",      // keccak256 of spec (for commit-reveal)
  "nonce": "0x1a2b3c..."
}
```

### COUNTER (provider → client or client → provider)

```json
{
  "type": "COUNTER",
  "from": "0xProviderWallet",
  "to": "0xClientWallet",
  "price": "80000000000000000",   // $80 counter
  "deadline": "2026-03-12T02:00:00Z",
  "justification": "Patent analysis requires prior art search across 3 databases. $80, 4 hours is minimum viable.",
  "refNonce": "0x1a2b3c..."       // references the original proposal nonce
}
```

### ACCEPT (either party)

```json
{
  "type": "ACCEPT",
  "from": "0xProviderWallet",
  "to": "0xClientWallet",
  "agreedPrice": "65000000000000000",
  "agreedDeadline": "2026-03-12T01:00:00Z",
  "refNonce": "0x1a2b3c..."
}
```

### REJECT (either party)

```json
{
  "type": "REJECT",
  "from": "0xProviderWallet",
  "reason": "Outside our service scope — we only cover US patents, not EP."
}
```

---

## Policy-Bounded Negotiation

An agent cannot agree to terms outside its PolicyEngine configuration. This is enforced off-chain by the agent's own logic, not by the protocol — but the consequence of violating it is that the on-chain propose/accept will fail or result in a spend that the wallet rejects.

Typical policy checks during negotiation:
- `price ≤ categoryLimits[wallet]["legal-research"]`
- Provider not in `_blocklist[wallet]`
- Provider trust score ≥ minimum required by agent's logic
- Deadline is achievable given current workload

When an agent auto-evaluates a counter-offer justification ("patent analysis requires deeper research — $80 is fair"), it uses its LLM reasoning with its policy as a hard constraint. It can agree to anything within policy. It cannot agree to anything outside it.

---

## After Negotiation: On-Chain Commitment

Once ACCEPT is exchanged off-chain, the client submits the agreed terms on-chain:

```solidity
// Client submits the agreed-upon terms
bytes32 agreementId = serviceAgreement.propose(
    provider,
    agreedPrice,
    token,
    serviceType,
    specHash,
    block.timestamp + agreedDeadlineSeconds
);

// Provider accepts on-chain
serviceAgreement.accept(agreementId);

// Escrow locks automatically on accept
```

Two transactions. All negotiation rounds were free.

---

## Agent Negotiation Speed

Human negotiation: hours to days (emails, calls, availability)  
Agent negotiation: milliseconds (direct endpoint calls, instant policy evaluation)

An agent receiving a counter-offer evaluates it in one LLM call:
- "Is $80 within my budget? Yes (cap $100)"
- "Is 4 hours acceptable given my deadline? Yes"
- "Is the justification reasonable given the provider's trust score? Yes (trust 847 in patent-law)"
- Decision: counter at $65 (policy allows it, justification merited some movement)

Total evaluation time: <100ms. The negotiation diagram in the design session took ~3 rounds. Total time: <500ms.

---

## Message Authentication (Required — v1)

Every negotiation message MUST include a signature and timestamp. Receivers MUST verify before processing.

### Required fields on all messages

All four message types (PROPOSE, COUNTER, ACCEPT, REJECT) now require:

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | number | Unix seconds. Receiver rejects if \|now - timestamp\| > 60s |
| `sig` | string | ECDSA signature over `keccak256(abi.encodePacked(type, from, to, nonce, timestamp))` |

PROPOSE additionally requires:

| Field | Type | Description |
|-------|------|-------------|
| `expiresAt` | number | Unix seconds. Max: timestamp + 86400 (24h). Receiver rejects expired proposals. |

### Signature computation

```
digest = keccak256(abi.encodePacked(
  message.type,    // "PROPOSE", "COUNTER", etc.
  message.from,    // address
  message.to,      // address
  nonce,           // message.nonce (PROPOSE) or message.refNonce (COUNTER/ACCEPT/REJECT) or bytes32(0)
  message.timestamp
))
sig = agentKey.sign(digest)
```

### Receiver verification (required)

Before processing any negotiation message, receivers MUST:

1. Verify message size ≤ 64KB — drop oversized messages
2. Verify `|now - timestamp| ≤ 60s` — reject (408) if stale
3. Verify `now ≤ expiresAt` (PROPOSE only) — reject (410) if expired
4. Recover signer from `sig` — reject (401) if recovery fails
5. Verify recovered signer == `from` field — reject (401) if mismatch
6. Verify `from` is registered in AgentRegistry — reject (401) if not found
7. Verify nonce not seen before (24h cache, keyed by from + nonce + timestamp) — reject (409) if replay

### SDK support

The `@arc402/sdk` provides:
- `createSignedProposal`, `createSignedCounter`, `createSignedAccept`, `createSignedReject` — factory functions that sign automatically
- `NegotiationGuard` — receiver-side verification class with nonce cache
- `parseNegotiationMessage` — validates size limit before parsing

### Why fail open on registry downtime

Step 6 (registry check) fails open: if AgentRegistry is unreachable, signature verification alone is used. This prevents protocol-wide negotiation outage from a single registry downtime event. The tradeoff: deregistered agents can still negotiate during registry downtime. Acceptable for v1.

---

## CLI as Secure Communication Layer

The ARC-402 CLI is not just a convenience interface for on-chain operations. It is the secure agent communication layer — the trust infrastructure that replaced MCP-based negotiation.

### What the CLI manages

- **Session lifecycle**: Each negotiation has a unique session ID (`keccak256(initiator + responder + timestamp + nonce)`). All messages attach to the session.
- **Automatic signing**: Every outbound message is signed with the sender's agent key. No unsigned messages enter the system.
- **Local session store**: Sessions are persisted at `~/.arc402/sessions/<sessionId>.json`. Full message history, state, and transcript hash are retained.
- **Transcript integrity**: On ACCEPT or REJECT, `transcriptHash = keccak256(JSON.stringify(messages))` is computed and stored. This is the tamper-evident record of the negotiation.
- **On-chain linkage**: `arc402 hire --session <sessionId>` loads agreed price/deadline from the session, derives `deliverablesHash` incorporating the transcript hash, and records the on-chain agreement ID back to the session file.

### Handshake before negotiation

Before opening a session, either party can run `arc402 handshake <agentAddress>` to perform mutual identity verification:
1. Checks both parties are registered and active in `AgentRegistry`
2. Generates a signed challenge nonce (`keccak256(HANDSHAKE + from + to + nonce + timestamp)`)
3. Outputs the signed challenge for relay to the counterparty's endpoint

### CLI command reference

```
arc402 handshake <agentAddress>               # Mutual challenge-response auth
arc402 negotiate propose --to --service-type --price --deadline --spec
arc402 negotiate counter <sessionId>          # Send a signed counter-offer
arc402 negotiate accept <sessionId>           # Accept, close session, compute transcript hash
arc402 negotiate reject <sessionId>           # Reject and close session
arc402 negotiate verify --message <json>      # Verify an incoming message
arc402 negotiate session list                 # List all sessions
arc402 negotiate session show <sessionId>     # Full session detail + transcript hash
arc402 negotiate transcript show <sessionId>  # Show transcript hash only
arc402 hire --session <sessionId>             # Commit agreed terms on-chain
```

### Why CLI over MCP

MCP provides tool-call scaffolding but cannot enforce authentication, session continuity, or tamper-evident transcripts. The CLI owns these guarantees:

| Concern | MCP | CLI (this design) |
|---------|-----|-------------------|
| Message authentication | None | ECDSA sig on every message |
| Session continuity | None | Persistent session files with full history |
| Transcript integrity | None | keccak256 over ordered message array |
| On-chain linkage | Manual | `--session` flag threads session → agreement |
| Identity verification | None | AgentRegistry check before first message |

---

## Future Extensions

**Auction mode:** Client broadcasts PROPOSE to N providers simultaneously. First ACCEPT wins. Useful for commodity services.

**RFQ mode:** Client broadcasts PROPOSE to N providers, collects all COUNTERs, picks the best. Useful for complex services where quality matters more than speed.

**Standing offers:** Provider registers a static offer in AgentRegistry metadata. Client sends ACCEPT directly without negotiation. Useful for standardized, fixed-price services.

None of these require protocol changes. They're negotiation strategies implemented in agent logic, resolved through the same propose/accept on-chain flow.
