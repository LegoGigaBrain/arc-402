# Spec 35 — ARC-402 Onboarding Web App
*Status: Draft | Date: 2026-03-17*

---

## Summary

A single-page guided flow at `app.arc402.xyz/onboard` that takes an operator from zero to a fully configured ARC-402 wallet in four browser-native steps. No CLI required. No seed phrase visible. Works on mobile.

---

## Why This Exists

The CLI (`arc402 wallet deploy`, `arc402 wallet set-guardian`, etc.) is authoritative but has a high setup barrier: Node.js, npm, config files, WalletConnect QR scanning on a laptop. The onboarding app reduces first-time setup to a phone-native flow: connect MetaMask/Rainbow/Rabby, register Face ID, set limits — all from Safari or Chrome on iOS/Android.

---

## 1. Flow Overview

```
/onboard
  ├── Step 1: Deploy Wallet
  ├── Step 2: Register Passkey (Face ID)
  ├── Step 3: Set Policy          [optional]
  └── Step 4: Register Agent      [optional]
```

Progress indicator at top. Each step shows current state (done / active / pending). Steps are completed in order; earlier steps must succeed before later steps are shown. Steps 3 and 4 can be skipped.

The deployed wallet address is displayed throughout once known.

---

## 2. Contract Addresses (Base Mainnet, chain 8453)

| Contract        | Address |
|----------------|---------|
| WalletFactory  | `0x974d2ae81cC9B4955e325890f4247AC76c92148D` |
| EntryPoint     | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| AgentRegistry  | `0xcc0D8731ccCf6CFfF4e66F6d68cA86330Ea8B622` |
| PolicyEngine   | `0xAA5Ef3489C929bFB3BFf5D5FE15aa62d3763c847` |

---

## 3. Step 1 — Deploy Wallet

**Goal:** Get an ARC-402 wallet contract address controlled by the user's EOA.

**Flow:**

```
1. User taps "Connect Wallet"
   → WalletConnect SignClient creates session
   → WC URI shown → wallet-specific deep links (MetaMask, Rabby, Trust, Rainbow, Coinbase)
   → User taps their wallet, approves connection in wallet app
   → Session established, EOA address extracted

2. App calls WalletFactory.getWallets(ownerAddress)
   → eth_call to Base mainnet RPC

3a. If wallets found:
   → "You already have an ARC-402 wallet: 0x…"
   → User selects wallet (if multiple)
   → Skip to Step 2

3b. If no wallet found:
   → "No ARC-402 wallet found for this address."
   → "Deploy Wallet" button
   → eth_sendTransaction: WalletFactory.createWallet(entryPoint)
   → Wait for receipt, parse WalletCreated event for new wallet address
   → Show: "ARC-402 Wallet deployed: 0x…"
   → Proceed to Step 2
```

**On-chain call:**
```
WalletFactory.createWallet(address _entryPoint) → address walletAddress
```

**Required WC methods:** `eth_sendTransaction`

---

## 4. Step 2 — Register Passkey

**Goal:** Bind a device Face ID / fingerprint to the ARC-402 wallet via P256 public key.

See Spec 33 for full passkey architecture rationale.

**Flow:**

```
1. Display wallet address context (ARC-402 wallet from Step 1)

2. "Register Face ID" button
   → navigator.credentials.create({
       challenge: <random 32 bytes>,
       rp: { name: 'ARC-402', id: rpId },   // rpId = 'arc402.xyz' in prod
       user: { id: walletAddr, name: walletAddr, displayName: 'ARC-402 ...' },
       pubKeyCredParams: [{ type: 'public-key', alg: -7 }],   // P256
       authenticatorSelection: {
         authenticatorAttachment: 'platform',
         userVerification: 'required',
         residentKey: 'preferred',
       },
     })
   → Face ID / fingerprint prompt
   → Extract getPublicKey() → SPKI → Web Crypto importKey(JWK) → x, y coords

3. Display:
   - credentialId (base64url)
   - pubKeyX (0x-prefixed 32-byte hex)
   - pubKeyY (0x-prefixed 32-byte hex)
   - CLI command: arc402 wallet set-passkey <x> <y>

4. "Activate On-Chain" button (WC)
   → New WC session
   → eth_sendTransaction: ARC402Wallet.setPasskey(bytes32 pubKeyX, bytes32 pubKeyY)
   → On success: "Face ID activated. Governance ops now use Face ID instead of MetaMask."

5. "Skip for now" link → proceed to Step 3
```

**On-chain call:**
```
ARC402Wallet.setPasskey(bytes32 pubKeyX, bytes32 pubKeyY)
```

**rpId scoping:**

| Domain | rpId |
|--------|------|
| `app.arc402.xyz` | `arc402.xyz` |
| `arc402-app.pages.dev` | `arc402-app.pages.dev` |
| `localhost` | `localhost` |

Passkeys registered in production (`arc402.xyz`) work for all governance signing at `app.arc402.xyz/passkey-sign`.

---

## 5. Step 3 — Set Policy (optional)

**Goal:** Configure spending limits and emergency guardian on the wallet.

**Inputs:**

| Field | Default | On-chain target |
|-------|---------|----------------|
| Velocity limit (ETH / rolling window) | 0.05 | `ARC402Wallet.setVelocityLimit(wei)` |
| Guardian address | auto-generate or skip | `ARC402Wallet.setGuardian(address)` |
| Max hire price (ETH) | 0.1 | `PolicyEngine.setCategoryLimitFor(wallet, "hire", wei)` |

**Flow:**

```
1. Show three inputs pre-filled with defaults

2. "Generate Guardian Key" button
   → ethers.Wallet.createRandom() in browser
   → Display guardian address
   → Warn: "Save this address. It is your emergency freeze key."

3. "Apply Settings" button → WC session
   → eth_sendTransaction: ARC402Wallet.setVelocityLimit(limitWei)
   → if guardian set: eth_sendTransaction: ARC402Wallet.setGuardian(guardianAddr)
   → if max hire price: eth_sendTransaction: PolicyEngine.setCategoryLimitFor(walletAddr, "hire", priceWei)

4. "Skip" link → proceed to Step 4
```

**Note:** Guardian private key is never sent to any server. Display it once for the user to save securely. In a future version, offer iCloud Keychain storage or a Telegram backup.

---

## 6. Step 4 — Register Agent (optional)

**Goal:** Register the ARC-402 wallet as an agent in the on-chain agent registry.

**Inputs:**

| Field | Notes |
|-------|-------|
| Agent name | Human-readable, e.g. "My Research Agent" |
| Capabilities | Comma-separated, e.g. "research, summarization" |
| Service type | e.g. "research", "coding", "data-analysis" |
| Endpoint URL | HTTPS URL the hiring agent will call |

**Flow:**

```
1. Show inputs

2. "Register Agent" button → WC session
   → Encode: AgentRegistry.register(name, capabilities[], serviceType, endpoint, "")
   → Encode: ARC402Wallet.executeContractCall({
       target: AGENT_REGISTRY,
       data: <register calldata>,
       value: 0,
       minReturnValue: 0,
       maxApprovalAmount: 0,
       approvalToken: address(0),
     })
   → eth_sendTransaction to ARC402Wallet

3. "Skip" link → proceed to Done screen
```

**Why via executeContractCall?**
The AgentRegistry records `msg.sender` as the agent's wallet address. The user's ARC-402 wallet contract must be the caller, not their EOA. `executeContractCall` is the governed mechanism for the wallet contract to make outbound calls.

---

## 7. Done Screen

After completing (or skipping) all steps:

```
✅ Setup complete

ARC-402 Wallet: 0xABCD...1234

What's working:
  ✓ Wallet deployed (Base Mainnet)
  ✓ Face ID registered           [or: "Passkey not yet activated on-chain"]
  ✓ Policy configured            [or: "Using default policy"]
  ✓ Agent registered             [or: "Not registered as agent"]

Next steps:
  • Fund your wallet with ETH for gas
  • Run the arc402 daemon: arc402 daemon start
  • View governance operations: app.arc402.xyz/passkey-sign
```

---

## 8. Technical Design

### WalletConnect

Each step that requires an on-chain transaction creates a fresh `SignClient` session:

```
SignClient.init({ projectId, metadata })
→ client.connect({ requiredNamespaces: { eip155: { methods: ['eth_sendTransaction'], chains: ['eip155:8453'] } } })
→ WC URI → wallet deep links
→ await approval()
→ session.namespaces.eip155.accounts[0] → EOA address
→ client.request(eth_sendTransaction)
→ client.disconnect()
```

The deploy step reuses the same WC session for both wallet lookup (off-chain) and deployment (on-chain) to minimize user friction.

### Static Export

The `/onboard` route must be statically exportable (`next.config.js output: 'export'`). Use `'use client'` directive. Wrap in `<Suspense>` in `page.tsx`.

### Mobile-First

- Cards: max-width 420px, centered
- Inline styles (no CSS modules, consistent with existing pages)
- Font: system UI (`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`)
- Dark background: `#080808` with `#111` cards

### ABI Fragments Used

```typescript
// WalletFactory
'function createWallet(address _entryPoint) external returns (address)'
'event WalletCreated(address indexed owner, address indexed walletAddress)'

// ARC402Wallet
'function setPasskey(bytes32 pubKeyX, bytes32 pubKeyY) external'
'function setVelocityLimit(uint256 limit) external'
'function setGuardian(address _guardian) external'
'function executeContractCall((address target, bytes data, uint256 value, uint256 minReturnValue, uint256 maxApprovalAmount, address approvalToken) params) external'

// AgentRegistry
'function register(string name, string[] capabilities, string serviceType, string endpoint, string metadataURI) external'

// PolicyEngine
'function setCategoryLimitFor(address wallet, string category, uint256 limitPerTx) external'
```

---

## 9. CLI Counterpart

The `arc402 wallet set-passkey <pubKeyX> <pubKeyY>` CLI command is the terminal equivalent of Step 2's on-chain activation. It is displayed as a reference command in the UI even when the WC button is available.

Command signature:
```
arc402 wallet set-passkey <pubKeyX> <pubKeyY>
```

Takes two `bytes32` hex arguments (the x and y P256 public key coordinates extracted from the WebAuthn credential) and calls `ARC402Wallet.setPasskey(bytes32, bytes32)` via WalletConnect.

---

## 10. Open Questions

1. **Guardian key storage** — The browser generates a random guardian key. How should the user store the private key? Options: display once + copy, email, Telegram backup. V1: display once.

2. **Policy Engine min trust score** — No `setMinTrustScore` ABI defined in current contracts. Needs contract-level spec before it can be surfaced in the UI.

3. **Multiple wallets** — If the user has more than one ARC-402 wallet, show a selector. All subsequent steps operate on the selected wallet.

4. **Passkey "skip"** — If the user skips passkey activation in Step 2, the CLI command is shown as a fallback. The passkey state on the done screen should reflect this.

5. **Transaction confirmations** — Currently the app sends transactions and moves on. Consider polling for receipt in the background and showing a toast when confirmed.

---

*Spec 35 — ARC-402 Onboarding Web App*
*Written: 2026-03-17*
