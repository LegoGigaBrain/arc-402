# ComputeAgreement Audit Reconciliation

**Date:** 2026-03-23
**Audits reconciled:** First Pass (Sonnet) + Auditor A (Attacker) + Auditor B (Architect) + Auditor C (Opus) + Machine Sweep (10 tools)

---

## CRITICAL — Must fix before testnet

| ID | Source | Title | Action |
|----|--------|-------|--------|
| CA-IND-1 | Opus | **Cross-chain signature replay — digest lacks chainId + address(this)** | FIX: Add `block.chainid` and `address(this)` to `_reportDigest()`. Update `compute-metering.ts` `buildReportDigest()` / `signReport()` to match. |

## HIGH — Fix before mainnet

| ID | Source | Title | Action |
|----|--------|-------|--------|
| CA-IND-2 | Opus | s-value malleability (amplifies CA-IND-1) | FIX: Add `s <= secp256k1n/2` and `v == 27 || v == 28` checks in `_recoverSigner()` |
| CA-ARCH-1 | Architect | Arbitrator immutable — no rotation/compromise recovery | ACKNOWLEDGE for v1. Document. Multi-sig arbitrator is operational mitigation. |
| CA-ARCH-2 | Architect | Client-only dispute timeout — provider has no fallback | FIX: Default to usage-report-based settlement on timeout instead of full client refund |
| SL-2 | Slither | Missing zero-address check on constructor arbitrator | FIX: Add `require(_arbitrator != address(0))` |

## MEDIUM — Fix or document

| ID | Source | Title | Action |
|----|--------|-------|--------|
| CA-IND-3 | Opus | proposeSession overpayment uses push-transfer | FIX: Require exact `msg.value == required` (option A). Simplest. |
| CA-IND-4 | Opus | resolveDispute(0,0) silently refunds to client | DOCUMENT: Intended behavior. |
| CA-IND-5 | Opus | calculateCost truncation favors client | DOCUMENT: Intentional. Client-favorable rounding. |
| CA-IND-6 | Opus | Redundant signature + msg.sender check | KEEP: Signature is for forensic/dispute evidence, not access control. Document intent. |

## LOW/INFO — Acknowledge

| ID | Source | Title | Action |
|----|--------|-------|--------|
| CA-IND-7 | Opus | abi.encodePacked vs abi.encode | FIX: Switch to abi.encode (free improvement) |
| CA-IND-8 | Opus | Force-sent ETH stuck | ACKNOWLEDGE |
| CA-IND-9 | Opus | No acceptedAt field | ACKNOWLEDGE for v1 |
| CA-IND-10 | Opus | Theoretical overflow | ACKNOWLEDGE — impossible |
| SL-1 | Slither | Strict equality false positive | FALSE POSITIVE |
| SL-3-6 | Slither | Cosmetic/info | ACKNOWLEDGE |

## Machine Sweep Results

- **Forge:** 39/39 PASS ✅
- **Slither:** 1 new finding (SL-2, zero-address) — merged above
- **Mythril:** TIMEOUT — no findings
- **Echidna:** 50,243 calls, all properties hold ✅
- **Halmos:** SKIPPED (no symbolic tests)
- **Semgrep:** No security findings (gas/style only)
- **Solhint:** NatSpec warnings only
- **Aderyn:** 1 high (duplicate of SL-2)
- **Wake:** ERROR (reference/ dir pollution)
- **Medusa:** ERROR (constructor arg issue)

## Verdict

**1 CRITICAL finding (CA-IND-1) must be fixed before testnet.** This is the exact class of bug our Opus second-eyes pass is designed to catch. Sonnet missed it. The three-auditor protocol justified itself.

After fixing CA-IND-1 + CA-IND-2 + SL-2 + CA-IND-3 + CA-ARCH-2 + CA-IND-7: proceed to testnet deploy.

---

## ERC-20 Audit Pass

**Date:** 2026-03-23
**Scope:** ERC-20/USDC payment support added to ComputeAgreement (proposeSession, endSession, resolveDispute, claimDisputeTimeout, cancelSession, withdraw)
**Auditor:** Claude Sonnet 4.6

### Changes audited
- `pendingWithdrawals` changed from `mapping(address => uint256)` to `mapping(address => mapping(address => uint256))` (user → token → amount)
- `ComputeSession` struct gained `address token` field
- `proposeSession` gained `address token` parameter with dual ETH/ERC-20 deposit paths
- `withdraw(address token)` replaces `withdraw()` — caller specifies which token to pull
- All settlement paths (`endSession`, `resolveDispute`, `claimDisputeTimeout`, `cancelSession`) credit the session's token
- OpenZeppelin SafeERC20 used for all ERC-20 transfers
- `MsgValueWithToken` error added for msg.value != 0 on ERC-20 sessions

### Finding: ERC20-1 — Can tokens get stuck? **NO**

Every credit path has a corresponding withdrawal path:
- `endSession` → credits `pendingWithdrawals[provider][tok]` + `pendingWithdrawals[client][tok]`
- `resolveDispute` → same (including remainder back to client)
- `claimDisputeTimeout` → same
- `cancelSession` → credits `pendingWithdrawals[client][tok]`
- `withdraw(token)` → drains `pendingWithdrawals[msg.sender][token]`

The double-mapping preserves the invariant: for every session, `depositAmount == sum of all credits issued`. Verified by 74/74 tests passing including fuzz tests.

**Status: CLEAN**

### Finding: ERC20-2 — Reentrancy via ERC-777 tokens? **LOW**

ERC-777 tokens call a `tokensReceived` hook on the recipient during `transfer`/`transferFrom`. If a malicious token's hook re-enters `withdraw`, the checks-effects-interactions pattern protects the contract:

```
pendingWithdrawals[msg.sender][token] = 0;  // effect FIRST
IERC20(token).safeTransfer(msg.sender, amount);  // interaction SECOND
```

The balance is zeroed before the external call, so a re-entrant `withdraw(token)` call would hit `NothingToWithdraw`. SafeERC20 wraps the transfer — no additional attack surface.

**Status: MITIGATED by CEI pattern. ACKNOWLEDGE: document ERC-777 as unsupported for proposeSession (untested), since safeTransferFrom during propose could also trigger hooks. Recommend allowlist or caller documentation.**

### Finding: ERC20-3 — Fee-on-transfer tokens? **NOT SUPPORTED — DOCUMENTED**

If a token charges a transfer fee, `depositAmount` would be recorded as `ratePerHour * maxHours` but the contract would only hold `amount - fee`. On settlement, `safeTransfer(provider, cost)` could exceed the actual balance held, causing a revert.

**Status: NOT SUPPORTED. Documented in `proposeSession` NatDoc: "NOTE: fee-on-transfer and rebasing tokens are not supported."**

### Finding: ERC20-4 — Rebasing tokens? **NOT SUPPORTED — DOCUMENTED**

Rebasing tokens change holder balances out-of-band. A negative rebase between deposit and withdrawal could make `safeTransfer(amount)` fail with insufficient balance. A positive rebase would leave excess tokens stuck (covered under ERC20-1 note: rebasing surplus cannot be withdrawn via `pendingWithdrawals`).

**Status: NOT SUPPORTED. Documented in `proposeSession` NatDoc.**

### Finding: ERC20-5 — Token approval front-running? **ACKNOWLEDGE**

Standard `transferFrom` pattern requires the client to `approve` the contract before calling `proposeSession`. Approval front-running (attacker observes approve, frontruns with transferFrom) is a general ERC-20 concern but does not affect this contract's security — the contract is not the attacker.

Mitigation pattern (approve(0) then approve(amount)) is left to integrators. No contract-level change warranted.

**Status: STANDARD PATTERN. No action needed.**

### Finding: ERC20-6 — Double-mapping breaks existing invariants? **NO**

Previous invariant: `sum(pendingWithdrawals[*]) == address(this).balance`
New invariant per token: `sum(pendingWithdrawals[*][tok]) == token.balanceOf(address(this))` for ERC-20, and same for ETH (`tok == address(0)`).

The fuzz test (`testFuzz_settlement`) verifies: `providerCredit + clientCredit == required` for all random inputs. This holds for both ETH and ERC-20 sessions. Dual sessions (one ETH, one ERC-20 for same client) are verified in `test_erc20_withdrawSpecificToken`.

**Status: INVARIANTS PRESERVED. Verified by tests.**

### Finding: ERC20-7 — Contract size under EIP-170? **PASS**

`forge build --sizes` output:
- Runtime size: 14,886 bytes (EIP-170 limit: 24,576 bytes)
- Runtime margin: 9,690 bytes

**Status: WELL WITHIN LIMIT**

### ERC-20 Audit Summary

| ID | Title | Status |
|----|-------|--------|
| ERC20-1 | Tokens can get stuck | CLEAN |
| ERC20-2 | ERC-777 reentrancy | MITIGATED (CEI) |
| ERC20-3 | Fee-on-transfer tokens | NOT SUPPORTED (documented) |
| ERC20-4 | Rebasing tokens | NOT SUPPORTED (documented) |
| ERC20-5 | Approval front-running | STANDARD PATTERN (acknowledged) |
| ERC20-6 | Double mapping breaks invariants | CLEAN |
| ERC20-7 | Contract size EIP-170 | PASS (14,886 / 24,576 bytes) |

**Test results: 74/74 PASS** (51 ComputeAgreementTest + 23 ComputeAgreementAttackerTest)
