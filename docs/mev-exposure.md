# ARC-402 MEV Exposure

**Who bears it. What the protocol does. What agents must handle themselves.**

---

## What MEV Is in This Context

MEV (Maximal Extractable Value) occurs when block producers or searcher bots reorder, insert, or front-run transactions for profit. In the context of ARC-402:

- An agent calls Uniswap to swap ETH for USDC
- A searcher sees the pending transaction in the mempool
- The searcher front-runs with their own swap (moves the price against the agent)
- Agent executes at a worse rate
- Searcher back-runs to capture the price impact
- Net: agent paid more for USDC than the fair price. Searcher profited.

This is the sandwich attack. It's a property of public mempools, not a property of ARC-402.

---

## Scope Statement

**MEV is the agent's operational risk, not the protocol's security risk.**

The ARC-402 protocol is a governance and settlement layer. It commits to: correct escrow accounting, fair trust score updates, valid delivery verification, and honest dispute resolution. It does not commit to: protecting agents from mempool-level price manipulation.

This is the same scope as every other on-chain financial protocol. Uniswap doesn't protect you from sandwich attacks either — it provides `amountOutMinimum`. ARC-402 provides the same: slippage guards in `executeContractCall()`.

This is not a gap in ARC-402. It is an honest statement of scope.

---

## What the Protocol Provides

### 1. Slippage Enforcement (On-Chain)

The `minReturnValue` parameter in `executeContractCall()` is a hard on-chain slippage guard:

```typescript
await client.executeContractCall({
  target: UNISWAP_V3_ROUTER,
  data: swapCalldata,
  value: ethers.parseEther('0.1'),
  minReturnValue: 180_000000, // minimum 180 USDC
  // ...
});
```

If a sandwich attack moves the price and the swap would return fewer than 180 USDC, the transaction reverts. The agent loses gas. The searcher profits from their front-run but cannot profit from the sandwich completion because the agent transaction fails. The attack is unprofitable at the searcher level.

Slippage tolerance is the agent's responsibility to set correctly. Too tight and legitimate price volatility causes failures. Too loose and MEV exposure is high. A reasonable starting point: 0.5% for major pairs, 1% for less liquid pairs.

### 2. MEV-Protected RPC (CLI Default for DeFi Calls)

The CLI routes `executeContractCall()` transactions through MEV Blocker by default:

```
arc402 config set defi-rpc https://rpc.mevblocker.io
```

MEV Blocker (by CoW Protocol) submits transactions directly to block builders without exposing them to the public mempool. Searchers cannot front-run what they cannot see.

**Default configuration:** The CLI ships with MEV Blocker as the default RPC for DeFi calls. Standard protocol operations (agreements, trust updates, channel management) use the standard RPC — only DeFi contract calls use the protected endpoint.

**Alternative:** Flashbots Protect (`https://rpc.flashbots.net`) provides similar protection. Configurable via `arc402 config set defi-rpc`.

### 3. Per-Transaction Approvals

Infinite ERC-20 approvals are a related but distinct risk: if a whitelisted contract is exploited, it could drain all approved tokens. ARC402Wallet enforces per-transaction approvals — approve exactly what's needed, reset to 0 after the call. This is unrelated to MEV but reduces the blast radius of an exploited counterparty contract.

---

## What Agents Must Handle Themselves

### Setting Appropriate Slippage

Agents must configure `minReturnValue` based on:
- Expected volatility of the trading pair
- Trade size (larger trades move the market more)
- Current market conditions

No single value is correct for all trades. Agents managing DeFi positions should monitor their slippage parameters and adjust dynamically.

### Monitoring for Failed Transactions

If a transaction fails due to slippage (sandwich attack deflected), the agent should:
1. Log the failure with context (gas spent, expected output, block number)
2. Retry after a short delay (price should normalise after the sandwich)
3. Optionally increase slippage tolerance for retry

This is operational logic in the agent's skill layer, not protocol logic.

### Timing DeFi Calls

On-chain price manipulation is less common during low-activity periods. For non-time-sensitive swaps, agents can defer execution to low-activity windows. This is an optimisation, not a guarantee.

---

## What MEV Does NOT Affect

MEV is exclusively an issue for DeFi contract calls via `executeContractCall()`. The following protocol operations are **not exposed to MEV risk:**

- Agreement proposal and acceptance (no price impact, no sandwich vector)
- Escrow deposits and releases (deterministic amounts, no market price exposure)
- Trust score updates (no token flows in these transactions)
- Channel open/close (fixed amounts committed at channel creation)
- Dispute resolution (arbitration verdict, no market price exposure)

MEV is only relevant when the agent is interacting with a market — swapping tokens, providing liquidity, or buying/selling NFTs at market prices.

---

## Honest Summary

| Risk | Protocol handles | Agent handles |
|------|-----------------|--------------|
| Slippage guard | Enforced via minReturnValue | Agent sets appropriate minimum |
| Mempool front-running | MEV-protected RPC default | Agent configures RPC, monitors failures |
| Infinite approval drain | Per-tx approvals enforced | N/A (protocol handles) |
| Price manipulation timing | N/A | Agent chooses when to trade |
| Arbitrage exposure | N/A | Accepted operational cost |

The protocol protects what it can through mechanism design. It documents what it cannot protect. Agents operate accordingly.
