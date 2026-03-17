# Smart Contract Security Audit — Spec 33 Passkey / P256 Auth
**Target:** `contracts/ARC402Wallet.sol` — passkey additions only
**Scope:** `setPasskey`, `clearPasskey`, `emergencyOwnerOverride` (×2), `_validateP256Signature`, updated `validateUserOp` routing, `_isGovernanceOp` additions, `OwnerAuth` struct + `SignerType` enum
**Spec Reference:** `spec/33-passkey-auth.md`
**Prior Audit:** `audit/AUDIT-ERC4337-2026-03-16.md` (all prior findings verified not regressed)
**Date:** 2026-03-17
**Auditor:** Claude Sonnet 4.6 (automated audit)
**Status:** ❌ BLOCKED — 1 Critical, 1 High finding require fixes before deploy

---

## Pre-Audit Test Baseline

```
forge test 2>&1 | tail -5
```

- **610 total tests: 610 passed, 0 failed, 0 skipped**
- All 4 pre-existing failures from the ERC-4337 audit are now fully resolved (not introduced by passkey work)

---

## Bytecode Size Check

```
forge build --sizes | grep ARC402Wallet
```

```
| ARC402Wallet | 26,838 (B) runtime | -2,262 margin |
Error: some contracts exceed the runtime size limit (EIP-170: 24576 bytes)
```

**ARC402Wallet runtime size: 26,838 bytes. EIP-170 limit: 24,576 bytes. Over by 2,262 bytes.**

The spec projected 24,572 bytes (4 bytes under limit). Actual is 2,266 bytes over that projection.

---

## Findings

---

### AUD-PK-01

**ID:** AUD-PK-01
**Severity:** Critical
**Title:** Runtime bytecode size 26,838 bytes exceeds EIP-170 24,576 byte limit — contract cannot be deployed

**Description:**
The Spec 33 passkey additions push ARC402Wallet from its pre-spec size of ~23,072 bytes to 26,838 bytes runtime — 2,262 bytes over the EVM limit. Any attempt to deploy this contract to mainnet or any standard EVM chain will revert during `CREATE` with an out-of-gas error. The contract is undeployable as-is.

The spec explicitly anticipated this risk (§8) and provided an extraction plan:

> *"If the actual bytecode exceeds 24,576 bytes, the P256 verifier must be extracted to a library."*

That extraction was not performed.

**Impact:** Complete deployment blocker. The contract cannot be created on any standard EVM chain.

**Fix (required before deploy):**

Extract `_validateP256Signature` to a Solidity library. Library functions are linked at deployment and do not count toward the calling contract's bytecode limit. The spec's extraction plan is ready to implement:

```solidity
library P256Verifier {
    address internal constant PRECOMPILE = 0x0000000000000000000000000000000000000100;

    function verify(
        bytes32 hash,
        bytes calldata sig,
        bytes32 x,
        bytes32 y
    ) internal view returns (uint256) {
        if (sig.length != 64) return 1;
        bytes32 r = bytes32(sig[:32]);
        bytes32 s = bytes32(sig[32:64]);
        bytes memory input = abi.encodePacked(hash, r, s, x, y);
        (bool ok, bytes memory result) = PRECOMPILE.staticcall(input);
        if (!ok || result.length < 32) return 1;
        return abi.decode(result, (uint256)) == 1 ? 0 : 1;
    }
}
```

In `ARC402Wallet`, replace the inline function with:
```solidity
using P256Verifier for bytes32;
// ...
validationData = userOpHash.verify(userOp.signature, ownerAuth.pubKeyX, ownerAuth.pubKeyY);
```

The `DELEGATECALL` to the library adds ~100 gas per governance op — acceptable for rare governance operations.

If the library extraction alone is insufficient (should recover ~350+ bytes), also consider:
- Inlining `clearPasskey` body into `emergencyOwnerOverride()` (shared path)
- Removing the `pubKeyX`/`pubKeyY` fields from EOA-mode `OwnerAuth` (store zero, reconstruct on demand)

**Verify:** After fix, `forge build --sizes | grep ARC402Wallet` must show positive margin.

---

### AUD-PK-02

**ID:** AUD-PK-02
**Severity:** High
**Title:** `_validateP256Signature` verifies against raw `userOpHash` — incompatible with real WebAuthn authenticators; all Face ID / passkey signatures fail validation

**Description:**
WebAuthn authenticators (Face ID, fingerprint, YubiKey) do **not** sign `userOpHash` directly. The WebAuthn protocol signs:

```
sha256(authenticatorData || sha256(clientDataJSON))
```

where `clientDataJSON` is a JSON blob that embeds the `challenge` field (set to `userOpHash`).

The current contract implementation:

```solidity
function _validateP256Signature(
    bytes32 hash,           // ← userOpHash
    bytes calldata sig,     // ← compact 64-byte r || s
    bytes32 pubKeyX,
    bytes32 pubKeyY
) internal view returns (uint256) {
    if (sig.length != 64) return SIG_VALIDATION_FAILED;
    // ...
    bytes memory input = abi.encodePacked(hash, r, s, pubKeyX, pubKeyY);
    // precompile verifies: is (r,s) a valid P256 sig over `hash`?
}
```

It passes `userOpHash` as `hash`. But the authenticator signed `sha256(authData || sha256(clientDataJSON))` — a **different value**.

The front-end (`web/app/passkey-sign/PasskeySignContent.tsx`) confirms the gap:

```typescript
// line 57-64: calls navigator.credentials.get() with userOpHash as challenge
// line 67: parseDerSig(new Uint8Array(response.signature)) → compact 64-byte r||s
// line 75: sends { signature } to daemon (no authData, no clientDataJSON)
```

The page correctly uses the WebAuthn API with `userVerification: 'required'` (biometric), and the authenticator signs the WebAuthn-computed hash. The compact (r, s) is forwarded without the `authenticatorData` and `clientDataJSON` needed to reconstruct the signed hash on-chain.

**Result:** Every governance UserOp signed by a real passkey authenticator (Face ID / fingerprint / YubiKey) will return `SIG_VALIDATION_FAILED`. The passkey authentication path is completely non-functional for production WebAuthn signers.

This corresponds to Spec §4 and Build Step 8 which are explicitly marked unimplemented:

> *"8. Contract — authenticatorData/clientDataJSON hash path in `_validateP256Signature` — Full WebAuthn signed hash reconstruction [...] Depends on: step 7 (signature format defined)"*

The contract implements Step 2 (precompile wired) but not Step 8 (hash reconstruction).

**Note on malleability:** P256 signatures are malleable (`(r, s)` and `(r, -s mod n)` both valid). The EntryPoint's per-nonce deduplication prevents replay of malleated sigs. Not a new or exploitable vulnerability, but recorded per spec §10 Q5.

**Fix (required before deploy):**

Two parts:

**Part A — Signature encoding.** Update `UserOp.signature` format for passkey UserOps to include the WebAuthn fields:

```
UserOp.signature (passkey mode) = abi.encode(r, s, authenticatorData, clientDataJSON)
```

where `r` and `s` are 32-byte values extracted from the DER signature, `authenticatorData` is raw bytes, and `clientDataJSON` is the raw UTF-8 JSON bytes.

**Part B — Contract hash reconstruction.** Update `_validateP256Signature` to accept and reconstruct the WebAuthn-signed hash:

```solidity
function _validateP256Signature(
    bytes32 userOpHash,
    bytes calldata sig,       // abi.encode(r, s, authData, clientDataJSON)
    bytes32 pubKeyX,
    bytes32 pubKeyY
) internal view returns (uint256) {
    if (sig.length < 64) return SIG_VALIDATION_FAILED;

    // Decode compact sig components
    (bytes32 r, bytes32 s, bytes memory authData, bytes memory clientDataJSON) =
        abi.decode(sig, (bytes32, bytes32, bytes, bytes));

    // Verify challenge: clientDataJSON must contain base64url(userOpHash)
    // (off-chain enforcement; on-chain check optional but recommended)

    // Reconstruct the hash the authenticator actually signed
    bytes32 clientDataHash = sha256(clientDataJSON);
    bytes32 signedHash = sha256(abi.encodePacked(authData, clientDataHash));

    bytes memory input = abi.encodePacked(signedHash, r, s, pubKeyX, pubKeyY);
    (bool ok, bytes memory result) = P256_PRECOMPILE.staticcall(input);
    if (!ok || result.length < 32) return SIG_VALIDATION_FAILED;
    return abi.decode(result, (uint256)) == 1 ? SIG_VALIDATION_SUCCESS : SIG_VALIDATION_FAILED;
}
```

Note: `sha256()` is a Solidity built-in (gas ~100 + 12/word). Two SHA-256 calls add ~200 gas per governance op — negligible.

**Part C — Front-end.** Update `PasskeySignContent.tsx` to post `authData` and `clientDataJSON` alongside the signature:

```typescript
const response = assertion.response as AuthenticatorAssertionResponse
const signature = parseDerSig(new Uint8Array(response.signature))
const authData = b64url(response.authenticatorData)
const clientDataJSON = b64url(response.clientDataJSON)
// POST { signature, authData, clientDataJSON }
```

**Alternatively:** Document that the system uses raw P256 signing (not WebAuthn protocol compliance), remove the biometric-enforcement security claim from the spec and UI, and accept that the key is not hardware-enclave-backed. This is a valid design choice for a v1 but must be explicit.

---

### AUD-PK-03

**ID:** AUD-PK-03
**Severity:** Medium
**Title:** `clearPasskey()` and `emergencyOwnerOverride()` (no-arg) emit no events — silent signer-type changes

**Description:**
The `setPasskey` function correctly emits `PasskeySet`. But two functions that change `ownerAuth` silently do not emit any event:

```solidity
function clearPasskey() external onlyEntryPointOrOwner {
    ownerAuth = OwnerAuth({ signerType: SignerType.EOA, ... });
    // ← no event
}

function emergencyOwnerOverride() external {
    if (msg.sender != owner) revert WAuth();
    ownerAuth = OwnerAuth({ signerType: SignerType.EOA, ... });
    // ← no event
}
```

Any off-chain monitoring, indexer, or guardian system watching for passkey-related state changes will miss these transitions. An attacker who manages to call `clearPasskey` via a replayed governance UserOp (theoretical — nonce prevents this) could silently degrade from P256 to ECDSA. More practically, a bug or race condition in the daemon could call `clearPasskey` and the owner would have no on-chain event record to alert them.

The spec calls for `OwnerAuthUpdated` events on all auth state changes (§2).

**Fix:**

Add a `PasskeyCleared` event (or reuse a generic `OwnerAuthChanged` event) and emit on `clearPasskey` and the no-arg `emergencyOwnerOverride`:

```solidity
event PasskeyCleared();

function clearPasskey() external onlyEntryPointOrOwner {
    ownerAuth = OwnerAuth({ signerType: SignerType.EOA, pubKeyX: bytes32(uint256(uint160(owner))), pubKeyY: bytes32(0) });
    emit PasskeyCleared();
}

function emergencyOwnerOverride() external {
    if (msg.sender != owner) revert WAuth();
    ownerAuth = OwnerAuth({ signerType: SignerType.EOA, pubKeyX: bytes32(uint256(uint160(owner))), pubKeyY: bytes32(0) });
    emit PasskeyCleared();
}
```

---

### AUD-PK-04

**ID:** AUD-PK-04
**Severity:** Low
**Title:** `authorizeMachineKey` / `revokeMachineKey` are `onlyOwner` — inaccessible via passkey governance UserOps

**Description:**
Machine key management functions use `onlyOwner` (not `onlyEntryPointOrOwner`) and are absent from `_isGovernanceOp`:

```solidity
function authorizeMachineKey(address key) external onlyOwner { ... }
function revokeMachineKey(address key) external onlyOwner { ... }
```

In Passkey mode, governance UserOps route through `_validateP256Signature`. But even if the passkey sig is valid, the EntryPoint cannot call these functions — `msg.sender == entryPoint` fails `onlyOwner`.

A user who has fully switched to passkey-based governance (no MetaMask active) cannot manage machine keys without importing their seed phrase. In a key-loss scenario, the user is locked out of machine key management until they recover the EOA.

This predates Spec 33 and was a deliberate design choice (machine keys are sensitive; EOA-only management adds friction). Now that passkeys are the primary governance signer, the friction is imposed on normal operations. Whether to change this is a design decision, not a security fix.

**Recommendation (not blocking):**
Consider whether `authorizeMachineKey` and `revokeMachineKey` should be moved to `onlyEntryPointOrOwner` and added to `_isGovernanceOp`. This allows passkey-signed governance UserOps to manage machine keys. The security gate remains `validateUserOp` with P256 or ECDSA verification.

---

### AUD-PK-05

**ID:** AUD-PK-05
**Severity:** Info
**Title:** Prior finding AUD-4337-04 (`validateUserOp` not `nonReentrant`) still unresolved

**Description:**
The prefund ETH transfer in `validateUserOp` remains before the `notFrozen` / signature check path:

```solidity
if (missingAccountFunds > 0) {
    (bool ok,) = payable(address(entryPoint)).call{value: missingAccountFunds}("");
    if (!ok) revert WPrefund();
}
```

This is unchanged from the ERC-4337 audit. The mitigation remains: `entryPoint` is immutable, requiring a malicious EntryPoint from genesis to exploit. Not introduced by passkey work. Recorded for completeness.

---

### AUD-PK-06

**ID:** AUD-PK-06
**Severity:** Info
**Title:** Spec / implementation API divergence — `setOwnerAuth` → `setPasskey` + `clearPasskey`

**Description:**
Spec §2 defines a single `setOwnerAuth(SignerType, bytes32, bytes32)` function. The implementation splits this into `setPasskey(bytes32, bytes32)` and `clearPasskey()`. No security impact — the splitting is a reasonable simplification. `_isGovernanceOp` is correctly updated for the actual selectors. The spec should be updated to match the implementation.

---

## Checklist Results

| Check | Result | Notes |
|---|---|---|
| Access control: attacker cannot set passkey on victim wallet | ✅ Pass | `setPasskey` / `clearPasskey` use `onlyEntryPointOrOwner`; both are governance ops requiring owner signature |
| Replay protection: P256 sig cannot be replayed | ✅ Pass | ERC-4337 nonce consumed by EntryPoint before re-use; malleated sigs also consume same nonce |
| EOA fallback always available | ✅ Pass | `emergencyOwnerOverride` checks `msg.sender == owner` only; no `notFrozen`; no EntryPoint dependency |
| Emergency override risks | ✅ Acceptable | Direct EOA call only; intentional break-glass; root-of-trust is the immutable EOA `owner` |
| `_validateP256Signature` RIP-7212 encoding | ✅ Correct | `hash \|\| r \|\| s \|\| x \|\| y` = 160 bytes; matches spec; length check; safe-degrades on non-Base chains |
| `_validateP256Signature` length check | ✅ Pass | `sig.length != 64` → FAILED; prevents malformed input |
| `_validateP256Signature` hash input | ❌ **FAIL** | Verifies against raw `userOpHash`; WebAuthn sigs are over different hash → always FAIL (AUD-PK-02) |
| `_isGovernanceOp`: `setPasskey` present | ✅ Pass | Line 271 |
| `_isGovernanceOp`: `clearPasskey` present | ✅ Pass | Line 272 |
| Storage layout: `OwnerAuth` appended after all existing vars | ✅ Pass | No existing slot interference; adds 3 new slots (enum + pubKeyX + pubKeyY) |
| Runtime bytecode ≤ 24,576 bytes | ❌ **FAIL** | 26,838 bytes — 2,262 bytes over limit (AUD-PK-01) |
| Tests green | ✅ Pass | 610/610 passed |

---

## Summary

| ID | Severity | Title | Status |
|---|---|---|---|
| AUD-PK-01 | **Critical** | Runtime bytecode 26,838 B > 24,576 B EIP-170 limit — undeployable | ❌ Not fixed |
| AUD-PK-02 | **High** | WebAuthn hash not reconstructed — all real passkey sigs fail validation | ❌ Not fixed |
| AUD-PK-03 | Medium | `clearPasskey` / `emergencyOwnerOverride()` emit no events | ⚠️ Not fixed |
| AUD-PK-04 | Low | Machine key mgmt EOA-only — inaccessible from passkey governance UserOps | ⚠️ Design choice |
| AUD-PK-05 | Info | AUD-4337-04 (`validateUserOp` not nonReentrant) persists | — Pre-existing |
| AUD-PK-06 | Info | Spec `setOwnerAuth` API vs. impl `setPasskey`/`clearPasskey` divergence | — Spec update needed |

---

## ❌ BLOCKED — Required Fixes Before Deploy

### Fix 1 (AUD-PK-01): Extract `_validateP256Signature` to `P256Verifier` library

Recover ≥350 bytes. The spec's extraction plan in §8 is ready. After extraction, `forge build --sizes | grep ARC402Wallet` must show positive runtime margin.

### Fix 2 (AUD-PK-02): Implement WebAuthn hash reconstruction

**Option A (full WebAuthn compliance — recommended):**
1. Update `UserOp.signature` format to `abi.encode(r, s, authData, clientDataJSON)`
2. In `_validateP256Signature`, decode these fields and compute `sha256(authData || sha256(clientDataJSON))` as the hash passed to the precompile
3. Update `PasskeySignContent.tsx` to include `authData` and `clientDataJSON` in its callback payload

**Option B (raw P256 signing — acceptable v1 scope-reduction):**
1. Remove `navigator.credentials.get()` from the signing page; replace with `SubtleCrypto.sign()` over a P256 key stored in the browser / daemon
2. Update all security documentation to remove the "biometric / secure enclave" claim
3. Document that this is software-backed P256 (similar to a signing key file), not WebAuthn

**Option A is required if the system is to deliver the stated passkey security model. Option B is safe but must be clearly communicated to users.**

---

*AUDIT-PASSKEY-2026-03-17 | ARC-402 Wallet Spec 33 Passkey P256 Auth*
