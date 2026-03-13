# ARC-402 Spec — 18: Session Channels

**Status:** DRAFT  
**Version:** 0.1.0  
**Created:** 2026-03-13  
**Scope:** High-frequency micro-payment sessions between agents. Extension to ServiceAgreement. Required for X402 at scale.

---

## Motivation

The base ServiceAgreement model (propose → accept → deliver → verify) costs 4 on-chain transactions and ~8–10 seconds for a complete cycle. For governed service agreements on meaningful tasks, this is fine.

For high-frequency agent interactions — dozens of API calls per minute, streaming compute, per-token billing — it is a hard bottleneck. A provider charging $0.001 per API call cannot wait 2 seconds per call for on-chain confirmation.

Session channels solve this by moving the per-interaction accounting off-chain while keeping the financial guarantee on-chain.

**Pattern:** Open one channel (1 tx). Exchange unlimited signed state updates off-chain (0 gas, ~1ms each). Close the channel (1 tx). Trust and settlement are on-chain at open and close. Everything in between is free.

---

## Design Principles

1. **Same security guarantees as ServiceAgreement.** The financial commitment is on-chain. The intermediate state is enforced by cryptographic signatures, not trust.
2. **Either party can close at any time.** No party is locked in. The latest signed state wins.
3. **Dispute is narrow and mechanical.** Channel disputes are not about quality — they are about which signed state is the latest. Higher sequence number wins.
4. **Trust registry updates on close.** A clean channel close writes a positive outcome to TrustRegistry. Bad-faith close attempts write a penalty.
5. **Transport agnostic.** State updates are signed JSON blobs. They travel over whatever transport the agents use.

---

## Channel Lifecycle

```
OPEN      → openSessionChannel()         1 on-chain tx
  │
  ├─ [call #1] → signed state update     0 gas, ~1ms
  ├─ [call #2] → signed state update     0 gas, ~1ms
  ├─ [call #N] → signed state update     0 gas, ~1ms
  │
CLOSE     → closeChannel()               1 on-chain tx
              (cooperative — both sigs)
  OR
CHALLENGE → challengeChannel()           1 on-chain tx
              (if cooperative close fails or party submits stale state)
  │
SETTLE    → automatic on close/challenge resolution
              escrow released, TrustRegistry updated
```

---

## State Structure

### ChannelState (off-chain signed object)

```json
{
  "channelId": "0x...",
  "agreementId": "0x...",
  "sequenceNumber": 47,
  "callCount": 47,
  "cumulativePayment": "23000000000000000",
  "token": "0x0000000000000000000000000000000000000000",
  "timestamp": 1710302100,
  "clientSig": "0x...",
  "providerSig": "0x..."
}
```

**sequenceNumber** — monotonically increasing. Disputes are resolved by the highest sequence number. Never reuse or skip.

**cumulativePayment** — total amount owed to provider as of this state. Always increasing. Never decreasing.

**Both signatures required** — a state update is only valid when both client and provider have signed it. An unsigned or single-signed state cannot be used for channel close or challenge.

---

## Contract Interface

### New methods on ServiceAgreement (channel mode)

```solidity
/// @notice Open a session channel. Deposits maxAmount into escrow.
/// @param provider The provider's wallet address
/// @param token ERC-20 token address (address(0) for ETH)
/// @param maxAmount Maximum amount client authorises for this session
/// @param ratePerCall Expected rate per call (informational, not enforced on-chain)
/// @param deadline Channel expiry timestamp
/// @return channelId Unique channel identifier
function openSessionChannel(
    address provider,
    address token,
    uint256 maxAmount,
    uint256 ratePerCall,
    uint256 deadline
) external payable returns (bytes32 channelId);

/// @notice Cooperatively close a channel with the final agreed state.
///         Both signatures required. Immediate settlement.
/// @param channelId The channel to close
/// @param finalState ABI-encoded ChannelState with both sigs
function closeChannel(
    bytes32 channelId,
    bytes calldata finalState
) external;

/// @notice Submit a challenge if counterparty closes with a stale state,
///         or force-close an unresponsive channel after deadline.
/// @param channelId The channel to challenge
/// @param latestState ABI-encoded ChannelState with both sigs (must have higher seq)
function challengeChannel(
    bytes32 channelId,
    bytes calldata latestState
) external;

/// @notice Finalise a challenge after the challenge window expires.
/// @param channelId The channel to finalise
function finaliseChallenge(bytes32 channelId) external;

/// @notice Client-only: reclaim unspent funds if channel expires without provider close.
/// @param channelId The expired channel to reclaim
function reclaimExpiredChannel(bytes32 channelId) external;
```

### Channel state enum

```solidity
enum ChannelStatus {
    OPEN,           // Active — state updates flowing
    CLOSING,        // closeChannel() called — challenge window open
    CHALLENGED,     // challengeChannel() called — dispute in progress
    SETTLED         // Final — funds released, TrustRegistry updated
}
```

### Storage

```solidity
struct Channel {
    address client;
    address provider;
    address token;
    uint256 depositAmount;       // Total escrowed
    uint256 settledAmount;       // Amount released to provider on close
    uint256 lastSequenceNumber;  // Highest accepted sequence number
    uint256 deadline;            // Channel expiry
    uint256 challengeExpiry;     // Set when closeChannel() called
    ChannelStatus status;
}

mapping(bytes32 => Channel) public channels;
```

---

## Off-Chain Protocol

### Per-call flow (client-initiated)

```
1. Client executes API call with provider
2. Provider returns result
3. Client signs new ChannelState:
   { sequenceNumber: prev+1, cumulativePayment: prev+rate, ... }
4. Client sends signed state to provider
5. Provider verifies:
   - sequenceNumber > lastKnownSequenceNumber
   - cumulativePayment >= prev cumulativePayment
   - clientSig is valid
6. Provider countersigns and sends back
7. Both store the doubly-signed state as the latest
```

Both parties always hold the **latest doubly-signed state**. This is the final financial obligation. The contract will honour it.

### State storage requirement

Both parties MUST persist every doubly-signed state update. Losing state is a self-inflicted loss — you cannot prove your payment claim without the signed state.

Recommended: agent runtime stores channel states in an append-only local log keyed by channelId + sequenceNumber.

---

## Cooperative Close

When the session is complete, either party initiates close:

```
1. Either party calls closeChannel(channelId, finalState)
2. Contract verifies both signatures on finalState
3. Contract releases settledAmount to provider
4. Contract refunds (depositAmount - settledAmount) to client
5. TrustRegistry updated: clean close → positive outcome for both parties
6. Channel status → SETTLED
```

No challenge window in cooperative close. Immediate settlement.

---

## Dispute: Challenge Window

If a party attempts to close with a stale state (lower sequence number than the real latest), the other party has a **challenge window** to submit the correct state.

```
1. Party A calls closeChannel(channelId, staleState)
   — sequenceNumber: 20, but real latest is 47
2. Contract opens challenge window (default: 24 hours)
3. Party B calls challengeChannel(channelId, realState)
   — sequenceNumber: 47
4. Contract verifies realState.sequenceNumber > staleState.sequenceNumber
5. Challenge window closes immediately
6. Contract settles using realState
7. Party A (who submitted stale state) receives a trust penalty
8. TrustRegistry: Party A = bad-faith close penalty
```

### After challenge window expires without challenge

If no valid challenge is submitted within the window:

```
1. finaliseChallenge(channelId) can be called by anyone
2. Contract settles using the state submitted in closeChannel()
3. TrustRegistry: normal close outcome
```

### Slashing for bad-faith challenge

If Party A submits a state they know is stale and Party B successfully challenges:

- Party A's trust score is penalised (same weight as a losing dispute)
- A protocol-defined portion of Party A's unspent channel deposit may be forfeited (v1: trust penalty only, no deposit slash — keep audit surface narrow)

---

## Expired Channel Recovery

If a channel reaches its deadline and the provider has not closed it:

```
1. Client calls reclaimExpiredChannel(channelId) after deadline
2. Contract verifies deadline has passed and channel is still OPEN
3. Full deposit returned to client
4. TrustRegistry: provider gets a non-response flag (minor penalty)
```

This protects clients from funds being locked indefinitely.

---

## Integration with X402

The session channel is the correct settlement layer for X402 pay-per-call APIs.

**Pattern:**

```
1. Agent discovers API endpoint in AgentRegistry
2. Agent calls GET /api/resource
3. Server returns 402 with ARC-402 session channel terms:
   { channelRequired: true, ratePerCall: "0.001 USDC", maxCalls: 1000 }
4. X402Interceptor calls openSessionChannel() on agent's ARC402Wallet
5. Agent retries request with channelId in header
6. Every subsequent call: X402Interceptor signs a state update, attaches to request
7. Provider countersigns, returns result
8. Session ends: either party calls closeChannel()
```

No per-call transactions. No per-call gas. Payments flow at API speed.

---

## Trust Registry Integration

| Event | TrustRegistry write |
|-------|---------------------|
| Cooperative close | Positive outcome for both parties (equivalent to clean ServiceAgreement completion) |
| Successful challenge | Challenger: neutral. Bad-faith closer: trust penalty |
| Expired channel reclaim | Provider: non-response flag (minor penalty) |
| Channel open (no close) | No write until close |

---

## SDK Additions

### New methods

```typescript
// Open a session channel
openSessionChannel(
  provider: string,
  token: string,
  maxAmount: bigint,
  ratePerCall: bigint,
  deadline: number
): Promise<{ channelId: string; txHash: string }>

// Sign a state update (off-chain, no gas)
signStateUpdate(
  channelId: string,
  sequenceNumber: number,
  callCount: number,
  cumulativePayment: bigint
): Promise<ChannelState>

// Verify a counterparty's state update
verifyStateUpdate(state: ChannelState): Promise<boolean>

// Cooperatively close a channel
closeChannel(channelId: string, finalState: ChannelState): Promise<{ txHash: string }>

// Challenge a stale close
challengeChannel(channelId: string, latestState: ChannelState): Promise<{ txHash: string }>

// Get channel status
getChannelStatus(channelId: string): Promise<Channel>

// Get all open channels for a wallet
getOpenChannels(wallet: string): Promise<Channel[]>
```

### New types

```typescript
interface ChannelState {
  channelId: string
  agreementId: string
  sequenceNumber: number
  callCount: number
  cumulativePayment: bigint
  token: string
  timestamp: number
  clientSig?: string
  providerSig?: string
}

interface Channel {
  client: string
  provider: string
  token: string
  depositAmount: bigint
  settledAmount: bigint
  lastSequenceNumber: number
  deadline: number
  challengeExpiry: number
  status: 'OPEN' | 'CLOSING' | 'CHALLENGED' | 'SETTLED'
}
```

---

## CLI Additions

```bash
# Open a session channel
arc402 channel open <provider> --token <address> --max <amount> --rate <amount> --deadline <timestamp>

# Get channel status
arc402 channel status <channel-id>

# List open channels for a wallet
arc402 channel list <wallet-address>

# Close a channel cooperatively
arc402 channel close <channel-id>

# Challenge a stale close
arc402 channel challenge <channel-id> --state <path-to-state-file>

# Reclaim an expired channel
arc402 channel reclaim <channel-id>
```

---

## Python SDK Additions

Same method surface as TypeScript SDK. Add to:
- `python-sdk/arc402/channel.py` (new module)
- `python-sdk/arc402/types.py` (ChannelState, Channel types)
- `python-sdk/tests/test_channel.py` (unit + integration tests)

---

## Audit Surface (Added)

1. Channel state arithmetic — cumulativePayment never decreases, sequenceNumber never resets
2. Signature verification — both sigs required for valid state; ecrecover correctness
3. Challenge window timing — cannot be bypassed or manipulated
4. Deposit isolation — channel deposits do not mix with ServiceAgreement escrow
5. Expired channel reclaim — deadline check cannot be bypassed
6. Trust penalty application — bad-faith close correctly writes to TrustRegistry
7. Reentrancy in closeChannel / finaliseChallenge (ETH and ERC-20 paths)
8. Sequence number overflow (uint256 — not a practical concern but verify)

---

## Sequencing

1. Implement DisputeArbitration + ServiceAgreement 4 surgical changes (current task)
2. Implement SessionChannel extension to ServiceAgreement
3. Add SDK + CLI methods for channels
4. Full test suite: unit + integration + adversarial (stale state, replay, expired reclaim)
5. Refreeze at new RC tag
6. Mega audit covers: contracts + channels + arbitration + SDK + CLI + docs

---

## Out of Scope (v1)

- Multi-hop channels (Agent A → B → C in a single channel)
- Channel factories (batch open)
- Watchtower services (third-party challenge submission on your behalf)
- Streaming token flow (continuous per-second payment, not per-call)

*These are natural v2 extensions. The channel primitive is the foundation.*

---

*Spec: ARC-402 Session Channels v0.1.0 | Created: 2026-03-13*
