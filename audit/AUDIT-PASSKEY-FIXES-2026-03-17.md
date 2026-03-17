# Security Audit — Passkey Fix Verification (Second Eyes)
**Target:** `ARC402Wallet.sol`, `P256VerifierLib.sol`, `PasskeySignContent.tsx`
**Scope:** Three fixes from `AUDIT-PASSKEY-2026-03-17.md` (AUD-PK-01, AUD-PK-02, AUD-PK-03)
**Prior Audit:** `audit/AUDIT-PASSKEY-2026-03-17.md` — 1 Critical (bytecode size), 1 High (WebAuthn hash), 1 Medium (missing events)
**Date:** 2026-03-17
**Auditor:** Claude Opus 4.6 (second-eyes review)
**Status:** ❌ BLOCKED — 1 Critical finding (missing challenge verification)

---

## Fix 1: P256VerifierLib.sol Extraction (AUD-PK-01 fix)

**Verdict: PASS — correctly implemented**

| Check | Result | Detail |
|---|---|---|
| Precompile address | ✅ | `0x0000000000000000000000000000000000000100` — correct RIP-7212 address on Base |
| Input encoding | ✅ | `abi.encodePacked(hash, r, s, pubKeyX, pubKeyY)` = 160 bytes — matches RIP-7212 spec |
| Return decode | ✅ | `abi.decode(result, (uint256)) == 1 ? SIG_VALID : SIG_INVALID` — correct (1 = valid) |
| Fallback on absent precompile | ✅ | `!success || result.length < 32` → `SIG_INVALID` — safe-degrades; no revert |
| Signature length guard | ✅ | `signature.length != 64` → `SIG_INVALID` — prevents malformed input |
| Library linkage | ✅ | `internal view` functions — DELEGATECALL at deployment, runs in wallet context, no trust change vs inline |
| Assembly safety | ✅ | `mload(add(signature, 32))` and `mload(add(signature, 64))` — standard memory-safe extraction from `bytes memory` |
| Caller integration | ✅ | `_validateP256Signature` passes `abi.encodePacked(r, s)` (64 bytes) — matches length check |

No issues found in the library extraction.

---

## Fix 2: WebAuthn Hash Reconstruction (AUD-PK-02 fix)

**Verdict: PARTIAL — hash reconstruction correct, but missing challenge verification creates a critical vulnerability**

### What's correct

| Check | Result | Detail |
|---|---|---|
| Signature decode | ✅ | `abi.decode(sig, (bytes32, bytes32, bytes, bytes))` — (r, s, authData, clientDataJSON) |
| Minimum length guard | ✅ | `sig.length < 192` — 4 head words (128) + 2 length words (64) = 192 bytes minimum for ABI-encoded struct |
| Hash reconstruction | ✅ | `sha256(abi.encodePacked(authData, sha256(clientDataJSON)))` — matches WebAuthn spec exactly |
| Precompile input | ✅ | Passes reconstructed `msgHash` (not `userOpHash`) to P256VerifierLib — correct |
| Web app: authData extraction | ✅ | `new Uint8Array(response.authenticatorData)` — correct ArrayBuffer → bytes conversion |
| Web app: clientDataJSON extraction | ✅ | `new Uint8Array(response.clientDataJSON)` — correct raw UTF-8 bytes |
| Web app: ABI encoding | ✅ | `AbiCoder.encode(['bytes32', 'bytes32', 'bytes', 'bytes'], [r, s, authData, clientDataJSON])` — matches contract's `abi.decode` |
| Web app: DER parsing | ✅ | `parseDerSig` correctly handles variable-length DER integers, pads to 32 bytes, produces 64-byte compact |

### AUD-PK-FIX-01: Missing `clientDataJSON` challenge verification

**Severity:** CRITICAL
**Location:** `ARC402Wallet.sol:299-322` — `_validateP256Signature`
**Commit context:** Lines 313-314 explicitly suppress the `userOpHash` parameter:

```solidity
// Suppress unused-variable warning for userOpHash — callers may use it for challenge
// verification off-chain; on-chain we verify the WebAuthn-reconstructed hash instead.
(userOpHash);
```

**Description:**

The contract reconstructs the WebAuthn hash correctly and verifies the P256 signature over it. However, it never verifies that `clientDataJSON` contains the correct challenge (which should be `userOpHash`). The `userOpHash` parameter is explicitly discarded.

This breaks the cryptographic binding between a WebAuthn assertion and the specific UserOp it authorizes.

**Attack scenario:**

1. User signs a legitimate governance UserOp (e.g., `updatePolicy`). The UserOp is submitted to the mempool or executes on-chain. The full signature payload `(r, s, authData, clientDataJSON)` is visible in calldata.
2. Attacker extracts this signature payload from on-chain calldata.
3. Attacker crafts a malicious governance UserOp (e.g., `setPasskey` with attacker-controlled public key) using a fresh nonce.
4. Attacker attaches the stolen signature payload to the malicious UserOp.
5. Contract decodes the signature, reconstructs `sha256(authData || sha256(clientDataJSON))` — this produces the **same hash** as the original (the bytes are identical).
6. P256 verification **passes** — the signature is valid over this hash.
7. EntryPoint accepts the UserOp (nonce is fresh, signature validates).
8. Attacker now controls governance — can rotate passkey, clear passkey, freeze wallet, etc.

**Impact:** Complete wallet takeover. Any observed passkey-signed governance UserOp gives an attacker a reusable credential to authorize arbitrary governance operations. The only requirement is observing one valid assertion — which is publicly visible on-chain for every governance tx.

**Root cause:** The WebAuthn protocol's security model relies on the `challenge` field in `clientDataJSON` to bind each assertion to a specific operation. The contract ignores this binding.

**Fix (required):**

Parse `clientDataJSON` on-chain and verify the `challenge` field matches `base64url(userOpHash)`. Implementation:

```solidity
// After decoding clientDataJSON:
// 1. Parse the "challenge":"<base64url>" field from the JSON bytes
// 2. Base64url-decode it
// 3. Compare against userOpHash

// Minimal approach — search for challenge field and compare:
bytes memory expectedChallenge = abi.encodePacked(
    '"challenge":"', _base64urlEncode(abi.encodePacked(userOpHash)), '"'
);
if (!_containsBytes(clientDataJSON, expectedChallenge)) return SIG_VALIDATION_FAILED;
```

Alternative (gas-efficient): Use a known-offset approach if the WebAuthn client always places `challenge` at a fixed position in `clientDataJSON` (standard browsers do: `{"type":"webauthn.get","challenge":"...","origin":"..."}`). Extract the challenge bytes at a fixed offset and compare directly.

**Note:** This is gas-expensive (~5,000-15,000 gas for JSON parsing) but governance ops are rare. The alternative — trusting off-chain challenge verification — defeats the purpose of on-chain signature validation.

---

### AUD-PK-FIX-02: P256 signature malleability not mitigated

**Severity:** LOW
**Location:** `P256VerifierLib.sol:18-37`

**Description:**

P256 (secp256r1) signatures are malleable: for any valid `(r, s)`, `(r, n - s)` is also valid (where `n` is the curve order). The library does not enforce `s < n/2` (low-s normalization).

With the challenge verification gap (AUD-PK-FIX-01), this doubles the number of valid signatures an attacker can derive from one observed assertion.

Even with challenge verification fixed, malleability means an attacker could submit a malleated version of a valid UserOp signature. However, EntryPoint nonce deduplication prevents replaying the same UserOp, so the practical impact is negligible once challenge verification is in place.

**Recommendation:** Add low-s enforcement in `P256VerifierLib`:

```solidity
// secp256r1 curve order
bytes32 constant P256_N_DIV_2 = 0x7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8;
if (uint256(s) > uint256(P256_N_DIV_2)) return SIG_INVALID;
```

This is defense-in-depth, not blocking.

---

## Fix 3: Events (AUD-PK-03 fix)

**Verdict: PASS — correctly implemented**

| Check | Result | Detail |
|---|---|---|
| `PasskeyCleared()` in `clearPasskey()` | ✅ | Line 485 — emitted after state change (line 484). Correct. |
| `PasskeyCleared()` in no-arg `emergencyOwnerOverride()` | ✅ | Line 506 — emitted after state change (line 505). Correct. |
| `EmergencyOverride(pubKeyX, pubKeyY)` in two-arg `emergencyOwnerOverride(bytes32, bytes32)` | ✅ | Line 498 — emitted after state change (line 496). Also emits `PasskeySet` first (line 497). Correct. |
| Checks-effects-events pattern | ✅ | All three functions: state change → emit. No external calls between. |
| Event parameter types | ✅ | `EmergencyOverride(bytes32 indexed pubKeyX, bytes32 pubKeyY)` — `pubKeyX` is indexed for filtering, `pubKeyY` is not (acceptable — filtering by X is sufficient). |

No issues found in the event additions.

---

## General Checks

| Check | Result | Detail |
|---|---|---|
| Library vs inline security properties | ✅ No change | `internal view` library functions compile to DELEGATECALL — same trust model as inline code |
| EOA fallback intact | ✅ | `_validateOwnerSignature` (lines 284-292) unchanged — `toEthSignedMessageHash` + `tryRecover` + `recovered == owner` |
| New attack surfaces | ❌ | Challenge verification gap (AUD-PK-FIX-01) creates a signature-reuse attack that doesn't exist in the ECDSA path (ECDSA signs `userOpHash` directly — the binding is inherent) |
| `_isGovernanceOp` coverage | ✅ | `setPasskey` and `clearPasskey` both present (lines 275-276) |
| `emergencyOwnerOverride` access control | ✅ | `msg.sender != owner` — direct EOA only, not through EntryPoint. Correct for break-glass. |

---

## Summary

| ID | Severity | Title | Status |
|---|---|---|---|
| Fix 1 (AUD-PK-01) | — | P256VerifierLib extraction | ✅ Correctly fixed |
| Fix 3 (AUD-PK-03) | — | Events added | ✅ Correctly fixed |
| Fix 2 (AUD-PK-02) | — | WebAuthn hash reconstruction | ⚠️ Partially fixed |
| **AUD-PK-FIX-01** | **CRITICAL** | No `clientDataJSON` challenge verification — signature reuse allows wallet takeover | ❌ Must fix |
| AUD-PK-FIX-02 | LOW | P256 signature malleability (low-s not enforced) | ⚠️ Defense-in-depth |

---

## ❌ BLOCKED — Missing challenge verification (AUD-PK-FIX-01)

The WebAuthn hash reconstruction is correct but incomplete. Without verifying that `clientDataJSON.challenge == base64url(userOpHash)`, any observed governance signature can be replayed against arbitrary governance operations. This is a **complete wallet takeover** vector — the signature is publicly visible in on-chain calldata after every governance tx.

### Required fix before deploy

Add on-chain `clientDataJSON` challenge parsing in `_validateP256Signature`:

1. Extract the `challenge` field from the JSON bytes
2. Base64url-decode it
3. Verify it equals `userOpHash`
4. Return `SIG_VALIDATION_FAILED` if mismatch

The `userOpHash` parameter is already available — it just needs to be used instead of suppressed.

### Optional (recommended)

Add low-s enforcement in `P256VerifierLib` (AUD-PK-FIX-02).

---

*AUDIT-PASSKEY-FIXES-2026-03-17 | ARC-402 Wallet — Second-Eyes Fix Verification*
