# ARC-402 Protocol Security Model

**Version:** 0.1.0  
**Date:** 2026-03-11  
**Scope:** Cross-boundary threats — HTTP layer, off-chain agents, contract interactions, and system composition  
**Author:** Forge Engineering  
**Status:** DRAFT

> **Relationship to THREAT-MODEL.md:** The [contract-level threat model](./THREAT-MODEL.md) audits the internals of individual contracts (reentrancy, escrow math, access control). This document looks at the seams *between* contracts, between contracts and the HTTP layer, and between contracts and off-chain agents. Where a finding already exists in THREAT-MODEL.md, this document references it rather than repeating it.

---

## 1. System Boundaries

The ARC-402 protocol spans four distinct trust zones. Each zone has a different threat model, and every flow that crosses a boundary is a potential attack surface.

| Zone | Components | Trust Level | Why |
|------|------------|-------------|-----|
| **On-chain** | ARC402Wallet, ServiceAgreement, TrustRegistry, AgentRegistry, PolicyEngine, IntentAttestation, ARC402Registry | Deterministic, auditable | EVM guarantees execution; code is immutable once deployed |
| **Off-chain agent** | AI runtime (LLM), agent orchestration layer, private key holder | **Untrusted input source** | Agent behaviour is not deterministic; prompt injection, model drift, and compromise are realistic |
| **HTTP layer** | x402-compatible API endpoints, network transit, DNS | **Fully untrusted** | Any server can return any response; no inherent authentication |
| **Owner/deployer** | Human with EOA private key controlling wallet, registry, and dispute resolution | **Trusted but fallible** | Single private key is the root of trust for the entire system; compromise is a realistic scenario |
| **External agents** | Third-party ARC-402 wallets acting as counterparties in ServiceAgreements | **Untrusted counterparties** | Their policy, trust score, and behaviour is observable but not controllable |

### Zone Interaction Map

```
[HTTP API Endpoint] ──── 402 response ────→ [X402Interceptor] ─── executeTokenSpend ──→ [ARC402Wallet]
                                                                                              │
[Off-chain Agent] ──── executeSpend() ───────────────────────────────────────────────────────┤
                                                                                              │
[Off-chain Agent] ──── setRegistry() ────→ [ARC402Registry] ←── reads ──────────────────────┘
                                                    │
                                          [PolicyEngine]
                                          [TrustRegistry]
                                          [IntentAttestation]
                                                    │
[ServiceAgreement] ── recordSuccess/Anomaly ──→ [TrustRegistry]
         │
[AgentRegistry] ──── getTrustScore ──────→ [TrustRegistry]
```

---

## 2. Cross-Boundary Flows

Every flow where data crosses a trust boundary is a candidate attack surface. The table below maps all seven principal flows and identifies the validation gap at each seam.

| Flow | Source → Destination | Data Crossing | What Validates It | What Could Go Wrong |
|------|---------------------|---------------|-------------------|---------------------|
| **Flow 1** | HTTP API → X402Interceptor → ARC402Wallet | `recipient`, `amount`, `attestationId`, `requestUrl` | PolicyEngine category limit; IntentAttestation.verify() | Price inflation; replay; MITM substitution; interceptor lacks wallet authorization |
| **Flow 2** | Off-chain agent → ARC402Wallet.executeSpend/TokenSpend | `recipient`, `amount`, `category`, `attestationId` | `onlyOwner`; IntentAttestation.verify(); PolicyEngine.validateSpend() | Velocity attacks; policy misconfiguration allows zero limits; agent compromise |
| **Flow 3** | ARC402Wallet → ServiceAgreement.propose() | `provider`, `price`, `token`, `deadline`, `deliverablesHash` | Token allowlist (T-03); ETH value check; deadline check | Malicious provider address; malicious token; wallet frozen mid-escrow |
| **Flow 4** | ServiceAgreement → TrustRegistry.recordSuccess/Anomaly | `wallet` address | `onlyUpdater` on TrustRegistry | Revert in TrustRegistry blocks escrow release; wrong TrustRegistry at deploy silently drops updates |
| **Flow 5** | AgentRegistry → TrustRegistry.getTrustScore | `wallet` address | `try/catch` in AgentRegistry | Stale-read window; trust score manipulated in same block as discovery query |
| **Flow 6** | Owner → ARC402Wallet.setRegistry() → ARC402Registry | New registry address | `onlyOwner` | Owner pointed at malicious registry; all subsequent contract calls compromised |
| **Flow 7** | Off-chain client → fulfillment hash verification | `actualDeliverablesHash`; content at hash URI | Off-chain content check; on-chain hash mismatch triggers dispute | Provider serves different content while preserving hash; mutable endpoint; client offline |

---

## 3. Seam-Specific Threats

### Seam A: HTTP → Chain (X402Interceptor)

**Overview:** The X402Interceptor is the bridge between x402 HTTP payment responses and the ARC-402 governance layer. An agent receives a 402 response from an API, then calls `executeX402Payment(recipient, amount, attestationId, requestUrl)`. The interceptor forwards this to `arc402Wallet.executeTokenSpend()`.

---

**Threat A-0: Architectural authorization gap (CRITICAL)**

The X402Interceptor calls `arc402Wallet.executeTokenSpend()`, but that function carries the `onlyOwner` modifier:

```solidity
// ARC402Wallet.sol
function executeTokenSpend(...) external onlyOwner requireOpenContext {
    // onlyOwner: require(msg.sender == owner, "ARC402: not owner");
```

When the interceptor calls this function, `msg.sender` from the wallet's perspective is the interceptor contract address — not the wallet's `owner` EOA. The call will revert with `"ARC402: not owner"` in every execution unless the X402Interceptor IS deployed as the wallet owner (an unusual architecture that creates its own risks).

- **Likelihood:** Certain (structural)
- **Impact:** X402Interceptor is non-functional as currently designed
- **Current mitigation:** None
- **Gap:** No trusted-forwarder or approved-caller mechanism exists in ARC402Wallet
- **Recommendation (PSM-06):** Add an `approvedCallers` mapping to ARC402Wallet so the owner can whitelist contracts (including the interceptor) that may call `executeTokenSpend` on their behalf. Gate with `msg.sender == owner || approvedCallers[msg.sender]`.

---

**Threat A-1: Price inflation attack**

A malicious or compromised API endpoint returns an inflated `amount` in the 402 response. The off-chain agent reads this amount, creates an intent attestation for it, and calls `executeX402Payment` with the inflated value.

- **Likelihood:** High — any API operator can return any price
- **Impact:** Funds drained up to the PolicyEngine category limit per transaction
- **Current mitigation:** PolicyEngine `categoryLimits[wallet][category]` enforces a per-transaction ceiling
- **Gap:** The interceptor itself performs no price check. If the PolicyEngine category limit is set high (or to zero — which blocks all spends, see A-4), the wallet pays whatever the API claims
- **Recommendation (PSM-03):** Add an explicit `maxAmount` parameter to `executeX402Payment`. The off-chain agent sets this from its own configuration (not from the 402 response). The interceptor rejects if `amount > maxAmount`. This creates a second line of defence independent of PolicyEngine configuration.

---

**Threat A-2: Rapid 402 storm**

A malicious API returns HTTP 402 on every single request, not just gated ones. The agent, following the x402 protocol, pays each 402 before retrying. If 1,000 requests are made in a session, the wallet processes 1,000 micro-payments.

- **Likelihood:** Medium — requires either a malicious provider or a compromised agent loop
- **Impact:** Wallet drained at the per-transaction category limit × request count
- **Current mitigation:** PolicyEngine per-transaction category limits (if configured)
- **Gap:** PolicyEngine tracks no velocity — there is no per-block or per-hour ceiling. `validateSpend` only checks `amount > categoryLimit[wallet][category]`, not cumulative spend.
- **Recommendation (PSM-02):** Circuit breaker: track cumulative spend per category per time window (e.g., 1-hour rolling). Reject if window total would exceed configured ceiling. This is noted as "Resolved (added to wallet)" in the spec's recommendation table, but is NOT present in the current PolicyEngine code — confirm implementation.
- **Recommendation (PSM-07):** PolicyEngine should add `windowStart[wallet][category]` and `windowSpend[wallet][category]` mappings. `validateSpend` should reset window on expiry and accumulate within it.

---

**Threat A-3: MITM price substitution**

A network-level attacker intercepts the HTTP 402 response in transit and substitutes a higher `amount` before the agent reads it. The agent creates an attestation for the inflated amount and pays.

- **Likelihood:** Low — requires network-level position (adversarial ISP, DNS hijack, malicious proxy)
- **Impact:** Overpayment up to policy limit per transaction
- **Current mitigation:** None — the interceptor and agent both trust the HTTP response at face value
- **Recommendation (PSM-01):** x402 payment responses should be signed by the provider's registered key. The interceptor (or agent) verifies the signature before paying. This is an x402 protocol-level enhancement, not just an ARC-402 one.

---

**Threat A-4: Silent spend block from unconfigured policy**

If the wallet's PolicyEngine category limit for `"api_call"` is unset (value = 0), `validateSpend` returns `(false, "PolicyEngine: category not configured")`. Every payment attempt silently fails with a revert. The interceptor call reverts. The agent's API calls never complete. This is not an economic attack, but it is a liveness threat.

- **Likelihood:** High (operational) — easy to deploy wallet without configuring API category limits
- **Impact:** Complete liveness failure for x402 flows
- **Current mitigation:** None — no initialization check, no error surfacing to off-chain layer
- **Recommendation:** Wallet deployment checklist must include PolicyEngine category configuration. The WalletFactory should accept initial policy parameters and configure them atomically at deploy time.

---

**Threat A-5: requestUrl calldata injection**

`requestUrl` is a free-form `string calldata` passed to the interceptor and emitted in `X402PaymentExecuted`. There is no length cap and no sanitization. A malicious caller could pass an extremely long URL, bloating the event log and increasing gas cost. More critically: off-chain indexers that parse this URL and make HTTP requests (for audit purposes) are exposed to SSRF.

- **Likelihood:** Medium (deliberate attacker calling interceptor)
- **Impact:** Gas griefing (on-chain); SSRF in off-chain indexers
- **Current mitigation:** None
- **Recommendation (PSM-05):** Cap `requestUrl` length (e.g., 2048 bytes) in the interceptor. Document that off-chain systems must not auto-fetch requestUrl content.

---

### Seam B: Off-chain Agent → ARC402Wallet

**Overview:** The off-chain agent (LLM runtime or orchestration layer) is the wallet's owner. It calls `openContext`, `executeSpend`, `executeTokenSpend`, `closeContext`, `setRegistry`, and `updatePolicy` directly.

---

**Threat B-1: Compromised agent — unrestricted spend**

The agent's private key is compromised (prompt injection, environment variable leak, supply chain attack on the agent runtime). The attacker calls `executeTokenSpend` in a loop.

- **Likelihood:** Medium — AI agent runtimes are a new and under-secured category
- **Impact:** All funds drained up to PolicyEngine limits per transaction. Without velocity limiting, this can be the entire wallet balance in one block if the category limit is high.
- **Current mitigation:** `onlyOwner`; PolicyEngine per-transaction limits; `requireOpenContext`
- **Gap:** If a context is open (which it must be for legitimate operation), there is no per-block or per-session spend ceiling
- **Recommendation (PSM-07):** Velocity limits in PolicyEngine (as per A-2). Additionally, consider a maximum context duration (`contextOpenedAt + maxDuration > block.timestamp`) to force periodic re-authorization.

---

**Threat B-2: Agent opens context and never closes it**

The agent opens a context but crashes, stalls, or is killed before calling `closeContext`. The context remains permanently open. A new legitimate context cannot be opened (`"ARC402: context already open"`). The wallet is bricked for new operations.

- **Likelihood:** High (operational) — crashes in AI agents are common
- **Impact:** Liveness failure; wallet cannot start new task sessions
- **Current mitigation:** None — no automatic timeout on open contexts
- **Recommendation:** Add `contextTimeout` parameter to `openContext`. Allow `closeContext` to be called by owner even if deadline has passed (i.e., allow forced close after timeout with `trustRegistry.recordAnomaly` side-effect to record the abandoned context).

---

**Threat B-3: Policy manipulation by agent**

The agent (as owner) can call `updatePolicy` and `_policyEngine().setCategoryLimit()` to relax or remove spending constraints before executing a spend. A compromised agent could first raise its own limits, then drain the wallet.

- **Likelihood:** Low in normal operation; Medium under agent compromise
- **Impact:** Complete spending constraint bypass
- **Current mitigation:** None — the wallet owner has no restrictions on policy updates
- **Recommendation:** Consider separating the policy-setter role from the spending role. Require a timelock or multisig approval for policy relaxation above a threshold.

---

### Seam C: ARC402Wallet → ServiceAgreement

**Overview:** The wallet proposes service agreements on behalf of the agent. This funds escrow and creates a bilateral contract.

---

**Threat C-1: Proposal to malicious ServiceAgreement contract**

The agent calls `ServiceAgreement.propose()` on an address it discovered from an untrusted source (e.g., an off-chain API, a phishing recommendation). The malicious contract accepts the ETH or ERC-20 deposit but never allows cancellation or fulfillment.

- **Likelihood:** Medium — agent discovery of counterparty agreements relies on off-chain data
- **Impact:** Escrow permanently locked in malicious contract
- **Current mitigation:** None — ARC402Wallet has no ServiceAgreement allowlist
- **Recommendation:** Agents should only interact with ServiceAgreement contracts whose bytecode hash matches the canonical ARC-402 deployment. This is an off-chain client responsibility, not enforceable on-chain without a registry.

---

**Threat C-2: ERC-20 approve-then-drain window**

For ERC-20 escrow, the wallet must `approve` the ServiceAgreement to spend tokens before calling `propose`. The approval transaction is separate from the propose transaction. In the window between approval and propose, any other contract that knows the approval exists could use it.

- **Likelihood:** Low — requires monitoring the wallet's approval transactions
- **Impact:** Approved tokens drained before propose executes
- **Current mitigation:** `SafeERC20.safeTransferFrom` prevents double-spend within a single transaction, but the approval window exists between separate transactions
- **Recommendation:** Use `safeIncreaseAllowance` with exact-amount approvals. Reset to zero after propose. Consider `permit()` (ERC-2612) for single-transaction approve + propose.

---

**Threat C-3: Wallet frozen with open escrow**

The wallet's context is closed (or owner key is lost) while a ServiceAgreement in `ACCEPTED` status is waiting for fulfillment. The wallet can't call `dispute()` from the ServiceAgreement side (dispute is called by client or provider, not restricted to wallet context). But if the owner key is fully lost, `expiredCancel` (the client's recourse) also requires the client wallet to transact.

- **Likelihood:** Low — but increases with number of active agreements
- **Impact:** Funds locked until `expiredCancel` deadline passes
- **Current mitigation:** `expiredCancel` allows client to reclaim after deadline. 
- **Gap:** If client EOA is lost, `expiredCancel` is unreachable. No time-bounded backstop exists.
- **Recommendation:** Document key management requirements explicitly. Consider a guardian mechanism for escrow recovery.

---

### Seam D: ServiceAgreement → TrustRegistry

**Overview:** ServiceAgreement calls `trustRegistry.recordSuccess(provider)` or `recordAnomaly(provider)` after fulfillment or dispute resolution. This updates trust scores.

---

**Threat D-1: TrustRegistry revert blocks escrow release**

In `ServiceAgreement.fulfill()`, the execution order is:
1. Set `ag.status = FULFILLED`
2. Emit event
3. `_releaseEscrow(token, provider, price)` — sends ETH/ERC-20 to provider
4. `ITrustRegistry(trustRegistry).recordSuccess(provider)` — updates score

If step 4 reverts, the entire transaction reverts, including step 3. The provider received nothing, and `ag.status` is rolled back to `ACCEPTED`. The provider **cannot get paid** as long as TrustRegistry reverts on `recordSuccess`.

This makes TrustRegistry a liveness dependency for every agreement fulfillment. A buggy, upgraded, or maliciously-constructed TrustRegistry can permanently block all fulfillments in every ServiceAgreement that references it.

- **Likelihood:** Medium — TrustRegistry failures (bugs, pausing, upgrade errors) are realistic
- **Impact:** All active ServiceAgreements are permanently unresolvable; all escrow locked
- **Current mitigation:** Null check on `trustRegistry != address(0)` — but if address is non-null and contract reverts, this doesn't help
- **Recommendation (PSM-08):** Wrap TrustRegistry calls in try/catch within ServiceAgreement. Escrow release must not be conditional on trust score update success. Log a `TrustUpdateFailed` event if the call reverts. This decouples economic settlement from reputation tracking.

```solidity
// Safer pattern:
_releaseEscrow(ag.token, ag.provider, ag.price);
if (trustRegistry != address(0)) {
    try ITrustRegistry(trustRegistry).recordSuccess(ag.provider) {
        // success
    } catch {
        emit TrustUpdateFailed(agreementId, ag.provider, "recordSuccess reverted");
    }
}
```

---

**Threat D-2: Wrong TrustRegistry address at ServiceAgreement deploy**

ServiceAgreement stores `trustRegistry` as an `immutable address`. If it's deployed with the wrong address (typo, stale address, address of a malicious contract), trust score updates silently go to the wrong contract or revert (see D-1). There is no way to correct this post-deploy.

- **Likelihood:** Low (operational error)
- **Impact:** All trust score updates for agreements on this instance go nowhere; reputation data diverges
- **Recommendation (PSM-09):** Deployment scripts should verify the TrustRegistry address responds to a `getScore()` call before finalizing deployment. Add this check to the Deploy.s.sol script.

---

**Threat D-3: TrustRegistry authorized updater scope creep**

TrustRegistry's `constructor` sets `isAuthorizedUpdater[msg.sender] = true`. The deployer (the ARC-402 team EOA) permanently retains direct score manipulation ability. There is no mechanism to revoke the deployer's updater status without removing it manually via `removeUpdater(deployer)`.

- **Likelihood:** Low (requires team action or compromise)
- **Impact:** Silent trust score manipulation bypassing ServiceAgreement; THREAT-MODEL.md T-03
- **Current mitigation:** See THREAT-MODEL.md T-03 — "ServiceAgreement as sole updater" is a planned fix
- **Recommendation:** After deployment, the deployer should call `removeUpdater(msg.sender)` and add only ServiceAgreement's address as an authorized updater. This should be a mandatory post-deploy step in the deployment checklist.

---

### Seam E: AgentRegistry → TrustRegistry (Discovery Read)

**Overview:** When a client agent queries `AgentRegistry.getTrustScore(wallet)`, it reads the current trust score from TrustRegistry. This score influences whether the client selects this agent as a provider.

---

**Threat E-1: Trust score freshness (same-block manipulation)**

An attacker controls a provider wallet and wants to appear highly trusted for a single block to attract high-value agreements. They batch in one transaction:
1. A series of small ServiceAgreements with their own secondary wallet (both sides)
2. Fulfill all of them → trust score spikes
3. A client queries AgentRegistry.getTrustScore in the same block → sees artificially high score
4. Client proposes a real agreement in the same block or next block

Since EVM reads are always current state (no checkpointing in TrustRegistry), there is no staleness protection. The score after the batch fulfillments is the score that discovery returns.

- **Likelihood:** Medium — requires the attacker to already have many small agreements completed
- **Impact:** Client enters agreement with over-trusted provider
- **Current mitigation:** None at the contract layer; minimum-agreement-value requirement (THREAT-MODEL T-03 recommendation) would raise the cost of score manipulation
- **Recommendation:** Off-chain clients should use time-weighted trust scores (averaging score over recent N blocks) rather than spot reads. On-chain, a checkpoint mechanism (similar to ERC20Votes) would provide historical score queries.

---

**Threat E-2: AgentRegistry endpoint SSRF**

`AgentRegistry` stores `endpoint` as an arbitrary string with no validation. An attacker registers an agent with `endpoint = "http://169.254.169.254/latest/meta-data/"` (AWS metadata service) or `endpoint = "file:///etc/passwd"`. Any off-chain client that automatically fetches the endpoint for capability discovery or health checks is exposed to SSRF.

- **Likelihood:** Medium — most agent discovery clients will attempt to reach the endpoint
- **Impact:** SSRF in off-chain agent runtimes; metadata leakage; internal service exposure
- **Current mitigation:** None
- **Recommendation (PSM-10):** Off-chain agent discovery clients MUST validate endpoints against an allowlist of schemes (https only) and MUST NOT auto-follow redirects. AgentRegistry could emit a warning-level event for endpoints that match known SSRF patterns, though on-chain validation of URLs is impractical.

---

**Threat E-3: Stale active status after deactivation**

A provider calls `deactivate()` to remove themselves from active availability. Off-chain clients that cache agent lists may still attempt to create agreements with the deactivated agent for the duration of their cache TTL.

- **Likelihood:** High (operational)
- **Impact:** Client proposes agreement; provider ignores it; escrow locked until deadline; client loses time and gas
- **Current mitigation:** `isActive()` on-chain check
- **Recommendation:** Off-chain clients should always call `isActive(wallet)` immediately before proposing an agreement, not just during initial discovery.

---

### Seam F: ARC402Registry → ARC402Wallet (Upgrade Path)

**Overview:** The wallet's `registry` field is mutable (not `immutable`). The wallet owner can call `setRegistry(newAddress)` to point the wallet at a new ARC402Registry, which in turn provides new addresses for PolicyEngine, TrustRegistry, and IntentAttestation.

---

**Threat F-1: Owner points wallet at malicious registry**

If the wallet owner is compromised or manipulated (social engineering, phishing, malicious UI), they may call `setRegistry(maliciousAddress)`. After this call, every contract lookup through the registry resolves to attacker-controlled contracts.

Attack chain after malicious registry is set:
- `_policyEngine()` → malicious PolicyEngine that returns `(true, "")` for any amount
- `_trustRegistry()` → malicious TrustRegistry that records any call as success (inflating score)  
- `_intentAttestation()` → malicious IntentAttestation that returns `true` for any attestationId

The wallet is now completely ungoverned. Any call to `executeTokenSpend` will succeed regardless of amount, category, or attestation validity.

- **Likelihood:** Low–Medium (requires owner compromise)
- **Impact:** Complete governance bypass; all wallet funds at risk; trust score can be inflated to any value
- **Current mitigation:** `onlyOwner` on `setRegistry` — limits to owner key compromise scenario
- **Recommendation (PSM-12):** Add a timelock to `setRegistry`. Proposed registry changes should be queued for 24-48 hours before taking effect. This gives the owner (or monitoring systems) time to detect and cancel malicious changes. Consider a two-step pattern: `proposeRegistry` + `acceptRegistry` with a time delay.

---

**Threat F-2: ARC402Registry.update() — silent in-place replacement**

Unlike `setRegistry` on the wallet (which replaces the registry address), `ARC402Registry.update()` replaces ALL infrastructure contracts in one call. If the registry owner calls `update()` with malicious contract addresses, every wallet currently pointing at this registry is immediately compromised — without any per-wallet action.

This is the most dangerous governance action in the system. The registry owner controls the effective behaviour of all wallets that have not called `setRegistry`.

- **Likelihood:** Low (requires registry owner compromise)
- **Impact:** All wallets on the canonical registry are simultaneously ungoverned
- **Current mitigation:** `owner` is `immutable` on ARC402Registry — prevents ownership transfer, which is actually a partial protection. The same key that deployed the registry must call `update()`. A compromised deploy key means all wallets are at risk.
- **Recommendation (PSM-04):** The ARC402Registry deployer key must be a Gnosis Safe multisig (3-of-5 minimum). This is referenced in THREAT-MODEL.md T-02 for ServiceAgreement; it applies equally (more critically) to the registry. Additionally, version changes to the registry should emit a highly visible event that wallet monitoring bots can alert on.

---

**Threat F-3: User trust in "official" registry**

The protocol is designed with user sovereignty: no one can force a wallet to upgrade. Wallet owners must explicitly call `setRegistry` to adopt a new registry. However, the vast majority of users will trust the "official" registry promoted by the ARC-402 team. If the official registry address is promoted via compromised channels (website defacement, DNS hijack), users may voluntarily point their wallets at a malicious registry believing it is legitimate.

- **Likelihood:** Medium (social engineering / channel compromise)
- **Impact:** Voluntary mass compromise of wallets
- **Current mitigation:** None at the protocol level
- **Recommendation:** Publish and pin the canonical registry address in multiple verifiable places (ENS, official docs, code comments). Wallets should display the current registry address prominently so users can verify against known-good.

---

### Seam G: Off-chain Client → Fulfillment Verification

**Overview:** The fulfillment verification seam is the bridge between on-chain hash commitment and off-chain content. The `deliverablesHash` committed at proposal time, and the `actualDeliverablesHash` submitted at fulfillment, are both `bytes32` values. The on-chain contract cannot verify the content behind these hashes — it can only check that a provider submitted a hash.

---

**Threat G-1: Garbage hash delivery (first victim always loses)**

A provider submits `fulfill(agreementId, bytes32(0))` or any nonsense hash. The escrow is released immediately. The client, if they notice the mismatch, can no longer recover funds through `fulfill` — it's already executed. Their only recourse is `dispute`, but the contract is already in `FULFILLED` state.

Wait — actually once `fulfill` is called successfully, status transitions to `FULFILLED` which is a terminal state. The client has no on-chain recourse after a provider calls `fulfill` with garbage.

- **Likelihood:** High — any provider can call fulfill with any hash
- **Impact:** Client receives garbage, pays full price; on-chain recourse is limited once `FULFILLED`
- **Current mitigation:** Dispute mechanism exists on `ACCEPTED` state — but note that `fulfill` can only be called when status is `ACCEPTED`, and calling `fulfill` terminates the agreement. A `dispute` by the client before `fulfill` is called is the only way to prevent payment.
- **Gap:** There is no pre-fulfillment client-confirmation step. The client cannot verify the hash before escrow releases.
- **Recommendation (PSM-11):** Commit-reveal fulfillment: provider submits hash in a `commitFulfillment()` call; client has a 24-hour window to verify and either `approveFulfillment()` or `dispute()`; if no action, auto-release fires. This is a v2 recommendation — see THREAT-MODEL.md T-13.

---

**Threat G-2: Mutable off-chain content behind hash**

For IPFS-stored deliverables: IPFS is content-addressed — changing content changes the CID. If the deliverables hash is an IPFS CID hash, the content is immutable.

For HTTP endpoint-stored deliverables (e.g., `https://provider.api/deliverables/123`): the content at this URL can change after the provider calls `fulfill`. The client downloads content, verifies it, is satisfied — then the provider changes the content. The hash on-chain matches the original (good) content, but the URL now serves different content. Future auditors see the hash but can't verify against current content.

For provider-controlled storage: the provider can serve one version during client verification and a different version afterwards. The hash proves what was served at verification time, not what was served generally.

- **Likelihood:** Medium — only affects providers operating in bad faith
- **Impact:** Audit trail becomes unreliable; future disputes cannot reconstruct delivered content
- **Current mitigation:** None
- **Recommendation:** Require IPFS CIDs for deliverables hashes (content-addressed, immutable). Document this requirement in the spec. The off-chain client should verify the hash is a valid CIDv1 before accepting a proposed agreement.

---

**Threat G-3: Client offline during fulfillment window**

The provider calls `fulfill()` at `deadline - 1 second`. The client is offline and cannot inspect the deliverables hash before fulfillment completes. By the time the client comes back online, the agreement is in `FULFILLED` state and the escrow is gone.

- **Likelihood:** Medium — especially in automated agent pipelines where agent downtime is common
- **Impact:** Client has no recourse; funds gone
- **Current mitigation:** None — `fulfill` fires immediately, no client confirmation required
- **Recommendation (PSM-11):** The commit-reveal pattern (see G-1) also solves this: a mandatory confirmation window ensures the client is given time to respond. The window start is the block when the provider commits.

---

**Threat G-4: Front-running fulfill with dispute**

A malicious client sees a legitimate `fulfill()` transaction in the mempool (before it lands on Base). The client front-runs it with `dispute("provider delivered garbage")`. The agreement transitions to `DISPUTED` before the provider's `fulfill` lands; the provider's transaction reverts (`"not ACCEPTED"`).

Escrow is now locked pending dispute resolution. The client made a bad-faith dispute to extract the arbiter's attention and delay payment.

- **Likelihood:** Low — requires mempool monitoring; Base sequencer ordering may reduce but not eliminate this
- **Impact:** Legitimate provider's fulfillment is blocked; dispute resolution queue is polluted
- **Current mitigation:** Dispute resolution is centralized to owner — bad-faith disputes are identifiable
- **Recommendation (PSM-13):** Add a dispute cooldown: disputes can only be raised for agreements that have been in `ACCEPTED` state for at least N blocks. This doesn't prevent front-running but raises its cost. Also: track disputes per client and penalize trust score for disputes resolved in the provider's favor (this may already happen via THREAT-MODEL.md's recommendation — confirm).

---

## 4. Composability Threats

Single-transaction atomic attacks exploit the EVM's atomicity: if any step reverts, all steps revert. This is usually a protection, but it can also be weaponised.

### Attack Chain 1: Flash Loan + Trust Score Manipulation

**Pattern:**
1. Flash loan 10,000 USDC from Aave/Balancer
2. Create two wallets: `clientWallet` and `providerWallet` (or pre-deploy them)
3. `ServiceAgreement.propose(providerWallet, price=10000, token=USDC)` from clientWallet — escrow funded with flash loan
4. `ServiceAgreement.accept(id)` from providerWallet
5. `ServiceAgreement.fulfill(id, someHash)` from providerWallet — escrow released to providerWallet; `recordSuccess(providerWallet)` called
6. 10,000 USDC now in providerWallet; repay flash loan from providerWallet
7. Trust score of providerWallet incremented by +5

**Is it profitable?** No — the attacker pays themselves (minus gas). Net P&L: -gas cost (~$0.10 on Base). The 10,000 USDC goes from wallet A to wallet B; both are controlled by the attacker. No net gain.

**Does it manipulate state?** Yes — providerWallet's trust score increases by +5 per cycle. Each cycle costs ~gas only (no capital at risk after repayment). As documented in THREAT-MODEL.md T-03: reaching "Autonomous" tier costs ~$5-57 in gas depending on Base gas price.

**Key amplification over T-03:** With flash loans, the attacker does not even need capital for the escrow. They only need enough ETH for gas. This reduces the barrier to trust farming from "have USDC" to "have gas money."

**Mitigation:** Minimum agreement value threshold (THREAT-MODEL T-03 recommendation). Flash loan attacks have gas-only costs, so the minimum value won't prevent them unless the minimum is denominated in *gas* (impractical). The real mitigation is: **require a time gap between agreement creation and score increment** (e.g., provider must have held `ACCEPTED` status for at least 1 hour). This defeats same-block flash loan cycles.

---

### Attack Chain 2: Registry Swap + Unlimited Spend in One Transaction

**Pattern:**
1. Attacker controls wallet owner key
2. In one transaction (via a helper contract):
   a. Call `wallet.setRegistry(maliciousRegistry)` — malicious registry returns a PolicyEngine that approves everything
   b. Call `wallet.executeTokenSpend(token, attacker, walletBalance, "anything", fakeAttestation)` — succeeds because malicious policy approves it
   c. Call `wallet.setRegistry(legitimateRegistry)` — restore to avoid detection in same block

**Is it possible?** Only if the attacker controls the owner key. If so, they don't need this complexity — they can just call `setRegistry` and drain in two separate transactions. But the atomic version is stealthier (harder to front-run a recovery).

**Does it exploit the timelock gap?** If PSM-12 (timelock on setRegistry) is implemented, step 2a would be queued, not immediate — this attack chain is broken.

**Mitigation:** PSM-12 timelock on `setRegistry`.

---

### Attack Chain 3: Bulk Attestation + Policy Manipulation Combo

**Pattern:**
1. Attacker-controlled agent pre-creates 100 IntentAttestations for various categories
2. Policy limits are set high for those categories (agent as owner sets its own limits)
3. Agent opens a context
4. Agent calls `executeTokenSpend` 100 times in 100 separate transactions within the same block (Base allows this)
5. Each transaction is within the per-tx limit, but cumulatively drains the wallet

**Is it profitable?** Only under agent compromise — the attacker IS the owner. So "profitable" means "drains the wallet completely."

**Mitigation:** PSM-07 (velocity limiting in PolicyEngine). Without it, the only protection is the per-transaction category limit, which is bypassable at scale.

---

## 5. The Oracle Problem

**This is a DESIGN CHOICE, not a bug.** Documenting it explicitly.

### Hash proves delivery. Hash does not prove quality.

The core limitation of the ARC-402 ServiceAgreement oracle model:

```
Provider submits actualDeliverablesHash
    ↓
Contract accepts it as proof of fulfillment
    ↓
Escrow releases
```

The hash is a commitment to *some* content. It does not prove:
- The content is what the client asked for
- The content has the quality the client expected
- The content is not garbage
- The content even exists (a hash of an empty string is still a valid bytes32)

### Attack Surface

| Attack | Mechanism | Mitigation | Residual Risk |
|--------|-----------|------------|---------------|
| Garbage hash delivery | Provider calls `fulfill(id, keccak256("garbage"))` | Client disputes → trust score decreases by 20 | First victim always loses (escrow gone before dispute can be raised) |
| Zero hash delivery | Provider calls `fulfill(id, bytes32(0))` | Same as above | Same as above |
| Legitimate hash, wrong content | Provider stores X at hash H, delivers Y | Client verifies hash mismatch and disputes | Requires client to store expected content off-chain |
| Agreed hash, late delivery | Provider calls `fulfill` at deadline-1 | Client can't dispute content in time | See Threat G-3 |

### Asymmetry in Trust Score Impact

Success: `+5` per agreement  
Failure (dispute, anomaly): `-20` per event  

This 4:1 ratio means it takes 4 successful agreements to recover from one failed one. The economic design disincentivizes garbage delivery at scale: a provider who delivers garbage once needs to deliver legitimately 4+ more times before their score recovers. Over time, consistent garbage delivery drives score to 0 (Probationary tier), removing them from discovery.

### Residual Risk: First Victim Economics

The first client to receive garbage from a new provider always loses their escrow. The trust score mechanism provides *future* protection, not compensation for past victims. This is an accepted limitation of reputation-based systems.

The long-term economic rationale: as the protocol matures and higher-value agreements become available only to high-trust providers, the opportunity cost of score destruction through garbage delivery exceeds the short-term gain from a single stolen escrow. This only holds if minimum agreement values are meaningful — reinforcing THREAT-MODEL T-03's minimum-value recommendation.

### Design Rationale

Full on-chain quality verification is impossible for most real-world service types (code, analysis, creative work). The hash-based system makes a deliberate trade: accept first-victim risk in exchange for avoiding a complex, gameable on-chain verification oracle. The dispute mechanism and trust score asymmetry are the economic guardrails.

---

## 6. Governance Attack Surface

### Threat G-K1: Owner Key Compromise — Blast Radius

A single compromised EOA key controls the following actions across the ARC-402 system:

**On ARC402Wallet (wallet owner):**
- `setRegistry(maliciousAddress)` → complete governance bypass (see Seam F)
- `openContext() / closeContext()` → control all spending windows
- `executeSpend() / executeTokenSpend()` → direct fund drain within policy limits
- `updatePolicy()` → modify spending policy before executing spend
- `proposeMASSettlement()` → initiate bilateral settlements

**On ARC402Registry (registry owner — immutable):**
- `update(newContracts)` → redirect all wallets pointing at this registry to malicious contracts
- This is the highest-impact single key in the system

**On TrustRegistry (trust registry owner):**
- `addUpdater(attackerAddress)` → grant self ability to manipulate any trust score
- `removeUpdater(serviceAgreementAddress)` → disable legitimate score updates
- `transferOwnership(attackerAddress)` → (two-step via Ownable2Step — requires acceptance from new owner)
- Direct `recordSuccess/recordAnomaly` calls (deployer is an updater by default)

**On ServiceAgreement (agreement owner):**
- `resolveDispute(id, favorProvider=true)` → drain all disputed escrow to attacker-controlled providers
- `allowToken(maliciousToken)` → allow fee-on-transfer or revert-on-transfer tokens
- `transferOwnership(attackerAddress)` → seize dispute resolution permanently

**Maximum extractable value from a single key compromise:**
- Registry owner key: all wallets pointing at canonical registry are immediately compromisable
- ServiceAgreement owner key: all currently-disputed escrow (no cap)
- Wallet owner key: that wallet's balance only (bounded by policy limits unless policy is also modified)

This is referenced in THREAT-MODEL.md as T-02. **The recommendation (PSM-04) is mandatory: all owner keys must be Gnosis Safe 3-of-5 multisigs before any production deployment.**

---

### Threat G-K2: Registry Upgrade Path — Mass Compromise Vector

The `ARC402Registry.update()` function is the highest-risk function in the entire protocol. Its blast radius:

1. Owner calls `update(maliciousPolicy, maliciousTrust, maliciousAttestation, maliciousSettlement, "v2")`
2. All wallets pointing at this registry now read malicious contract addresses
3. The next `executeTokenSpend` call on any such wallet bypasses all governance

The scope is not limited to one wallet. Every wallet that has not independently overridden their registry is affected simultaneously.

**Mitigation layers (in order of preference):**
1. Gnosis Safe as registry owner (PSM-04) — requires M-of-N signers to agree
2. Timelock on `update()` (PSM-12) — 24-48 hour delay gives monitoring systems time to alert
3. Event monitoring — bots watch `ContractsUpdated` events and alert immediately
4. User sovereignty — wallets can always call `setRegistry(trustedAddress)` to escape; publish a known-good frozen registry

**What user sovereignty does NOT protect against:** Users who have simply never heard of the attack, users whose agent bots auto-accept registry updates, and users who are offline during the attack window.

---

## 7. Residual Risks (Accepted)

The following threats are known, analyzed, and accepted as inherent properties of the v1 system or the underlying platform:

| Risk | Category | Why Accepted | V2 Mitigation |
|------|----------|--------------|---------------|
| Oracle quality problem (hash ≠ quality) | Design choice | Full on-chain quality verification is infeasible for general service types | Commit-reveal + optional dispute window (PSM-11) |
| First-victim escrow loss | Design choice | Reputation economics correct at scale, not per-transaction | Minimum stake requirement for providers |
| Small-agreement trust farming | Economic | Gas cost provides some deterrent; minimum-value fix is straightforward | Minimum value + time delay between creation and score update |
| Single EOA owner (v1) | Operational | Prototype/testnet only; Gnosis Safe required before production (PSM-04) | Gnosis Safe → DAO governance |
| Base L2 ±2s timestamp variance | Platform property | Not ARC-402-specific; affects all Base protocols | Minimum 300s deadline recommendation |
| Off-chain endpoint quality | Market mechanism | AgentRegistry endpoint content is unverified on-chain; off-chain clients must validate | Reputation graph penalizes bad endpoints economically |
| Forced ETH send to contracts | Solidity property | No escrow accounting depends on `address(this).balance`; per-agreement accounting is safe | N/A |

---

## 8. Security Assumptions

The following assumptions must hold for the ARC-402 protocol to function correctly and securely. If any assumption breaks, the documented impact applies.

| # | Assumption | Holds Because | Impact if Broken |
|---|-----------|---------------|-----------------|
| 1 | Base L2 consensus is not compromised | Coinbase sequencer; Ethereum finality | Transaction ordering can be manipulated; timestamp attacks; MEV extraction on all ARC-402 transactions |
| 2 | The ARC-402 deployer key is not leaked | Key management (currently EOA; must be multisig before production) | Registry can be updated to malicious contracts; all wallets on canonical registry compromised simultaneously |
| 3 | USDC on Base maintains its peg and contract behavior | Circle contract immutability; Circle solvency | If USDC introduces transfer fees or blacklisting, escrow accounting breaks; fee-on-transfer threat (THREAT-MODEL T-10) becomes active |
| 4 | PolicyEngine correctly enforces stored policy | Contract code is audited; no bugs in validateSpend() | Spending policy is not enforced; wallet can spend beyond configured limits |
| 5 | TrustRegistry is the sole updater of trust scores | `onlyUpdater` modifier; post-deploy `removeUpdater(deployer)` is required | Trust scores can be manipulated by anyone with updater access; reputation graph is not trustworthy |
| 6 | IntentAttestation.verify() is not forgeable | Cryptographic properties of the attestation scheme (not fully audited in scope) | Any spend can be authorized with a fake attestation; intent audit trail is meaningless |
| 7 | Off-chain agent does not suffer prompt injection that triggers financial operations | Agent runtime security; system prompt hardening | Compromised agent can execute arbitrary spends within policy limits; with policy manipulation, unlimited spends |
| 8 | The `requestUrl` in X402 responses is from the intended API endpoint | TLS/HTTPS authenticity; no DNS hijacking | Client pays wrong recipient; MITM price substitution (Threat A-3) |

---

## 9. Recommendations Summary

All recommendations from this document, consolidated for tracking:

| ID | Recommendation | Priority | Status | Seam |
|----|----------------|----------|--------|------|
| PSM-01 | Sign x402 402 responses with provider's registered key; interceptor verifies signature before paying | HIGH | Open | A |
| PSM-02 | Circuit breaker velocity limit in wallet: track cumulative spend per category per rolling time window | HIGH | Unconfirmed (referenced in spec, not in code) | A, B |
| PSM-03 | Add `maxAmount` parameter to `executeX402Payment`; interceptor rejects if `amount > maxAmount` | HIGH | Open | A |
| PSM-04 | Replace all EOA owner keys with Gnosis Safe 3-of-5 multisig (wallet owner, registry owner, ServiceAgreement owner, TrustRegistry owner) | CRITICAL | Open | F, G-K1 |
| PSM-05 | Cap `requestUrl` and other free-form string inputs to prevent gas griefing and log bloat | MEDIUM | Open | A |
| PSM-06 | Add `approvedCallers` mapping to ARC402Wallet; X402Interceptor must be an approved caller; current architecture makes interceptor non-functional | CRITICAL | Open | A |
| PSM-07 | Add velocity tracking to PolicyEngine: `windowStart`, `windowSpend` per wallet per category; reset window on expiry | HIGH | Open | A, B |
| PSM-08 | Wrap TrustRegistry calls in try/catch in ServiceAgreement; escrow release must not revert if trust score update fails | HIGH | Open | D |
| PSM-09 | Add TrustRegistry address verification in deployment scripts; confirm `getScore()` responds before finalizing deploy | MEDIUM | Open | D |
| PSM-10 | Off-chain clients must not auto-fetch AgentRegistry endpoints; validate scheme (https only) and protect against SSRF | MEDIUM | Open | E |
| PSM-11 | Commit-reveal fulfillment: provider commits hash; client has N-hour window to verify before auto-release | MEDIUM | Future (v2) | G |
| PSM-12 | Timelock on `setRegistry` (wallet) and `update` (ARC402Registry): queue changes for 24-48 hours before execution | HIGH | Open | F |
| PSM-13 | Add dispute minimum-age requirement: disputes can only be raised N blocks after agreement reaches ACCEPTED status | LOW | Future (v2) | G |
| PSM-14 | Remove deployer as default authorized updater on TrustRegistry post-deploy; make this a mandatory deployment checklist step | HIGH | Open | D |
| PSM-15 | WalletFactory should accept and atomically configure initial PolicyEngine category limits at wallet deploy time | MEDIUM | Open | A, B |
| PSM-16 | Consider separating policy-setter role from spending role in ARC402Wallet; require timelock for policy relaxation | MEDIUM | Future (v2) | B |

---

## 10. Negotiation Transport Security

> Added: 2026-03-13 | Based on architectural review of Spec 14 (Negotiation Protocol) and Spec 15 (Transport Agnosticism)

### The gap

The negotiation layer (Spec 14) defines message types (PROPOSE, COUNTER, ACCEPT, REJECT) but does not mandate:
- Authentication of the sender before processing
- Cross-session nonce deduplication
- Message TTL / expiry
- Maximum message size

This means an attacker can currently:
1. POST arbitrary PROPOSE messages to any agent's `/negotiate` endpoint without proving they are a registered ARC-402 wallet
2. Replay a full recorded negotiation session from a previous date (nonce chaining only prevents within-session replay)
3. Send a stale PROPOSE weeks after original transmission — no expiry exists
4. Send a crafted oversized PROPOSE to exhaust agent memory or compute resources

### The available fix

The protocol already has the infrastructure. Agent keys and AgentRegistry are deployed. They're just not enforced at the negotiation layer.

**Required additions to Spec 14:**

Every negotiation message MUST include:
```json
{
  "...existing fields...",
  "sig": "0x...",            // ECDSA signature over keccak256(type + from + to + nonce + timestamp)
  "timestamp": 1742875432    // Unix seconds — receiver rejects if |now - timestamp| > 60s
}
```

Receiver MUST:
1. Recover signer from `sig` — reject (401) if recovery fails
2. Verify recovered address matches `from` field
3. Verify `from` is registered in AgentRegistry — reject (401) if not found
4. Verify `|now - timestamp| ≤ 60 seconds` — reject (408) if stale
5. Verify `nonce` not seen before in this session AND not in receiver's nonce cache (TTL: 24h) — reject (409) if replay
6. Enforce max message size: reject any message > 64KB before parsing

### The transport exposure (HTTP only)

Agents registering an HTTP endpoint expose an open port. For operators running on laptops or home machines, this creates unintended network exposure. Three mitigations:

**Short term (v1):** Mandatory signed messages reduce the attack surface from "the whole internet" to "registered ARC-402 wallets only."

**Medium term (v1.x):** Ship a reference relay with the SDK. Agents that use the relay post negotiation messages to the relay (push) and poll from it (pull) — no inbound port needed.

**Long term (v2):** Hybrid transport mode. Registry stores `transportMode: direct | relay | both`. Initiator routes accordingly. Direct if available and preferred; relay as fallback.

### MCP transport eliminates the HTTP exposure for OpenClaw agents

Spec 15 lists MCP (Model Context Protocol) as a supported transport. Agents that register an MCP URI instead of an HTTP URL communicate through OpenClaw's native channel — no exposed port, no inbound endpoint required. This is the recommended integration path for OpenClaw deployments specifically.

### Nonce replay window

Nonce chaining (Spec 14, `refNonce`) prevents replay of messages within a single negotiation thread. It does not prevent a full recorded session from being replayed with a new timestamp. Receiver-side nonce cache (24h TTL) closes this gap.

### Message TTL

No expiry is currently defined. A PROPOSE has infinite validity. Recommended:
- `expiresAt` field added to PROPOSE messages (required, maximum 24h from `timestamp`)
- Receiver rejects any PROPOSE where `now > expiresAt`
- Once expired, the nonce is released and the sender must create a new PROPOSE

### New PSM recommendations

| ID | Recommendation | Priority |
|----|----------------|----------|
| PSM-17 | Mandate agent key signature on every negotiation message (PROPOSE, COUNTER, ACCEPT, REJECT); receiver recovers signer and verifies against AgentRegistry before processing | HIGH |
| PSM-18 | Enforce ±60s timestamp window on signed negotiation messages; reject stale messages before processing content | HIGH |
| PSM-19 | Receiver must maintain a 24h nonce cache; reject any nonce seen before regardless of session context (cross-session replay prevention) | HIGH |
| PSM-20 | Add `expiresAt` field to PROPOSE (required, max 24h); receivers reject expired proposals before processing | MEDIUM |
| PSM-21 | Enforce 64KB maximum message size before parsing; log and drop oversized messages without processing | HIGH |
| PSM-22 | Ship a reference relay with the SDK as the default for home/laptop deployments; document as the recommended path for operators who cannot accept inbound ports | MEDIUM |
| PSM-23 | Document MCP transport as the recommended integration path for OpenClaw agents; register MCP URI in AgentRegistry to eliminate HTTP endpoint exposure entirely | MEDIUM |

---

## Appendix: THREAT-MODEL.md Cross-Reference

The following threats in THREAT-MODEL.md have direct cross-boundary implications documented here:

| THREAT-MODEL ID | Description | PSM Seam Reference |
|-----------------|-------------|-------------------|
| T-02 | Owner key compromise | Section 6, PSM-04 |
| T-03 | Sybil trust farming | Section 4 (Attack Chain 1), Section 5 |
| T-04 | Malicious ERC-20 | Seam C (C-1 partial); ServiceAgreement token allowlist mitigates |
| T-09 | Endpoint bait-and-switch | Seam E (E-2, E-3) |
| T-13 | Garbage deliverables hash | Section 5, Seam G (G-1, G-2), PSM-11 |
| T-15 | Registry upgrade bricking wallets | Seam F (F-1, F-2) |

---

*ARC-402 Protocol Security Model v0.1.0 — 2026-03-11*  
*Scope: Cross-boundary threat analysis*  
*Next review: Before v1 production deployment*
