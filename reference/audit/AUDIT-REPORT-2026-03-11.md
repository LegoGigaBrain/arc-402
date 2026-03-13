# ARC-402 Audit Report — 2026-03-11

## Summary

- **Tools run:** Forge (tests + coverage), Slither, Semgrep, Halmos, Mythril, solhint (via forge lint), 4naly3er (not installed — skipped)
- **Total findings:** 22 (CRITICAL: 0, HIGH: 1, MEDIUM: 3, LOW: 8, INFO: 10)
- **Contracts audited:**
  - ARC402Wallet.sol
  - ARC402Registry.sol
  - PolicyEngine.sol
  - TrustRegistry.sol
  - IntentAttestation.sol
  - SettlementCoordinator.sol
  - WalletFactory.sol
  - X402Interceptor.sol
  - AgentRegistry.sol *(new)*
  - ServiceAgreement.sol *(new)*
- **Test suite:** 79/79 passing ✅
- **Audit date:** 2026-03-11
- **Auditor:** Automated (Forge + Slither + Semgrep + Mythril + Halmos + forge lint)

---

## Critical Findings

**None.** No findings classified as CRITICAL (funds at risk via direct exploit, unchecked access control bypass, or classic reentrancy with incorrect CEI) were identified.

---

## High Findings

### H-01 — `ServiceAgreement._releaseEscrow` sends ETH to arbitrary address
- **Contract:** `ServiceAgreement.sol`
- **Lines:** 299–306
- **Tool:** Slither (High severity)
- **Description:** Slither flags `_releaseEscrow(address token, address recipient, uint256 amount)` as sending ETH to an arbitrary destination. The `recipient` parameter is always populated with `ag.client` or `ag.provider` — parties that voluntarily entered the agreement. However, if either party deploys a malicious contract as their address, they could in theory attempt re-entrancy. The CEI pattern **is** correctly applied at all call sites (state is set to `FULFILLED`, `CANCELLED`, or `RESOLVED` before `_releaseEscrow` is invoked), but events are emitted **after** the external call, which could mislead off-chain monitoring in a re-entrant scenario.
- **Risk:** A malicious provider/client contract could re-enter and observe incorrect event ordering. State re-entrancy is not exploitable due to CEI. Direct fund loss is NOT possible given current control flow, but the pattern is dangerous and should be hardened.
- **Recommendation:**
  1. Add `nonReentrant` modifier (OpenZeppelin `ReentrancyGuard`) to `fulfill()`, `cancel()`, `expiredCancel()`, and `resolveDispute()`.
  2. Move all event emissions before `_releaseEscrow()` calls to strictly follow CEI.
  3. Consider a pull-payment pattern (escrow withdrawal) for ETH releases instead of push.

```solidity
// Example fix in fulfill():
ag.status = Status.FULFILLED;
ag.resolvedAt = block.timestamp;
ag.deliverablesHash = actualDeliverablesHash;
emit AgreementFulfilled(agreementId, msg.sender, actualDeliverablesHash); // emit BEFORE external call
_releaseEscrow(ag.token, ag.provider, ag.price);
```

---

## Medium Findings

### M-01 — Missing zero-address validation in constructors and setters
- **Contracts:** `ARC402Registry.sol` (lines 23–26, 43–46), `WalletFactory.sol` (line 21)
- **Tool:** Slither (Low/Medium confidence)
- **Description:** Constructor and `update()` in `ARC402Registry` accept `_policyEngine`, `_trustRegistry`, `_intentAttestation`, and `_settlementCoordinator` without checking for `address(0)`. WalletFactory accepts `_registry` without a zero-check. If any of these are set to `address(0)` (e.g., deployment misconfiguration), wallets deployed from this registry will be permanently broken — all spend calls will revert on external calls to the zero address.
- **Recommendation:** Add `require(addr != address(0), "...")` checks in both constructors and in the `update()` function.

```solidity
require(_policyEngine != address(0), "Registry: zero policyEngine");
require(_trustRegistry != address(0), "Registry: zero trustRegistry");
require(_intentAttestation != address(0), "Registry: zero intentAttestation");
require(_settlementCoordinator != address(0), "Registry: zero settlementCoordinator");
```

### M-02 — Events emitted after external calls (CEI partial violation)
- **Contracts:** `ServiceAgreement.sol` (fulfill:174, cancel:213, expiredCancel:232, resolveDispute:258)
- **Tool:** Slither (Low/Medium confidence, reentrancy-events)
- **Description:** In all four state-transition functions, the `emit` statement occurs after the `_releaseEscrow()` external call. While state variables are updated before the external call (correct CEI for storage), the event is emitted in the callback window. This can produce misleading off-chain logs if a re-entrant call triggers before the emit. Also affects `X402Interceptor.executeX402Payment()` which emits after calling into `ARC402Wallet`.
- **Recommendation:** Move all event emissions to immediately after state changes, before any external calls.

### M-03 — X402Interceptor has zero test coverage
- **Contract:** `X402Interceptor.sol`
- **Tool:** Forge coverage
- **Description:** `X402Interceptor` — the on-chain payment gateway component — has 0% line, statement, branch, and function coverage. This contract handles USDC payment interception and calls back into `ARC402Wallet.executeTokenSpend()`. No tests exist for the payment flow, refund path, or access controls.
- **Recommendation:** Write a full test suite for `X402Interceptor` before mainnet. At minimum: happy-path USDC payment, insufficient balance revert, unauthorised caller revert, and context-not-open revert.

---

## Low / Info Findings

### LOW

**L-01 — Block timestamp dependence** (Slither)
- Contracts: `SettlementCoordinator.sol` (lines 50, 101, 128), `ServiceAgreement.sol` (lines 119, 165, 228)
- `block.timestamp` used for deadline comparisons. Block producers can manipulate by ~12–15 seconds. At current transaction volumes and deadline lengths (typically hours/days), this is acceptable risk. No action required for mainnet, but document the assumption.

**L-02 — TrustRegistry arithmetic underflow (Semgrep INFO)**
- `TrustRegistry.sol:96` — `oldScore < DECREMENT ? 0 : oldScore - DECREMENT`
- Properly guarded against underflow. Semgrep flagged a potential arithmetic path but the ternary makes it safe. No action required.

**L-03 — Arbitrary low-level ETH calls flagged by Semgrep**
- `ARC402Wallet.sol:141`, `SettlementCoordinator.sol:102`
- Both use `recipient.call{value: amount}("")` which is the correct pattern for ETH transfers (avoids gas limit issues of `transfer()`). The CEI pattern is followed in both cases. Flag is expected — document intent.

**L-04 — WalletFactory reentrancy in createWallet() (Slither LOW)**
- `WalletFactory.sol:25–36` — After deploying new `ARC402Wallet`, calls `ITrustRegistry.initWallet()` on an external contract. This is a state-registration call, not a value-transfer call. The risk is low but the wallet object is in memory before the registry is updated.
- Recommendation: No code change needed, but consider adding `ReentrancyGuard` to `createWallet()` as defence-in-depth.

**L-05 — Low coverage on ARC402Registry (43.75%) and TrustRegistry (66.67%)**
- The `update()` function on `ARC402Registry` is completely untested (0% coverage).
- TrustRegistry `bulkInitWallets()`, `bulkUpdateScores()`, `removeUpdater()` untested.
- Recommendation: Add tests for all admin/update paths before mainnet.

**L-06 — SettlementCoordinator branch coverage (50%)**
- `SettlementCoordinator.checkExpiry()` and reject/accept failure paths untested.
- Recommendation: Add negative-path tests.

**L-07 — `proposeMASSettlement` function naming**
- `ARC402Wallet.sol:187` — Function name uses `MAS` abbreviation in PascalCase, violating Solidity mixedCase convention. Should be `proposeMasSettlement`.
- Low risk, but inconsistent naming.

**L-08 — Immutable variables use camelCase (forge lint)**
- `ARC402Registry.sol:12`, `WalletFactory.sol:14`, `ARC402Wallet.sol:25`, `X402Interceptor.sol:20–21`, `AgentRegistry.sol:18` — All immutables should use `SCREAMING_SNAKE_CASE` per Solidity convention.

### INFO

**I-01 — ARC402Wallet should explicitly inherit IARC402Wallet**
- Slither: `ARC402Wallet` (contracts/ARC402Wallet.sol) should inherit from `IARC402Wallet` (contracts/X402Interceptor.sol#61–69). Currently implicit.

**I-02 — Parameter naming convention in ARC402Registry.update()**
- Parameters `_policyEngine`, `_trustRegistry` etc. use leading underscores (acceptable) but Slither flags as not in mixedCase.

**I-03 — Events missing indexed parameters**
- `ARC402Registry.ContractsUpdated` and `ARC402Wallet.RegistryUpdated` have address parameters without `indexed`. This reduces off-chain filtering efficiency.

**I-04 — Unaliased plain imports (forge lint)**
- 30+ import statements use `import "path/file.sol"` without named imports or aliases. Minor style issue.

**I-05 — Unwrapped modifier logic (forge lint)**
- `onlyOwner`, `requireOpenContext`, `onlyUpdater` modifiers in multiple contracts recommended to be wrapped in internal functions to reduce bytecode size.

**I-06 — Solidity version pragma in OZ dependencies**
- `^0.8.20`, `>=0.6.2`, `>=0.4.16` version constraints in OpenZeppelin dependencies include historically known compiler bugs. These are in the dependency, not the project contracts. Acceptable for current OZ release.

**I-07 — Halmos: no symbolic tests**
- No `check_` prefixed functions exist in the test suite. Halmos ran but found nothing to verify formally. Consider adding symbolic tests for critical invariants (e.g., `check_trustScoreNeverExceeds1000`, `check_escrowNeverDrained`).

**I-08 — Mythril: all outputs empty**
- Mythril ran per-contract but produced no findings. This is likely due to Mythril hitting analysis timeouts on the full bytecode rather than confirming clean analysis. Cannot be treated as a pass.

**I-09 — 4naly3er not installed**
- Tool failed with `MODULE_NOT_FOUND`. Install with `npm i -g 4naly3er` for future audits.

**I-10 — ARC402WalletTest.sol in contracts/ directory**
- `contracts/ARC402WalletTest.sol` is a test/reference contract living in the production contracts directory. This is not deployed but adds confusion. Should be moved to `test/` or `reference/`.

---

## Tool Results

| Tool | Status | Notes |
|------|--------|-------|
| **Forge build** | ✅ PASS | Compiled 57 files, 0 errors |
| **Forge test** | ✅ PASS | 79/79 tests passing, 0 failures |
| **Forge coverage** | ⚠️ PARTIAL | Several contracts below 70% coverage (ARC402Registry 43%, X402Interceptor 0%) |
| **Forge lint** | ⚠️ WARNINGS | 4 warnings, ~60 style notes (no errors) |
| **Slither** | ⚠️ 1 HIGH | 1 high, 35 low, 20 informational — see H-01, M-01, M-02 |
| **Semgrep** | ⚠️ 3 ERROR | 3 arbitrary-low-level-call (expected pattern), 1 info arithmetic |
| **Mythril** | ⚠️ INCONCLUSIVE | All output files empty — likely timeout. Not a clean pass. |
| **Halmos** | ℹ️ N/A | No symbolic tests written — halmos skipped |
| **4naly3er** | ❌ NOT INSTALLED | `MODULE_NOT_FOUND` — tool not available |

---

## Verdict

### **PASS WITH CONDITIONS**

The codebase is structurally sound. The test suite passes 100% (79/79). No CRITICAL vulnerabilities were found. The one HIGH finding (H-01) reflects a dangerous ETH transfer pattern in `ServiceAgreement` that is currently not exploitable due to correct CEI for state, but is one contract-upgrade away from becoming dangerous.

### Conditions that MUST be resolved before mainnet:

1. **[H-01] Add `ReentrancyGuard` to ServiceAgreement** — `fulfill()`, `cancel()`, `expiredCancel()`, `resolveDispute()` must be protected. Move event emissions before `_releaseEscrow()`. This is a 30-minute fix.

2. **[M-01] Add zero-address checks** — `ARC402Registry` constructor/`update()` and `WalletFactory` constructor must validate all address parameters. Bricking deployed wallets via misconfigured deployment is a real ops risk.

3. **[M-03] Write X402Interceptor tests** — The payment gateway has zero test coverage. This must not go to mainnet untested.

### Recommended before mainnet (not blocking):

4. **[M-02] Move all events before external calls** — Fix event ordering across all four ServiceAgreement state-transition functions.
5. **[L-05]** Add tests for `ARC402Registry.update()` and `TrustRegistry` admin functions.
6. **[I-07]** Add at least 2–3 Halmos symbolic invariant tests for trust scoring and escrow arithmetic.
7. **[I-08]** Re-run Mythril with `--execution-timeout 300` per contract to confirm no findings.

### New contracts verdict:

- **AgentRegistry.sol** — PASS. 96.8% coverage, 100% function coverage. Clean architecture. Zero critical issues.
- **ServiceAgreement.sol** — PASS WITH CONDITIONS. H-01 and M-02 must be fixed. Otherwise sound escrow logic, SafeERC20 used correctly, CEI state transitions are correct.

---

*Audit conducted by Forge automated pipeline. Manual review of CEI patterns and re-entrancy vectors performed. Findings reflect state of codebase as of 2026-03-11.*
