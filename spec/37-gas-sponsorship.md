# Spec 37 — Gas Sponsorship via Coinbase Base Paymaster
*Status: Spec | Date: 2026-03-17*

---

## Summary

Zero-ETH onboarding for new users. Gas for the initial ARC-402 wallet setup sequence is sponsored by the Coinbase Base paymaster, eliminating the requirement to fund a wallet before it can be deployed.

---

## 1. Why This Exists

New users arriving via email or social login (Spec 36) have an embedded wallet EOA with zero ETH. Deploying ARC402Wallet costs roughly 300k gas (~$0.01 on Base). Without sponsorship the onboarding flow (Spec 35) fails at Step 1 before the wallet even exists.

This spec wires up ERC-4337 paymaster sponsorship for the initial setup UserOps so the user's first experience is seamless: sign in → Face ID → done. No funding step, no on-ramp, no crypto knowledge required.

---

## 2. The Solution — Coinbase Base Paymaster

Coinbase operates a free paymaster on Base mainnet:

```
https://paymaster.base.org
```

Properties:
- Free for Base mainnet transactions
- No API key required for basic use (rate-limited per IP)
- Registered API key available (free tier) for production use — removes rate limit
- Supports ERC-4337 v0.7 EntryPoint (`0x0000000071727De22E5E9d8BAf0edAc6f37da032`)

> **Note:** Verify the paymaster contract address from `docs.base.org/docs/paymaster` before deployment. The canonical Base paymaster address is published there and subject to change.

---

## 3. How It Works

Standard ERC-4337 paymaster sponsorship flow:

```
1. Build UserOp for WalletFactory.createWallet(entryPoint)
   (same structure as current buildUserOp in cli/src/bundler.ts)

2. Call paymaster API:
   POST https://paymaster.base.org
   {
     "method": "pm_sponsorUserOperation",
     "params": [userOp, entryPointAddress]
   }

3. Paymaster response adds to UserOp:
   - paymaster          (paymaster contract address)
   - paymasterData      (authorization from paymaster)
   - paymasterVerificationGasLimit
   - paymasterPostOpGasLimit

4. Sign the updated UserOp (owner key or machine key)

5. Submit to bundler → EntryPoint executes:
   - Verifies paymaster signature
   - Deploys wallet
   - Coinbase pays the gas
```

The `UserOperation` type in `cli/src/bundler.ts` already includes the optional paymaster fields (`paymaster`, `paymasterData`, `paymasterVerificationGasLimit`, `paymasterPostOpGasLimit`) — no type changes required.

---

## 4. Which Ops to Sponsor

Only the initial setup sequence requires sponsorship. After the wallet is deployed it accumulates ETH from normal agent income and pays its own gas.

| Operation | Sponsor? | Reason |
|-----------|----------|--------|
| `WalletFactory.createWallet()` | Yes | Wallet does not exist yet; cannot self-fund |
| `ARC402Wallet.setPasskey(x, y)` | Yes | Day-1, wallet may have no ETH; face ID registration is setup, not ongoing operation |
| `AgentRegistry.register()` | Yes | First registration is part of onboarding, wallet freshly deployed |
| All subsequent operations | No | Wallet self-funds from agent income |

Do not sponsor ongoing protocol operations (policy updates, agent calls, governance ops). Those come from the wallet's own ETH.

---

## 5. Integration Points

### A. Web App — `/onboard` (OnboardContent.tsx)

Wrap the deploy UserOp in a paymaster call before submitting to the bundler:

```typescript
// Before: submit userOp directly
const hash = await bundler.sendUserOperation(userOp)

// After: sponsor first, then submit
const sponsored = await paymasterClient.sponsorUserOperation(userOp, ENTRY_POINT)
const hash = await bundler.sendUserOperation(sponsored)
```

The same pattern applies to the setPasskey and AgentRegistry.register UserOps during onboarding.

### B. CLI — `arc402 wallet deploy --sponsored`

Add an optional `--sponsored` flag. When set, the CLI invokes `PaymasterClient.sponsorUserOperation` using the `paymaster_url` from `daemon.toml` before sending.

```
arc402 wallet deploy --sponsored
arc402 wallet set-passkey <x> <y> --sponsored
```

---

## 6. Fallback

If the paymaster is unavailable (rate-limited, network error, or policy rejection):

```
1. Log: "Paymaster unavailable: <reason>"

2. Show funding prompt in the web app:
   "Add $0.05 of ETH to your wallet to continue"
   - Display wallet address (QR code)
   - Coinbase on-ramp link: https://pay.coinbase.com/?address=<walletAddr>
   - "Continue" button — polls eth_getBalance until > 0.001 ETH
   - Proceeds with unsponsored UserOp once funded

3. In CLI: print funding instructions and exit with a non-zero code
   (user can re-run without --sponsored after funding)
```

The fallback must be a graceful degradation, not a crash. Users who are crypto-native and already have ETH should never see it.

---

## 7. Configuration

`daemon.toml`:

```toml
[bundler]
url             = 'https://api.pimlico.io/v2/base/rpc'
paymaster_url   = 'https://paymaster.base.org'        # empty string = no sponsorship
paymaster_policy_id = 'env:PAYMASTER_POLICY_ID'       # optional; from Coinbase developer dashboard
```

Web app environment variables:

```
NEXT_PUBLIC_PAYMASTER_URL=https://paymaster.base.org
NEXT_PUBLIC_PAYMASTER_POLICY_ID=          # empty for rate-limited free tier; set for registered apps
```

If `paymaster_url` / `NEXT_PUBLIC_PAYMASTER_URL` is empty, sponsorship is skipped and the fallback funding flow is shown.

---

## 8. Security Notes

- The Coinbase paymaster has its own rate limiting and abuse detection. ARC-402 does not need to implement additional spam prevention on top of it.
- Sponsorship is scoped to the initial setup ops only. The paymaster cannot access or move wallet funds; it only agrees to pay the miner/sequencer for a specific UserOp.
- Paymaster-signed UserOps expire. The paymaster response includes a validity window. UserOps must be submitted within that window (typically ~60 seconds). The `PaymasterClient` should submit immediately after sponsoring.
- Do not cache or re-use paymaster responses across different UserOps.

---

## 9. Build Sequence

### Step 1 — Add `PaymasterClient` to `cli/src/bundler.ts`

```typescript
export class PaymasterClient {
  private paymasterUrl: string
  private policyId?: string

  constructor(paymasterUrl: string, policyId?: string) {
    this.paymasterUrl = paymasterUrl
    this.policyId = policyId
  }

  private async rpc(method: string, params: unknown[]): Promise<unknown> {
    const response = await fetch(this.paymasterUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    if (!response.ok) {
      throw new Error(`Paymaster HTTP ${response.status}: ${response.statusText}`)
    }
    const json = (await response.json()) as { result?: unknown; error?: { code: number; message: string } }
    if (json.error) {
      throw new Error(`Paymaster RPC error [${json.error.code}]: ${json.error.message}`)
    }
    return json.result
  }

  async sponsorUserOperation(
    userOp: UserOperation,
    entryPoint: string
  ): Promise<UserOperation> {
    const context = this.policyId ? { policyId: this.policyId } : {}
    const result = await this.rpc('pm_sponsorUserOperation', [userOp, entryPoint, context]) as {
      paymaster: string
      paymasterData: string
      paymasterVerificationGasLimit: string
      paymasterPostOpGasLimit: string
      callGasLimit?: string
      verificationGasLimit?: string
      preVerificationGas?: string
    }
    return {
      ...userOp,
      paymaster: result.paymaster,
      paymasterData: result.paymasterData,
      paymasterVerificationGasLimit: result.paymasterVerificationGasLimit,
      paymasterPostOpGasLimit: result.paymasterPostOpGasLimit,
      // Paymaster may override gas limits — use them if provided
      ...(result.callGasLimit && { callGasLimit: result.callGasLimit }),
      ...(result.verificationGasLimit && { verificationGasLimit: result.verificationGasLimit }),
      ...(result.preVerificationGas && { preVerificationGas: result.preVerificationGas }),
    }
  }
}
```

### Step 2 — Update `buildUserOp` to accept optional paymaster URL

```typescript
export async function buildUserOp(
  callData: string,
  sender: string,
  nonce: bigint,
  config: Arc402Config,
  paymasterUrl?: string      // new optional param
): Promise<UserOperation> {
  // ... existing gas estimation logic ...

  const userOp = { sender, nonce: ethers.toBeHex(nonce), callData, ... }

  if (paymasterUrl) {
    const pm = new PaymasterClient(paymasterUrl, config.bundler?.paymasterPolicyId)
    return pm.sponsorUserOperation(userOp, config.entryPoint ?? DEFAULT_ENTRY_POINT)
  }

  return userOp
}
```

### Step 3 — Update `web/app/onboard/OnboardContent.tsx`

In the deploy step handler, check for `NEXT_PUBLIC_PAYMASTER_URL` and apply sponsorship before submitting. On paymaster failure, catch the error and fall through to the funding UI.

### Step 4 — Add `--sponsored` flag to `arc402 wallet deploy` CLI command

Pass `config.bundler.paymasterUrl` to `buildUserOp` when `--sponsored` is set.

---

## 10. Relation to Other Specs

| Spec | Relation |
|------|----------|
| Spec 33 (Passkey P256) | `setPasskey` is a sponsored op on day 1 |
| Spec 35 (Onboarding App) | Primary integration point — Step 1 deploy UserOp gets wrapped in sponsorship |
| Spec 36 (Embedded Wallet Auth) | Primary beneficiary — email/social users have zero ETH; sponsorship unblocks the whole path |

---

## 11. Open Questions

1. **Registered policy ID**: Does ARC-402 operate a single Coinbase developer account with a policy ID, or do self-hosting operators register their own? Initial answer: one official policy for `app.arc402.xyz`; operators self-hosting configure their own.
2. **AgentRegistry.register via executeContractCall**: The registration in Step 4 of onboarding goes through `ARC402Wallet.executeContractCall`, which means the wallet must already be deployed (it is). Sponsoring this op requires the wallet address to be the sender — confirm bundler supports this after factory deployment in the same session.
3. **Gas limit overrides from paymaster**: Some paymasters return revised gas estimates. The `sponsorUserOperation` implementation above merges them in — verify Coinbase paymaster response shape matches this before shipping.

---

*Spec 37 — Gas Sponsorship via Coinbase Base Paymaster*
*Written: 2026-03-17*
