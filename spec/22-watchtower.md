# ARC-402 Spec — 22: Watchtower Architecture

**Status:** DRAFT
**Version:** 0.1.0
**Created:** 2026-03-13
**Scope:** Liveness protection for session channels. Required for launch alongside spec/18-session-channels.md.

---

## Motivation

Session channels require at least one party to be online during the challenge window. If a malicious counterparty submits a stale-state close while you are offline, you lose funds by default — the challenge window expires and the stale state is finalised.

This is the liveness problem. It cannot be hand-waved.

**The solution:** A watchtower — a process authorised to submit challenge transactions on your behalf when you cannot. The watchtower never holds your keys. It holds your pre-signed states and a narrow, revocable authorisation to submit them if needed.

---

## Design Principles

1. **Watchtowers never hold agent keys.** They hold pre-signed states and on-chain authorisation to submit them. Key custody stays with the owner.
2. **Watchtower trust is bounded.** The worst a malicious watchtower can do is fail to challenge. It cannot steal funds or forge state.
3. **Three tiers serve two audiences.** Always-on home nodes use the daemon as their own watchtower. Intermittent users delegate to an external watchtower. Enterprises run managed watchtower infrastructure.
4. **Authorisation is per-channel, revocable.** You do not give a watchtower blanket access. Each channel authorisation is independent and can be revoked.

---

## Watchtower Tiers

### Tier 1: OpenClaw Daemon (always-on home nodes)

For any OpenClaw instance running continuously, the daemon is already watching the chain. Extending it to monitor open channels and auto-challenge stale closes requires no external service.

```
OpenClaw daemon
  ├── Relay polling (already running)
  ├── Channel state store (local DB, all open channels + latest signed states)
  └── Chain monitor (polls for closeChannel events on owned channels)
         → if stale close detected → auto-submit challengeChannel()
```

**No extra setup required.** `arc402 relay daemon start` activates relay + watchtower simultaneously.

For always-on home machines, this is the watchtower. Zero cost. Zero dependency.

### Tier 2: External Watchtower Service (intermittent users)

For users who cannot guarantee machine uptime. You register your open channels with a watchtower service and submit your latest signed states as they update.

**Contract interface:**

```solidity
/// @notice Authorise a watchtower to challenge on your behalf for a specific channel
/// @param channelId The session channel to protect
/// @param watchtower The watchtower's address
function authorizeWatchtower(
    bytes32 channelId,
    address watchtower
) external;

/// @notice Revoke a watchtower's authorisation for a channel
function revokeWatchtower(
    bytes32 channelId,
    address watchtower
) external;

/// @notice Watchtower submits a challenge on behalf of an authorised party
/// @param channelId The channel being challenged
/// @param latestState ABI-encoded ChannelState with both signatures
/// @param beneficiary The party whose funds are being protected
function submitWatchtowerChallenge(
    bytes32 channelId,
    bytes calldata latestState,
    address beneficiary
) external;

/// @notice Check if a watchtower is authorised for a channel
function isWatchtowerAuthorized(
    bytes32 channelId,
    address watchtower
) external view returns (bool);
```

**Off-chain state submission interface (watchtower HTTP API):**

```
POST /register
  Body: {
    channelId: string,
    agentAddress: string,
    authTxHash: string,       // proof of on-chain authorisation
    latestState: ChannelState // doubly-signed latest state
  }
  Response: { watcherId: string }

POST /update
  Body: {
    watcherId: string,
    latestState: ChannelState // updated doubly-signed state
  }
  Response: { acknowledged: true }

DELETE /unregister
  Body: { watcherId: string }
  Response: { unregistered: true }

GET /status/:watcherId
  Response: { active: boolean, lastStateSeq: number, channelStatus: string }
```

Agents submit updated states to their watchtower after every N calls (configurable). The watchtower stores the latest state. If it detects a stale close on-chain, it submits `submitWatchtowerChallenge()` with the stored state.

### Tier 3: Enterprise Watchtower Infrastructure

Enterprise operators running agent fleets run their own watchtower infrastructure alongside their relay. Same contract interface. Higher reliability SLAs. Internal monitoring, alerting, and redundancy.

The reference watchtower implementation (see below) is the starting point. Enterprise operators add:
- Redis-backed state storage (not in-memory)
- Redundant chain monitoring nodes
- Alerting on challenge events
- SLA-based response time guarantees

---

## Security Model

### What a watchtower can do
- Submit `challengeChannel()` with a state you pre-registered
- Protect your funds when you are offline

### What a watchtower cannot do
- Forge a state (state must have both parties' valid signatures)
- Create a state with a higher sequence number than you provided
- Steal funds (it calls challenge on your behalf — funds still go to you)
- Act on channels it is not authorised for

### What happens if a watchtower is malicious or fails
- **Malicious (submits wrong state):** Cannot. It only has valid doubly-signed states. Any tampered state fails signature verification.
- **Fails to challenge (goes offline):** Your stale-close loss. This is the residual risk. Mitigations:
  - Register with multiple watchtowers (fallback list)
  - OpenClaw daemon as primary, external watchtower as backup
  - Challenge window set long enough to allow recovery

### Residual risk statement
A watchtower that fails to respond within the challenge window results in the stale state being finalised. This is a liveness failure, not a security failure. Mitigation: redundant watchtowers, long challenge windows, daemon monitoring.

---

## Challenge Window Parameters

| Parameter | Value | Justification |
|-----------|-------|---------------|
| Default challenge window | 24 hours | Sufficient for human response + watchtower fallback |
| Minimum challenge window | 4 hours | Below this, reliable challenge is impractical for non-daemon users |
| Maximum challenge window | 7 days | Above this, capital lock-up is unreasonable |
| Watchtower response target | < 1 hour | Well within 24h window even with monitoring delays |

Challenge window is set at channel open time. Parties negotiate it as part of session parameters. Default is 24 hours.

---

## OpenClaw Integration

### Always-on home node (Tier 1)

`arc402 relay daemon start` activates both relay polling and channel monitoring:

```
arc402 relay daemon start
  → Starting relay polling (2s interval)...
  → Starting channel monitor...
  → Watching 0 open channels
  → Watchtower active. Your channels are protected.
```

When a new channel opens:
```
arc402 channel open <provider> --max 50 --rate 0.001
  → Channel opened: 0x...
  → Registered with local watchtower daemon.
  → Your funds are protected while OpenClaw is running.
```

### Intermittent user (Tier 2)

During `arc402 init`:
```
→ Is this machine always on? (y/n)
→ [n] We recommend registering with a watchtower to protect your session channels.
→ Use the ARC-402 public watchtower? (free, best-effort) / Enter your own / Skip
→ [public] Registering with watchtower.arc402.io...
→ Done. Your channels will be protected even when you are offline.
```

Manual watchtower management:
```bash
# Register a channel with a watchtower
arc402 channel watchtower register <channel-id> --watchtower https://watchtower.arc402.io

# Update watchtower with latest state (auto-called by SDK after each state update)
arc402 channel watchtower update <channel-id>

# List active watchtower registrations
arc402 channel watchtower list

# Revoke watchtower for a channel
arc402 channel watchtower revoke <channel-id> --watchtower https://watchtower.arc402.io
```

### Enterprise (Tier 3)

```bash
# Start a self-hosted watchtower server
node tools/watchtower/server.js --port 3001 --rpc https://base-rpc.yourdomain.com

# Configure agents to use internal watchtower
arc402 channel watchtower register <channel-id> --watchtower https://watchtower.internal.yourdomain.com
```

---

## Reference Watchtower Implementation

A reference watchtower ships at `tools/watchtower/` in the ARC-402 repository.

- Single-file Node.js server
- In-memory state storage (Redis recommended for production)
- Polls chain every 12 seconds (6 Base L2 blocks) for close events
- Submits challenges automatically when stale close detected
- MIT licensed — run your own

```bash
node tools/watchtower/server.js \
  --port 3001 \
  --rpc https://mainnet.base.org \
  --private-key 0x...   # watchtower's own key (NOT user agent key)
  --max-channels 10000
```

Production additions:
- Redis for persistent state (lose in-memory = lose challenge capability)
- Redundant RPC providers (single provider failure = challenge failure)
- Monitoring and alerting on challenge events
- Multiple confirmations before accepting close as final

---

## SDK Integration

The SDK automatically submits state updates to registered watchtowers after every N state updates:

```typescript
// Open channel with watchtower
const channel = await client.openSessionChannel({
  provider: '0x...',
  token: USDC,
  maxAmount: parseUnits('50', 6),
  ratePerCall: parseUnits('0.001', 6),
  deadline: Math.floor(Date.now()/1000) + 86400,
  watchtower: 'https://watchtower.arc402.io', // optional
  watchtowerUpdateInterval: 10,               // update every 10 state changes
})

// State updates automatically forwarded to watchtower every 10 calls
const state = await client.signStateUpdate(channel.channelId, ...)
// → SDK auto-submits to watchtower if registered
```

---

## Audit Surface (Added)

1. `authorizeWatchtower` — only channel participant can authorise
2. `revokeWatchtower` — only channel participant can revoke; cannot revoke mid-challenge
3. `submitWatchtowerChallenge` — watchtower must be authorised; state must have valid signatures; sequence number must exceed current on-chain state
4. Reentrancy in `submitWatchtowerChallenge` (ETH + ERC-20 paths)
5. Watchtower cannot grief by spamming `submitWatchtowerChallenge` with older states — sequence check prevents it
6. Revocation during active challenge window — specify behaviour: revocation should not cancel an active challenge

---

## Relationship to Pre-Audit Checklist

This spec closes the session channel liveness vulnerability flagged in pre-audit review. With watchtowers:

- Always-on nodes: daemon = watchtower, zero extra setup
- Intermittent users: public watchtower registered at `arc402 init`
- Enterprise: managed watchtower infrastructure

The liveness assumption for session channels is now: at least one of (your daemon, your registered watchtower) must be online and responsive during the challenge window. With redundant watchtowers, this approaches the reliability of any other network service.

---

## Out of Scope (v1)

- Watchtower incentive layer (paying watchtowers for their service)
- Watchtower slashing for provable failure to challenge
- Recursive watchtower delegation
- Cross-chain watchtower operation

*ARC-402 Watchtower Spec v0.1.0 | Created: 2026-03-13*
