# ARC-402 Security Audit Report
**Perspective: Adversarial Attacker**
**Threat Model: Flash loans, reentrancy, colluding arbitrators, front-running, economic exploits, griefing, DoS**
**Date: 2026-03-14**
**Scope: All 22 Solidity contracts in `/reference/contracts/`**
**Status of codebase: DRAFT — explicitly not production-ready**

---

## Executive Summary

The ARC-402 protocol implements a multi-party service agreement marketplace with escrow, session payment channels, an arbitration system, and agentic wallet infrastructure. The codebase is a draft and carries significant security risks across all severity levels. The most critical issues are:

1. A **centralized admin key** that can steal all escrowed funds via fee manipulation and arbitrary dispute resolution.
2. **Colluding arbitrators** can systematically drain disputes with near-zero friction — the on-chain cost is only a trust score decrement.
3. The **DisputeArbitration oracle price manipulation** creates a window for the owner to over-charge dispute fees and extract funds.
4. The **SettlementCoordinator lacks escrow** — it records proposals about funds but never holds them, creating an incoherent execution model.
5. **WatchtowerRegistry calls SA.challengeChannel directly** bypassing the SA nonReentrant guard, creating a potential reentrancy surface.
6. **ARC402Wallet.executeContractCall** allows arbitrary external calls with only a whitelist guard — a compromised or social-engineered registry can redirect all funds.

---

## Findings by Severity

---

## BLOCKER: Must Fix Before Mainnet

---

### B-01: Owner Can Steal All Escrowed Funds via Protocol Fee Manipulation
**Contract:** `ServiceAgreement.sol`
**Functions:** `setProtocolFee()`, `setProtocolTreasury()`, `ownerResolveDispute()`, `resolveDisputeDetailed()`

**Description:**
The `ServiceAgreement` owner can atomically:
1. Set `protocolFeeBps` to the maximum 100 bps (1%) via `setProtocolFee()`.
2. Change `protocolTreasury` to an attacker-controlled address via `setProtocolTreasury()`.
3. Call `ownerResolveDispute()` or `resolveDisputeDetailed()` to immediately resolve any disputed agreement in favor of the provider, triggering `_releaseEscrowWithFee()` which deducts and routes the fee to the attacker.

This is partially mitigated by the 1% cap on fees, so per-agreement theft is limited to 1% of the escrow. However, the owner can also use `ownerResolveDispute()` to resolve disputes incorrectly (e.g., always favor provider regardless of merit), causing 100% loss of the client's escrow with zero accountability.

**Attack Vector (Dispute Manipulation):**
```
1. Wait for large agreements to enter DISPUTED state.
2. As owner, call ownerResolveDispute(agreementId, favorProvider=true).
3. Provider receives 100% of escrow. Client loses all funds.
4. No on-chain mechanism prevents this.
```

**Impact:** Complete theft of any disputed agreement's escrow. With fee manipulation, 1% of all successfully-fulfilled agreements over time. With dispute manipulation, 100% of any disputed agreement.

**Note:** There is no timelock on admin key actions, no governance multisig requirement, and no way for users to resist or recover from this.

---

### B-02: Colluding Arbitrators Can Guarantee Any Dispute Outcome at Minimal Cost
**Contract:** `DisputeModule.sol`, `DisputeArbitration.sol`
**Functions:** `nominateArbitrator()`, `castArbitrationVote()`

**Description:**
An attacker who controls, or can collude with, 2 of 3 arbitrators can guarantee any dispute outcome. The cost of doing so is:
- Each arbitrator must have a trust score >= 50 (`DisputeArbitration.isEligibleArbitrator()`).
- A single anomaly in `TrustRegistry` deducts only 20 points (v1) or 50 points (v2). Starting at 100, an arbitrator can withstand 2 (v2) or 5 (v1) anomalies before falling below 50.
- The `slashArbitrator()` in `DisputeArbitration` is owner-only and not automatic; it requires the owner to detect and act on misconduct.

**Attack Steps:**
```
1. Create two Sybil arbitrator accounts. Complete 10 successful small agreements
   to bring both trust scores to ≥50 (each success adds 5 points in v1).
2. When a target dispute opens, have both Sybils nominate themselves (or be
   nominated by a party). Panel of 3 requires majority = 2.
3. Both Sybils cast PROVIDER_WINS or CLIENT_REFUND votes — whichever is the
   corrupt outcome. Majority reached immediately.
4. Agreement finalizes. Attacker receives their cut (split arranged off-chain
   with the favored party who paid for the rigged outcome).
```

**Impact:** Any dispute can be stolen. The colluding party who hired the arbitrators can extract the full escrow of the opposing party. The on-chain "penalty" is a trust score decrement for the arbitrators (which can be recovered by completing more agreements) and owner discretionary slashing.

**Amplification via `SPLIT` votes:**
Two colluding arbitrators can also cast coordinated `SPLIT` votes to allocate any desired ratio of funds, since the final split is an average. E.g., both vote for `providerAward = price, clientAward = 0` styled as a SPLIT — but the SPLIT path requires `providerAward + clientAward == price`, so they cannot cast two SPLIT votes for full provider award. However, they can cast one PROVIDER_WINS and one SPLIT, and the third honest arbitrator votes CLIENT_REFUND — the final tally never reaches majority for any outcome, causing a stall and eventual human escalation (which still goes to the centralized owner).

---

### B-03: DisputeArbitration Fee Oracle Is Fully Admin-Controlled — Price Manipulation Steals Funds
**Contract:** `DisputeArbitration.sol`
**Functions:** `setTokenUsdRate()`, `openDispute()`

**Description:**
The `tokenUsdRate18` mapping is set exclusively by the owner with no delay, no oracle, no staleness check, and no validation against market rates. The fee calculation (`_calcFee`) uses this rate to convert a USD-denominated fee into tokens.

**Attack Vector:**
```
1. Owner (or compromised owner key) sets tokenUsdRate18[USDC] to 1e30
   (1 trillion USD per USDC, grotesquely wrong).
2. Next dispute opener calls dispute() on any agreement.
3. _calcFee() computes feeRequired = floor($5 worth of USDC at wrong rate)
   = effectively 0 token units (floor division underflows to 0).
4. Alternatively, set rate to 1 (1e-18 USD per token):
   feeRequired = massive number of tokens (fee is $5 but rate says each
   token is nearly worthless → requires enormous token amount).
5. Dispute opener must pay an astronomical fee to open the dispute, or
   dispute is forced to fail — effectively blocking all dispute rights.
```

**Impact:** The owner can make disputes prohibitively expensive or free, depending on the direction of rate manipulation. This destroys the economic security of the dispute system. No user can trust that disputing won't cost them more than the agreement value.

**Note:** The code acknowledges this: "This is NOT a trustless price oracle. The owner is responsible for keeping rates current." This is not acceptable for a financial protocol.

---

### B-04: SettlementCoordinator.execute() Does Not Hold Escrowed Funds — Double-Spend / Race Condition
**Contract:** `SettlementCoordinator.sol`
**Functions:** `propose()`, `accept()`, `execute()`

**Description:**
The `SettlementCoordinator` tracks proposals but **never holds funds**. When a proposal is created via `ARC402Wallet.proposeMASSettlement()`, the wallet records the spend and consumes the attestation, but no ETH/tokens are transferred to the coordinator. Later, `execute()` requires the caller (fromWallet) to provide the funds at execution time via `msg.value` (ETH) or `safeTransferFrom` (ERC-20).

**Sequence of vulnerabilities:**

1. **Proposal can be accepted and then funds drained before execution:** A malicious `fromWallet` can accept the proposal, drain their wallet (via other means), and then `execute()` will fail. The `toWallet` has no recourse — they accepted but will not receive payment.

2. **PolicyEngine double-counting:** `proposeMASSettlement()` calls `_policyEngine().recordSpend()` immediately, counting the proposed amount against daily limits even though the funds may never actually transfer. A provider who gets paid via `execute()` later also doesn't re-validate through PolicyEngine.

3. **Race condition — anyone can call execute():** The `execute()` function only requires `msg.sender == p.fromWallet` — but if the fromWallet contract has a bug or is controlled by an adversary, they can call execute() with `msg.value = 0` for ETH proposals if no ETH check happens… Actually the check `require(msg.value == p.amount)` is present for ETH. The real risk is the fund-drain described in (1).

**Impact:** The recipient of a MAS settlement has no on-chain guarantee of payment. The proposer consumes their attestation and policy budget, then can fail to pay, griefing the recipient.

---

### B-05: WatchtowerRegistry Calls SA.challengeChannel() Directly, Bypassing SA's nonReentrant Guard
**Contract:** `WatchtowerRegistry.sol`, `SessionChannels.sol`
**Functions:** `submitChallenge()`, `challengeChannel()` in ServiceAgreement

**Description:**
`WatchtowerRegistry.submitChallenge()` calls `serviceAgreement.challengeChannel(channelId, latestState)` directly. However, the `ServiceAgreement.challengeChannel()` function is guarded by `nonReentrant`. The problem is that `WatchtowerRegistry` is itself a fully external, unguarded contract.

When `SessionChannels.challengeChannel()` is called via the SA (which is the only authorized caller enforced by `onlySA`), the call chain is:
```
WatchtowerRegistry.submitChallenge()
  → SA.challengeChannel()  [nonReentrant on SA]
    → SC.challengeChannel() [onlySA guard]
      → _settleChannel()    [ETH/token transfers OUT]
```

**Critical observation:** `WatchtowerRegistry` is listed as an authorized challenger in `SessionChannels.challengeChannel()`:
```solidity
caller == ch.client ||
caller == ch.provider ||
(watchtowerReg != address(0) && (
    IWatchtowerRegistry(watchtowerReg).channelWatchtower(channelId) == caller ||
    caller == watchtowerReg   // <-- WatchtowerRegistry itself is authorized
))
```

The `caller == watchtowerReg` check means if anyone calls SA.challengeChannel with `msg.sender` that happens to be WatchtowerRegistry's address — but more critically, WatchtowerRegistry.submitChallenge() calls SA.challengeChannel() which calls SC.challengeChannel() with `caller = msg.sender of SA call = WatchtowerRegistry`. So WatchtowerRegistry is approved as a challenger itself.

A malicious watchtower could be authorized for a channel, then call submitChallenge with a fraudulent (but validly signed) state, triggering settlement at a lower amount than the honest state. This is partially mitigated by signature verification — the watchtower cannot forge signatures. However, the watchtower could submit an older (but still signed) state if the client failed to update the registered state hash. This is a **deliberate griefing/theft vector** where a compromised watchtower uses an old signed state to cheat the client.

**Impact:** A compromised or malicious authorized watchtower can submit a lower-value state, causing the provider to receive less than owed (partial theft from provider), and the client to receive more refund than deserved.

---

### B-06: ARC402Wallet.executeContractCall() — Arbitrary External Call with Whitelist as Sole Guard
**Contract:** `ARC402Wallet.sol`
**Function:** `executeContractCall()`

**Description:**
`executeContractCall()` allows the wallet owner to call any whitelisted external contract with arbitrary calldata, any ETH value, and a per-tx ERC-20 approval. The whitelist is managed by `PolicyEngine`, which itself stores state for all wallets in a single shared contract.

**Attack surface:**
1. **Registry compromise:** `ARC402Registry` has an immutable owner but mutable `policyEngine` address. If the registry owner is compromised or social-engineered, they can point `policyEngine` to a malicious contract that `validateContractCall()` returns `(true, "")` for any target, including attacker-controlled addresses. The wallet owner then unknowingly calls a malicious contract under the belief it's whitelisted.

2. **Approval residual:** The pattern `forceApprove(target, maxApprovalAmount)` then `call()` then `forceApprove(target, 0)` is correct in principle, but if the external `call()` itself reenters and calls `executeContractCall()` again (which is guarded by `nonReentrant` — so this is blocked), or if the target is a malicious ERC-20 that uses `transferFrom` during the approval callback phase. The `nonReentrant` guard does block same-contract reentry.

3. **Policy bypass via DeFi tier:** An attacker who controls a wallet's policy (owner-controlled) can enable DeFi access and whitelist their own malicious contract. Then `executeContractCall()` with `params.data` crafted to call any function on the malicious contract. This is not an exploit — it's the intended design — but it means a compromised agent AI that controls the wallet can drain it by whitelisting a malicious target and calling it.

**Impact:** If the registry is compromised or the AI agent is compromised, all wallet funds can be drained via `executeContractCall()`. There is no spending limit on `executeContractCall()` (only on `executeSpend`/`executeTokenSpend`).

---

### B-07: ARC402Registry Owner Can Silently Redirect All Wallet Infrastructure
**Contract:** `ARC402Registry.sol`
**Function:** `update()`

**Description:**
`ARC402Registry.update()` allows the immutable `owner` (deployer) to instantly replace `policyEngine`, `trustRegistry`, `intentAttestation`, and `settlementCoordinator` with any addresses, including malicious contracts.

All `ARC402Wallet` instances that point to this registry (including all future wallet operations) immediately route through the new addresses with **no timelock, no user notification on-chain, and no opt-out mechanism beyond a 2-day timelocked wallet registry upgrade**.

**Attack Vector:**
```
1. Registry owner (or compromised key) deploys MaliciousPolicyEngine that
   always returns (true, "") from validateSpend() and does nothing in recordSpend().
2. Registry owner calls ARC402Registry.update() to point policyEngine to malicious contract.
3. All wallet spends immediately bypass all category limits, daily limits, and velocity checks.
4. Deploy MaliciousIntentAttestation that returns true from verify() for any attestationId
   and does nothing in consume() (attestations become reusable).
5. Any wallet can now drain itself — or an attacker who has the authorizedInterceptor
   role on a victim's wallet can drain it.
```

**Impact:** Catastrophic. All wallets that use the registry are immediately at risk. The 2-day timelock on wallet-side registry upgrades means users have a 2-day window to react if they notice the registry was updated — but there is no mechanism to alert them.

---

## REQUIRED: Should Fix Before Mainnet

---

### R-01: Dispute Fee ETH Refund Reentrancy Risk
**Contract:** `DisputeModule.sol`
**Function:** `openFormalDispute()`
**Lines:** ~222-233

**Description:**
When `DisputeArbitration.openDispute()` fails (reverts), `openFormalDispute()` attempts to refund ETH to the caller:
```solidity
(bool refunded, ) = p.caller.call{value: msg.value}("");
if (!refunded) revert ETHTransferFailed();
```

This ETH refund is made **before the state changes that mark the dispute as open** are complete (only `_ensureDisputeCase` and `_disputeCases[p.agreementId].opener = p.caller` have been set). However, the call is in a `catch` block and `ServiceAgreement.dispute()` is guarded by `nonReentrant` at the SA level, which prevents reentrant calls through SA.

The risk is that `p.caller` is a contract that, in its `receive()` function, calls back into `SA.dispute()` on a different agreement. Since SA's `nonReentrant` is per-SA-contract and uses a shared mutex, this reentry is blocked. However, if the caller is a wallet that calls back into a different non-guarded SA entry point (e.g., `cancel()`, which IS `nonReentrant`), the reentrancy guard prevents it.

**Verdict:** The immediate reentrancy is blocked by SA's `nonReentrant`. However, the pattern of making ETH transfers in catch blocks is fragile and should be replaced with a pull-payment pattern.

**Impact:** Currently low due to nonReentrant guard, but the pattern is dangerous and should be corrected.

---

### R-02: Arbitration Panel Selection is Adversarially Gameable — No Anti-Collusion Mechanism
**Contract:** `DisputeModule.sol`
**Function:** `nominateArbitrator()`

**Description:**
Either party to a dispute can nominate arbitrators. There is no restriction on which party can nominate which arbitrator. A party who has a financial arrangement with an arbitrator can nominate them. The other party has equal nomination rights, but:

1. The **first party to act can nominate 2 of 3 slots** before the other party reacts (in a race condition, if both are watching the mempool).
2. There is no mechanism for either party to **veto** an arbitrator nominated by the other side.
3. The eligibility check (`isEligibleArbitrator`) only checks trust score ≥ 50 — trivially achievable by any actor who has completed 10 agreements.

**Front-running scenario:**
```
1. Client opens dispute.
2. Provider front-runs the dispute transaction (or acts within same block) by
   watching mempool and immediately calling nominateArbitrator with two colluding
   arbitrators before client can nominate.
3. Provider's two nominations are recorded first. Client can nominate one.
4. Provider's two arbitrators form a majority — guaranteed outcome.
```

**Impact:** Dispute outcomes can be systematically gamed. Financial loss is 100% of the disputed agreement value.

---

### R-03: SessionChannels Missing Cross-Chain Replay Protection on State Signatures
**Contract:** `SessionChannels.sol`
**Function:** `_verifyChannelStateSigs()`

**Description:**
The signature scheme for channel states signs:
```solidity
keccak256(abi.encode(
    state.channelId,
    state.sequenceNumber,
    state.callCount,
    state.cumulativePayment,
    state.token,
    state.timestamp
))
```

There is no `chainId` or contract address in the signed payload. This means:
1. **Cross-chain replay:** A state signed on one chain can be replayed on another chain where the same `channelId` exists. If the protocol deploys on multiple chains with the same deployer nonce (and thus the same contract addresses), a state from chain A is valid on chain B.
2. **Cross-contract replay:** The signed hash does not include the `SessionChannels` contract address. If a second SessionChannels contract is deployed (e.g., for a v2 upgrade), states from the v1 channels can be replayed against v2 if channel IDs collide.

**Note:** `channelId` is derived as:
```solidity
keccak256(abi.encodePacked(client, provider, token, maxAmount, deadline, block.timestamp, _channelNonce))
```
The nonce mitigates same-chain same-block collisions, but cross-chain replay is not prevented since chainId is not included.

**Impact:** Cross-chain replay could allow a provider to close a channel on chain B using a state from chain A, potentially double-collecting payment.

---

### R-04: DisputeArbitration.selectArbitratorFromPool() Is a View Function — Commit-Reveal Is Broken
**Contract:** `DisputeArbitration.sol`
**Function:** `selectArbitratorFromPool()`

**Description:**
The commit-reveal scheme for arbitrator selection is designed to prevent validator manipulation. However, `selectArbitratorFromPool()` is declared as `view`, meaning:
1. It can be called off-chain by anyone to **simulate the selection result before revealing**.
2. The owner (who controls the reveal) can test different pool orderings and select the pool ordering that produces the desired arbitrators.
3. Since the owner also controls who is in the pool (the function takes an arbitrary `address[] calldata pool`), the owner can craft a pool that — with their chosen reveal — selects any desired arbitrators.

**Attack Vector:**
```
1. Owner commits a hash off-chain.
2. Owner receives the reveal value.
3. Before calling selectArbitratorFromPool on-chain, owner simulates different
   pool orderings via staticcall to find a pool+reveal combination that selects
   their preferred arbitrators.
4. Owner calls selectArbitratorFromPool with the crafted pool.
5. The returned addresses are "randomly" selected but are fully owner-controlled.
```

Furthermore, the function is only `view` and returns data — it does **not** actually assign the arbitrators. The caller must take the returned addresses and call `nominateArbitrator()` separately, which means this function's output is advisory and the actual nomination is still done manually.

**Impact:** The "commit-reveal" scheme provides no actual randomness protection. The owner can deterministically select any arbitrators they want.

---

### R-05: Channel Close Front-Running — Provider Can Exploit Client's `closeChannel` Call
**Contract:** `SessionChannels.sol`
**Functions:** `closeChannel()`, `challengeChannel()`

**Description:**
The challenge window is 24 hours. When a client calls `closeChannel()` with a final state, the provider has 24 hours to submit a `challengeChannel()` with a higher-sequence state.

**Front-running scenario (MEV / sandwich attack):**
```
1. Client submits closeChannel(channelId, finalState) with sequence N,
   cumulativePayment = 50 (low payment, client reclaims most deposit).
2. Provider watches mempool. Provider has a valid signed state with
   sequence N+1, cumulativePayment = 90 (higher payment for provider).
3. Provider front-runs by submitting challengeChannel() in the same block
   or immediately after.
4. Channel settles at the higher state — provider gets 90 instead of 50.
```

This is actually the **correct behavior** — the challenge mechanism exists precisely to handle this. The issue is the inverse: a provider can close the channel with an older state (lower sequence) to reclaim funds as if less work was done, and the client must challenge within 24 hours. If the client is offline (e.g., an AI agent that goes down), the provider can cheat.

**Watchtower mitigation:** Partially mitigated by `WatchtowerRegistry`, but as noted in B-05, a compromised watchtower can submit an old state.

**Impact:** If the client's agent is offline during the 24-hour challenge window, a malicious provider can close at an earlier state and underpay. Amount at risk: `depositAmount - actualFinalPayment`.

---

### R-06: IntentAttestation — Anyone Can Attest for Any Wallet
**Contract:** `IntentAttestation.sol`
**Function:** `attest()`

**Description:**
`attest()` takes `msg.sender` as the `wallet` field:
```solidity
attestations[attestationId] = Attestation({
    ...
    wallet: msg.sender,  // Set to caller, not a parameter
    ...
});
```

This correctly prevents an attacker from creating attestations for another wallet's address. However:

1. **Attestation ID collision:** The `attestationId` is caller-supplied as a `bytes32`. An attacker could attempt to front-run a legitimate attestation by submitting the same `attestationId` first. Since `wallet = msg.sender`, the resulting attestation would have the wrong wallet address, causing the subsequent `verify()` call (which checks `a.wallet == wallet`) to fail. This is a **griefing attack** that makes a specific attestationId unusable for the legitimate wallet.

2. **Attestation grinding:** An attacker watching the mempool who sees a pending `attest()` call from wallet W with id=X can front-run and register that attestationId themselves. W's attest() then reverts with "already exists". W must pick a new ID and retry. This wastes gas and delays the payment.

**Impact:** Griefing — can force legitimate wallet attestations to fail, delaying time-sensitive payments (e.g., x402 payments that have a short window).

---

### R-07: ReputationOracle — Unbounded Signal Array, Gas DoS on getReputation()
**Contract:** `ReputationOracle.sol`
**Functions:** `publishSignal()`, `getReputation()`

**Description:**
`_signals[subject]` is an unbounded array. Each call to `publishSignal()` appends to it. The check `hasManualSignaled[publisher][subject]` only prevents the same publisher from signaling the same subject twice, but there is no limit on how many different publishers can signal a single subject.

With enough publishers (which could be Sybil accounts), `getReputation()` iterates over the entire array:
```solidity
for (uint256 i = 0; i < sigs.length; i++) { ... }
```

**Attack scenario:**
```
1. Attacker creates 10,000 Sybil wallets (each needs to interact with
   TrustRegistry once to get initialized).
2. Each Sybil calls publishSignal() against a target provider.
3. Target's _signals array has 10,000 entries.
4. Any call to getReputation() for this target runs out of gas.
5. Any on-chain system that calls getReputation() will revert.
```

**Note:** Currently `getReputation()` is only called off-chain (view function), so this is primarily an off-chain DoS. However, any future integration that reads reputation on-chain will fail.

**Impact:** Reputation queries for heavily-targeted subjects become economically infeasible. No cap on signal storage cost to the attacker (only gas for push to array).

---

### R-08: PolicyEngine.recordSpend() Can Be Called Independently — Policy Accounting Manipulation
**Contract:** `PolicyEngine.sol`
**Function:** `recordSpend()`

**Description:**
`recordSpend()` checks:
```solidity
require(msg.sender == wallet || msg.sender == walletOwners[wallet], "PolicyEngine: not authorized");
```

This means the wallet owner (EOA) can directly call `recordSpend()` against their own wallet, inflating the spending counters for any category — forcing their own wallet into a "daily limit exceeded" state for arbitrary categories.

**Attack scenario — griefing a wallet:**
```
1. Attacker registers a wallet they don't own via registerWallet() —
   WAIT: registerWallet() requires msg.sender == wallet, so this is blocked.
```

**Actual risk:** The wallet owner can self-grief by burning their daily spending budget without actually spending. More importantly, `walletOwners[wallet]` is set at registration time and cannot be updated. If the wallet owner changes (e.g., the ARC402Wallet owner transfers out), the PolicyEngine still maps the old owner. Since `ARC402Wallet.owner` is immutable, this is not an issue for ARC402Wallet — but any wallet that manually calls `registerWallet` and later changes ownership is permanently misconfigured.

**Second attack vector — PolicyEngine.setPolicy():**
`setPolicy()` is completely open: any address can set policy data for themselves. There's no validation of the `policyData` content. This means a wallet can set arbitrary `policyData` bytes, which might be parsed incorrectly by off-chain systems or future on-chain modules that consume `policyData`.

**Impact:** Policy accounting can be manipulated by the wallet owner to bypass or drain daily limits intentionally. Risk to third parties is low in the current design.

---

### R-09: AgreementTree — Provider-Controlled Sub-Agreement Visibility Spoofing
**Contract:** `AgreementTree.sol`
**Function:** `registerSubAgreement()`

**Description:**
Any provider of a parent agreement can register child agreements under that parent. The children are verified to exist in `ServiceAgreement` (via `getAgreement()`), but there is **no requirement that the provider of the child is the same as the provider of the parent**.

**Attack vector:**
```
1. Legitimate provider P creates parent agreement A (client C, provider P).
2. Attacker (also a provider) creates child agreement B where they are the
   provider (client C2, provider Attacker).
3. Provider P calls registerSubAgreement(A, B).
4. The tree now shows agreement B (unrelated to P) as a child of A.
5. When allChildrenSettled() is called, it checks B's status. Attacker can
   dispute B to block allChildrenSettled() from returning true.
6. Any system gating on allChildrenSettled(A) == true is now DoS'd.
```

**Impact:** Providers can create misleading tree structures, DoS systems that check tree completeness, and potentially confuse off-chain tooling about agreement relationships.

---

### R-10: DisputeArbitration.acceptAssignment() — Panel Can Be Filled by Same Arbitrator Sybils
**Contract:** `DisputeArbitration.sol`
**Function:** `acceptAssignment()`

**Description:**
`acceptAssignment()` checks:
```solidity
require(!_bonds[agreementId][msg.sender].locked, "DisputeArbitration: already accepted");
```

This prevents the same address from accepting twice, but it does not cross-reference with the `DisputeModule` arbitration panel. An arbitrator who has bonded in `DisputeArbitration` but was NOT nominated via `DisputeModule.nominateArbitrator()` can still call `acceptAssignment()` and fill `_accepted[agreementId]`.

Furthermore, `_settleArbitratorBondsAndFees()` uses `_accepted[agreementId]` to determine who to pay, but `DisputeModule._arbitrationCases[agreementId].arbitrators` tracks who was nominated. These two lists are **not synchronized**. An arbitrator who accepts a bond but was never nominated would have their vote tracked in `_voted` but would never actually cast a vote through DisputeModule (since DisputeModule checks `_isPanelArbitrator`).

**Impact:** Bond accounting and arbitration vote accounting are in separate contracts with no cross-validation. Arbitrators can lock bonds in `DisputeArbitration` for disputes they cannot actually vote on, leading to bond lock-up with no path to recovery until the 45-day `reclaimExpiredBond()` timeout.

---

## ADVISORY: Low Risk, Note for Future

---

### A-01: TrustRegistry v1 — No Flash Loan Protection
**Contract:** `TrustRegistry.sol` (v1)
**Functions:** `recordSuccess()`, `recordAnomaly()`

**Description:**
Unlike `TrustRegistryV2`, v1 has no `noFlashLoan` modifier (no `block.number` tracking). A flash loan attacker can, within a single block:
1. Complete multiple small agreements using flash-borrowed funds as the payment.
2. Each completion triggers `recordSuccess()` on the provider's trust score.
3. This requires the agreement to complete within one block, which is impossible for normal ServiceAgreement flows (accept → fulfill requires at least one block transition).

**Assessment:** Not directly exploitable through ServiceAgreement's multi-step flow. Advisory only.

---

### A-02: PolicyEngine Two-Bucket Window — 1.5x Overspend Boundary Case
**Contract:** `PolicyEngine.sol`
**Function:** `_getEffectiveSpend()`

**Description:**
The two-bucket window design intentionally allows up to 1.5x the daily limit to be spent across a bucket boundary (acknowledged in code comments). An attacker who times transactions precisely at bucket boundaries can spend:
- Full limit in bucket N (in last few seconds of bucket)
- Full limit in bucket N+1 (in first few seconds of new bucket)
= 2x limit in a 2-second window (worst case, not 1.5x as claimed)

**Assessment:** The code comment says "worst-case boundary spend is 1.5×" but the actual worst case is closer to 2× if both spends happen in adjacent bucket windows without any previous spend. This is a design limitation acknowledged by the developers.

---

### A-03: ARC402Governance — No Transaction Expiry or Time Bound
**Contract:** `ARC402Governance.sol`
**Functions:** `submitTransaction()`, `executeTransaction()`

**Description:**
Governance transactions never expire. A transaction that was proposed and confirmed months ago can be executed at any time (unless it was already executed). If the governance context changes (e.g., a signer leaves, protocol conditions change), old approved transactions remain executable indefinitely.

**Impact:** Stale governance actions can be executed unexpectedly. Low risk if signers are diligent, but creates a lingering attack surface.

---

### A-04: WatchtowerRegistry.watchedChannels Array — Unbounded Growth, No Removal
**Contract:** `WatchtowerRegistry.sol`
**Function:** `authorizeWatchtower()`

**Description:**
`watchedChannels[watchtower]` grows unboundedly. `revokeWatchtower()` deletes `channelWatchtower[channelId]` but does **not** remove the channelId from `watchedChannels[watchtower]`. Over time, a watchtower's watched channel list accumulates expired/settled channels, creating an ever-growing array that `getWatchedChannels()` must iterate.

**Impact:** Read-function gas exhaustion over time. No direct fund risk.

---

### A-05: AgentRegistry — Heartbeat Manipulation Inflates Uptime Score
**Contract:** `AgentRegistry.sol`
**Function:** `submitHeartbeat()`

**Description:**
`submitHeartbeat()` is self-reported by agents with no external validation. An agent can:
1. Report heartbeats continuously at any latency value (latencyMs is a `uint32` input, not measured).
2. Set `latencyMs = 0` to always appear as "≤250ms" (100 score).
3. Never actually be available — just submit heartbeats.

**Impact:** Uptime and latency scores are meaningless as security metrics. Any trust model relying on `responseScore` or `uptimeScore` is manipulable. Advisory only as these scores are not used in access control decisions in the current codebase.

---

### A-06: SponsorshipAttestation — No Tier Upgrade Restriction
**Contract:** `SponsorshipAttestation.sol`
**Function:** `publishWithTier()`

**Description:**
Any address can publish a `ENTERPRISE_PROVIDER` tier attestation for any agent, including themselves (self-attestation is blocked). There is no governance approval required for `VERIFIED_PROVIDER` or `ENTERPRISE_PROVIDER` tiers. A colluding sponsor can issue enterprise-tier attestations to any agent.

**Impact:** Sponsorship tiers are meaningless as a trust signal if anyone can issue any tier. Advisory — currently these attestations are informational only and not used for access control.

---

### A-07: Integer Arithmetic — `_calcBond` in DisputeArbitration
**Contract:** `DisputeArbitration.sol`
**Function:** `_calcBond()`

**Description:**
```solidity
uint256 twiceFee = feeRequired * 2;
uint256 bondFloorTokens = rate > 0 ? (minBondFloorUsd18 * 1e18) / rate : 0;
```

`feeRequired * 2` can overflow if `feeRequired` is extremely large. In practice, `feeRequired` is capped at `feeCapUsd18 = 250e18` (in USD units) converted to tokens, so the maximum token amount is bounded. For standard tokens (1e18 decimals), this won't overflow uint256. However, for tokens with very small `tokenUsdRate18` values (approaching 0), the bond calculation could produce astronomically large values.

If `rate = 1` (practically zero USD value per token), then:
- `bondFloorTokens = (20e18 * 1e18) / 1 = 20e36` — this fits in uint256 (max ~1.15e77) but represents a bond of `20e36` token units, which no arbitrator could ever post.

**Impact:** With maliciously-configured rates, bond requirements become unpostable, effectively preventing any arbitrator from accepting assignments for those token disputes.

---

### A-08: ARC402Wallet — Velocity Limit Tracking Mixes ETH and ERC-20 in Same Window
**Contract:** `ARC402Wallet.sol`
**Functions:** `executeSpend()`, `executeTokenSpend()`

**Description:**
Both functions share `spendingWindowStart` but track separate accumulators (`ethSpendingInWindow` for ETH, `tokenSpendingInWindow` for ERC-20). The `velocityLimit` is compared against each independently:
```solidity
if (velocityLimit > 0 && ethSpendingInWindow > velocityLimit) { ... }
if (velocityLimit > 0 && tokenSpendingInWindow > velocityLimit) { ... }
```

This means a single `velocityLimit` value is applied separately to ETH (in wei) and ERC-20 (in token-native units), which have incommensurable scales. Setting a USDC velocity limit of `1_000_000` (= $1) while also capping ETH at `1_000_000` wei (= $0.000000003) creates an inconsistent policy.

**Impact:** Wallet owners who don't carefully account for decimal differences will set ineffective limits. Primarily a UX/configuration risk, not a direct exploit.

---

### A-09: ReputationOracle — Flash Loan Block Guard Applied to Subject Not Publisher
**Contract:** `ReputationOracle.sol`
**Function:** `publishSignal()`, `noFlashLoan(subject)` modifier

**Description:**
The `noFlashLoan(subject)` modifier prevents the same `subject`'s reputation from being written more than once per block. However, this does not prevent a flash loan attack where:
1. Attacker briefly borrows many tokens.
2. Uses them to complete agreements and boost their own score in TrustRegistry.
3. Then publishes endorsement signals for themselves under many Sybil accounts.

Since `hasManualSignaled[publisher][subject]` prevents duplicate signals from the same publisher, an attacker needs multiple Sybil accounts. The `noFlashLoan` modifier only blocks the second write to the same subject in the same block, but with multiple Sybils attacking in different blocks, this doesn't prevent a slow reputation attack.

**Impact:** Advisory — Sybil-based reputation inflation is slow and costly.

---

### A-10: ARC402Registry — Owner Is Immutable, Introduces Single-Point-of-Failure Risk
**Contract:** `ARC402Registry.sol`

**Description:**
The registry's `owner` is set at construction and is immutable (no ownership transfer mechanism). If the deployer's key is lost or compromised, the registry can never be updated. However, as noted in B-07, the ability to update IS the attack surface. The immutability is a deliberate design choice to prevent phishing-based ownership hijacks.

**Assessment:** This is a trade-off. Immutable ownership prevents the B-07 attack from being executed by a phished key — but means an EOA key compromise (not a signed governance transaction) can still call `update()` with any address. The correct solution would be requiring the registry owner to be a multisig. This is advisory given the design intent.

---

## Cross-Cutting Concerns

### CC-01: Centralized Admin Key Risk Across All Contracts
The following contracts have single-EOA owner admin keys with significant protocol-level power:
- `ServiceAgreement`: can resolve any dispute, change all fee parameters, change all module addresses.
- `DisputeArbitration`: controls token-USD rates (B-03), can slash any arbitrator (potentially selectively).
- `TrustRegistry` / `TrustRegistryV2`: can add/remove authorized updaters, effectively controlling all trust scores.
- `ARC402Registry`: can redirect all wallet infrastructure (B-07).
- `ARC402Guardian`: can permanently pause the protocol (no automatic unpause even with timelock).

**Recommendation:** All admin operations should require a multisig (e.g., the `ARC402Governance` contract) and a timelock. The `ARC402Governance` multisig is deployed but is not wired as the owner of these contracts.

---

### CC-02: No Upgrade Path for ServiceAgreement Holding Live Escrow
`ServiceAgreement` holds all escrow funds (ETH and ERC-20). It is not upgradeable. If a critical bug is found post-deployment, there is no upgrade mechanism. The `ARC402Guardian.pause()` can halt new operations, but existing escrow funds remain locked in the buggy contract.

**Recommendation:** Implement an emergency migration mechanism (e.g., owner-only `emergencyWithdraw()`) as a last resort, protected by a governance multisig and timelock.

---

### CC-03: DisputeModule and DisputeArbitration Are Separate Contracts With Shared State
The `DisputeModule` stores arbitration panel data (`_arbitrationCases`) and the `DisputeArbitration` stores bond data (`_bonds`, `_accepted`, `_voted`). These are separate contracts that must remain synchronized. The `DisputeArbitration.setDisputeModule()` allows the owner to set a `disputeModule` address, and the modifier `onlyServiceAgreement` accepts calls from either SA or DM:

```solidity
modifier onlyServiceAgreement() {
    require(
        msg.sender == serviceAgreement || (disputeModule != address(0) && msg.sender == disputeModule),
        "DisputeArbitration: not ServiceAgreement"
    );
    _;
}
```

This means the `DisputeModule` address, if set by the `DisputeArbitration` owner, has elevated privileges in `DisputeArbitration`. A compromised or malicious `DisputeModule` could call `resolveDisputeFee()` directly, draining the fee pool without going through a legitimate dispute resolution.

---

### CC-04: No Slippage Protection on ARC402Wallet.executeSpend() / executeTokenSpend()
While `executeContractCall()` has a `minReturnValue` slippage check, the core spend functions (`executeSpend`, `executeTokenSpend`) have no slippage or price protection. An attacker who is the recipient could manipulate the gas/block context to receive funds intended for a different price point, though in practice these are fixed-amount transfers, not AMM swaps.

---

## Findings Summary Table

| ID   | Severity | Contract | Finding |
|------|----------|----------|---------|
| B-01 | BLOCKER  | ServiceAgreement | Owner can steal all escrowed funds via fee manipulation and dispute resolution |
| B-02 | BLOCKER  | DisputeModule, DisputeArbitration | Colluding arbitrators can guarantee any dispute outcome |
| B-03 | BLOCKER  | DisputeArbitration | Admin-controlled price oracle enables fee manipulation |
| B-04 | BLOCKER  | SettlementCoordinator | No escrow held — double-spend / race condition on MAS settlement |
| B-05 | BLOCKER  | WatchtowerRegistry, SessionChannels | Malicious watchtower can submit old channel state |
| B-06 | BLOCKER  | ARC402Wallet | executeContractCall with arbitrary calldata via registry-redirectable whitelist |
| B-07 | BLOCKER  | ARC402Registry | Owner can silently redirect all wallet infrastructure instantly |
| R-01 | REQUIRED | DisputeModule | ETH refund in catch block — pull payment pattern needed |
| R-02 | REQUIRED | DisputeModule | Arbitration panel selection gameable by front-running |
| R-03 | REQUIRED | SessionChannels | Missing chainId / contract address in channel state signatures |
| R-04 | REQUIRED | DisputeArbitration | Commit-reveal arbitrator selection is owner-controllable (view function) |
| R-05 | REQUIRED | SessionChannels | Provider can front-run closeChannel with older state |
| R-06 | REQUIRED | IntentAttestation | AttestationId front-running griefing attack |
| R-07 | REQUIRED | ReputationOracle | Unbounded signal array — gas DoS on getReputation() |
| R-08 | REQUIRED | PolicyEngine | recordSpend() manipulation of policy accounting |
| R-09 | REQUIRED | AgreementTree | Provider can register unrelated child agreements — DoS allChildrenSettled() |
| R-10 | REQUIRED | DisputeArbitration | acceptAssignment() not cross-validated with DisputeModule panel |
| A-01 | ADVISORY | TrustRegistry v1 | No flash loan protection (multi-step SA flow provides natural mitigation) |
| A-02 | ADVISORY | PolicyEngine | Two-bucket window allows up to 2x daily limit at boundary |
| A-03 | ADVISORY | ARC402Governance | No transaction expiry on governance proposals |
| A-04 | ADVISORY | WatchtowerRegistry | watchedChannels array grows without removal of settled channels |
| A-05 | ADVISORY | AgentRegistry | Self-reported heartbeats are trivially manipulable |
| A-06 | ADVISORY | SponsorshipAttestation | Anyone can issue any tier attestation — tiers are meaningless |
| A-07 | ADVISORY | DisputeArbitration | Extreme token rates can make bond unpostable |
| A-08 | ADVISORY | ARC402Wallet | Velocity limit compares incommensurable ETH and ERC-20 units |
| A-09 | ADVISORY | ReputationOracle | Flash loan block guard applied to subject, not publisher |
| A-10 | ADVISORY | ARC402Registry | Immutable owner is single-point-of-failure on key loss |
| CC-01 | REQUIRED | All | Centralized admin key across all protocol contracts |
| CC-02 | REQUIRED | ServiceAgreement | No emergency upgrade/migration for live escrow |
| CC-03 | REQUIRED | DisputeModule, DisputeArbitration | DisputeModule has elevated privileges in DisputeArbitration — attack surface if DM is compromised |
| CC-04 | ADVISORY | ARC402Wallet | No slippage protection on core spend functions |

---

## Recommendations Summary

**Immediate (before any mainnet deployment):**
1. Wire `ARC402Governance` (multisig) as the owner of all protocol contracts. Add a minimum 48-hour timelock on all admin operations that affect fee parameters, module addresses, or dispute resolution.
2. Replace the admin-controlled `tokenUsdRate18` in `DisputeArbitration` with a time-weighted Chainlink or Uniswap TWAP oracle, or at minimum add a 1-hour timelock and a maximum rate-change cap per update.
3. Add an arbitrator veto mechanism: both parties must approve the full panel before it is activated, or use on-chain randomness (Chainlink VRF) for panel selection.
4. Add `chainId` and `address(this)` to the `SessionChannels` signature scheme.
5. Implement escrow in `SettlementCoordinator`: funds must be deposited at proposal time and locked until execution or rejection.
6. Add watchtower state recency validation: if the submitted state is older than the on-chain `lastSequenceNumber`, reject it even if signatures are valid.
7. Cap `_signals` array length in `ReputationOracle` (e.g., max 1000 signals per subject) or use a Merkle accumulator.

**Before v2:**
8. Replace direct arbitrator nomination with a neutral selection mechanism. Neither party alone should be able to fill a majority of the panel.
9. Decouple `DisputeModule` privilege from `DisputeArbitration` — `resolveDisputeFee()` should only be callable via ServiceAgreement, not directly from DisputeModule.
10. Implement an emergency migration path for escrowed funds in ServiceAgreement.

---

## Audit Round 4 — Passkey/WebAuthn Signature Validation
**Date:** 2026-03-17
**Scope:** Spec 33 P256/passkey additions to ARC402Wallet.sol
**Model:** First pass — claude-sonnet-4-6 | Second pass — claude-opus-4-6
**Auditors:** neat-ocean (first pass), plaid-pine-2 Opus (second pass)

### Process

1. tender-prairie implemented Spec 33 (passkey P256 support)
2. neat-ocean (sonnet) ran targeted audit → found 2 blockers + 1 medium
3. cool-mist-2 fixed all three findings
4. plaid-pine-2 (opus) ran second-eyes on the fixes → found 1 new critical (challenge verification missing)
5. nimble-slug fixing the critical → final Opus pass before deploy

This is the established pattern for cryptographic code:
**Implement → Audit (sonnet) → Fix → Second-eyes (Opus) → Fix any new findings → Final Opus pass → Deploy**

### Findings

| ID | Severity | Title | Status |
|---|---|---|---|
| AUD-PK-01 | Critical | Contract 2,266 bytes over EIP-170 limit | ✅ Fixed — P256VerifierLib extracted, 17,639 bytes |
| AUD-PK-02 | High | WebAuthn hash not reconstructed — all real Face ID sigs fail | ✅ Fixed — sha256(authData\|\|sha256(clientDataJSON)) |
| AUD-PK-03 | Medium | clearPasskey/emergencyOwnerOverride emit no events | ✅ Fixed — PasskeyCleared + EmergencyOverride events added |
| AUD-PK-FIX-01 | Critical | No challenge verification — governance sig replay attack | ⏳ Fix in progress (nimble-slug) |

### AUD-PK-FIX-01 — Replay Attack Description

**Vector:** WebAuthn signature (r, s, authData, clientDataJSON) is visible on-chain in UserOp calldata. Without verifying that clientDataJSON contains userOpHash as the challenge, any observed governance signature can be copied into a new UserOp with a different governance call and a fresh nonce. The P256 math passes because the WebAuthn hash is unchanged.

**Example:** User approves `setGuardian` with Face ID. Attacker copies the sig bytes, crafts a new UserOp calling `proposeRegistryUpdate`, reuses the same sig. Contract accepts it.

**Fix:** Parse clientDataJSON on-chain, extract the `challenge` field, base64url-decode it, verify it equals userOpHash. Each Face ID tap is cryptographically bound to exactly one operation.

**Why Opus caught it and sonnet missed it:** The userOpHash parameter was present but silently suppressed `(userOpHash);`. The logic appeared correct superficially. Opus recognized this as an intentional no-op that defeated the binding purpose.

### Lesson Locked

> **Cryptographic signature validation requires Opus second-eyes before mainnet. Always.**
> The first audit pass catches structural issues. Opus catches subtle protocol-level flaws.
> This is now mandatory policy for any crypto code in ARC-402.

