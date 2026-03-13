# ARC-402 Pre-Audit Engineering Handoff

**Date:** 2026-03-13
**Status:** Ready for final implementation pass before mega audit
**Frozen baseline:** `7c79ae7` (RC0 — do not touch)
**New branch:** `feature/pre-audit-final`

---

## What This Document Is

The complete list of what needs to be built, documented, and verified before the mega audit begins. Nothing in this list changes the protocol architecture. Everything here either closes a security gap, increases test coverage, or makes the audit surface honest and navigable.

Two audiences this protocol serves:
- **Average Joe:** Always-on home machine running OpenClaw. No cloud. No platform fees. Just Base gas.
- **Enterprise:** Agent fleets, governed wallets, internal relay and watchtower infrastructure.

Both are first-class. Both use the same protocol. The implementation must serve both.

---

## Section A: New Builds Required

### A1. Watchtower System (spec/22-watchtower.md)

**Why:** Session channels without liveness protection is a known attack vector. Ships with launch, not v2.

**What to build:**

Contract additions to ServiceAgreement (or standalone WatchtowerRegistry):
```solidity
function authorizeWatchtower(bytes32 channelId, address watchtower) external
function revokeWatchtower(bytes32 channelId, address watchtower) external
function submitWatchtowerChallenge(bytes32 channelId, bytes calldata latestState, address beneficiary) external
function isWatchtowerAuthorized(bytes32 channelId, address watchtower) external view returns (bool)
```

Reference watchtower server at `tools/watchtower/server.js`:
- Node.js single-file server
- Polls chain every 12s for close events on registered channels
- Auto-submits challenge when stale close detected
- In-memory state (Redis for production hardening)
- MIT licensed

OpenClaw daemon extension:
- `arc402 relay daemon start` activates relay + channel monitor simultaneously
- Auto-challenge stale closes on owned channels
- Daemon IS the watchtower for always-on home nodes

SDK additions:
- `authorizeWatchtower(channelId, watchtowerUrl)`
- `revokeWatchtower(channelId, watchtowerUrl)`
- Auto-submit state updates to watchtower every N state changes (configurable)

CLI additions:
- `arc402 channel watchtower register <channel-id> --watchtower <url>`
- `arc402 channel watchtower update <channel-id>`
- `arc402 channel watchtower list`
- `arc402 channel watchtower revoke <channel-id>`

`arc402 init` flow addition:
```
→ Is this machine always on? (y/n)
→ [n] Recommended: register with a watchtower for session channel protection.
→ Use ARC-402 public watchtower / Enter your own / Skip
```

### A2. Circuit Breaker / Emergency Pause

**Why:** If a critical vulnerability is discovered post-deploy, there must be a controlled pause mechanism. No serious protocol ships without this.

**What to build:**

```solidity
contract ProtocolGuardian {
    address public guardian;
    bool public paused;
    uint256 public constant TIMELOCK = 24 hours;

    // Pause is immediate (emergency)
    function pause() external onlyGuardian
    // Unpause requires 24h timelock (cannot rug under pressure)
    function queueUnpause() external onlyGuardian
    function executeUnpause() external onlyGuardian afterTimelock
}
```

All core contracts check `!protocolGuardian.paused()` on state-mutating operations. The guardian key is held by the governance multisig — not a single EOA.

Document: who holds the guardian key, what the pause/unpause process is, and that the guardian cannot steal funds (only pause operations).

### A3. Test Coverage Parity

**Why:** RC0 has 279 tests on 7 contracts. Post-freeze additions (DisputeArbitration, Session Channels, AgreementTree, CapabilityRegistry, Watchtower) need equivalent adversarial coverage. The audit will check test density.

**Required test coverage for each new contract:**

DisputeArbitration:
- [ ] Fee formula: floor, cap, class multipliers, edge cases ($0, very small, very large)
- [ ] Unilateral: win → 50% refund, lose → consumed, abusive → consumed + penalty
- [ ] Mutual: both fund, one defaults, settlement
- [ ] Arbitrator: bond deposit/withdraw, slash conditions (no-show, missed vote, rules violation)
- [ ] Trust writes: all outcome classes
- [ ] Reentrancy: closeDispute, resolveDisputeFee

Session Channels:
- [ ] Open: fund escrow, return channelId
- [ ] State update: sequence increment, cumulative payment, both sigs required
- [ ] Cooperative close: both sigs, immediate settlement, trust write
- [ ] Stale close + challenge: higher seq wins, bad-faith penalty
- [ ] Challenge window expiry: finalise without challenge
- [ ] Expired channel reclaim: deadline check
- [ ] Reentrancy: closeChannel, finaliseChallenge (ETH + ERC-20)
- [ ] Griefing: repeated challenge submissions with older states (must fail)

Watchtower:
- [ ] Authorize: only channel participant
- [ ] Revoke: only participant; cannot revoke during active challenge
- [ ] submitWatchtowerChallenge: must be authorized; state signatures valid; seq > current on-chain
- [ ] Unauthorized watchtower submission: must revert
- [ ] Stale state submission by watchtower: must revert

AgreementTree:
- [ ] A→B→C chain: happy path
- [ ] C fails: B's agreement with A not automatically voided (explicit scope)
- [ ] DAG traversal gas bounds: no unbounded loops

CapabilityRegistry:
- [ ] Governance-only root creation
- [ ] Invalid capability string rejection (format validation)
- [ ] 20 capability limit per agent
- [ ] Duplicate claim rejection
- [ ] Inactive root rejection

---

## Section B: Documentation Required

### B1. Threat Model Document

**File:** `reference/THREAT-MODEL-COMPLETE.md`

Cover all attack classes:
- Reentrancy paths: ServiceAgreement → DisputeArbitration → Session Channels (trace all external calls)
- Salami attack: daily cumulative limits + contextId replay protection (already fixed — document the fix)
- Gas griefing: CapabilityRegistry namespace loops, AgreementTree DAG traversal bounds
- Arbitrator collusion: why slashing is narrow in v1, what's deferred
- Sybil attacks on TrustRegistry: explicit scope statement (see B5)
- Upgrade key custody: wallet migration function — who authorises, what the migration path is
- PolicyEngine temporal boundaries (see B2)

### B2. PolicyEngine Temporal Boundary Clarification

**Verify and document:**
- What defines "a day" for daily cumulative limits: UTC midnight, rolling 24h window, or block-number epoch?
- Does cumulative spend track globally across ALL simultaneous agreements, or per-agreement?
- Answer: 100 concurrent agreements each under the per-agreement limit — do daily cumulative limits catch this?

If the implementation doesn't track cross-agreement global daily spend, this is a build fix, not just documentation.

### B3. Session Channel Liveness Parameters

**Document explicitly:**
- Default challenge window: 24 hours (justified)
- Minimum challenge window: 4 hours
- Liveness requirement: "At least one of (OpenClaw daemon, registered watchtower) must be responsive within the challenge window"
- What happens if both fail: stale state is finalised. This is a liveness failure, not a security failure. Document honestly.
- Watchtower redundancy recommendation: register at least 2 watchtowers for production channels

### B4. AgreementTree Liability Chain Scope

**Document explicitly:**
- In v1: A has no direct recourse against C if B subcontracts and C fails
- A's recourse is against B only (bilateral agreement)
- A's PolicyEngine cannot currently evaluate B's subcontracting risk
- This is a known v1 limitation. Named and scoped, not missed.

### B5. TrustRegistry Sybil Resistance Scope

**Document explicitly:**
- Creating a new wallet identity costs ~$0.30 on Base
- The trust system therefore protects against honest-but-incompetent agents
- Against adversarial sybil actors who burn and recreate identities, trust scores are currently advisory
- v2 consideration: staking, identity costs, or sponsorship attestation as sybil resistance

This is honest scope. State it clearly.

### B6. DisputeArbitration Fee Floor vs Micro-transactions

**Document explicitly:**
- $5 floor means disputes are economically irrational for transactions under ~$167
- Session channels enable micro-transactions below this threshold
- Intentional: the dispute system filters out noise and protects meaningful agreements
- For micro-transaction disputes: the trust/reputation consequence (not fee-based dispute) is the mitigation
- State this design decision clearly in DisputeArbitration docs

### B7. ERC-20 Token Handling

**Verify and document:**
- Does the wallet use Permit2 or traditional approve + transferFrom?
- Approval front-running: is there a risk window between approval and transferFrom?
- Document the chosen approach and its tradeoffs

### B8. Event Emission Audit

**One pass through every contract:**
- Every state mutation emits an event
- No silent state changes
- Events include all data needed for off-chain indexers (discovery, relay, channel monitoring)
- Log the audit result: contract name → events verified

---

## Section C: Pre-Audit Verification Checklist

Before handing to auditors, verify all of these are true:

### Contracts
- [ ] Circuit breaker deployed and wired into all core contracts
- [ ] Watchtower contract deployed and integrated with ServiceAgreement
- [ ] PolicyEngine daily limits are global (cross-agreement), not per-agreement
- [ ] All post-freeze contracts have adversarial test coverage (Section A3)
- [ ] Event emission audit complete (Section B8)
- [ ] No unbounded loops in CapabilityRegistry or AgreementTree

### Documentation
- [ ] THREAT-MODEL-COMPLETE.md written
- [ ] Session channel challenge window parameters documented
- [ ] PolicyEngine temporal boundaries documented and verified
- [ ] AgreementTree liability chain scope documented
- [ ] TrustRegistry sybil resistance scope documented
- [ ] DisputeArbitration fee floor vs micro-transactions documented
- [ ] ERC-20 token handling documented
- [ ] SECURITY-ASSUMPTIONS-RC0.md updated to reflect watchtower addition

### Tools
- [ ] Reference relay at `tools/relay/server.js` — functional, documented, MIT licensed
- [ ] Reference watchtower at `tools/watchtower/server.js` — functional, documented, MIT licensed
- [ ] `arc402 init` one-command setup — complete flow functional end-to-end
- [ ] `arc402 relay daemon start` activates relay + watchtower simultaneously
- [ ] `arc402 channel watchtower` subcommands functional

### Final freeze
- [ ] All implementations verified against their spec files
- [ ] New freeze tag cut on `feature/pre-audit-final`
- [ ] Audit target SHA documented in `reference/AUDIT-TARGET-SHA.txt`
- [ ] Test suite fully green: contracts + TS SDK + CLI + Python SDK

---

## Section D: Two Audiences — How the Protocol Serves Both

### Average Joe (always-on home node)

```
arc402 init
→ Wallet deployed
→ Skills auto-mapped to capabilities
→ Local relay started
→ Daemon started (= relay + watchtower built in)
→ Live. Costs: $2 deployment + Base gas per agreement.
```

Participates fully. Hires agents. Gets hired. Builds trust. Earns. No platform fees. No subscriptions.

### Enterprise (agent fleet operator)

```
arc402 deploy --fleet 50-agents \
  --relay https://relay.internal.company.com \
  --watchtower https://watchtower.internal.company.com \
  --governance-multisig 0x...
```

Fleet of governed wallets. Internal relay. Internal watchtower with SLA. Governance multisig controls policy changes. Full audit trail on-chain. Dispute resolution available. Same contracts as the home node — same trust, same settlement.

---

## Sequencing

```
1. Build A1 (Watchtower) + A2 (Circuit Breaker)
2. Build A3 (Test coverage parity across all new contracts)
3. Write B1–B8 (Documentation)
4. Run Section C verification checklist — everything green
5. Cut new freeze tag
6. Mega audit begins
```

Total scope: two new builds + test coverage + documentation. No architectural changes. No new primitives.

---

*ARC-402 Pre-Audit Engineering Handoff | 2026-03-13*
