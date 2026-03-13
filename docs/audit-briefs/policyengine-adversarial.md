# PolicyEngine — Adversarial Red-Team Brief

**For:** Mega Audit
**Priority:** HIGH — the PolicyEngine is where the ARC-402 security model lives or dies
**Date:** 2026-03-13

---

## What This Document Is

A targeted brief for auditors on the attack surface of the PolicyEngine contract. Standard coverage applies to the full contract. This brief identifies the specific adversarial scenarios the audit team should attempt to execute, not just review.

---

## The Security Model (What It's Supposed to Do)

PolicyEngine enforces per-transaction spending limits by category, blocklists, and shortlists for each wallet. The `validateSpend(wallet, category, amount, contextId)` function is the enforcement gate — a service agreement should fail to propose if spend validation fails.

The security property: **an agent operating an ARC-402 wallet cannot exceed the policy configured by the wallet owner, regardless of what the agent's reasoning layer decides.**

---

## The Critical Gap: No Cumulative Tracking

### The Salami Attack

**Severity: HIGH**

`validateSpend` checks `amount > categoryLimits[wallet][category]`. This is a per-transaction check only. There is no:
- Daily spend accumulation
- Session spend accumulation
- Cumulative tracking of any kind

**Attack vector:**

```
Policy: categoryLimits[wallet]["compute"] = 1 ETH per transaction
Real intent: max 1 ETH per day

Attacker (compromised agent) executes:
  tx #1: 0.99 ETH → validateSpend returns (true, "") ✅
  tx #2: 0.99 ETH → validateSpend returns (true, "") ✅
  tx #3: 0.99 ETH → validateSpend returns (true, "") ✅
  ... × 100 transactions = 99 ETH drained
```

The `contextId` parameter in `validateSpend` is accepted but **unused** (`bytes32 /*contextId*/`). It was presumably intended for context-binding (preventing replay across different sessions). It currently provides zero protection.

**What to verify:**
1. Confirm `contextId` is unused — no storage lookup, no deduplication
2. Confirm there is no per-period accumulation anywhere in the contract
3. Attempt the salami attack in a test environment and confirm it succeeds

**Recommended fix (for audit brief, not implementation scope):**
- Add `mapping(address => mapping(string => uint256)) public dailySpend`
- Add `mapping(address => mapping(string => uint256)) public periodStart`
- Reset daily accumulation when `block.timestamp > periodStart[wallet][category] + 1 days`
- `validateSpend` should check `dailySpend + amount <= dailyCategoryLimit`
- This is a significant scope change — flag it as pre-launch required

---

## contextId: Dead Parameter

**Severity: MEDIUM**

`validateSpend(wallet, category, amount, bytes32 /*contextId*/)` — the contextId is silently ignored.

Original intent (from IPolicyEngine presumably): bind spend validation to a specific agreement or session context, preventing replay of a validated spend across multiple agreements.

Current state: any call with any contextId succeeds if the amount is below the per-transaction limit. The same validation can be replayed against multiple agreements simultaneously.

**What to verify:**
1. Is contextId checked anywhere in the call stack? (ServiceAgreement → validateSpend)
2. Can two ServiceAgreements both call validateSpend with the same contextId and both succeed?
3. If yes — is this a practical drain vector given the per-transaction limit?

---

## Policy Update Mid-Session Race

**Severity: LOW-MEDIUM**

The wallet owner can call `setCategoryLimitFor(wallet, category, newLimit)` at any time. There is no timelock, no pending-period.

**Scenario:**
1. Agent initiates a high-value spend (propose() called, policy validated)
2. Owner lowers the limit before accept() is called
3. If ServiceAgreement re-validates at accept() — spend is blocked
4. If ServiceAgreement only validates at propose() — the lower limit has no effect

**What to verify:**
- At which lifecycle points does ServiceAgreement call validateSpend? (propose only? propose + accept?)
- If propose-only: a limit increase after propose() creates a false security guarantee
- If propose + accept: a limit decrease mid-negotiation creates a griefing vector (owner can block agent's legitimate pending agreements)

---

## Registration Hijacking (Ruled Out — Confirm)

`registerWallet` requires `msg.sender == wallet`. This prevents a third party from registering as the owner of a wallet they don't control.

**Confirm:**
- No path exists to call `registerWallet` with `wallet != msg.sender`
- Re-registration after owner is set is correctly blocked (`walletOwners[wallet] != address(0)`)
- `setCategoryLimitFor` authorization check (`walletOwners[wallet] == msg.sender || wallet == msg.sender`) is correct and cannot be bypassed

---

## Category Not Configured = Blocked (Intended Behavior — Verify Intent)

If `categoryLimits[wallet][category] == 0` (default unset value), `validateSpend` returns `(false, "category not configured")`.

This means: **a wallet with no configured categories cannot spend anything.**

**Intended:** yes, this is a safe default. An unconfigured wallet blocks all spending.

**Edge case to verify:**
- What happens if an agent tries to propose an agreement in a category the wallet hasn't configured?
- Does the error surface to the agent in a debuggable way?
- Can an attacker DOS an agent by somehow clearing its category limits? (Only wallet owner can clear — probably not, but verify)

---

## Shortlist Manipulation (Ruled Out — Confirm)

`addPreferred` and `removePreferred` are protected by `onlyWalletOwnerOrWallet`. The shortlist only affects which providers are preferred — it does not affect whether a transaction validates.

**Confirm:**
- Shortlist cannot be modified by a third party
- Shortlist data is informational (routing hint), not a security gate
- No path exists for a blocked provider to add themselves to the shortlist

---

## Gas Exhaustion: Session Channel + Policy Validation

**Severity: LOW (gas cost concern, not security)**

If every session channel state update calls `validateSpend`, the gas cost per API call increases. At 50 state updates/minute, the cumulative gas becomes meaningful.

**What to verify:**
- Does ServiceAgreement call `validateSpend` for each channel state update or only at `openSessionChannel`?
- If per-update: what is the gas cost at 1,000 updates/session?
- Recommended: validate at open only, with the max channel amount as the policy check value

---

## Red-Team Test Checklist

| Test | Expected Outcome | Priority |
|------|-----------------|---------|
| Salami attack: 100 × (limit-1) transactions | Currently succeeds — should fail | CRITICAL |
| contextId replay: same contextId, two agreements | Currently succeeds — behavior undefined | HIGH |
| Policy update mid-agreement: decrease limit | Document which lifecycle point enforces | MEDIUM |
| registerWallet from non-wallet address | Should revert | MEDIUM |
| setCategoryLimitFor from non-owner | Should revert | MEDIUM |
| addPreferred from non-owner | Should revert | LOW |
| validateSpend on unconfigured category | Returns (false, reason) — confirm surfacing | LOW |

---

## Auditor Instruction

**Attempt to drain a wallet while satisfying every individual policy rule.**

The salami attack is the most credible vector. Execute it. Confirm whether it succeeds. If it succeeds, this is a pre-launch blocker regardless of timeline pressure.

The PolicyEngine is the enforcement layer that separates "agent has a wallet" from "agent has a governed wallet." If the enforcement layer has holes, the governance moat doesn't exist.
