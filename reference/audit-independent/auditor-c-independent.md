# Auditor C — Independent Cold Review

Read in full:
- ARC402Wallet.sol
- ARC402Registry.sol
- PolicyEngine.sol
- TrustRegistry.sol
- IntentAttestation.sol
- SettlementCoordinator.sol
- WalletFactory.sol
- X402Interceptor.sol
- AgentRegistry.sol
- ServiceAgreement.sol

A few functions looked comparatively clean on first pass: `ServiceAgreement.propose/accept/cancel/expiredCancel/resolveDispute` follow a clear state machine and use `nonReentrant`; `AgentRegistry` has sensible input-length caps and explicit active/inactive handling; `ARC402Registry` is simple and internally consistent. My concerns are mostly around cross-contract wiring and authorization assumptions.

## Finding C-1: WalletFactory deploys wallets owned by the factory, not by the user
**Severity:** CRITICAL
**Contract:** WalletFactory.sol / ARC402Wallet.sol
**Location:** `WalletFactory.createWallet()` (~line 26) and `ARC402Wallet.constructor()` (~line 80)

**Observation:**
`WalletFactory` deploys the wallet directly:

```solidity
function createWallet() external returns (address) {
    ARC402Wallet wallet = new ARC402Wallet(registry);
```

But `ARC402Wallet` hard-codes the deployer as owner:

```solidity
constructor(address _registry) {
    owner = msg.sender;
    registry = ARC402Registry(_registry);
    _trustRegistry().initWallet(address(this));
}
```

**Concern:**
When `createWallet()` is used, `msg.sender` inside the wallet constructor is the factory, not the end user. That means the factory becomes the immutable `owner` of every wallet it deploys. The user is only recorded in `ownerWallets[msg.sender]`, which is bookkeeping and does not grant control.

This is catastrophic for the trust model: the advertised owner cannot open contexts, spend, freeze/unfreeze, update registry, or update policy ID. If the factory has no forwarding/admin functions, the wallet becomes effectively unusable; if such functions are ever added, the factory becomes a superuser over all wallets.

**Confidence:** HIGH
The ownership assignment is explicit and deterministic.

## Finding C-2: TrustRegistry authorization makes wallet trust updates revert in normal flows
**Severity:** HIGH
**Contract:** ARC402Wallet.sol / TrustRegistry.sol
**Location:** `ARC402Wallet.closeContext()` (~line 141), `executeSpend()` reject path (~line 174), `executeTokenSpend()` reject path (~line 229); `TrustRegistry.onlyUpdater` / `recordSuccess` / `recordAnomaly` (~lines 34, 72, 83)

**Observation:**
The wallet directly calls TrustRegistry update functions:

```solidity
_trustRegistry().recordSuccess(address(this));
```

and

```solidity
_trustRegistry().recordAnomaly(address(this));
```

But the registry restricts those functions:

```solidity
modifier onlyUpdater() {
    require(isAuthorizedUpdater[msg.sender], "TrustRegistry: not authorized updater");
    _;
}

function recordSuccess(address wallet) external onlyUpdater { ... }
function recordAnomaly(address wallet) external onlyUpdater { ... }
```

The constructor only authorizes the deployer of `TrustRegistry`:

```solidity
constructor() Ownable(msg.sender) {
    isAuthorizedUpdater[msg.sender] = true;
}
```

**Concern:**
Nothing in wallet deployment or factory deployment authorizes each wallet as an updater. As written, a normal wallet calling `closeContext()` will revert. Even worse, the policy-rejection branches in `executeSpend()` / `executeTokenSpend()` attempt to record an anomaly before reverting, so the revert reason will likely become `TrustRegistry: not authorized updater` instead of the actual policy failure.

This is a cross-contract integration bug that can break basic lifecycle operations and distort off-chain monitoring.

**Confidence:** HIGH
The wallet calls are direct external calls and the authorization path is missing.

## Finding C-3: Intent attestations are not bound to the spend details and can be replayed
**Severity:** HIGH
**Contract:** IntentAttestation.sol / ARC402Wallet.sol
**Location:** `IntentAttestation.verify()` (~line 58); `ARC402Wallet.executeSpend()` (~line 160); `executeTokenSpend()` (~line 222); `proposeMASSettlement()` (~line 265)

**Observation:**
The attestation stores detailed fields:

```solidity
struct Attestation {
    bytes32 attestationId;
    address wallet;
    string action;
    string reason;
    address recipient;
    uint256 amount;
    address token;
    uint256 timestamp;
}
```

But verification checks only existence plus wallet equality:

```solidity
function verify(bytes32 attestationId, address wallet) external view returns (bool) {
    return exists[attestationId] && attestations[attestationId].wallet == wallet;
}
```

The wallet then accepts any verified ID without checking recipient, amount, token, category, or one-time use.

**Concern:**
A single attestation can be reused for multiple spends or for a completely different recipient/amount/token than what was originally attested. The protocol appears to present attestations as the immutable record of "why" a spend occurred, but on-chain enforcement does not actually tie the spend to that record.

That creates an audit-integrity problem and a replay surface: once a wallet has one valid attestation ID, the owner can reuse it for repeated transfers as long as policy checks pass.

**Confidence:** HIGH
The verification logic is very narrow and the caller never compares the stored payload to the requested spend.

## Finding C-4: X402Interceptor cannot call the wallet it is supposed to control
**Severity:** HIGH
**Contract:** X402Interceptor.sol / ARC402Wallet.sol
**Location:** `X402Interceptor.executeX402Payment()` (~line 44); `ARC402Wallet.executeTokenSpend()` (~line 212)

**Observation:**
The interceptor forwards the payment request to the wallet:

```solidity
IARC402Wallet(arc402Wallet).executeTokenSpend(
    usdcToken,
    recipient,
    amount,
    "api_call",
    attestationId
);
```

But the wallet function is restricted:

```solidity
function executeTokenSpend(...) external onlyOwner requireOpenContext notFrozen {
```

and `onlyOwner` is:

```solidity
require(msg.sender == owner, "ARC402: not owner");
```

**Concern:**
In the documented flow, an external actor calls `X402Interceptor`, which then calls the wallet. Inside the wallet, `msg.sender` is the interceptor contract, not the wallet owner, so the call reverts unless the interceptor itself is the wallet owner.

That means the advertised x402 integration path does not work as written. Combined with Finding C-1, factory-created wallets are owned by the factory anyway, making the integration even less plausible.

**Confidence:** HIGH
This is a direct consequence of Solidity call semantics.

## Finding C-5: SettlementCoordinator requires wallet contracts themselves to send transactions
**Severity:** MEDIUM
**Contract:** SettlementCoordinator.sol
**Location:** `accept()` (~line 67), `reject()` (~line 78), `execute()` (~line 89)

**Observation:**
The coordinator stores `fromWallet` and `toWallet`, then authorizes actions with strict `msg.sender` checks:

```solidity
require(msg.sender == p.toWallet, "SettlementCoordinator: not recipient");
```

and

```solidity
require(msg.sender == p.fromWallet, "SettlementCoordinator: not sender");
```

Execution for ERC-20 then does:

```solidity
IERC20(p.token).safeTransferFrom(msg.sender, p.toWallet, p.amount);
```

**Concern:**
If `fromWallet` / `toWallet` are meant to be ARC-402 wallet contracts, those contracts cannot spontaneously originate EOA-style transactions to call `accept`, `reject`, or `execute`. There is no callback or helper in `ARC402Wallet` that would make these coordinator calls on behalf of the wallet, and no signature-based authorization path either.

So the coordinator’s state machine appears mismatched with the rest of the protocol: it is written as though wallet addresses can actively transact, but the provided wallet contract cannot do that.

**Confidence:** MEDIUM
If the design intended EOAs here, this is less severe; but the naming and surrounding architecture strongly imply contract wallets.

## Finding C-6: PolicyEngine ownership/authorization model is both incomplete and trivially spoofable
**Severity:** MEDIUM
**Contract:** PolicyEngine.sol
**Location:** `registerWallet()` (~line 26), `setPolicy()` (~line 30), `setCategoryLimitFor()` (~line 49), `validateSpend()` (~line 56)

**Observation:**
Wallet ownership registration is completely unrestricted:

```solidity
function registerWallet(address wallet, address owner) external {
    walletOwners[wallet] = owner;
}
```

And `setCategoryLimitFor` trusts that mapping:

```solidity
require(walletOwners[wallet] == msg.sender || wallet == msg.sender, "PolicyEngine: not authorized");
categoryLimits[wallet][category] = limitPerTx;
```

At the same time, `setPolicy()` and `setCategoryLimit()` key data to `msg.sender` directly:

```solidity
policies[msg.sender] = PolicyData({ ... });
categoryLimits[msg.sender][category] = limitPerTx;
```

while wallet validation always reads by wallet address:

```solidity
uint256 limit = categoryLimits[wallet][category];
```

**Concern:**
Two separate problems show up:

1. Anyone can front-run or overwrite `walletOwners[wallet]` for any wallet and then call `setCategoryLimitFor()`.
2. Even without an attacker, the integration is incomplete: neither `ARC402Wallet` nor `WalletFactory` registers the wallet owner with `PolicyEngine`, and the wallet has no function that forwards `setPolicy()` / `setCategoryLimit()` calls on behalf of the owner.

So policy administration looks both under-protected and functionally unfinished. In the best case, wallets become impossible to configure correctly. In the worst case, a third party can assign themselves as owner of someone else’s wallet in `PolicyEngine` and manipulate its limits.

**Confidence:** HIGH
The unrestricted setter and the missing registration path are both explicit in code.

## Finding C-7: Velocity-limit breach silently blocks the transfer while still consuming state and emitting a freeze from the wrong actor
**Severity:** LOW
**Contract:** ARC402Wallet.sol
**Location:** `executeSpend()` (~lines 181-194) and `executeTokenSpend()` (~lines 235-247)

**Observation:**
On velocity breach the wallet increments the window first, freezes itself, emits an event, and returns without reverting:

```solidity
spendingInWindow += amount;
if (velocityLimit > 0 && spendingInWindow > velocityLimit) {
    frozen = true;
    frozenAt = block.timestamp;
    emit WalletFrozen(address(this), "velocity limit exceeded", block.timestamp);
    return;
}
```

**Concern:**
This is not a direct theft bug, but it feels operationally dangerous:
- the attempted spend does not happen,
- the call does not revert,
- the usage counter still includes the blocked amount,
- and `WalletFrozen` reports `address(this)` as the freezer instead of an operator or policy module.

Off-chain systems may interpret the call as a success unless they inspect both token balances and freeze events. The state mutation before the early return also means a single oversized attempt can poison the spending window and keep the wallet frozen until the owner intervenes.

**Confidence:** MEDIUM
This may be intentional, but it is surprising behavior and easy for integrators to misunderstand.

## Summary
- CRITICAL: 1
- HIGH: 4
- MEDIUM: 2
- LOW: 1
- INFO: 0

## What surprised me most:
1. The wallet factory/wallet constructor combination appears to hand ownership to the factory instead of the user.
2. The attestation system stores rich spend metadata but enforcement only checks `wallet == ...`, which defeats most of that structure.
3. Several cross-contract integrations (`TrustRegistry`, `X402Interceptor`, `SettlementCoordinator`, `PolicyEngine`) look individually reasonable but do not actually fit together in a live flow.

## Top concerns:
1. C-1 — factory-created wallets appear permanently owned by the factory, breaking the core trust model.
2. C-3 — intent attestations are replayable and not bound to the actual spend details.
3. C-2 — trust update authorization likely causes normal wallet operations to revert unexpectedly.
