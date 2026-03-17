# Spec 36 — Embedded Wallet Auth (Social / Email Login)
*Status: Draft | Date: 2026-03-17*

---

## Why This Exists

The majority of potential ARC-402 users are not crypto-native. Requiring MetaMask as the only path to onboarding excludes anyone who:

- Has never installed a browser wallet
- Is on iOS Safari (MetaMask mobile is unreliable)
- Wants to onboard in under 60 seconds without understanding seed phrases
- Is a developer evaluating ARC-402 for the first time on a fresh machine

Email and social login (Google, Apple) create *embedded wallets* — EOAs backed by MPC or TEE key management held by a provider. The ARC-402 protocol sees embedded wallet addresses as identical to MetaMask wallet addresses. Nothing in the contracts, SDK, CLI, or daemon changes.

---

## Prerequisites

- **Spec 33** (Passkey Auth) — setPasskey flow, P256 governance key
- **Spec 35** (Onboarding App) — /onboard page, deploy + passkey registration flow

---

## 1. Architecture Constraint

ARC-402 contracts are immutable and have no concept of email, social identity, or authentication provider. Identity is a wallet address. This spec is exclusively about how that wallet address gets created for users without MetaMask.

The embedded wallet EOA created by Privy is functionally identical to a MetaMask EOA at the protocol level. It can:

- Deploy an ARC402Wallet (owner = embedded wallet address)
- Sign governance UserOps
- Call setPasskey to register a P256 key

After setPasskey, the embedded wallet EOA transitions to break-glass status — same role as a hardware wallet key in a normal MetaMask flow.

---

## 2. Onboarding Path

```
Email / Google / Apple
  → Privy creates embedded wallet (EOA, MPC-backed)
  → Deploy ARC402Wallet (owner = embedded wallet address)
  → setPasskey(x, y)  — spec 33, Face ID as governance signer
  → Embedded wallet EOA is now break-glass only
  → Agent operational — no seed phrase, no MetaMask, no crypto knowledge required
```

After this sequence the user's operational stack is:

| Key | Role | Auth mechanism |
|-----|------|----------------|
| Embedded wallet EOA | Break-glass / recovery | Privy re-authentication (email/social) |
| Passkey (Face ID) | All governance ops | Biometric, spec 33 |
| Machine key | All autonomous ops | Daemon config, spec 32 |

The user never needs to re-authenticate with email after initial setup.

---

## 3. Provider Selection

### Primary: Privy (`@privy-io/react-auth`)

- Embedded wallets backed by MPC (multi-party computation)
- Supports email, Google, Apple, SMS, and wallet-connect
- Best developer experience and mobile UX
- React SDK with built-in modal UI
- App ID configured per operator deployment

### Secondary: Dynamic (`dynamic.xyz`)

- Enterprise-focused, supports more auth methods
- Heavier SDK, more configuration surface
- Use for deployments requiring SAML, SSO, or enterprise IdP

### Fallback: Turnkey (`turnkey.com`)

- Most technical, API-first
- Best for agents deploying other agents programmatically
- No built-in login UI — requires custom integration

**Why Privy first:** most early ARC-402 operators are developers and technical early adopters. Privy has the cleanest embedded wallet UX for mobile and the simplest React integration. The onboarding app (spec 35) is Next.js — `@privy-io/react-auth` is a natural fit.

---

## 4. Integration Point

The integration is **entirely in the onboarding app** (`/onboard`, spec 35). No other component changes.

### Detection Logic in `/onboard`

```
window.ethereum present?
  Yes → standard MetaMask/injected wallet flow (existing)
  No  → offer Privy embedded wallet (email / Google / Apple)

Privy wallet already exists for this user?
  Yes → resume from existing embedded wallet address
  No  → create new embedded wallet
```

### Flow Divergence

Both paths converge at the same point: a usable EOA address. After that, the deploy and setPasskey steps are identical:

```
// MetaMask path
const provider = new BrowserProvider(window.ethereum)
const signer = await provider.getSigner()

// Privy path
const { wallets } = useWallets()  // @privy-io/react-auth
const embeddedWallet = wallets.find(w => w.walletClientType === 'privy')
const provider = await embeddedWallet.getEthereumProvider()
const ethersProvider = new BrowserProvider(provider)
const signer = await ethersProvider.getSigner()

// Both paths: same from here
const factory = new ARC402Factory(FACTORY_ADDRESS, signer)
await factory.createWallet(signer.address)
```

---

## 5. Privy SDK Integration

### Install

```bash
npm install @privy-io/react-auth
```

### Provider Setup (`app/layout.tsx` or `_app.tsx`)

```tsx
import { PrivyProvider } from '@privy-io/react-auth'

export default function RootLayout({ children }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID}
      config={{
        loginMethods: ['email', 'google', 'apple'],
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
          noPromptOnSignature: false,
        },
        appearance: {
          theme: 'dark',
          accentColor: '#4F46E5',
        },
      }}
    >
      {children}
    </PrivyProvider>
  )
}
```

### Login Trigger in Onboarding Step 1

```tsx
import { usePrivy, useWallets } from '@privy-io/react-auth'

function OnboardStep1() {
  const { login, authenticated, user } = usePrivy()
  const { wallets } = useWallets()

  const embeddedWallet = wallets.find(
    w => w.walletClientType === 'privy'
  )

  if (!authenticated) {
    return <button onClick={login}>Sign in with Email / Google / Apple</button>
  }

  if (!embeddedWallet) {
    return <Spinner label="Creating embedded wallet..." />
  }

  return <DeployWalletButton signer={embeddedWallet} />
}
```

### Environment Variables

```
NEXT_PUBLIC_PRIVY_APP_ID=<app_id from privy.io dashboard>
```

---

## 6. Security Model

MPC wallets have a fundamentally different trust model from self-custodied keys. This must be communicated to users during onboarding.

### What Privy holds

Privy holds one key share in their MPC scheme. The user's device holds another. Neither party alone can sign. Privy cannot unilaterally move funds.

However:

- **If Privy is compromised:** an attacker with both Privy's share and the user's device can sign
- **If Privy goes down or shuts down:** key recovery depends on Privy's export/recovery mechanism
- **If the user loses their device and email access:** recovery depends on Privy's account recovery flow

### Risk tiers

| Use case | Embedded wallet acceptable? |
|----------|----------------------------|
| Development, testing, low-value agents | Yes — Privy MPC is acceptable |
| Production agents, moderate economic activity | Yes, after passkey is set (spec 33) |
| High-value production agents | Recommend MetaMask or hardware wallet for owner key |
| Institutional / custodial | Use Turnkey with dedicated key management |

### Passkey as risk mitigant

Once `setPasskey(x, y)` is called (spec 33), the passkey becomes the governance signer. The embedded wallet EOA is demoted to break-glass status. Even if Privy's key share is compromised:

- Governance ops require the passkey (Face ID) — physically bound to user's device
- Autonomous ops use the machine key — not related to Privy
- The embedded wallet EOA can no longer perform governance ops unilaterally

### Gas sponsorship for embedded wallet users

Users arriving via the email/social path have zero ETH at the point of onboarding. Spec 37 covers this: the initial setup sequence (wallet deploy, `setPasskey`, `AgentRegistry.register`) is sponsored via the Coinbase Base paymaster so no ETH is required to get started. Sponsorship is applied only to these first-time setup UserOps; all subsequent operations are paid from the wallet's own ETH. If the paymaster is unavailable, the onboarding app falls back to a funding prompt with a Coinbase on-ramp link.

### Key export recommendation

For production agents handling significant economic activity: Privy supports private key export. Operators should export the private key, store it in a hardware wallet or secrets manager, and revoke Privy's role once the passkey is operational. This is documented in the onboarding app UI (step 4, post-setup).

---

## 7. Build Sequence

1. **Add Privy SDK** to web app: `npm install @privy-io/react-auth`
2. **Wrap app in `PrivyProvider`** with `loginMethods: ['email', 'google', 'apple']` and `createOnLogin: 'users-without-wallets'`
3. **Add detection logic** in `/onboard` Step 1: `window.ethereum` present → MetaMask flow; absent → Privy flow
4. **Privy login UI** renders when no injected wallet found — Privy's modal handles email/social auth and embedded wallet creation
5. **After wallet creation**: extract embedded wallet address, proceed with same ARC402Wallet deploy flow as MetaMask path
6. **setPasskey**: same as spec 33 flow — no changes needed

---

## 8. UX Copy

The onboarding app should not use the phrase "embedded wallet" or "MPC" in user-facing text. Suggested framing:

- "No crypto wallet? No problem. Sign in with your email."
- "We'll create a secure wallet for you — no seed phrase needed."
- "Your wallet is protected by Face ID and your email. You can export your key anytime."

After passkey setup:
- "Face ID is now your primary key. Your email login is a backup."

---

## 9. Open Questions

- **Privy App ID ownership**: Should ARC-402 operate an official Privy app, or should each operator register their own? Initial answer: one official app for `app.arc402.xyz`; operators self-hosting use their own.
- **Machine key / daemon interaction**: No change needed. The daemon's machine key is separate from the owner key. Privy wallets are transparent at the protocol level.
- **Auto-detection for SDK/CLI**: Post-launch. Could add `arc402 wallet import-privy` command to export embedded key to local keystore.
- **Apple Sign In domain verification**: Privy requires domain verification for Apple login — ensure `app.arc402.xyz` is registered.

---

## 10. What Does Not Change

| Component | Changed? |
|-----------|----------|
| ARC402Wallet contract | No |
| ARC402Factory contract | No |
| SDK (`arc402` npm package) | No |
| CLI (`arc402` binary) | No |
| Daemon (`arc402d`) | No |
| Spec 33 passkey flow | No |
| Protocol-level identity | No |

The onboarding app (`/onboard`, spec 35) is the only integration surface.
