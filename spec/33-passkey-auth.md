# Spec 33 — ARC-402 Passkey Authentication
*Status: Draft | Date: 2026-03-16*

---

## Why This Exists

ARC402Wallet uses a master key (EOA, secp256k1) for governance operations. In practice this means MetaMask, a seed phrase, and WalletConnect — all friction-heavy and unreliable on mobile. WalletConnect sessions drop. MetaMask mobile has a history of routing bugs. Seed phrases are a liability.

Governance operations are rare and deliberate (set guardian, update policy, freeze, rotate keys). They do not need persistent key availability. They need a deliberate, authenticated, human-present approval mechanism. That is exactly what passkeys are built for.

Passkeys (WebAuthn / FIDO2) provide:
- Private key lives in the device secure enclave — never exportable, never leaves hardware
- Signing requires biometric presence (Face ID / fingerprint) — phishing-resistant by design
- Browser-native API — no wallet extension, no seed phrase
- Cross-device sync via iCloud Keychain / Google Password Manager

Base provides RIP-7212 — a P256 signature verification precompile at `0x0000000000000000000000000000000000000100`. Passkeys use ES256 (P256 / secp256r1). With RIP-7212, P256 verification costs ~3,500 gas instead of the ~300,000 gas required by pure-Solidity implementations. This makes passkey-based governance economically viable on-chain.

The result: Face ID replaces MetaMask for every governance UserOp. No seed phrase. No WalletConnect. No extension.

---

## Prerequisites

- **Spec 30** (ERC-4337 Wallet Standard) — `validateUserOp`, governance op classification, EOA signature path
- **Spec 32** (Daemon) — governance approval flow, Telegram notification, daemon config schema

---

## 1. Why Passkeys Fit ARC-402

The fit is architectural, not cosmetic.

```
ARC402Wallet governance path (current):
    master key (EOA) → signs userOpHash → validateUserOp → _validateOwnerSignature → ECDSA recover

ARC402Wallet governance path (Spec 33):
    passkey (P256) → signs userOpHash → validateUserOp → _validateP256Signature → RIP-7212 precompile
```

Three properties make this work cleanly:

**1. Governance ops are already isolated.** `validateUserOp` routes governance ops (setGuardian, updatePolicy, proposeRegistryUpdate, setVelocityLimit, freeze, unfreeze) through `_validateOwnerSignature`. This is the only place in the contract that needs to change — we replace the ECDSA check with a P256 check for passkey-auth wallets. Protocol ops (hire, deliver, accept) remain auto-approved by policy. They are never signed by the owner and are unaffected.

**2. Governance ops are rare.** The passkey authentication flow (open browser page, biometric, POST signature back to CLI) adds 3–5 seconds of latency. For autonomous protocol ops that run hundreds of times per day, this would be a problem. For governance ops that run once a month, it is not.

**3. Base has RIP-7212.** Without the precompile, P256 verification costs ~300k gas per governance op — prohibitive. With the precompile at `0x100`, it costs ~3,500 gas — cheaper than many token transfers. This is not a workaround; it is a first-class Base chain feature designed exactly for this use case.

---

## 2. Contract Changes (ARC402Wallet.sol)

### New State

```solidity
enum SignerType { EOA, Passkey }

struct OwnerAuth {
    SignerType signerType;
    bytes32    pubKeyX;   // P256 x coordinate (32 bytes)
    bytes32    pubKeyY;   // P256 y coordinate (32 bytes)
    // EOA path: pubKeyX = bytes32(uint256(uint160(ownerAddress))), pubKeyY = 0
}

OwnerAuth public ownerAuth;
```

`OwnerAuth` is stored in addition to the existing `address public immutable owner`. The `owner` field remains — it serves as the emergency fallback (§7) and is required by the `IARC402Wallet` interface (Spec 30 §6). After switching to passkey auth, `owner` becomes a break-glass key rather than the active governance signer.

On construction, `ownerAuth` is initialised to EOA mode with the owner address packed into `pubKeyX`:
```solidity
ownerAuth = OwnerAuth({
    signerType: SignerType.EOA,
    pubKeyX: bytes32(uint256(uint160(_owner))),
    pubKeyY: bytes32(0)
});
```

### New Governance Function

```solidity
/// @notice Transition governance signer to a passkey (P256) public key.
/// @dev    Only callable via governance UserOp (owner must sign as EOA — one last time).
///         After this call, all governance UserOps must carry a P256 signature.
///         The EOA owner address remains as an emergency fallback path (see emergencyOwnerOverride).
/// @param signerType  EOA or Passkey
/// @param pubKeyX     P256 x coordinate (32 bytes). Ignored for EOA (set to 0).
/// @param pubKeyY     P256 y coordinate (32 bytes). Ignored for EOA (set to 0).
function setOwnerAuth(SignerType signerType, bytes32 pubKeyX, bytes32 pubKeyY) external onlyEntryPointOrOwner {
    if (signerType == SignerType.Passkey) {
        if (pubKeyX == bytes32(0) && pubKeyY == bytes32(0)) revert WZero();
    }
    ownerAuth = OwnerAuth({ signerType: signerType, pubKeyX: pubKeyX, pubKeyY: pubKeyY });
    emit OwnerAuthUpdated(signerType, pubKeyX, pubKeyY);
}
```

`setOwnerAuth` is a governance op — it is added to `_isGovernanceOp()`. This means it must be signed by the current owner (EOA or passkey, depending on current state) to execute. You cannot trick the wallet into rotating its own signer from the outside.

### New Event

```solidity
event OwnerAuthUpdated(SignerType indexed signerType, bytes32 pubKeyX, bytes32 pubKeyY);
```

### Updated `validateUserOp` (governance branch)

```solidity
if (_isGovernanceOp(selector)) {
    if (ownerAuth.signerType == SignerType.Passkey) {
        validationData = _validateP256Signature(
            userOpHash,
            userOp.signature,
            ownerAuth.pubKeyX,
            ownerAuth.pubKeyY
        );
    } else {
        validationData = _validateOwnerSignature(userOpHash, userOp.signature);
    }
}
```

### P256 Verifier Using RIP-7212 Precompile

```solidity
address internal constant P256_PRECOMPILE = 0x0000000000000000000000000000000000000100;

/// @notice Verify a P256 (secp256r1) signature using the Base RIP-7212 precompile.
/// @param hash      The 32-byte message hash (userOpHash).
/// @param sig       64 bytes: r (32) || s (32). WebAuthn compact format.
/// @param pubKeyX   P256 public key x coordinate.
/// @param pubKeyY   P256 public key y coordinate.
/// @return SIG_VALIDATION_SUCCESS (0) or SIG_VALIDATION_FAILED (1).
function _validateP256Signature(
    bytes32 hash,
    bytes calldata sig,
    bytes32 pubKeyX,
    bytes32 pubKeyY
) internal view returns (uint256) {
    if (sig.length != 64) return SIG_VALIDATION_FAILED;

    bytes32 r = bytes32(sig[:32]);
    bytes32 s = bytes32(sig[32:64]);

    // RIP-7212 input: hash (32) || r (32) || s (32) || x (32) || y (32) = 160 bytes
    // Output: 32 bytes — 0x01 on success, 0x00 on failure (or empty on precompile missing)
    bytes memory input = abi.encodePacked(hash, r, s, pubKeyX, pubKeyY);
    (bool ok, bytes memory result) = P256_PRECOMPILE.staticcall(input);

    if (!ok || result.length < 32) return SIG_VALIDATION_FAILED;
    return abi.decode(result, (uint256)) == 1 ? SIG_VALIDATION_SUCCESS : SIG_VALIDATION_FAILED;
}
```

The precompile returns `1` on valid signature, `0` on invalid. If the precompile is not available (non-Base chain, devnet), the `staticcall` fails and the function returns `SIG_VALIDATION_FAILED` — safe degradation.

### Updated `_isGovernanceOp`

Add `setOwnerAuth` to the governance selector list:

```solidity
function _isGovernanceOp(bytes4 selector) internal pure returns (bool) {
    return selector == this.setGuardian.selector
        || selector == this.updatePolicy.selector
        || selector == this.proposeRegistryUpdate.selector
        || selector == this.setVelocityLimit.selector
        || selector == this.setOwnerAuth.selector           // new
        || selector == bytes4(keccak256("freeze(string)"))
        || selector == this.unfreeze.selector;
}
```

### Emergency Break-Glass

```solidity
/// @notice Emergency override: reset passkey using the EOA owner address.
/// @dev    Only callable by the EOA owner directly (not via EntryPoint).
///         This is the break-glass path when the passkey device is lost.
///         Sets signerType back to EOA so the owner can then rotate to a new passkey.
function emergencyOwnerOverride(bytes32 newPubKeyX, bytes32 newPubKeyY) external {
    if (msg.sender != owner) revert WAuth();
    ownerAuth = OwnerAuth({
        signerType: SignerType.Passkey,
        pubKeyX: newPubKeyX,
        pubKeyY: newPubKeyY
    });
    emit OwnerAuthUpdated(SignerType.Passkey, newPubKeyX, newPubKeyY);
}
```

Alternatively, pass `signerType = EOA` to revert to EOA mode entirely:
```solidity
function emergencyOwnerOverride() external {
    if (msg.sender != owner) revert WAuth();
    ownerAuth = OwnerAuth({
        signerType: SignerType.EOA,
        pubKeyX: bytes32(uint256(uint160(owner))),
        pubKeyY: bytes32(0)
    });
    emit OwnerAuthUpdated(SignerType.EOA, bytes32(uint256(uint160(owner))), bytes32(0));
}
```

Both overloads are valid. The choice between "reset to new passkey" vs. "revert to EOA" depends on the recovery scenario. See §7.

---

## 3. Registration Flow (One-Time Setup)

```
arc402 wallet setup --auth passkey
        ↓
CLI opens local web page: http://localhost:8765/passkey-setup.html
        ↓
Page calls navigator.credentials.create({
    publicKey: {
        challenge: <random 32 bytes from CLI>,
        rp: { name: "ARC-402", id: "localhost" },
        user: { id: <walletAddress bytes>, displayName: walletAddress },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }]  // alg: -7 = ES256 = P256
        authenticatorSelection: {
            residentKey: "required",    // discoverable credential — stored on device
            userVerification: "required"  // require biometric (Face ID / fingerprint)
        }
    }
})
        ↓
Face ID / fingerprint prompt on device
        ↓
Returns AuthenticatorAttestationResponse
        ↓
Page extracts credential.response.getPublicKey() → DER-encoded SPKI P256 public key
        ↓
CLI parses DER-encoded SPKI → extracts raw P256 (x, y) coordinates (64 bytes)
        ↓
CLI displays: "Public key registered. x=0x..., y=0x... — confirm to write on-chain."
        ↓
CLI encodes calldata: setOwnerAuth(Passkey, x, y)
CLI builds governance UserOp, signs with current EOA owner via WalletConnect
(This is the last time WalletConnect is needed)
        ↓
Bundler submits UserOp → EntryPoint → ARC402Wallet.setOwnerAuth(Passkey, x, y)
        ↓
CLI writes to daemon.toml:
  passkey_credential_id = "<base64url-encoded-credential-id>"
        ↓
Setup complete. MetaMask / WalletConnect never needed again.
```

### DER → (x, y) Parsing

WebAuthn returns the public key as a DER-encoded SPKI structure. The raw P256 coordinates are the last 64 bytes of the uncompressed point (`0x04 || x (32) || y (32)`). CLI parsing (TypeScript):

```typescript
function extractP256PublicKey(derBytes: Uint8Array): { x: Uint8Array; y: Uint8Array } {
    // DER SPKI for P256 ends with: 04 || x (32) || y (32)
    // Find the uncompressed point marker 0x04 at offset len-65
    const offset = derBytes.length - 65;
    if (derBytes[offset] !== 0x04) {
        throw new Error("Expected uncompressed P256 point (0x04 prefix)");
    }
    return {
        x: derBytes.slice(offset + 1, offset + 33),
        y: derBytes.slice(offset + 33, offset + 65),
    };
}
```

---

## 4. Governance Signing Flow (Ongoing)

Every governance operation follows this flow after passkey setup:

```
CLI or daemon needs governance signature
        ↓
CLI generates userOpHash (hash of the UserOperation to be signed)
        ↓
Opens signing page at http://localhost:8765/passkey-sign.html?challenge=<userOpHash>
        ↓
Page displays operation summary:
  "Sign governance operation:
   Function: setGuardian
   New guardian: 0x7a3b...
   Wallet: 0xC320..."
        ↓
User reviews summary, taps "Sign with Face ID"
        ↓
Page calls navigator.credentials.get({
    publicKey: {
        challenge: <userOpHash as ArrayBuffer>,
        allowCredentials: [{ id: <credentialId>, type: "public-key" }],
        userVerification: "required"
    }
})
        ↓
Face ID / fingerprint prompt → secure enclave signs
        ↓
Returns AuthenticatorAssertionResponse
        ↓
Page extracts: response.signature (DER-encoded) → converts to r, s (compact 64 bytes)
        ↓
CLI receives r || s (64 bytes total) — this is UserOp.signature
        ↓
CLI packs signature into UserOperation and submits to bundler
```

### WebAuthn Challenge and userOpHash

The WebAuthn `challenge` field becomes the signed message. The authenticator hashes and signs `challenge || clientDataJSON`. The contract sees `userOpHash` (the EntryPoint's hash of the UserOperation). These must be consistent.

The signing page must reconstruct the exact bytes the authenticator signed: `sha256(authenticatorData || sha256(clientDataJSON))`. The page sends both `authenticatorData` and `clientDataJSON` back to the CLI alongside `r` and `s`. The CLI forwards all four to the contract as the `signature` field.

Updated signature encoding for passkey UserOps:
```
UserOp.signature = abi.encode(r, s, authenticatorData, clientDataJSON)
```

The `_validateP256Signature` function must compute the actual signed hash from these fields before calling the precompile. The precompile verifies a raw `(hash, r, s, x, y)` tuple — the hash must be the one the authenticator actually signed, not `userOpHash` directly.

---

## 5. Telegram Remote Signing

When the daemon needs a governance approval and the operator is away from their computer:

```
Step 1: Daemon needs governance op signed
  → Sends Telegram message to configured chat_id:
    "⚠️ Governance approval needed
     Operation: proposeRegistryUpdate
     New registry: 0xcc0D87...
     Tap to sign on your phone."
  → Message includes inline button: [Sign with Face ID →]

Step 2: Button opens deep link
  → URL: https://app.arc402.xyz/sign?op=<base64url-encoded-userop>&challenge=<userOpHash>
  → Opened in phone browser (or Telegram WebApp)

Step 3: Phone signing page
  → Shows op details with structured summary
  → Calls WebAuthn on the phone
  → Face ID prompt → secure enclave signs
  → Page POSTs { r, s, authenticatorData, clientDataJSON } to daemon relay endpoint

Step 4: Daemon receives signature
  → Validates r, s are 32 bytes each
  → Packs UserOp.signature
  → Submits UserOp to bundler
  → Sends confirmation Telegram message: "✅ Governance op submitted. Tx: 0xa4c1..."
```

### Relay Endpoint

The daemon exposes a local signing relay endpoint:

```
POST http://localhost:8765/governance-signature
Authorization: Bearer <daemon_signing_token>
{
  "userOpHash": "0x...",
  "r": "0x...",
  "s": "0x...",
  "authenticatorData": "<base64url>",
  "clientDataJSON": "<base64url>"
}
```

The `daemon_signing_token` is a shared secret between the daemon and the signing page (embedded in the deep link URL, valid for one use, 5-minute TTL). This prevents unauthenticated submissions.

For production deployments where the daemon is behind NAT, the signing page POSTs to a relay service (arc402.xyz), which forwards to the daemon via a persistent outbound WebSocket connection. The daemon opens this connection at startup when `passkey_remote_signing = true` in daemon.toml.

### rp.id Domain Requirement

WebAuthn passkeys are scoped to a relying party domain (`rp.id`). A passkey registered on `localhost` cannot be used to sign on `arc402.xyz` — the browser enforces this strictly.

Implication: the signing page domain must be fixed and consistent between registration and signing.

| Environment | rp.id | Registration | Signing |
|-------------|-------|-------------|---------|
| Development | `localhost` | `localhost:8765/passkey-setup.html` | `localhost:8765/passkey-sign.html` |
| Production  | `arc402.xyz` | `app.arc402.xyz/passkey-setup` | `app.arc402.xyz/sign` |

The `arc402 wallet setup --auth passkey` command detects which environment is active and uses the appropriate rp.id. Operators who want production passkeys must complete setup via the app.arc402.xyz hosted page, not localhost.

---

## 6. Credential Storage

The passkey has two parts with different storage requirements:

| Data | Location | Secret? | Notes |
|------|----------|---------|-------|
| P256 public key (x, y) | On-chain in `ownerAuth` | No | Public — anyone can see it. Used for verification. |
| Credential ID | `~/.arc402/daemon.toml` | No | Opaque identifier. Needed to trigger signing. Not a secret. |
| Private key | Device secure enclave | N/A | Never exported. Never stored anywhere. That is the point. |

### `daemon.toml` additions

```toml
[wallet]
contract_address = "0x..."
owner_address = "0x..."
passkey_credential_id = "base64url-encoded-credential-id"   # new
passkey_rp_id = "arc402.xyz"                                # new — must match registration rp.id
passkey_remote_signing = false                              # new — enable relay for mobile signing
```

The `passkey_remote_signing` flag controls whether the daemon opens an outbound WebSocket to the arc402.xyz relay service to receive signatures from mobile. Default: false (local signing via localhost only).

---

## 7. Fallback and Recovery

Passkeys are tied to a device. If that device is lost:

### Scenario A: New passkey on a replacement device

The EOA `owner` address remains in the contract as the authoritative fallback. The `emergencyOwnerOverride` function is callable by the EOA owner directly (not via EntryPoint, not via passkey — only `msg.sender == owner`).

```
1. Operator imports seed phrase into MetaMask on any device
   (This is the one time the seed phrase is needed post-setup)

2. On the new device: register a new passkey
   → arc402 wallet setup --auth passkey --emergency-reset
   → New credential, new (x, y) coordinates

3. Call emergencyOwnerOverride(newX, newY) directly from EOA
   → Single raw ETH transaction from the owner EOA
   → No bundler, no UserOp, no EntryPoint required
   → ownerAuth updated to new passkey

4. Store new credential ID in daemon.toml
   Governance ops resume on new device
```

### Scenario B: Revert to EOA mode temporarily

```
1. EOA owner calls emergencyOwnerOverride() (no-arg overload)
   → ownerAuth.signerType = EOA
   → Governance UserOps validated by ECDSA again (MetaMask)

2. Generate and register a new passkey at leisure

3. Call setOwnerAuth(Passkey, newX, newY) as governance UserOp
   → Back to passkey mode
```

### Security Properties

- The EOA `owner` is never removed from the contract. It is `immutable` — set at construction, cannot be changed. This is the root of trust.
- `emergencyOwnerOverride` requires the EOA private key (MetaMask + seed phrase). Keep the seed phrase in cold storage. You need it only in a break-glass scenario.
- The guardian can freeze the wallet even if the passkey device is lost, preventing any operation until recovery is complete.

---

## 8. Bytecode Impact

### Current size

`ARC402Wallet.sol` at time of writing: **23,072 bytes** (post-audit, production-ready).
EVM bytecode size limit: **24,576 bytes**.
Headroom: **1,504 bytes**.

### Additions from Spec 33

| Addition | Estimated bytes |
|----------|----------------|
| `OwnerAuth` struct + `SignerType` enum storage | ~200 |
| `setOwnerAuth()` function | ~250 |
| `emergencyOwnerOverride()` function (two overloads) | ~300 |
| `_validateP256Signature()` function | ~350 |
| `validateUserOp` dispatch branch | ~150 |
| `OwnerAuthUpdated` event | ~100 |
| Constructor initialisation of `ownerAuth` | ~100 |
| Updated `_isGovernanceOp` selector | ~50 |
| **Estimated total** | **~1,500 bytes** |

Projected size: **23,072 + 1,500 = 24,572 bytes** — four bytes under the limit.

This is tight. The estimate should be validated by compiling with `--optimize-runs 200` after implementation. If the actual bytecode exceeds 24,576 bytes, the P256 verifier must be extracted:

### Extraction plan (if needed)

```solidity
library P256Verifier {
    address internal constant PRECOMPILE = 0x0000000000000000000000000000000000000100;

    function verify(bytes32 hash, bytes calldata sig, bytes32 x, bytes32 y)
        internal view returns (uint256) { ... }
}
```

Library functions are linked at deployment and do not count toward the calling contract's bytecode limit. The `DELEGATECALL` to the library adds ~100 gas per call — acceptable for governance ops.

**Recommendation:** implement inline first, measure, extract to library only if the limit is exceeded.

---

## 9. Build Sequence

Dependencies are strict. Do not reorder.

```
1. ARC402Wallet.sol — OwnerAuth state + setOwnerAuth
   - Add SignerType enum and OwnerAuth struct
   - Add ownerAuth state variable
   - Initialise ownerAuth in constructor (EOA mode)
   - Implement setOwnerAuth() with onlyEntryPointOrOwner
   - Add OwnerAuthUpdated event
   - No signature verification yet — just state management
   - No external dependencies

2. ARC402Wallet.sol — P256 verifier
   - Implement _validateP256Signature() using RIP-7212 precompile at 0x100
   - Unit test on Base Sepolia (precompile present)
   - Measure bytecode size against 24,576 limit
   - Extract to P256Verifier library if > 24,576 bytes
   - Depends on: step 1

3. ARC402Wallet.sol — validateUserOp dispatch
   - Update governance branch: check ownerAuth.signerType
   - Route to _validateP256Signature or _validateOwnerSignature
   - Add setOwnerAuth to _isGovernanceOp selector list
   - Depends on: steps 1, 2

4. ARC402Wallet.sol — emergencyOwnerOverride
   - Implement direct-EOA break-glass function
   - Both overloads (new passkey vs. revert to EOA)
   - Depends on: step 1

5. Testnet integration tests
   - Deploy to Base Sepolia
   - Test EOA → Passkey transition via setOwnerAuth
   - Test P256 governance UserOp accepted
   - Test EOA governance UserOp rejected when in Passkey mode
   - Test emergencyOwnerOverride resets to EOA
   - Test break-glass: EOA → new passkey after device loss
   - Depends on: steps 1–4

6. CLI — passkey-setup.html
   - Local page served by CLI on localhost:8765
   - navigator.credentials.create() with rp.id = localhost (dev) or arc402.xyz (prod)
   - DER → (x, y) extraction
   - setOwnerAuth calldata encoding + WalletConnect submission (final MetaMask use)
   - credential_id → daemon.toml write
   - Depends on: contract steps 1–4 deployed on testnet

7. CLI — passkey-sign.html
   - Local signing page for governance ops
   - navigator.credentials.get() with credential ID from daemon.toml
   - Signature → r, s extraction and compact encoding
   - authenticatorData + clientDataJSON forwarding
   - Depends on: step 6

8. Contract — authenticatorData/clientDataJSON hash path in _validateP256Signature
   - Full WebAuthn signed hash reconstruction
   - Must account for authenticatorData prefix, clientDataJSON SHA-256
   - See §4 for the hash construction
   - Depends on: step 2 (precompile wired), step 7 (signature format defined)

9. Daemon — passkey signing integration
   - POST endpoint: /governance-signature (localhost only by default)
   - One-use token generation and validation (5-minute TTL)
   - Updated governance UserOp build flow: sign via passkey page instead of WalletConnect
   - daemon.toml additions: passkey_credential_id, passkey_rp_id
   - Depends on: steps 6, 7

10. Daemon + Telegram — remote signing relay
    - Telegram deep link generation: app.arc402.xyz/sign?op=...&challenge=...
    - passkey_remote_signing flag in daemon.toml
    - Outbound WebSocket to arc402.xyz relay when enabled
    - Inline button in governance approval Telegram messages
    - Depends on: step 9, app.arc402.xyz signing page deployed ✅ live

11. app.arc402.xyz — production signing page ✅ live
    - Hosted at app.arc402.xyz/sign with rp.id = arc402.xyz
    - Production passkey registration: app.arc402.xyz/passkey-setup
    - POSTs signature to daemon relay endpoint or arc402.xyz relay service
    - rp.id mismatch handling: warn user to re-register if setup was done on localhost
    - This is an external/web deployment — separate from CLI and contract work
    - Depends on: steps 6–9 shipped and validated on testnet

12. Audit delta
    - P256 verifier path in validateUserOp
    - emergencyOwnerOverride access control
    - setOwnerAuth — can this be called to degrade security? (yes, by owner only — by design)
    - Bytecode size confirmation
    - Depends on: steps 1–8 complete, testnet validation done
```

**What can ship first:** Steps 1–5 (contract changes + testnet tests) are fully self-contained. Steps 6–8 (CLI signing pages) can be developed in parallel. Steps 9–11 (daemon and Telegram integration) depend on the contract and CLI work being stable.

---

## 10. Open Questions

**1. rp.id transition: localhost (dev) → app.arc402.xyz (prod)**

A passkey registered on localhost cannot sign on app.arc402.xyz. Operators who set up during development will need to re-register when switching to the production signing page. The transition UX is: `arc402 wallet setup --auth passkey --re-register`, which registers a new passkey on the prod domain and calls `setOwnerAuth` with the new (x, y). The old localhost passkey becomes dead weight in the browser. Document this clearly in the setup flow.

**2. Multi-device: can the same passkey be used on multiple devices?**

Yes, via platform sync:
- Apple: iCloud Keychain syncs passkeys across iPhone, iPad, and Mac automatically.
- Google: Google Password Manager syncs passkeys across Android and Chrome.

The passkey's (x, y) public key is the same across synced devices. The credential ID may differ per-platform. `daemon.toml` stores one credential ID — the one used on the signing device.

Security tradeoff: iCloud/Google account compromise now means passkey compromise. Operators with strict security requirements should use a hardware security key (see below) which does not sync. The protocol is agnostic — both paths produce the same (r, s) output.

**3. Hardware security key (YubiKey) support**

YubiKey 5 series supports FIDO2 with P256. The WebAuthn API is identical — the authenticator selection differs:

```javascript
authenticatorSelection: {
    authenticatorAttachment: "cross-platform",  // external hardware key
    userVerification: "preferred"               // YubiKey PIN, not biometric
}
```

From the contract's perspective, a YubiKey-generated signature is indistinguishable from a phone-generated one. Both produce (r, s) over P256. YubiKey does not sync — if the key is lost, use `emergencyOwnerOverride`. Operators should keep a backup YubiKey registered as a second passkey. The contract supports this: `setOwnerAuth` can be called again to rotate to a second YubiKey.

**4. What exactly does the contract verify from the WebAuthn response?**

WebAuthn does not sign `userOpHash` directly. It signs `sha256(authenticatorData || sha256(clientDataJSON))`. The `clientDataJSON` contains the challenge (which we set to `userOpHash`). The contract must verify:
1. `clientDataJSON.challenge == base64url(userOpHash)` — ensures the signing was for this specific UserOp
2. The P256 signature over `sha256(authenticatorData || sha256(clientDataJSON))` is valid

This means `_validateP256Signature` needs the full `authenticatorData` and `clientDataJSON` to reconstruct the signed message, not just a raw hash. The signature field encoding in §4 handles this. Resolve the exact encoding before Step 8 of the build sequence.

**5. Signature malleability on P256**

P256 signatures are malleable (for any valid `(r, s)`, `(r, -s mod n)` is also valid). This is the same issue secp256k1 has. For UserOps the EntryPoint deduplicates by nonce, so replaying a malleable signature achieves nothing — the nonce would already be consumed. This is not a new vulnerability, but should be confirmed with the auditor.

---

*Spec 33 — ARC-402 Passkey Authentication*
*Written: 2026-03-16*
