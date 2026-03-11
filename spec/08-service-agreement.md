# Intelligence Layer 2: Service Agreement

**Status:** DRAFT  
**Version:** 0.1.0  
**Authors:** TBD  
**Created:** 2026-03-11

---

## Abstract

`ServiceAgreement` is an on-chain, escrow-backed contract between two ARC-402 agent wallets that formalises a unit of work. The client wallet locks payment in escrow when proposing the agreement. The provider wallet accepts, delivers, and claims escrow on fulfillment. If either party disputes the outcome, escrow remains locked pending resolution. The full lifecycle — propose, accept, fulfill, dispute, resolve — is recorded on-chain, creating an auditable work trail that feeds back into both parties' trust scores. ServiceAgreement is the mechanism by which agents transact with each other under contractual guarantees rather than informal API calls.

---

## Motivation

### The Problem with Informal Agent-to-Agent Calls

Without a formal agreement layer, agent-to-agent transactions are fire-and-forget API calls: Agent A sends a request, Agent B responds, Agent A pays (or doesn't). This pattern fails in four ways at scale:

**1. No payment guarantee for the provider.** Agent B has no assurance it will be paid before it begins work. It can demand pre-payment, but then Agent A has no assurance it will receive the deliverable. Without escrow, one party must extend trust first.

**2. No delivery guarantee for the client.** Agent A has no on-chain record of what was agreed. If Agent B delivers garbage, Agent A has no recourse and no evidence. The definition of "done" lives in an off-chain chat or a memory buffer that neither party controls.

**3. No audit trail.** When an agent pipeline fails, the post-mortem has no record of which service agreement was in flight, what was promised, who accepted, and what was delivered. Debugging multi-agent systems without an audit trail is guesswork.

**4. No shared accountability.** If both parties operate under ARC-402 but there is no shared on-chain record of their interaction, neither party's trust score can accurately reflect the outcome of the engagement. Trust scores become lagging indicators of self-reported behaviour.

ServiceAgreement solves all four. It makes the terms explicit, the payment automatic, and the history permanent.

### Why Escrow in the Contract

An alternative is a trusted third-party escrow agent (a human, a multisig, or an oracle). ARC-402 rejects this pattern for the same reason it rejects off-chain registries: trust should not depend on an operator.

Escrow held in the `ServiceAgreement` contract requires no operator trust. The rules for release are encoded in the contract and cannot be changed after deployment. The only party that can release escrow to the provider is the contract itself, triggered by a valid `fulfill()` call from the provider, or by the owner in a dispute resolution. No third party can steal the funds.

---

## Design

### Agreement Struct

Every service agreement is represented by a single `Agreement` struct:

```solidity
struct Agreement {
    uint256 id;              // Auto-incremented, starts at 1
    address client;          // Paying agent wallet
    address provider;        // Delivering agent wallet
    string serviceType;      // Short type tag matching AgentRegistry serviceType
    string description;      // Human/agent-readable statement of work
    uint256 price;           // Payment amount in wei (ETH) or token base units
    address token;           // ERC-20 token address, or address(0) for ETH
    uint256 deadline;        // Unix timestamp: provider must fulfill before this
    bytes32 deliverablesHash; // keccak256 of the agreed deliverables specification
    Status status;           // Current state machine position
    uint256 createdAt;       // Block timestamp of proposal
    uint256 resolvedAt;      // Block timestamp of terminal state (0 if open)
}
```

**`id`** — Auto-incremented from 1. IDs are permanent and never reused. An `id` of 0 is used as a sentinel to detect non-existent agreements.

**`client`** — The ARC-402 wallet that proposes and pays. Set to `msg.sender` at proposal time and immutable thereafter.

**`provider`** — The ARC-402 wallet that will deliver the service. The client selects the provider from a prior AgentRegistry discovery query. The provider is invited — they accept or ignore the proposal.

**`serviceType`** — Mirrors the `serviceType` field in `AgentInfo`. Provides a consistent taxonomy between the registry and the agreement layer. Clients SHOULD use the same value they found in the registry.

**`description`** — A plain text description of the work. This is the human/agent-readable statement of work. It is not validated on-chain; it serves as the record of intent for later dispute resolution.

**`price`** — The agreed payment. For ETH agreements, this is in wei. For ERC-20, it is in the token's base units (e.g., USDC uses 6 decimals, so 1 USDC = 1_000_000). Price is locked in escrow at proposal time and cannot change.

**`token`** — The payment token. `address(0)` represents native ETH. Any non-zero address is treated as an ERC-20 and must implement the standard transfer interface.

**`deadline`** — A Unix timestamp. The provider must call `fulfill()` before this timestamp or the client may call `expiredCancel()` to reclaim escrow. The deadline is set by the client at proposal time.

**`deliverablesHash`** — A `keccak256` hash of the deliverables specification document. This document (stored off-chain: IPFS, Arweave, or provider endpoint) defines exactly what constitutes successful delivery. When the provider calls `fulfill()`, they submit an `actualDeliverablesHash` — the hash of what they actually delivered. A mismatch between proposed and actual hashes signals the client that the deliverable content changed and is a legitimate basis for dispute.

**`status`** — The current position in the state machine. See [State Machine](#state-machine).

**`createdAt`** — Block timestamp at proposal. Immutable.

**`resolvedAt`** — Block timestamp at terminal state (`FULFILLED` or `CANCELLED`). Zero while the agreement is open or disputed.

---

## State Machine

```
                                                   ┌──────────────┐
              propose()                accept()    │   ACCEPTED   │
  [CLIENT] ──────────────→ PROPOSED ─────────────→│              │
                                │                  └──────┬───────┘
                                │                         │
                           cancel()                       ├──── fulfill() [PROVIDER] ──→ FULFILLED
                                │                         │
                                ↓                         ├──── dispute() [EITHER] ──→ DISPUTED
                           CANCELLED                      │                                  │
                                                          │                        resolveDispute()
                                                     expiredCancel()               [OWNER]
                                                     [CLIENT, post-deadline]       │
                                                          │                         ├──→ FULFILLED
                                                          ↓                         │
                                                     CANCELLED                      └──→ CANCELLED
```

### PROPOSED

**Entry:** `propose()` called by the client. Escrow is locked.

**Transitions:**

| Transition | Caller | Preconditions | Escrow Effect |
|------------|--------|---------------|---------------|
| `accept()` → ACCEPTED | Provider | Status == PROPOSED | Escrow remains locked |
| `cancel()` → CANCELLED | Client | Status == PROPOSED | Escrow refunded to client |

The provider is under no obligation to accept. If the provider does not accept before the deadline, the client SHOULD cancel and reclaim escrow. The contract does not auto-cancel on deadline for PROPOSED agreements — this is a deliberate choice to avoid gas costs for automated expiry; the client must act.

### ACCEPTED

**Entry:** `accept()` called by the provider. Both parties are now bound.

**Transitions:**

| Transition | Caller | Preconditions | Escrow Effect |
|------------|--------|---------------|---------------|
| `fulfill()` → FULFILLED | Provider | Status == ACCEPTED; `block.timestamp <= deadline` | Escrow released to provider |
| `dispute()` → DISPUTED | Client or Provider | Status == ACCEPTED | Escrow remains locked |
| `expiredCancel()` → CANCELLED | Client | Status == ACCEPTED; `block.timestamp > deadline` | Escrow refunded to client |

### FULFILLED

**Entry:** `fulfill()` called by the provider before the deadline.

**Terminal state.** No further transitions. `resolvedAt` is set. The provider has received payment.

### DISPUTED

**Entry:** `dispute()` called by either party on an ACCEPTED agreement.

**Transitions:**

| Transition | Caller | Preconditions | Escrow Effect |
|------------|--------|---------------|---------------|
| `resolveDispute(true)` → FULFILLED | Owner (arbiter) | Status == DISPUTED | Escrow released to provider |
| `resolveDispute(false)` → CANCELLED | Owner (arbiter) | Status == DISPUTED | Escrow refunded to client |

Escrow is locked for the duration of the dispute. Neither party can unilaterally claim it.

### CANCELLED

**Entry:** `cancel()`, `expiredCancel()`, or `resolveDispute(false)`.

**Terminal state.** No further transitions. `resolvedAt` is set. The client has received a refund.

---

## Escrow Model

### ETH Escrow

When `token == address(0)`, the agreement uses native ETH. The client sends `msg.value == price` with the `propose()` call. The ETH is held in the contract's balance. On release, the contract executes a low-level `call{value: amount}` to the recipient:

```solidity
(bool ok, ) = recipient.call{value: amount}("");
require(ok, "ServiceAgreement: ETH transfer failed");
```

The recipient must be able to receive ETH. ARC-402 wallets MUST implement a `receive()` function.

### ERC-20 Escrow

When `token != address(0)`, the agreement uses an ERC-20 token. The client MUST approve the contract for at least `price` tokens before calling `propose()`. The contract uses `SafeERC20.safeTransferFrom` to pull tokens at proposal time:

```solidity
IERC20(token).safeTransferFrom(msg.sender, address(this), price);
```

On release, the contract uses `SafeERC20.safeTransfer`:

```solidity
IERC20(token).safeTransfer(recipient, amount);
```

### Why SafeERC20

The ERC-20 standard does not require tokens to return a boolean from `transfer()` and `transferFrom()`. Some tokens (notably USDT on Ethereum) return nothing. Calling a raw `transfer()` on such tokens and checking the return value will silently fail in Solidity ≥ 0.8.x because the absence of a return value is not treated as success.

`SafeERC20` from OpenZeppelin wraps these calls with low-level assembly that correctly handles both the returning and non-returning cases. All ERC-20 interactions in ServiceAgreement MUST use `SafeERC20`.

### Why ReentrancyGuard

ETH release (`call{value: amount}`) transfers execution control to the recipient. A malicious or compromised recipient contract could re-enter the `ServiceAgreement` contract during the ETH transfer and call `fulfill()` or `cancel()` again before the state update completes — potentially draining escrow from multiple agreements.

The contract uses OpenZeppelin's `ReentrancyGuard` to prevent this. All state-changing functions that release escrow are marked `nonReentrant`.

### CEI Pattern

Within each function, the implementation follows the Checks-Effects-Interactions (CEI) pattern:

1. **Checks** — Verify caller, status, and preconditions (`require` statements)
2. **Effects** — Update contract state (`ag.status`, `ag.resolvedAt`)
3. **Interactions** — Call external contracts (emit events, release escrow)

State is updated before escrow is released. If the external call fails, the entire transaction reverts, including the state change. This ensures that a failed ETH transfer does not leave the agreement in a terminal state with escrow still locked.

---

## Dispute Resolution

### v1: Owner-Resolved

In the v1 implementation, dispute resolution is centralised to the contract owner. The owner is an `address` set in the constructor and transferable via `transferOwnership()`. When a dispute is raised, the owner reviews the evidence off-chain (deliverables hash, description, any off-chain communication) and calls `resolveDispute(agreementId, favorProvider)`.

The `resolveDispute` function has two outcomes:
- `favorProvider = true`: The provider's work is deemed complete. Agreement transitions to FULFILLED and escrow goes to the provider.
- `favorProvider = false`: The provider's work is deemed insufficient. Agreement transitions to CANCELLED and escrow is refunded to the client.

The owner is expected to be a trusted arbiter — this could be a multisig controlled by the protocol deployer, a DAO governance contract, or an oracle module. Who holds the owner role is a deployment decision, not a protocol specification.

This is acknowledged as a centralisation vector. It is an acceptable tradeoff for v1 in exchange for simplicity and deployability.

### Future Direction: Oracle-Based Arbitration

A v2 dispute resolution system SHOULD replace the single owner with one of the following models:

**Option A — Decentralised arbitration network.** The dispute is submitted to an on-chain arbitration protocol (e.g., Kleros, UMA Optimistic Oracle). A panel of jurors reviews evidence submitted to IPFS and votes on the outcome. The vote triggers `resolveDispute()` via a governance-approved oracle callback.

**Option B — Stake-weighted provider arbitration.** Agents in the Autonomous trust tier (score 800–1000) form an arbitration panel. They stake to participate, review disputes in their domain (by `serviceType`), and vote. Incorrect votes slash stake. This aligns incentives: high-trust agents have the most to lose from a corrupt arbitration.

**Option C — Commit-reveal with auto-release timer.** The dispute window is time-bounded. If neither party escalates to the owner within N days, escrow auto-releases to the provider. This places the burden of initiating formal arbitration on the client, which reduces spam disputes.

All three options require protocol changes and are not defined in the v1 spec.

---

## Security Considerations

### Reentrancy

All escrow-releasing functions (`fulfill`, `cancel`, `expiredCancel`, `resolveDispute`) are guarded by `nonReentrant`. The CEI pattern is followed in all cases. State transitions happen before external calls.

### Zero-Price Agreements

The `propose()` function reverts on `price == 0`. Zero-price agreements would create agreements with no economic stake — no escrow to lock, no payment to release. They would pollute the audit trail and could be used to generate false positive trust score updates. Implementors MUST enforce `price > 0`.

### Expired Agreements

An ACCEPTED agreement past its deadline can be cancelled by the client via `expiredCancel()`. A provider that misses the deadline loses the right to call `fulfill()` — the `require(block.timestamp <= ag.deadline)` check in `fulfill()` reverts if the deadline has passed.

There is a grace period consideration: if a provider submits `fulfill()` in the same block as the deadline timestamp, the call succeeds (the check is `<=`). Clients setting deadlines SHOULD account for block timing uncertainty (±12 seconds per Ethereum block).

### Deliverables Hash Mismatch

The `deliverablesHash` in the proposed agreement is the hash of the *expected* deliverables specification. The `actualDeliverablesHash` submitted in `fulfill()` is the hash of *what was actually delivered*. The contract does not enforce that these match — it stores both and emits both in events.

This is intentional: the contract cannot evaluate whether the deliverable is correct. Matching hashes mean the provider is claiming the delivered spec is identical to the agreed spec. Mismatching hashes signal the client to inspect the deliverable before accepting. Mismatches are a legitimate basis for dispute.

### Dispute Spam

Either party can raise a dispute at any time on an ACCEPTED agreement. There is no cost to raising a dispute in v1. This opens a potential vector: the client raises a spurious dispute to delay payment to the provider.

Mitigations in v1:
- The owner can resolve disputes quickly, limiting delay.
- Spurious disputes by a client will appear in the client's on-chain record and SHOULD be factored into the client's trust score in a future trust scoring update.

Future versions SHOULD require a dispute stake from the initiating party, slashable if the dispute is resolved against them.

### Self-Agreement

The `propose()` function reverts if `provider == msg.sender`. An agreement with the same party on both sides has no economic meaning and would create an exploitable accounting loop.

---

## Auto-Release

### v1: Immediate Release on Fulfill

In v1, when the provider calls `fulfill()`, escrow is released immediately to the provider in the same transaction. The client has no window to contest the delivery before payment clears. The client's recourse is:

1. Call `dispute()` after the fact if they observed the delivery was incorrect — but escrow has already been released. In v1, `dispute()` is only valid on ACCEPTED agreements, not FULFILLED ones.
2. Accept the loss and penalise the provider via the trust score system (future).

This is a known limitation of v1. It is acceptable in contexts where:
- The deliverables hash match is sufficient proof of delivery
- The trust score history of the provider provides adequate confidence
- The agreement value is below the client's trust-based threshold for prior verification

### Future Direction: Two-Step Commit-Reveal

A v2 auto-release model SHOULD introduce a challenge window:

1. Provider submits `fulfillCommit(agreementId, deliverableHash)` — signals intent to claim, escrow not yet released.
2. A challenge window opens (e.g., 24 hours). The client may call `challenge()` during this window to escalate to DISPUTED.
3. If no challenge arrives, `fulfillReveal()` releases escrow to the provider automatically.

This pattern guarantees the client a review window while keeping the system trustless (the release is automatic if no challenge occurs). It requires an additional transaction from the provider but provides meaningful delivery assurance to clients.

---

## Interface

The `IServiceAgreement` interface defines the minimum required surface:

```solidity
interface IServiceAgreement {

    enum Status { PROPOSED, ACCEPTED, FULFILLED, DISPUTED, CANCELLED }

    struct Agreement {
        uint256 id;
        address client;
        address provider;
        string serviceType;
        string description;
        uint256 price;
        address token;
        uint256 deadline;
        bytes32 deliverablesHash;
        Status status;
        uint256 createdAt;
        uint256 resolvedAt;
    }

    /// @notice Client proposes a service agreement, locking escrow.
    /// @dev For ETH: msg.value == price. For ERC-20: approve this contract first.
    /// @return agreementId The new agreement's ID (starts at 1)
    function propose(
        address provider,
        string calldata serviceType,
        string calldata description,
        uint256 price,
        address token,
        uint256 deadline,
        bytes32 deliverablesHash
    ) external payable returns (uint256 agreementId);

    /// @notice Provider accepts a PROPOSED agreement.
    /// @dev Escrow remains locked. Status → ACCEPTED.
    function accept(uint256 agreementId) external;

    /// @notice Provider marks the agreement fulfilled and claims escrow.
    /// @dev Must be called before deadline. Status → FULFILLED. Escrow → provider.
    function fulfill(uint256 agreementId, bytes32 actualDeliverablesHash) external;

    /// @notice Client or provider raises a dispute on an ACCEPTED agreement.
    /// @dev Escrow remains locked. Status → DISPUTED.
    function dispute(uint256 agreementId, string calldata reason) external;

    /// @notice Client cancels a PROPOSED agreement and retrieves escrow.
    /// @dev Only valid on PROPOSED. Status → CANCELLED. Escrow → client.
    function cancel(uint256 agreementId) external;

    /// @notice Returns a full Agreement struct by ID.
    function getAgreement(uint256 id) external view returns (Agreement memory);
}
```

### Function Reference

| Function | Caller | From Status | To Status | Escrow |
|----------|--------|-------------|-----------|--------|
| `propose(...)` | Client | — | PROPOSED | Locked from client |
| `accept(id)` | Provider | PROPOSED | ACCEPTED | Unchanged |
| `fulfill(id, hash)` | Provider | ACCEPTED | FULFILLED | Released to provider |
| `dispute(id, reason)` | Client or Provider | ACCEPTED | DISPUTED | Locked |
| `cancel(id)` | Client | PROPOSED | CANCELLED | Refunded to client |
| `expiredCancel(id)` | Client | ACCEPTED (past deadline) | CANCELLED | Refunded to client |
| `resolveDispute(id, true)` | Owner | DISPUTED | FULFILLED | Released to provider |
| `resolveDispute(id, false)` | Owner | DISPUTED | CANCELLED | Refunded to client |
| `getAgreement(id)` | Anyone | Any | Any (view) | Unchanged |
| `getAgreementsByClient(addr)` | Anyone | Any | Any (view) | Unchanged |
| `getAgreementsByProvider(addr)` | Anyone | Any | Any (view) | Unchanged |

---

## Example

### Full Walkthrough: Research Task Delegation

**Setup.** An insurance orchestration agent (`0xOrch`) needs a legal analysis of a specific contract clause. It has discovered `0xLegal` in the AgentRegistry (see `07-agent-registry.md`) and verified its trust score is 520 (Standard tier). Both wallets are ARC-402 compliant.

**Step 1 — Client produces an intent attestation (ARC-402 governance)**

Before spending, `0xOrch` produces an Intent Attestation (see `04-intent-attestation.md`):

```json
{
  "action": "pay_subagent",
  "reason": "Hire LexAgent to analyse clause 7.3 of contract #IC-2026-0042 for coverage exclusion risk",
  "expected_outcome": "Legal risk assessment document, keccak256 hash of deliverable spec committed",
  "policy_reference": "policy-abc123:agent_payment"
}
```

The attestation is signed and stored. The wallet's Policy Object is checked — the `agent_payment` category allows up to 200 USDC per transaction. The proposed price (50 USDC) is within policy.

**Step 2 — Client proposes the agreement**

`0xOrch` approves the `ServiceAgreement` contract for 50 USDC and calls `propose()`:

```solidity
uint256 agreementId = serviceAgreement.propose(
    0xLegal,                                              // provider
    "LLM",                                                // serviceType
    "Analyse clause 7.3 of contract IC-2026-0042",        // description
    50_000_000,                                           // price: 50 USDC (6 decimals)
    USDC_ADDRESS,                                         // token
    block.timestamp + 2 days,                             // deadline
    keccak256(abi.encodePacked(deliverablesSpec))          // deliverablesHash
);
// agreementId = 42
```

50 USDC is transferred from `0xOrch` to the contract. Status = PROPOSED. The contract emits `AgreementProposed`.

**Step 3 — Provider accepts**

`0xLegal` receives the `AgreementProposed` event (via its event listener) and reviews the terms. The description and deliverables spec match the request it received at its endpoint. It calls:

```solidity
serviceAgreement.accept(42);
```

Status = ACCEPTED. Both parties are now bound. `0xLegal` begins the research.

**Step 4 — Provider delivers and fulfills**

`0xLegal` completes the legal analysis, uploads the result to IPFS, and calls:

```solidity
serviceAgreement.fulfill(42, keccak256(abi.encodePacked(actualDeliverable)));
```

The contract verifies:
- `msg.sender == ag.provider` ✓
- `ag.status == ACCEPTED` ✓
- `block.timestamp <= ag.deadline` ✓

Status → FULFILLED. `ag.resolvedAt` = now. 50 USDC is transferred to `0xLegal`. The contract emits `AgreementFulfilled` with the `actualDeliverablesHash`.

**Step 5 — Client verifies delivery**

`0xOrch` reads the `AgreementFulfilled` event. The `actualDeliverablesHash` matches the hash of the IPFS document it received from `0xLegal`'s endpoint. The deliverable is accepted.

**Step 6 — Trust score update (future)**

In a future trust scoring extension, both parties' trust scores are updated:
- `0xLegal` receives a positive delta for a fulfilled, on-time agreement
- `0xOrch` receives a positive delta for a completed coordination task

The audit trail — proposal, acceptance, fulfillment, hashes — is permanently on-chain at agreement ID 42.

---

## Relationship to ARC-402 Wallet

ServiceAgreement does not interact with ARC-402 wallets directly. The client wallet calls `propose()` from its own execution context. The ARC-402 wallet's policy governs *whether that call is authorised*, not how the call executes.

Before calling `propose()`, the ARC-402 wallet:

1. Checks the active Context Binding — is this type of agent payment authorised for the current task?
2. Checks the Policy Object — is the price within the `agent_payment` category limit?
3. Produces an Intent Attestation — records why this agreement is being created
4. Verifies the provider trust score against the policy's minimum threshold for this category

If all checks pass, the wallet submits the `propose()` transaction. The ServiceAgreement contract holds the escrow. The ARC-402 governance layer authorised the spend; the ServiceAgreement layer enforces the delivery contract.

This separation means:
- A wallet with a restrictive policy cannot be tricked into creating agreements above its policy limits
- A wallet without an active context cannot create agreements (the policy check fails)
- Every agreement creation is accompanied by an Intent Attestation that explains why

```
ARC-402 Wallet (governs spend authority)
      │
      │  policy check passes
      ↓
ServiceAgreement.propose() (locks escrow, enforces delivery)
      │
      │  agreement fulfilled
      ↓
Escrow released to provider wallet
```

---

## Requirements

### MUST
- Escrow MUST be locked at proposal time; no agreement may be created without locking
- `price` MUST be > 0
- `provider` MUST NOT equal `client`
- `deadline` MUST be in the future at proposal time
- All escrow-releasing functions MUST be guarded against reentrancy
- ERC-20 interactions MUST use SafeERC20

### SHOULD
- Client wallets SHOULD produce an Intent Attestation before calling `propose()`
- Client wallets SHOULD verify provider trust score before calling `propose()`
- The owner role for dispute resolution SHOULD be a multisig or governance contract, not an EOA
- Implementations SHOULD emit events on all status transitions

### MUST NOT
- Implementations MUST NOT allow `fulfill()` to be called after the deadline
- Implementations MUST NOT allow state transitions on terminal agreements (FULFILLED, CANCELLED)
- Implementations MUST NOT allow `dispute()` on agreements not in ACCEPTED state
