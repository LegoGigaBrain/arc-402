# ARC-402 Wallet Governance

Your `ARC402Wallet` is a governed smart contract. Every function that changes how the wallet behaves requires your **master key** — the phone wallet you used at deployment. This document covers every governance parameter, what it does, and how to set it.

---

## Quick Setup

Run everything in one command:

```bash
arc402 wallet governance setup
```

This interactive wizard prompts for your velocity limit, guardian key, and per-category spending limits, then sends all transactions in a single WalletConnect session (batched via `wallet_sendCalls` if your wallet supports EIP-5792, otherwise sequentially). One phone approval covers the full setup.

```
Velocity limit (max ETH per rolling window) [0.05]:
Set guardian key? [Y/n]:
Spending categories — press Enter to skip any:
  general limit in ETH [0.02]:
  research limit in ETH [0.05]:
  compute limit in ETH [0.10]:
  Add custom category? [name or Enter to skip]:

Changes to be made:
  Wallet:         0xYourWalletAddress
  Velocity limit: 0.05 ETH per rolling window
  Guardian key:   0x... (new — private key will be saved to config)
  Spending limits:
    general      0.02 ETH
    research     0.05 ETH
    compute      0.10 ETH
  Transactions:   4 total

Confirm and sign with your wallet? [Y/n]:
```

After confirming, verify everything is set:

```bash
arc402 wallet status
arc402 wallet policy show
```

---

## The Governance Model

Three roles operate on your wallet:

| Role | Key | What It Controls |
|------|-----|-----------------|
| **Owner** | Master key (phone wallet) | All policy and governance — spending limits, velocity, registry, interceptor |
| **Guardian** | Dedicated guardian key (machine) | Emergency freeze only — cannot unfreeze, cannot change policy |
| **Agent** | Agent key (machine) | Day-to-day operations within policy — cannot modify any governance |

The master key is the root of trust. It delegates bounded authority downward — the agent key can act, but cannot exceed what the master key has permitted. The guardian key is a break-glass mechanism: fast, limited, one direction.

---

## Governance Contracts

Five contracts govern wallet behaviour:

| Contract | Address | What It Does |
|----------|---------|--------------|
| `PolicyEngine` | `0x0743ab6a7280b416D3b75c7e5457390906312139` | Per-category spending limits |
| `ARC402Wallet` | Your deployed address | Velocity limits, freeze state, active policy, interceptor |
| `ARC402Guardian` | `0xED0A033B79626cdf9570B6c3baC7f699cD0032D8` | Guardian key registry |
| `ARC402RegistryV2` | `0xcc0D8731ccCf6CFfF4e66F6d68cA86330Ea8B622` | Contract address registry (v2 — existing wallets) |
| `ARC402RegistryV3` | `0x6EafeD4FA103D2De04DDee157e35A8e8df91B6A6` | Contract address registry (v3 — new default) |
| `ARC402Governance` | `0xE931DD2EEb9Af9353Dd5E2c1250492A0135E0EC4` | Protocol-level governance (protocol parameters, not your wallet) |

Your wallet reads from `ARC402RegistryV3` (new wallets) or `ARC402RegistryV2` (existing wallets) to find contract addresses. Upgrading your wallet's registry pointer is how you migrate to newer protocol versions.

---

## 1. Spending Limits (PolicyEngine)

Spending limits are per-category caps. Your agent cannot spend above these limits regardless of what any task or prompt instructs.

### View current limits

```bash
arc402 wallet policy show
```

Output:
```
Spending limits for 0xYourWallet:
  research         0.05 ETH/day
  code-review      0.02 ETH/day
  general          0.10 ETH/day
```

### Set a spending limit

```bash
arc402 wallet policy set-limit --category research --amount 0.05eth
```

This requires your **master key** via WalletConnect. Your phone will prompt for approval.

Categories are arbitrary strings — use whatever maps to your agent's work types. Common categories:
- `general` — catch-all limit
- `research` — data and intelligence purchases
- `code` — code review and development services
- `creative` — design, writing, brand work
- `compute` — GPU, inference, processing

**How limits are enforced:** Every `executeContractCall` and escrow operation on your wallet passes through the PolicyEngine. If the cumulative spend in a category would exceed the limit, the transaction reverts. The contract does not ask for confirmation — it refuses.

### Set the active policy ID

```bash
arc402 wallet policy set <policyId>
```

Policy IDs are `bytes32` labels that group rules. This sets which policy ruleset the wallet is currently operating under. If you have multiple operational modes (e.g. `dev-mode` vs `production`), you can switch them here with one master key signature.

---

## 2. Velocity Limit (ARC402Wallet)

The velocity limit caps total ETH outflow per rolling time window. It's a second layer of protection on top of per-category limits — an absolute ceiling on how fast funds can leave.

### View velocity limit

```bash
arc402 wallet status
# Shows velocityLimit in ETH
```

### Set velocity limit

```bash
arc402 wallet set-velocity-limit 0.1
# Sets 0.1 ETH per rolling window
# Requires master key via WalletConnect
```

**When to use this:** Set conservatively. If your agent's heaviest legitimate workload requires 0.05 ETH/hour, set the limit at 0.1 ETH/hour. The extra headroom handles bursts. Anything above that is an attack.

---

## 3. Guardian Key

The guardian key is the emergency brake. It can freeze the wallet instantly — no timelock, no WalletConnect ceremony. It cannot unfreeze. Only the master key can unfreeze.

This separation is intentional: the guardian key can be on a faster, less secure path (a hot key on the same machine) because its power is one-directional and bounded.

### Check guardian status

```bash
arc402 wallet status
# Shows guardianAddress and frozen: true/false
```

### Set or rotate the guardian key

```bash
arc402 wallet set-guardian
# Generates a new guardian keypair
# Saves guardian private key to ~/.arc402/config.json
# Registers new guardian address on-chain via WalletConnect
# Requires master key approval
```

Run this during initial setup and whenever you want to rotate the guardian key.

### Emergency freeze (guardian)

```bash
arc402 wallet freeze
# Signs with guardian key — instant, no WalletConnect required
# Freezes the wallet immediately
```

Use this the moment you suspect your agent key is compromised. Funds stay in the contract. Nothing moves until you unfreeze from your master key.

### Unfreeze (master key only)

```bash
arc402 wallet unfreeze
# Requires master key via WalletConnect
# Shows current frozen state + who froze it + when
```

---

## 4. Authorized Interceptor (X402)

The interceptor is the contract that handles x402 payment requests — when your agent receives a `402 Payment Required` response and the wallet needs to decide whether to pay.

### View current interceptor

```bash
arc402 wallet status
# Shows authorizedInterceptor address
```

### Set interceptor

```bash
arc402 wallet set-interceptor <interceptor-address>
# Requires master key via WalletConnect
```

The `X402Interceptor` contract at `0x47aEbD1d42623e78248f8A44623051bF7B941d8B` is the protocol default. You only need to change this if you're running a custom interceptor or testing a newer version.

---

## 5. Registry Upgrade (2-Day Timelock)

The registry determines which contract addresses your wallet resolves — ServiceAgreement, TrustRegistry, DisputeArbitration, etc. When a new protocol version deploys, you upgrade your wallet's registry pointer to access the new contracts.

This is protected by a 2-day timelock. You cannot execute the upgrade for 48 hours after proposing it. This is the safety window: if you're phished into proposing a malicious registry, you have 2 days to cancel before it executes.

### Check current registry + pending upgrade

```bash
arc402 wallet status
# Shows current registry address
# Shows pendingRegistry and unlockAt timestamp (if upgrade is proposed)
```

### Propose a registry upgrade

```bash
arc402 wallet upgrade-registry <newRegistryAddress>
# Requires master key via WalletConnect
# Starts 2-day timelock immediately
```

For upgrading to ARC402RegistryV3 (recommended for new wallets):
```bash
arc402 wallet upgrade-registry 0x6EafeD4FA103D2De04DDee157e35A8e8df91B6A6
```

For upgrading to ARC402RegistryV2 (if migrating from V1):
```bash
arc402 wallet upgrade-registry 0xcc0D8731ccCf6CFfF4e66F6d68cA86330Ea8B622
```

### Execute after timelock

```bash
arc402 wallet execute-registry-upgrade
# Requires master key via WalletConnect
# Only works after 48 hours have passed
```

### Cancel a pending upgrade

```bash
arc402 wallet cancel-registry-upgrade
# Requires master key via WalletConnect
# Works at any time before execution
```

---

## 6. PolicyEngine Blocklist and Preferred Providers

Beyond spending limits, the PolicyEngine lets you control *who* your agent works with.

### Blocklist — agents your wallet will never accept work from

```bash
# Block an address
arc402 policy blocklist add 0xBadActorAddress

# Remove from blocklist
arc402 policy blocklist remove 0xAddress

# Check if blocked
arc402 policy blocklist check 0xAddress

# List all blocked addresses
arc402 policy blocklist list
```

Blocklist is enforced at the ServiceAgreement level — your agent cannot enter an agreement with a blocked counterparty, regardless of what it's instructed to do.

### Preferred providers — addresses your agent prioritises for a capability

```bash
# Add preferred provider for a capability
arc402 policy preferred add --capability research --address 0xTrustedProvider

# Remove
arc402 policy preferred remove --capability research --address 0xAddress

# List preferred providers for a capability
arc402 policy preferred list --capability research

# Check if address is preferred
arc402 policy preferred check --capability research --address 0xAddress
```

Preferred providers rank higher in discovery results. Combined with the blocklist, this gives you explicit agent-level curation of who your wallet transacts with.

---

## Governance Setup Checklist

For a freshly deployed wallet, run through these in order:

```bash
# 1. Set guardian key
arc402 wallet set-guardian

# 2. Set velocity limit (start conservative)
arc402 wallet set-velocity-limit 0.05

# 3. Set per-category spending limits
arc402 wallet policy set-limit --category general --amount 0.02eth
arc402 wallet policy set-limit --category research --amount 0.05eth
arc402 wallet policy set-limit --category compute --amount 0.10eth

# 4. Verify all governance is set
arc402 wallet status
arc402 wallet policy show

# 5. If upgrading to v3 registry (new default)
arc402 wallet upgrade-registry 0x6EafeD4FA103D2De04DDee157e35A8e8df91B6A6
# (wait 48 hours)
arc402 wallet execute-registry-upgrade
```

---

## What the Governance Cannot Do

The governance model is designed to bound what the agent can do — not to give any party unlimited power.

**The master key cannot:**
- Access funds that are in active escrow (locked in ServiceAgreement)
- Modify a running agreement after hire
- Retroactively change trust scores

**The agent key cannot:**
- Exceed spending limits set by the master key
- Modify its own policy, velocity limit, or interceptor
- Freeze or unfreeze the wallet
- Propose a registry upgrade

**The guardian key cannot:**
- Unfreeze the wallet (only the master key can)
- Change any policy or governance parameter
- Move funds

**The protocol cannot:**
- Change the terms of a live agreement
- Move funds from your wallet without your agent's participation
- Override the 2-day timelock on registry upgrades

---

## Security Posture

**Start with tight limits.** Your agent's normal operating range is probably well below your caps. The limits don't slow your agent down — they limit the blast radius if something goes wrong.

**Keep the guardian key on the same machine as your agent, but separate from the agent key.** It needs to be fast (no phone ceremony). It only needs one power: stop everything.

**Rotate the guardian key if the machine is compromised.** After rotating, check wallet status to confirm the old guardian address is no longer registered.

**Never store your master key private key on the machine running your agent.** The master key lives on your phone. That separation is the security guarantee. Break it and you lose the governance model entirely.

---

*ARC-402 | Wallet Governance*
