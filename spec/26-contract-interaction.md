# ARC-402 Spec — 26: Direct Contract Interaction

**Status:** DRAFT
**Version:** 1.0.0
**Created:** 2026-03-13

---

## Abstract

ARC402Wallet is a smart contract. It can call any other smart contract on Base. Combined with PolicyEngine's DeFi access tier, this enables agents to interact directly with DEXes, lending protocols, NFT markets, and any other on-chain primitive — without API keys, without intermediaries, governed by the wallet's policy rules.

This spec defines the contract interaction pattern, the PolicyEngine governance layer, and the security constraints that make direct DeFi access safe.

---

## Core Principle

The ARC402Wallet's `executeContractCall()` is the generalised on-chain interaction surface. It wraps any contract call with:

1. PolicyEngine validation (is this contract allowed? is the value within limits?)
2. Per-transaction ERC-20 approvals (never infinite approvals)
3. Slippage enforcement (revert if return value is below minimum)
4. Reentrancy protection

The wallet becomes an on-chain agent capable of participating in any DeFi protocol, governed by its owner's policy rules.

---

## DeFi Access Tier

Direct contract interaction is a **separate, opt-in permission tier**. It is NOT enabled by default.

A wallet with DeFi access disabled cannot call `executeContractCall()` at all. The PolicyEngine gate enforces this before any external call executes.

### Enabling DeFi Access

```bash
# Enable DeFi access on your wallet
arc402 policy defi enable

# Whitelist the Uniswap V3 router
arc402 policy defi whitelist 0xE592427A0AEce92De3Edee1F18E0157C05861564

# Set maximum per-call value
arc402 policy defi max-call-value 500 USDC

# View current DeFi configuration
arc402 policy defi status
```

### What the PolicyEngine Checks

For every `executeContractCall()`:

1. `defiAccessEnabled[wallet]` — is DeFi access turned on?
2. `_whitelistedContracts[wallet].contains(target)` — is this specific contract approved?
3. `value <= maxContractCallValue[wallet]` — is the call value within the limit?

All three must pass. Any failure reverts before the external call executes.

---

## Calling a DEX (Uniswap Example)

```typescript
// Agent wants to swap 0.1 ETH for at least 180 USDC
const swapCalldata = uniswapV3Interface.encodeFunctionData('exactInputSingle', [{
  tokenIn: WETH,
  tokenOut: USDC,
  fee: 3000,
  recipient: walletAddress,
  deadline: Math.floor(Date.now() / 1000) + 300,
  amountIn: ethers.parseEther('0.1'),
  amountOutMinimum: 180_000000, // 180 USDC, 6 decimals
  sqrtPriceLimitX96: 0,
}]);

await client.executeContractCall({
  target: UNISWAP_V3_ROUTER,
  data: swapCalldata,
  value: ethers.parseEther('0.1'),
  minReturnValue: 180_000000, // slippage guard
  maxApprovalAmount: 0,       // ETH path, no ERC-20 approval needed
  approvalToken: ethers.ZeroAddress,
});
```

The wallet: validates PolicyEngine, executes the swap, checks the returned USDC amount is ≥ 180, reverts if not.

### ERC-20 Swap (USDC → DAI)

```typescript
const swapCalldata = /* encode USDC → DAI swap */;

await client.executeContractCall({
  target: UNISWAP_V3_ROUTER,
  data: swapCalldata,
  value: 0,
  minReturnValue: 99_000000000000000000n, // min 99 DAI
  maxApprovalAmount: 100_000000,           // approve exactly 100 USDC for this tx
  approvalToken: USDC_ADDRESS,             // approve USDC to router
});
```

The wallet approves 100 USDC to the router, executes the swap, then immediately resets approval to 0. No infinite approvals. The router can never pull more than what was approved for this specific transaction.

---

## Per-Transaction Approvals (Never Infinite)

This is a hard security constraint in the protocol. A common vulnerability in DeFi is granting `type(uint256).max` approval to a contract — if that contract is later exploited, the attacker can drain everything.

ARC402Wallet enforces:
1. Approve exactly `maxApprovalAmount` before the call
2. Execute the call
3. Reset approval to 0 after the call

This means the approved contract can never pull more than what was explicitly authorised for that one transaction. Even if Uniswap's router is exploited tomorrow, your wallet's USDC is safe — there's no standing approval to drain.

---

## MEV Protection

Direct DeFi calls from agents are vulnerable to sandwich attacks. Two mitigation layers:

**Layer 1 — MEV-protected RPC (CLI default for DeFi calls)**

The CLI routes DeFi transactions through MEV Blocker by default:

```bash
# Default for executeContractCall:
arc402 config set defi-rpc https://rpc.mevblocker.io

# Alternative: Flashbots Protect
arc402 config set defi-rpc https://rpc.flashbots.net
```

Transactions sent to MEV Blocker never appear in the public mempool. Sandwich attacks require visibility — without it, they can't target your transaction.

**Layer 2 — Slippage enforcement**

The `minReturnValue` parameter in `executeContractCall()` is a hard on-chain slippage guard. If a sandwich attack succeeds and the return is below minimum, the transaction reverts. The attacker burns gas, the agent loses nothing.

MEV risk at the protocol level is documented in THREAT-MODEL.md: MEV is the agent's operational risk, not the protocol's security risk. The contract provides the tools; the agent chooses to use them.

---

## NFT Governance

ARC402Wallet implements ERC-721 and ERC-1155 receiver interfaces. Wallets can receive NFTs.

PolicyEngine governs which NFT contracts a wallet can receive from and send to:

```bash
# Allow receiving from a specific NFT collection
arc402 policy nft allow 0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D  # BAYC

# Remove an allowed NFT contract
arc402 policy nft disallow <contract>

# List allowed NFT contracts
arc402 policy nft list
```

**Use cases:**
- Agent earns an NFT credential for completing a milestone
- Deliverable IS an NFT — agent mints directly to client
- Agent participates in NFT marketplace as a buyer/seller
- Soulbound identity NFT (see Spec 27)

---

## Contract Interaction Patterns

### Pattern 1: DEX Swap
Target: Uniswap / Curve / Balancer router
Use: Agent swaps tokens for operational treasury management or as part of a settlement

### Pattern 2: Lending Protocol
Target: Aave / Compound pool
Use: Agent deposits idle balance, earns yield between agreements

### Pattern 3: NFT Marketplace
Target: OpenSea Seaport / Blur
Use: Agent buys/sells NFTs as part of its service offering

### Pattern 4: Custom Protocol
Target: Any whitelisted contract
Use: Agent interacts with domain-specific protocols (RWA platforms, insurance protocols, etc.)

### What Stays Out of Scope
- Flash loans (flash loan resistance is enforced on TrustRegistry and ReputationOracle)
- Cross-chain bridge calls (v2 extension, requires additional safety checks)
- Arbitrary `delegatecall` (explicitly blocked — would allow target to control wallet storage)

---

## AgreementTree and DeFi

An AgreementTree where the root deliverable is an on-chain asset becomes possible. Example:

1. Client hires orchestrator to "acquire and deliver 100 USDC of staked ETH yield"
2. Orchestrator opens sub-agreements: one with a swap agent (ETH → stETH), one with a yield tracking agent
3. Swap agent executes via `executeContractCall()` to Curve
4. Yield tracking agent monitors via The Graph
5. Orchestrator assembles and delivers the root agreement

All three levels have escrow, trust scores, and delivery hashes. The on-chain execution is atomic at each step.

---

## Audit Surface

The `executeContractCall()` function is the highest-risk surface in ARC402Wallet. Auditors should verify:

1. PolicyEngine validation cannot be bypassed
2. Reentrancy guard prevents re-entering via the external contract
3. Approval reset is unconditional (happens even if call reverts via try/catch)
4. No delegatecall path exists
5. Flash loan resistance means a single block cannot manipulate TrustRegistry + execute DeFi operations
6. slippage check decodes return correctly for the specific ABI (or is documented as caller's responsibility)
