# ARC-402 Independent Security Audit — Auditor A (Attacker Mindset)
**Date:** 2026-03-11  
**Scope:** Cold read of all ARC-402 smart contracts (no prior audit context)  
**Approach:** Attacker mindset — every function is an attack surface  
**Status of contracts reviewed:** DRAFT — not audited (per contract headers)

---

## Finding A-1: WalletFactory Creates Wallets Owned by the Factory, Not the User

**Severity:** CRITICAL  
**Contract:** WalletFactory.sol  
**Function:** `createWallet()`  
**Line:** ~30

**Attack scenario:**
1. Victim calls `WalletFactory.createWallet()`.
2. Internally: `new ARC402Wallet(registry)` is called. Inside the `ARC402Wallet` constructor, `owner = msg.sender` — but `msg.sender` is the **WalletFactory contract address**, not the victim's EOA.
3. The wallet is deployed with `owner = WalletFactory`.
4. WalletFactory has no functions to forward owner-controlled calls (no `openContext`, `executeSpend`, `executeTokenSpend`, etc.).
5. The victim's wallet is permanently locked: all `onlyOwner` functions are inaccessible to the user.
6. If WalletFactory held ETH or tokens on behalf of users, those funds would be permanently unrecoverable.

**Impact:**
All wallets created through WalletFactory are permanently owned by the factory contract. No user can ever call `openContext()`, `executeSpend()`, `executeTokenSpend()`, `freeze()`, `unfreeze()`, `updatePolicy()`, or `setRegistry()`. The wallet is bricked at creation. Any ETH or tokens deposited into these wallets (via `receive()`) are permanently locked.

**Preconditions:**
- Any user calls `createWallet()` on the deployed WalletFactory (default expected usage path).

**Likelihood:**
Certain — this is the expected path for all users who follow the factory pattern. No special skill required to trigger; it happens automatically on every `createWallet()` call.

---

## Finding A-2: IntentAttestation `verify()` Does Not Validate Spend Parameters — Attestations Are Fully Replayable

**Severity:** CRITICAL  
**Contract:** IntentAttestation.sol + ARC402Wallet.sol  
**Function:** `verify()` / `executeSpend()` / `executeTokenSpend()`  
**Line:** IntentAttestation.sol ~55; ARC402Wallet.sol ~132, ~167

**Attack scenario:**

**Part 1 — Parameter mismatch (attestation laundering):**
1. Wallet owner (agent) calls `intentAttestation.attest(id, "api_call", "Pay $1 for API", api_vendor, 1e6, USDC)` — attests a $1 USDC payment to `api_vendor`.
2. Wallet owner then calls `wallet.executeTokenSpend(USDC, attacker_wallet, 1_000_000e6, "api_call", same_id)` — uses the $1 attestation to authorize a $1,000,000 transfer to themselves.
3. `verify(id, address(wallet))` only checks: (a) attestation exists, (b) created by this wallet. It does NOT check recipient, amount, or token.
4. Policy check (category limit) is the only remaining guard — but if the attacker also controls policy limits (e.g. via `setCategoryLimitFor` — see Finding A-4), even this can be bypassed.

**Part 2 — Attestation replay:**
1. Wallet owner creates a single attestation for a small legitimate payment: `attest(id, ...)`.
2. Calls `executeSpend(recipient, amount, "category", id)` — succeeds.
3. Calls `executeSpend(recipient, amount, "category", id)` **again** with the same `id`.
4. `verify()` still returns `true` — the attestation is never marked as used.
5. The wallet owner can drain the wallet making the same `executeSpend` call N times with a single attestation.

**Impact:**
- Part 1: The entire intent attestation system — the "audit trail of why" — is meaningless as a binding constraint. Off-chain compliance and monitoring systems that rely on attestation data to understand what was authorized will see misleading records.
- Part 2: A wallet owner can execute unlimited spends using a single attestation, bypassing the implied "one attestation per intent" design. The audit log shows 1 intent but N fund transfers.
- Combined, the attestation primitive provides zero security guarantees on spend parameters.

**Preconditions:**
- Wallet owner controls both attestation creation and spend execution (by design).
- No external system enforces one-attestation-per-spend.

**Likelihood:**
Certain — no code prevents this. Anyone who understands the contracts can exploit Part 2 immediately.

---

## Finding A-3: ARC402Wallet Cannot Create Attestations — Core Spend Flow Is Permanently Broken

**Severity:** HIGH  
**Contract:** ARC402Wallet.sol + IntentAttestation.sol  
**Function:** `executeSpend()` / `executeTokenSpend()` / `attest()`  
**Line:** ARC402Wallet.sol ~132; IntentAttestation.sol ~38

**Attack scenario (for a protocol attacker attempting to exploit broken functionality):**
1. Legitimate user deploys wallet directly (not via factory). `owner = user_EOA`.
2. User wants to call `executeSpend(recipient, amount, category, attestationId)`.
3. Before this, the attestation must pass: `verify(attestationId, address(wallet_contract))` checks `attestations[id].wallet == wallet_contract_address`.
4. The wallet contract address can only appear as `attestations[id].wallet` if the **wallet contract itself** called `intentAttestation.attest()` — because `attest()` records `msg.sender` as `wallet`.
5. ARC402Wallet has **no function to call `intentAttestation.attest()`**. There is no `createAttestation()` or `attest()` wrapper in the wallet contract.
6. If the user EOA calls `attest()` directly, `msg.sender = EOA`, so `attestations[id].wallet = EOA ≠ wallet_contract_address`. Verification fails.
7. **Result: `executeSpend()` and `executeTokenSpend()` will ALWAYS revert** for any wallet used in the intended manner — there is no valid path to create an attestation that will pass `verify(id, address(wallet))`.

**Impact:**
The entire primary payment flow of ARC-402 is non-functional. `executeSpend()` and `executeTokenSpend()` both revert at the attestation check for every call. This renders the wallet's core functionality completely inoperable. Any protocol building on ARC-402's spend functions will have permanently broken integrations.

**Preconditions:**
- No workaround exists within the current contracts as written.

**Likelihood:**
Certain — this is a code bug, not an edge case. Every executeSpend attempt fails.

---

## Finding A-4: PolicyEngine `registerWallet()` Has No Access Control — Anyone Can Hijack Wallet Policy Configuration

**Severity:** HIGH  
**Contract:** PolicyEngine.sol  
**Function:** `registerWallet()` / `setCategoryLimitFor()`  
**Line:** ~22, ~38

**Attack scenario:**
1. Victim deploys a wallet at address `0xVICTIM` and sets up their category limits.
2. Attacker observes `0xVICTIM` on-chain and calls `policyEngine.registerWallet(0xVICTIM, attacker_address)`.
3. `walletOwners[0xVICTIM] = attacker_address` is now set — no check that caller is the actual wallet owner.
4. Attacker now satisfies `walletOwners[wallet] == msg.sender` in `setCategoryLimitFor`.
5. Attacker calls `setCategoryLimitFor(0xVICTIM, "api_call", 0)` — sets the category limit to 0.
6. When `validateSpend` runs for victim's wallet: `limit == 0` → returns `(false, "PolicyEngine: category not configured")`.
7. All of victim's future `executeSpend` calls revert. Wallet is permanently griefed for those categories.
8. Attacker can also SET LIMITS HIGH, then monitor for off-chain policy systems that read PolicyEngine to make spending decisions — they would see permissive limits they didn't set.

**Impact:**
- DoS attack: attacker can zero out all configured category limits for any wallet, permanently blocking spending.
- Griefing: any wallet that hasn't yet called `registerWallet` for itself is vulnerable. Even if the victim reconfigures via `setCategoryLimit` (their own direct call), the attacker can repeatedly grief by calling `setCategoryLimitFor(victim, category, 0)`.
- The `walletOwners` mapping can be hijacked for any wallet address at any time if not pre-registered.

**Preconditions:**
- Victim's wallet has not yet had `registerWallet` called for it (race condition exists at deployment).
- No cost to the attacker (just gas).

**Likelihood:**
High — trivial to execute, no special privileges required. Front-running the registration is straightforward.

---

## Finding A-5: X402Interceptor Has No Access Control — Any Caller Can Trigger Payments If Used as Wallet Owner

**Severity:** HIGH  
**Contract:** X402Interceptor.sol  
**Function:** `executeX402Payment()`  
**Line:** ~42

**Attack scenario:**
1. Protocol deploys X402Interceptor as a gateway for agentic USDC payments. For this to work (`executeTokenSpend` has `onlyOwner`), the X402Interceptor must be set as the ARC402Wallet's owner.
2. Once X402Interceptor is the wallet owner, `executeTokenSpend(...)` can be called by it.
3. `executeX402Payment(recipient, amount, attestationId, requestUrl)` has **no access control** — `msg.sender` is not checked.
4. Attacker calls `x402Interceptor.executeX402Payment(attacker_address, wallet_balance, fake_attestation_id, "evil.com")`.
5. This calls `wallet.executeTokenSpend(USDC, attacker_address, wallet_balance, "api_call", fake_attestation_id)`.
6. Due to A-2 (attestation not binding), if the attacker already has a valid attestation created from the wallet, the call proceeds.
7. All USDC in the wallet is transferred to the attacker.

Note: If X402Interceptor is NOT the wallet owner (normal case), `executeTokenSpend` reverts. However, the design comment explicitly suggests an agentic flow where X402Interceptor mediates payments — any deployment where it is set as wallet owner is catastrophically vulnerable.

**Impact:**
Complete USDC drainage of the wallet if X402Interceptor is wallet owner. Full fund loss.

**Preconditions:**
- X402Interceptor must be the wallet's `owner` (intended deployment pattern for x402 mediation).
- Attacker needs a valid attestation ID (or the attestation system is broken, per A-3).

**Likelihood:**
High if deployed in intended pattern. X402Interceptor's design explicitly requires it to call `executeTokenSpend`, which requires owner privileges.

---

## Finding A-6: ServiceAgreement Owner Can Resolve Disputes Favorably for Themselves

**Severity:** HIGH  
**Contract:** ServiceAgreement.sol  
**Function:** `resolveDispute()`  
**Line:** ~213

**Attack scenario:**
1. Attacker deploys ServiceAgreement (becomes `owner` / dispute arbiter).
2. Attacker acts as `provider` and creates a service agreement with a legitimate client (e.g., proposes an agreement as client, or gets someone to propose to attacker-as-provider).
3. Attacker (as provider) calls `accept()`.
4. Attacker delivers nothing. Client raises `dispute()`.
5. Attacker (as `owner`) calls `resolveDispute(id, true)` (favor provider = attacker).
6. Escrow is released to attacker. No actual service was delivered.

**Alternative scenario — as client:**
1. Attacker as client proposes with large escrow.
2. Provider accepts and delivers work.
3. Attacker disputes.
4. Attacker resolves dispute in their own favor (`favorProvider = false`).
5. Attacker gets escrow refunded despite service being delivered.

**Impact:**
Total escrow theft via dispute manipulation. All funds in disputed agreements can be redirected by the owner. This is a systemic backdoor — the arbiter has unconstrained, unilateral, irreversible control over all disputed funds.

**Preconditions:**
- Attacker must be the contract deployer (owner), OR must compromise/socially engineer the owner.
- Requires target to enter into a service agreement.

**Likelihood:**
Medium — requires owning the contract or compromising the owner, but the attack path is clear and the incentive (stealing escrow) is direct. There is no multi-sig, timelock, or independent review required.

---

## Finding A-7: Attestations Never Expire — Stale Intent Can Authorize Future Spends Indefinitely

**Severity:** MEDIUM  
**Contract:** IntentAttestation.sol  
**Function:** `verify()` / `attest()`  
**Line:** ~55

**Attack scenario:**
1. Wallet owner creates an attestation for a legitimate spend: "Pay $50 for API access" (timestamp: Jan 2025).
2. The actual spend is never executed (e.g., payment fails, intent abandoned).
3. One year later, the same `attestationId` is still valid per `verify()`.
4. If the wallet is compromised or the owner is replaced via `setRegistry` trick, the stale attestation can be used to authorize a spend with no fresh declaration of intent.
5. More practically: automated agents that create attestations in bulk ahead of time can authorize spends months later with no time-bound validation.

**Impact:**
Audit trail integrity is broken. An attestation from an abandoned or superseded intent can authorize a current spend. Compliance systems relying on attestation timestamps will have a false picture of intent timing. In a compromised wallet scenario, a library of old attestations becomes a ready-made toolkit for unauthorized spends.

**Preconditions:**
- Attacker or rogue agent has access to pre-created attestation IDs.
- Wallet owner controls the execution side.

**Likelihood:**
Medium — no active exploit in isolation (still requires wallet owner access), but significantly degrades the security model when combined with other findings.

---

## Finding A-8: SettlementCoordinator ACCEPTED Proposals Can Never Expire — Permanent State Lock

**Severity:** MEDIUM  
**Contract:** SettlementCoordinator.sol  
**Function:** `checkExpiry()` / `accept()` / `execute()`  
**Line:** ~97, ~113, ~76

**Attack scenario:**
1. `fromWallet` proposes a settlement. `toWallet` accepts it (status: ACCEPTED).
2. The deadline passes without `execute()` being called.
3. `execute()` reverts: `require(block.timestamp <= p.expiresAt, "expired")`.
4. `checkExpiry()` reverts: `require(p.status == ProposalStatus.PENDING, "not pending")` — it only handles PENDING proposals.
5. The proposal is permanently stuck in ACCEPTED state. No function can transition it to EXPIRED or CANCELLED.
6. `reject()` also reverts: `require(p.status == ProposalStatus.PENDING, "not pending")`.

**Impact:**
Agreement state machine is permanently jammed for expired-ACCEPTED proposals. While no direct fund loss occurs (ETH/tokens are pulled at execute time, not pre-locked), the state cannot be cleaned up. Systems that enumerate proposals by status will have permanent pollution. In any future version that pre-locks funds at accept time, this becomes a fund-locking vulnerability.

**Preconditions:**
- Any proposal accepted but not executed before its deadline.

**Likelihood:**
High — this is a common scenario (deadline passes, payment not completed). No attack required; normal usage triggers it.

---

## Finding A-9: Velocity Limit Uses Fixed Window — Boundary Gaming Attack

**Severity:** MEDIUM  
**Contract:** ARC402Wallet.sol  
**Function:** `executeSpend()` / `executeTokenSpend()`  
**Line:** ~144

**Attack scenario:**
1. Velocity limit is set to 1000 tokens/day.
2. At t = 23:59:59 (near end of window), wallet owner spends 999 tokens: `spendingInWindow = 999`. Just under the limit.
3. One second later (t = 00:00:00, new window), the window resets: `spendingWindowStart = now`, `spendingInWindow = 0`.
4. Wallet owner immediately spends 999 tokens again.
5. In ~2 seconds, 1998 tokens have been transferred — nearly double the intended daily limit.

**Additional issue:** ETH (in wei) and ERC-20 token amounts (e.g. USDC with 6 decimals) are tracked in the same `spendingInWindow` counter without normalization. A limit set in USD value makes no sense when one call sends 1 ETH (1e18 wei) and another sends 1 USDC (1e6 units). The limit is nonsensical across token types.

**Impact:**
Velocity limit can be nearly doubled at window boundaries. The limit provides weaker protection than implied. Mixed-token accounting makes the limit meaningless for cross-token wallets.

**Preconditions:**
- Wallet owner is the attacker (self-gaming of their own policy, or compromised key).
- Velocity limit is set.

**Likelihood:**
Medium — requires knowing when the window resets and timing two transactions. Trivial for any automated agent.

---

## Finding A-10: SettlementCoordinator `propose()` Is Fully Open — Griefing and ID Collision Attack

**Severity:** MEDIUM  
**Contract:** SettlementCoordinator.sol  
**Function:** `propose()`  
**Line:** ~40

**Attack scenario (front-run / ID squatting):**
1. Attacker observes a legitimate `propose()` call in the mempool.
2. Attacker front-runs with the exact same parameters in the same block.
3. Both transactions hash to the same `proposalId = keccak256(fromWallet, toWallet, amount, token, intentId, block.timestamp)`.
4. First transaction succeeds. Second reverts with "proposal exists".
5. The legitimate proposer's transaction fails. The attacker has "squatted" the proposalId (but they can't do anything useful with it — only `toWallet` can accept).

**Attack scenario (spam / griefing):**
1. Attacker proposes hundreds of fake settlements FROM victim's wallet TO attacker.
2. No authorization check — anyone can propose on behalf of any `fromWallet`.
3. These proposals show up in any proposal enumeration, pollute the state, and may cause downstream confusion for systems monitoring settlement flows.
4. The proposals can't be cancelled by the victim (cancel is for `toWallet` to reject, or is not available for pending proposals created by attacker — `reject()` is restricted to `toWallet` = attacker, so attacker just never rejects).

**Impact:**
- Proposal spam pollutes the contract state permanently.
- ID collision can cause legitimate proposals to fail if someone races with identical parameters.
- Fake proposals from victim's `fromWallet` may cause off-chain monitoring to flag the victim incorrectly.

**Preconditions:**
- Anyone with gas.

**Likelihood:**
High — no barrier to entry.

---

## Finding A-11: TrustRegistry `initWallet()` Is Permissionless — Score Farming Potential

**Severity:** LOW  
**Contract:** TrustRegistry.sol  
**Function:** `initWallet()`  
**Line:** ~48

**Attack scenario:**
1. TrustRegistry's `initWallet()` has no access control — anyone can call it for any address.
2. Attacker initializes hundreds of addresses at INITIAL_SCORE (100), bypassing the "probationary" trust level (score < 100).
3. Any system that reads trust scores for off-chain decisions will see addresses at score 100 ("restricted" level) that should be at 0 ("probationary").
4. If the attacker can then get the TrustRegistry owner to add them as an authorized updater (social engineering), they can further inflate scores.

Note: Score inflation beyond INITIAL_SCORE requires `onlyUpdater`, which limits the direct exploit. But the free initialization bypasses the natural "new wallet starts at 0" invariant.

**Impact:**
Trust score bootstrapping for fake agents. Systems using trust scores as a meaningful signal will be polluted with pre-initialized addresses. Low severity because additional elevation requires authorized updater access.

**Preconditions:**
- Any address not yet initialized in the registry.

**Likelihood:**
High (trivial to execute) but low impact.

---

## Finding A-12: ServiceAgreement Has No Dispute Resolution Timeout — Permanent Escrow Lock Risk

**Severity:** LOW  
**Contract:** ServiceAgreement.sol  
**Function:** `dispute()` / `resolveDispute()`  
**Line:** ~186

**Attack scenario:**
1. Provider and client have a legitimate ACCEPTED agreement with escrowed ETH.
2. Either party disputes.
3. The contract owner (arbiter) becomes unavailable: key lost, owner company dissolves, or owner is malicious and deliberately refuses to resolve.
4. No timeout exists for dispute resolution.
5. Escrowed funds are permanently locked — neither party can recover them.
6. There is no `expiredDispute()`, no DAO governance, no timelock release.

**Impact:**
Permanent escrow lock for any disputed agreement if the owner becomes unavailable. Total loss of escrowed funds for all parties. For a protocol holding significant value across many agreements, this is a systemic single-point-of-failure.

**Preconditions:**
- Agreement reaches DISPUTED state.
- Owner fails to resolve (malice or incapacity).

**Likelihood:**
Low (depends on owner reliability), but the impact when triggered is catastrophic and irreversible.

---

## Finding A-13: ARC402Wallet `proposeMASSettlement()` Missing `notFrozen` Modifier

**Severity:** LOW  
**Contract:** ARC402Wallet.sol  
**Function:** `proposeMASSettlement()`  
**Line:** ~207

**Attack scenario:**
1. A wallet is frozen (either by the owner or by velocity limit trigger).
2. Wallet owner can still call `proposeMASSettlement()` — the `notFrozen` check is absent.
3. This inconsistency could lead to off-chain confusion: settlement events are emitted from a frozen wallet, downstream systems that observe `SettlementProposed` events may treat the proposal as valid.
4. If SettlementCoordinator integration is later added where `proposeMASSettlement` triggers actual fund movements, the missing freeze check becomes a fund-loss vulnerability.

**Impact:**
Currently: only an event is emitted (no funds move), so direct fund loss is not possible. However, the inconsistency with `executeSpend` and `executeTokenSpend` (which both have `notFrozen`) violates the design invariant that a frozen wallet cannot initiate financial activity. Downstream systems may misinterpret emitted events.

**Preconditions:**
- Wallet is frozen.
- Owner calls `proposeMASSettlement`.

**Likelihood:**
Low impact now; medium risk if the function is connected to actual settlement execution in future versions.

---

## Finding A-14: PolicyEngine `walletOwners` Registration Race Condition — First-Write-Wins

**Severity:** LOW  
**Contract:** PolicyEngine.sol  
**Function:** `registerWallet()`  
**Line:** ~22

**Attack scenario:**
1. A new wallet is deployed at address `0xNEW`.
2. Attacker sees the wallet creation transaction and front-runs the legitimate owner's `registerWallet(0xNEW, legitimate_owner)` call.
3. Attacker submits `registerWallet(0xNEW, attacker_address)` with higher gas.
4. Attacker's transaction is mined first: `walletOwners[0xNEW] = attacker`.
5. Legitimate owner's transaction also succeeds — `walletOwners[0xNEW]` is now overwritten to `legitimate_owner`. 

Wait — there is no "already registered" check in `registerWallet`. The mapping is simply overwritten. This means:
- Both transactions succeed.
- Whichever runs LAST wins.
- If the legitimate owner registers last, they're fine. But if the attacker runs last, they own the mapping.
- Attacker can grief repeatedly, always overwriting back to `attacker_address`.

**Impact:**
Persistent griefing: attacker can continuously overwrite `walletOwners` back to themselves after the legitimate owner fixes it, creating a gas war. If combined with `setCategoryLimitFor`, the attacker can repeatedly zero out category limits. The legitimate owner can never permanently win this race without a separate protection mechanism.

**Preconditions:**
- Attacker monitors `registerWallet` events and re-griefs after each fix.

**Likelihood:**
Low (gas-intensive griefing, no direct profit), but the attack is real and no defense exists in the contract.

---

## Finding A-15: ServiceAgreement `dispute()` Has No `nonReentrant` Guard

**Severity:** LOW  
**Contract:** ServiceAgreement.sol  
**Function:** `dispute()`  
**Line:** ~186

**Attack scenario:**
No direct fund transfer occurs in `dispute()` — it only changes state. However, the inconsistency with all other state-changing functions (which use `nonReentrant`) is notable. If the status change in `dispute()` triggers external callbacks in future integrations (e.g., ERC-777 tokens with `tokensReceived` hooks), reentrancy could be exploited to double-dispute or manipulate state.

**Impact:**
No immediate exploit path with current ERC-20 tokens. Risk surface if the function is extended or if the protocol moves to ERC-777 tokens. Currently LOW severity but warrants note.

**Preconditions:**
- Future integration with re-entrant token or callback mechanism.

**Likelihood:**
Low given current token assumptions, but worth hardening.

---

## Finding A-16: ARC402Registry `update()` Accepts Arbitrary Addresses Without Interface Validation

**Severity:** INFO  
**Contract:** ARC402Registry.sol  
**Function:** `update()`  
**Line:** ~44

**Attack scenario:**
1. Registry owner (possibly compromised) calls `update()` with a malicious `policyEngine` address.
2. The malicious policy engine always returns `(true, "")` from `validateSpend()` — bypassing all spending controls.
3. All wallets that haven't opted into a new registry will now have their spend validation bypassed.
4. Combined with a malicious `intentAttestation` that always returns `true` from `verify()`, all spending controls are nullified.

Note: This requires the registry owner key to be compromised. The immutable `owner` design was explicitly chosen for security (per code comment). But the risk of a single key compromise taking down all wallet security is worth documenting.

**Impact:**
If registry owner key is compromised: all spending limits and attestation checks can be bypassed for all wallets pointing to this registry. Total protocol compromise.

**Preconditions:**
- Registry owner key compromise.

**Likelihood:**
Low — requires key compromise or insider threat, but the blast radius is total.

---

## Finding A-17: ARC402Wallet Velocity Limit Does Not Track ETH and Token Spending Separately

**Severity:** INFO  
**Contract:** ARC402Wallet.sol  
**Function:** `executeSpend()` / `executeTokenSpend()`  
**Line:** ~144, ~180

**Attack scenario:**
1. Wallet has `velocityLimit = 1000` (owner intends this as USD-equivalent).
2. Wallet owner calls `executeSpend(recipient, 1 wei, "eth_payment", id)` — `spendingInWindow += 1`.
3. Wallet owner calls `executeTokenSpend(USDC, recipient, 999e6, "usdc_payment", id)` — `spendingInWindow += 999e6`.
4. The 1 wei ETH spend and the 999 USDC spend are summed as `999000001` — which is WAY above the limit of 1000.
5. Wallet freezes on the USDC spend despite 999 USDC being a reasonable amount.

Alternatively: limit set to cover USDC (1000 = $1000 in 6-decimal USDC = 1000000000 in raw units) would never fire for ETH because 1 ETH = 1e18 wei, which immediately exceeds any reasonable limit.

**Impact:**
Velocity limits are effectively non-functional for mixed ETH/token wallets. Either the limit is too low for ETH (fires on any real ETH payment), or too high for tokens (provides no protection). The limit cannot be meaningfully configured to cover both.

**Preconditions:**
- Wallet uses both ETH and ERC-20 token spending.
- Velocity limit is set.

**Likelihood:**
High (this is the expected wallet usage pattern), but impact is misconfiguration rather than exploit.

---

## Summary

- **CRITICAL:** 2  
- **HIGH:** 4  
- **MEDIUM:** 4  
- **LOW:** 5  
- **INFO:** 2

---

## Top 3 Most Dangerous Findings (in my view):

1. **A-1** — WalletFactory creates wallets owned by the factory, not users: all factory-deployed wallets are permanently bricked, any deposited funds are unrecoverable.  
2. **A-2** — Attestation `verify()` does not validate spend parameters AND attestations are replayable: the entire audit trail and intent binding mechanism is meaningless, unlimited spend with a single attestation.  
3. **A-6** — ServiceAgreement owner can unilaterally resolve disputes in their own favor: the arbiter has a direct, code-level path to steal all escrowed funds from disputed agreements.
