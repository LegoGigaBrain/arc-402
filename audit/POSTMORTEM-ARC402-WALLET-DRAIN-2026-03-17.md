# ARC-402 Wallet Drain Incident Post-Mortem — 2026-03-17

**Incident:** ETH drain operation (0.00045 ETH from v4 wallet `0xb4aF8760` to owner) required **4 user taps + 2+ hours debugging** instead of planned **0-1 taps** and ~2 minutes.

**Root Cause:** Six compounding protocol and infrastructure bugs caused context revert loops, ABI mismatches, and missing onboarding steps.

**Impact:** Protocol-level design flaws + CLI/SDK fragility exposed just before mainnet launch.

**Status:** All six bugs identified and fixes designed. Protocol requires patching before production claim.

---

## Executive Summary

The v4 wallet drain incident exposed a **gap between contract design and operational reality:**

- **Contract design** assumes PolicyEngine categories are pre-configured at wallet deploy time
- **Operational reality** was: wallet deployed with zero categories → every spend reverted with "category not configured"
- **Protocol design** allowed attest() to be unnecessarily routed through executeContractCall, adding complexity
- **Infrastructure** (public RPC stale state) created false contextOpen() reads, requiring manual recovery
- **CLI** lacked end-to-end wallet drain command, forcing 3+ manual step encoding
- **ABI validation** was absent, allowing 4-field tuples to be silently accepted in place of 6-field structs

**The incident is fixable.** No fundamental protocol vulnerabilities. The flaws are:
1. Configuration/setup ceremony incomplete
2. Unnecessary architectural layers (attest via executeContractCall)
3. Missing guardrails for partial state (open context without spend)
4. Infrastructure RPC choice (public Base RPC instead of Alchemy)

---

## Root Cause Analysis

### BUG-DRAIN-01: Wrong executeContractCall struct ABI in scripts ⚠️ SILENT FAIL

**Symptom:** Scripts passed 4-field tuple `(target, data, value, category)` to `executeContractCall`, but contract expects 6-field `ContractCallParams` struct.

**Root Cause:** No ABI validation in CLI. TypeScript ethers.js `encodeFunctionData()` accepted the malformed tuple silently.

**Impact:**
- Missing fields `minReturnValue`, `maxApprovalAmount`, `approvalToken` were not checked
- Calldata encoded incorrectly — first 4 fields aligned wrong
- Contract received garbage for `minReturnValue` and `maxApprovalAmount`, causing silent slippage/approval failures

**Why it happened:**
```solidity
// Contract expects 6 fields
struct ContractCallParams {
    address target;
    bytes data;
    uint256 value;
    uint256 minReturnValue;
    uint256 maxApprovalAmount;
    address approvalToken;
}

// Scripts attempted 4 fields
encodeFunctionData("executeContractCall", [{
    target: "0x...",
    data: "0x...",
    value: ethers.parseEther("0"),
    category: "general"  // DOES NOT EXIST IN STRUCT
}])
```

**Fix Required:**
1. Add TypeScript struct definition matching contract ABI (6 fields)
2. Add runtime ABI validation tests that verify:
   - Field count matches contract
   - Field types match contract
   - No extra fields allowed
3. Update CLI helpers to always use correct struct definition
4. Add CLI warning if `category` is passed (common mistake)

---

### BUG-DRAIN-02: attest() routed through executeContractCall unnecessarily 🏗️ DESIGN LAYER VIOLATION

**Symptom:** Scripts called `attest()` indirectly via `executeContractCall`, treating it like an external contract function.

**Root Cause:** Over-generalized wallet architecture. Designed attest → executeContractCall → PolicyEngine → whitelist validation. But attest is a core protocol function that should be direct.

**Contract Reality:**
```solidity
// attest() is onlyOwnerOrMachineKey, directly on wallet
function attest(
    bytes32 attestationId,
    string calldata action,
    string calldata reason,
    address recipient,
    uint256 amount,
    address token,
    uint256 expiresAt
) external onlyOwnerOrMachineKey notFrozen returns (bytes32) {
    _intentAttestation().attest(...);
    return attestationId;
}

// executeContractCall is onlyEntryPointOrOwner — machine key CANNOT call
function executeContractCall(ContractCallParams calldata params)
    external
    nonReentrant
    onlyEntryPointOrOwner
    notFrozen
    returns (bytes memory returnData)
```

**The Problem:**
- v4 wallet has `onlyEntryPointOrOwner` on executeContractCall
- Machine key does NOT have access to executeContractCall
- But attest is `onlyOwnerOrMachineKey` (machine key CAN call)
- Routing attest through executeContractCall blocked machine key autonomy
- Unnecessary PolicyEngine whitelist enforcement (attest shouldn't require DeFi policy approval)

**Fix Required:**
1. **Protocol clarification:** Core wallet functions (openContext, closeContext, attest, executeSpend) are direct-callable `onlyOwnerOrMachineKey`
2. **Only use executeContractCall for external DeFi contracts**, not internal protocol functions
3. Update drain CLI/SDK scripts to call attest() directly on wallet
4. Add developer guide explaining the two call paths:
   - **Direct path:** openContext, attest, executeSpend (core protocol)
   - **Contract path:** executeContractCall (external DeFi, requires PolicyEngine whitelist)

---

### BUG-DRAIN-03: openContext WCtx revert due to stale context ♻️ STATE MANAGEMENT

**Symptom:** Script failed at `openContext()` with `WCtx()` error (wallet context already open).

**Root Cause:** Previous partial run left `contextOpen = true` on-chain. No state cleanup in retry logic.

**Contract Logic:**
```solidity
function openContext(bytes32 contextId, string calldata taskType) external onlyOwnerOrMachineKey notFrozen {
    if (contextOpen) revert WCtx();  // ← REVERT if already open
    ...
    contextOpen = true;
}
```

**Why it happened:**
1. Initial drain attempt started (openContext succeeded)
2. Hit BUG-DRAIN-04 (category not configured)
3. Script aborted without calling closeContext()
4. Retry attempt: openContext reverted because contextOpen was still true
5. No automatic cleanup, no UX indication of what went wrong

**Impact:**
- Required manual `closeContext()` call between retries
- 45+ minute debugging loop identifying stale context
- No CLI command to check context state or force-close

**Fix Required:**
1. **Always check and close stale context before opening:**
```typescript
const isOpen = await wallet.contextOpen();
if (isOpen) {
    await wallet.closeContext();
    // Wait for confirmation
    await provider.waitForTransaction(...);
}
// Now safe to open
await wallet.openContext(...);
```

2. Add wallet subcommand: `arc402 wallet check-context` (returns: contextId, taskType, age, isOpen)
3. Add wallet subcommand: `arc402 wallet close-context` (force-close stale context)
4. Add drain command: auto-check and auto-close stale context before starting
5. Update drain script to include context cleanup in try-finally block

---

### BUG-DRAIN-04: PolicyEngine category not configured on wallet 🔧 ONBOARDING CEREMONY

**Symptom:** `executeSpend()` reverted with `"PolicyEngine: category not configured"`.

**Root Cause:** Wallet deployed (v4, 2026-03-17) without configuring any spending categories. v4 was the first wallet deployed after PolicyEngine contract went live, but no governance setup occurred.

**Contract Logic:**
```solidity
function validateSpend(
    address wallet,
    string calldata category,
    uint256 amount,
    bytes32 contextId
) external view returns (bool valid, string memory reason) {
    uint256 limit = categoryLimits[wallet][category];
    if (limit == 0) {
        return (false, "PolicyEngine: category not configured");  // ← THIS FIRED
    }
    ...
}
```

**Why it happened:**
- v4 wallet deployed to mainnet
- No post-deploy governance step to call `PolicyEngine.setCategoryLimitFor(wallet, "general", amount)`
- Wallet existed but had zero configured spending categories
- Any spend attempt on any category reverted

**Impact:**
- Core wallet feature (spending) completely blocked without configuration
- No error message in CLI indicating missing setup
- No checklist in deployment script reminding of this step
- 90+ minutes spent discovering this one missing transaction

**This is the most critical bug** — affects wallet usability at core level.

**Fix Required:**
1. **Mandatory onboarding ceremony** — wallet deployment must trigger governance setup:
   ```typescript
   async function deployAndConfigureWallet(owner) {
       // Step 1: Deploy wallet
       const wallet = await walletFactory.createWallet(owner);
       
       // Step 2: REQUIRED — register with PolicyEngine
       await policyEngine.registerWallet(wallet.address, owner);
       
       // Step 3: REQUIRED — set at least "general" category
       const GENERAL_LIMIT = ethers.parseEther("1");  // 1 ETH per tx
       await policyEngine.setCategoryLimitFor(wallet.address, "general", GENERAL_LIMIT);
       
       // Step 4: REQUIRED — set daily limit (optional but recommended)
       const DAILY_LIMIT = ethers.parseEther("10");  // 10 ETH per day
       await policyEngine.setDailyLimitFor(wallet.address, "general", DAILY_LIMIT);
       
       return wallet;
   }
   ```

2. **CLI deployment helper:**
   ```bash
   arc402 wallet deploy --owner <addr> --auto-configure
   # Auto-configures: general category @ 1 ETH/tx, 10 ETH/day
   ```

3. **Checklist added to deployment script** — ensures categories are set before wallet is considered operational

4. **Minimum categories requirement:**
   - `"general"` — all general spending (required)
   - Optional: `"defi"`, `"nft"`, `"settlement"` (for specialized operations)

---

### BUG-DRAIN-05: Public RPC serves stale state 🌐 INFRASTRUCTURE

**Symptom:** `contextOpen()` reads returned stale state immediately after `openContext()` transaction was confirmed. Script's context check skipped retry logic because it thought context was open, but on-chain state was not yet propagated.

**Root Cause:** Public Base RPC (`mainnet.base.org`) has delayed state propagation. Machine key operations were routed through public RPC in read paths, causing false reads.

**Impact:**
- Confirmation logic relied on immediate state reads
- Public RPC lagged 1-2 blocks behind Alchemy
- Scripts misinterpreted delay as transaction failure
- Required manual state verification via Alchemy RPC to see real state

**Fix Required:**
1. **Enforce Alchemy RPC for all contract reads and writes:**
   - All state validation (contextOpen, balanceOf, etc.) → Alchemy
   - All transaction sends → Alchemy
   - Zero use of public Base RPC in production paths

2. **Update CLI config schema:**
   ```typescript
   const config = {
       rpcUrl: "https://base-mainnet.g.alchemy.com/v2/YOUR_KEY",  // Alchemy, not public
       fallbackRpcUrl: "https://base.publicrpc.com",  // Fallback only for display, not validation
   };
   ```

3. **Add RPC validation test** that checks state consistency after each transaction:
   ```typescript
   // After openContext, verify it's readable
   await waitForTransaction(txHash, 2);  // Wait 2 blocks
   const isOpen = await wallet.contextOpen();
   if (!isOpen) throw new Error("State not propagated to RPC");
   ```

---

### BUG-DRAIN-06: No arc402 wallet drain CLI command 📋 MISSING UX PATH

**Symptom:** No single command to drain ETH from wallet. Operators had to manually:
1. Encode openContext calldata
2. Encode attest calldata
3. Encode executeSpend calldata
4. Open WalletConnect session
5. Send each tx sequentially
6. Manage context state manually

**Root Cause:** drain-wallet.ts and drain-v4.ts scripts exist, but not integrated into CLI as a user-facing command.

**Impact:**
- 3-4 manual steps instead of 1 command
- High error surface (manual encoding)
- No context cleanup guardrails
- No category validation before attempting spend
- Difficult for non-technical operators

**Fix Required:**
1. **New CLI command: `arc402 wallet drain`**
   ```bash
   arc402 wallet drain [--amount 0.0005] [--recipient 0x...] [--category general] [--output-only]
   ```

2. **Full flow:**
   - Check wallet balance
   - Check PolicyEngine: wallet registered? category configured? limit > 0?
   - Warn if balance < reserve (0.0001 ETH for gas)
   - Auto-close any stale context
   - Open context (machine key)
   - Create attest (machine key)
   - Execute spend (machine key)
   - Close context (machine key)
   - Confirm in Telegram/Discord
   - Return tx hash

3. **Implementation:**
   ```typescript
   program
       .command("wallet drain")
       .option("--amount <eth>", "Amount to drain (default: all - 0.0001 reserve)", "0")
       .option("--recipient <addr>", "Recipient (default: owner)")
       .option("--category <category>", "Spend category (default: general)", "general")
       .option("--output-only", "Print calldata without sending")
       .action(async (options) => {
           // Full drain orchestration
           const wallet = new ethers.Contract(config.walletContractAddress, WALLET_ABI, machineKeySigner);
           const balance = await provider.getBalance(wallet.address);
           
           // Validation
           await validateWalletConfiguration(wallet, options.category);
           
           // Context cleanup
           if (await wallet.contextOpen()) {
               await wallet.closeContext();
               await provider.waitForTransaction(...);
           }
           
           // Build operations
           const contextId = buildContextId();
           const attestationId = buildAttestationId();
           
           // Send operations
           console.log("Opening context...");
           await wallet.openContext(contextId, "drain");
           
           console.log("Creating attestation...");
           await wallet.attest(attestationId, "spend", "drain to owner", recipient, amount, ethers.ZeroAddress, expiry);
           
           console.log("Executing spend...");
           await wallet.executeSpend(recipient, amount, options.category, attestationId);
           
           console.log("Closing context...");
           await wallet.closeContext();
           
           console.log("✅ Drain complete");
       });
   ```

---

## Protocol-Level Analysis

### Answer 1: What other wallet operations hit "category not configured"?

**All spending operations require configured categories:**

1. **ETH spending** — `executeSpend()` → checks `categoryLimits[wallet][category]`
2. **Token spending** — `executeTokenSpend()` → validates via PolicyEngine
3. **Settlement coordination** — `verifyAndConsumeAttestation()` → validates via PolicyEngine
4. **Any cross-wallet settlement** — SettlementCoordinator requires category check

**These would ALL fail with "category not configured" on newly deployed wallets:**

```solidity
// All of these call _validateSpendPolicy, which requires category limit > 0
function executeSpend(..., string calldata category, ...) { ... }
function executeTokenSpend(..., string calldata category, ...) { ... }
function verifyAndConsumeAttestation(..., string calldata category) { ... }
```

**Non-affected operations:**
- openContext / closeContext — no category check
- attest — no category check
- updatePolicy — no category check
- authorize/revoke machine keys — no category check

**Mitigation:** Onboarding ceremony MUST include category setup before wallet is marked "operational".

---

### Answer 2: Ideal wallet onboarding flow (deploy → configure → operational)

**Three-phase deployment ceremony:**

```
PHASE 1: DEPLOYMENT (Owner signing via MetaMask)
  ├─ Deploy wallet via WalletFactoryV3
  │  └─ Wallet address emitted, owner set
  ├─ [CRITICAL] Register wallet with PolicyEngine
  │  └─ PolicyEngine.registerWallet(wallet, owner)
  └─ [CRITICAL] Set minimum "general" category limit
     └─ PolicyEngine.setCategoryLimitFor(wallet, "general", LIMIT)

PHASE 2: AUTHORIZATION (Owner signing via MetaMask or machine key)
  ├─ Authorize machine key(s)
  │  └─ wallet.authorizeMachineKey(machineKeyAddress)
  ├─ Set velocity limits (optional)
  │  └─ PolicyEngine.setMaxSpendPerHour(wallet, limit)
  └─ Set daily limits (optional)
     └─ PolicyEngine.setDailyLimitFor(wallet, "general", dailyLimit)

PHASE 3: OPERATIONAL (Ready for autonomous operation)
  ├─ Verify all configurations
  │  ├─ Check categoryLimits["general"] > 0
  │  ├─ Check machineKey authorized
  │  ├─ Check wallet.contextOpen == false (no stale state)
  │  └─ Check balance sufficient for operations
  └─ [OPTIONAL] Set guardian address
     └─ wallet.setGuardian(agentGuardianAddress)
```

**Recommended deployment flow via CLI:**

```bash
# Phase 1: Deploy
arc402 wallet deploy --owner 0x7745... --auto-configure

# This runs:
# 1. wallet = WalletFactory.createWallet(owner)
# 2. PolicyEngine.registerWallet(wallet, owner)
# 3. PolicyEngine.setCategoryLimitFor(wallet, "general", 1 ETH)
# 4. PolicyEngine.setDailyLimitFor(wallet, "general", 10 ETH)
# Returns: wallet address

# Phase 2: Authorize machine key
arc402 wallet authorize-machine-key --wallet 0xb4aF... --key 0x7470...

# Phase 3: Verify operational
arc402 wallet check-health --wallet 0xb4aF...
# Output:
# ✓ Policy configured
# ✓ Machine key authorized
# ✓ No stale context
# ✓ Operational
```

**Checklist embedded in deployment script** (enforced before returning "success"):

- [ ] Wallet deployed to mainnet
- [ ] Owner set correctly
- [ ] Wallet registered with PolicyEngine
- [ ] "general" category limit set (minimum 0.1 ETH)
- [ ] Daily limit set (optional but recommended)
- [ ] Owner notified with wallet address
- [ ] All state verified on-chain

---

### Answer 3: Other functions unnecessarily blocked from machine key?

**Current machine key restrictions:**

```solidity
onlyOwnerOrMachineKey  // Machine key CAN call
├─ openContext
├─ closeContext
├─ attest
└─ executeSpend / executeTokenSpend

onlyEntryPointOrOwner  // Machine key CANNOT call
└─ executeContractCall

onlyOwner              // Machine key CANNOT call
├─ updatePolicy
├─ authorizeMachineKey / revokeMachineKey
├─ setGuardian
├─ setAuthorizedInterceptor
├─ proposeRegistryUpdate / executeRegistryUpdate
└─ [Governance operations]
```

**Audit of restrictions:**

❌ **UNNECESSARY RESTRICTION 1: attest → executeContractCall wrapper**
- Currently: attest called indirectly via executeContractCall → PolicyEngine whitelist
- Should be: direct call to wallet.attest() (already onlyOwnerOrMachineKey)
- **Fix:** Remove executeContractCall wrapper for attest

❌ **UNNECESSARY RESTRICTION 2: updatePolicy requires owner-only**
- Currently: onlyOwner
- Could be: onlyOwnerOrMachineKey (policy is operational, not governance)
- **Rationale:** Machine key should be able to switch operating policies within bounds
- **Risk:** Mitigated by PolicyEngine enforcement at spend time
- **Recommendation:** Keep onlyOwner for now (conservative), reconsider post-launch

❌ **UNNECESSARY RESTRICTION 3: setAuthorizedInterceptor requires owner-only**
- Currently: onlyOwner
- Could be: onlyOwnerOrMachineKey (operational routing, not governance)
- **Impact:** Blocks autonomous token spending via interceptor
- **Fix:** Change to onlyOwnerOrMachineKey
- **Risk:** Low — interceptor can only call executeTokenSpend (bounded by attest)

✅ **CORRECT RESTRICTIONS:**
- authorizeMachineKey / revokeMachineKey → onlyOwner (governance)
- setGuardian → onlyOwner (governance)
- proposeRegistryUpdate → onlyOwner (governance)

**Recommendation:**
1. Keep executeContractCall as onlyEntryPointOrOwner (correct — prevents machine key DeFi exploits)
2. Change setAuthorizedInterceptor to onlyOwnerOrMachineKey (operational)
3. Leave updatePolicy as onlyOwner (conservative)

---

### Answer 4: Minimum PolicyEngine categories every wallet needs at deploy?

**Minimum required:** `"general"` only (1 category)

**Recommended configuration:**

```typescript
// MINIMUM (required at deploy time)
{
    "general": {
        perTxLimit: ethers.parseEther("1"),      // 1 ETH max per spend
        dailyLimit: ethers.parseEther("10"),     // 10 ETH max per day
        description: "General spending"
    }
}

// COMPLETE (recommended for most agents)
{
    "general": {
        perTxLimit: ethers.parseEther("1"),
        dailyLimit: ethers.parseEther("10"),
        description: "General spending"
    },
    "defi": {
        perTxLimit: ethers.parseEther("5"),
        dailyLimit: ethers.parseEther("50"),
        description: "DeFi operations (swaps, liquidity, etc.)"
    },
    "settlement": {
        perTxLimit: ethers.parseEther("10"),
        dailyLimit: ethers.parseEther("100"),
        description: "Multi-agent settlements"
    },
    "nft": {
        perTxLimit: ethers.parseEther("2"),
        dailyLimit: ethers.parseEther("20"),
        description: "NFT purchases and transfers"
    }
}

// SPECIALIZED (for specific use cases)
{
    "oracle-feed": {
        perTxLimit: ethers.parseEther("0.5"),
        dailyLimit: ethers.parseEther("5"),
        description: "Oracle payments"
    },
    "emergency": {
        perTxLimit: ethers.parseEther("100"),
        dailyLimit: ethers.parseEther("500"),
        description: "Emergency operations (after guardian approval)"
    }
}
```

**Why per-category limits matter:**

1. **Risk isolation:** Compromise of one protocol doesn't drain all liquidity
2. **Intent clarity:** Category documents what operation is happening
3. **Audit trail:** PolicyEngine.recordSpend logs category for forensics
4. **Time-based controls:** Different categories can have different velocity limits

**Protocol requirement:** At least `"general"` must be configured with `limit > 0` before ANY spend is possible.

**Enforcement:** PolicyEngine.validateSpend() checks `categoryLimits[wallet][category] == 0` → revert.

---

### Answer 5: What UX guardrails prevent partial state (open context, unconsumed attestation)?

**Current guardrails (insufficient):**

1. **Context state check before spend:**
   ```solidity
   function executeSpend(...) external ... {
       // ...
       if (!contextOpen) revert WCtx();  // ← Only fails if context CLOSED
       // No check for STALE context age
   }
   ```

2. **Attestation verification:**
   ```solidity
   function executeSpend(..., bytes32 attestationId) external {
       if (!_intentAttestation().verify(attestationId, ...)) revert WAtt();
       _intentAttestation().consume(attestationId);
   }
   ```

**Gaps identified:**

❌ **Gap 1: No context age limit**
- Context can stay open indefinitely
- No forced closure after timeout
- No warning when context is "stale" (> 10 minutes old)

❌ **Gap 2: No attestation expiry enforcement at spend time**
- Attestation has expiresAt, but not checked during executeSpend
- Stale attestation could be consumed long after expiry

❌ **Gap 3: No partial-state recovery path**
- If script dies mid-drain (after attest, before spend), context stays open
- No UX to understand what state is pending
- Manual closeContext() required

❌ **Gap 4: No spending timeout**
- Attestation can be created and spent 1 hour later (expiresAt only)
- Contextual intent degrades over time
- No automatic spend deadline

**Recommended guardrails to add:**

```solidity
// Add to ARC402Wallet

mapping(address => uint256) public contextMaxAge;  // Owner-configurable, e.g., 10 min

function openContext(bytes32 contextId, string calldata taskType) external onlyOwnerOrMachineKey notFrozen {
    if (contextOpen) revert WCtx();
    activeContextId = contextId;
    activeTaskType = taskType;
    contextOpen = true;
    contextOpenedAt = block.timestamp;  // ← Key for age check
    emit ContextOpened(contextId, taskType, block.timestamp);
}

function executeSpend(
    address payable recipient,
    uint256 amount,
    string calldata category,
    bytes32 attestationId
) external onlyOwnerOrMachineKey requireOpenContext notFrozen {
    // NEW: Check context age
    if (contextMaxAge[msg.sender] > 0) {
        uint256 contextAge = block.timestamp - contextOpenedAt;
        if (contextAge > contextMaxAge[msg.sender]) {
            emit SpendRejected(recipient, amount, "context too old");
            revert WCtx();  // Force close and retry
        }
    }
    
    // Verify attestation includes expiry check
    if (!_intentAttestation().verify(attestationId, address(this), recipient, amount, address(0))) revert WAtt();
    if (_intentAttestation().expiresAt(attestationId) < block.timestamp) {
        emit SpendRejected(recipient, amount, "attestation expired");
        revert WAtt();
    }
    
    // ... rest of spend logic
}

// Owner can set context max age (0 = disabled)
function setContextMaxAge(uint256 maxAgeSeconds) external onlyOwner {
    contextMaxAge[msg.sender] = maxAgeSeconds;
}
```

**CLI-level guardrails:**

```bash
# Check context state before spend
arc402 wallet check-context --wallet 0xb4aF...
# Output:
# Context open: YES
# Context ID: 0x1234...
# Task type: drain
# Opened: 5 minutes ago
# ⚠️  Warning: context is 5 minutes old (expires in 5 more minutes)

# Force-close stale context
arc402 wallet close-context --wallet 0xb4aF... --force

# Get pending attestations (if exposed)
arc402 wallet list-attestations --wallet 0xb4aF...
# Output:
# ID: 0x5678...
# Action: spend
# Recipient: 0x7745...
# Amount: 0.00045 ETH
# Created: 5 minutes ago
# Expires: 10 minutes from now
```

---

### Answer 6: Security implications of stale open context?

**Threat model:**

A stale open context (contextOpen = true) creates attack surface in three scenarios:

**Scenario A: Compromised machine key**
- Attacker gains machine key (private key leaked)
- Wallet has open context from legitimate operation
- Attacker can call executeSpend with STALE context without re-opening
- Attestation verification still enforces "correct recipient/amount", but attacker can:
  - Create new attestation for attacker-controlled recipient
  - Execute spend with attacker's attestation
  - All within the legitimate context (wallet thinks it's the same operation)

**Severity:** HIGH

```solidity
// Attacker flow (machine key compromised):
wallet.attest(newAttestationId, "spend", "...attacker...", attacker, 1000000, address(0), farFutureExpiry);
wallet.executeSpend(attacker, 1000000, "general", newAttestationId);
// ^ Succeeds because contextOpen == true (from legitimate operation hours ago)
```

**Scenario B: Frontrunning open context**
- Legitimate user opens context for operation X
- Mempool sees openContext tx
- Attacker front-runs with their own attest + executeSpend
- Attacker spends from the wallet within a context intended for something else
- Context state is not attacker-specific; it's wallet-global

**Severity:** CRITICAL if context is shared across multiple operations

```solidity
// Sequence:
// User mempool: openContext(contextId=0x1234, "drain to owner")
// Attacker sees it, immediately sends:
attacker.attest(attestationId=0x9999, "spend", "...", attackerAddr, amount, address(0), expiry);
attacker.executeSpend(attackerAddr, amount, "general", attestationId=0x9999);
// ^ Succeeds first because attacker's tx is ahead in block
// User's openContext still succeeds, but context is "poisoned"
```

**Scenario C: Manual context open left unclosed**
- Operator opens context via CLI for drain
- Script crashes before closeContext
- Context stays open for 24+ hours
- Any attacker with machine key can spend during that window
- Context ID is deterministic (based on timestamp), so attacker can predict it

**Severity:** MEDIUM (requires machine key compromise)

**Current mitigations:**
1. ✅ contextOpen is Boolean (prevents multiple open contexts)
2. ✅ onlyOwnerOrMachineKey (bounded caller set)
3. ✅ Attestation verification (recipient/amount must match attestation)
4. ❌ No context age limit (stays open indefinitely)
5. ❌ No context expiry (context can be as old as needed)
6. ❌ No context-binding in attestation (attestation not tied to specific context)

**Recommended security fixes:**

```solidity
// ENHANCEMENT 1: Bind attestation to context
// Modify attest() to require contextOpen
function attest(
    bytes32 attestationId,
    bytes32 contextId,  // NEW: must match wallet.activeContextId
    string calldata action,
    // ...
) external onlyOwnerOrMachineKey notFrozen {
    if (contextId != activeContextId) revert WCtx();  // Bind to context
    _intentAttestation().attest(attestationId, ...);
}

// ENHANCEMENT 2: Enforce context age limit
function executeSpend(...) external {
    if (block.timestamp - contextOpenedAt > 10 minutes) {
        revert WCtx();  // Force context refresh
    }
    // ...
}

// ENHANCEMENT 3: Force closeContext at context max age
// Happens automatically if maxAge is enforced

// ENHANCEMENT 4: Guardian can force-close context (emergency)
function setGuardian(address _guardian) external onlyOwner {
    guardian = _guardian;
}

function freezeContext() external {
    if (msg.sender != guardian) revert WAuth();
    contextOpen = false;
    emit ContextClosed(activeContextId, block.timestamp);
}
```

**Risk assessment:**

| Scenario | Severity | Likelihood | Mitigation |
|----------|----------|------------|-----------|
| Compromised key + stale context | HIGH | LOW (key compromise required) | Context age limit + context-binding |
| Frontrunning open context | CRITICAL | MEDIUM (observable mempool) | Context-specific attestations |
| Unmanaged context timeout | MEDIUM | MEDIUM (operator error) | Auto-close after maxAge |

**Recommendation:** Implement context-binding (ENHANCEMENT 1) as CRITICAL before mainnet launch.

---

### Answer 7: Full spec for arc402 wallet drain command

**Command: `arc402 wallet drain`**

**Purpose:** Safely and completely drain ETH from an ARC-402 wallet to a recipient (typically the owner EOA).

**Syntax:**

```bash
arc402 wallet drain [OPTIONS]

Options:
  --amount <eth>              Amount to drain (default: all available - 0.0001 reserve)
  --recipient <address>       Recipient address (default: wallet owner from config)
  --category <category>       Spend category (default: "general")
  --wait-blocks <n>           Blocks to wait for confirmation (default: 2)
  --force-close-context       Force-close any stale context before draining
  --dry-run                   Print calldata without sending
  --no-signature-check        Skip source code signature verification (risky)
  --output-only               Output calldata as JSON for manual broadcasting
  --verbose                   Print all intermediate steps

Examples:
  arc402 wallet drain
  # Drains all ETH (minus 0.0001 reserve) to wallet owner

  arc402 wallet drain --amount 0.0005 --recipient 0x1234...
  # Drains exactly 0.0005 ETH to specified recipient

  arc402 wallet drain --dry-run
  # Prints calldata for all 3 transactions without sending

  arc402 wallet drain --force-close-context --verbose
  # Force-closes any stale context, prints all steps, drains
```

**Implementation specification:**

### Pre-flight Checks

```typescript
async function validateDrainOperation(config: Arc402Config, options: DrainOptions) {
    const wallet = new ethers.Contract(
        config.walletContractAddress,
        WALLET_ABI,
        new ethers.JsonRpcProvider(config.rpcUrl)
    );

    // 1. Check wallet balance
    const balance = await provider.getBalance(wallet.address);
    if (balance < ethers.parseEther("0.00001")) {
        throw new Error("Wallet balance too low to drain");
    }

    // 2. Check PolicyEngine configuration
    const policyEngine = new ethers.Contract(PE_ADDRESS, PE_ABI, provider);
    const categoryLimit = await policyEngine.categoryLimits(wallet.address, options.category);
    if (categoryLimit == 0n) {
        throw new Error(
            `PolicyEngine: category "${options.category}" not configured. ` +
            `Run: arc402 wallet set-category --category ${options.category} --limit 1`
        );
    }

    // 3. Check if recipient is valid
    const recipientCode = await provider.getCode(options.recipient);
    // recipientCode.length == 2 means EOA (just 0x), any longer means contract
    // Both are OK, just warn if contract
    if (recipientCode.length > 2) {
        console.warn(`⚠️  Recipient is a contract. Ensure it can receive ETH.`);
    }

    // 4. Check machine key authorization
    const isMachineKeyAuthorized = await wallet.authorizedMachineKeys(config.machineKeyAddress);
    if (!isMachineKeyAuthorized) {
        throw new Error(
            `Machine key ${config.machineKeyAddress} not authorized on wallet. ` +
            `Run: arc402 wallet authorize-machine-key`
        );
    }

    // 5. Check context state (warn if open)
    const contextOpen = await wallet.contextOpen();
    if (contextOpen) {
        if (!options.forceCloseContext) {
            console.warn(`⚠️  Wallet has an open context. This will block drain.`);
            console.log(`Recommendation: run with --force-close-context flag`);
            throw new Error("Stale context detected");
        }
        console.log(`ℹ️  Closing stale context...`);
        // Will be handled in main flow
    }

    // 6. Check RPC provider is Alchemy (warn if not)
    if (!config.rpcUrl.includes("alchemy")) {
        console.warn(`⚠️  RPC is not Alchemy. State reads may be stale.`);
        console.warn(`Recommendation: set RPC_URL to Alchemy endpoint`);
    }

    console.log(`✓ All pre-flight checks passed\n`);
}
```

### Build Transaction Payloads

```typescript
async function buildDrainTransactions(config: Arc402Config, options: DrainOptions) {
    const wallet = new ethers.Contract(
        config.walletContractAddress,
        WALLET_ABI,
        provider
    );

    const balance = await provider.getBalance(wallet.address);
    const reserve = ethers.parseEther("0.0001");
    const drainAmount = options.amount && options.amount > 0n
        ? options.amount
        : balance - reserve;

    const iface = new ethers.Interface(WALLET_ABI);
    const contextId = ethers.keccak256(ethers.toUtf8Bytes(`drain-${Date.now()}-${Math.random()}`));
    const attestationId = ethers.keccak256(ethers.toUtf8Bytes(`attest-${Date.now()}-${Math.random()}`));
    const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 minutes

    const transactions = [];

    // TX 0 (optional): Close stale context if needed
    if (options.forceCloseContext) {
        const contextOpen = await wallet.contextOpen();
        if (contextOpen) {
            transactions.push({
                name: "closeContext",
                to: wallet.address,
                data: iface.encodeFunctionData("closeContext", []),
                value: "0x0",
                description: "Close stale context from prior operation"
            });
        }
    }

    // TX 1: Open context
    transactions.push({
        name: "openContext",
        to: wallet.address,
        data: iface.encodeFunctionData("openContext", [contextId, "drain"]),
        value: "0x0",
        description: "Open a new context for drain operation"
    });

    // TX 2: Create attestation
    transactions.push({
        name: "attest",
        to: wallet.address,
        data: iface.encodeFunctionData("attest", [
            attestationId,
            "spend",
            `drain to ${options.recipient}`,
            options.recipient,
            drainAmount,
            ethers.ZeroAddress,
            expiresAt
        ]),
        value: "0x0",
        description: "Create intent attestation authorizing the spend"
    });

    // TX 3: Execute spend
    transactions.push({
        name: "executeSpend",
        to: wallet.address,
        data: iface.encodeFunctionData("executeSpend", [
            options.recipient,
            drainAmount,
            options.category,
            attestationId
        ]),
        value: "0x0",
        description: "Execute the spend (sends ETH to recipient)"
    });

    // TX 4: Close context
    transactions.push({
        name: "closeContext",
        to: wallet.address,
        data: iface.encodeFunctionData("closeContext", []),
        value: "0x0",
        description: "Close context (cleanup)"
    });

    return {
        transactions,
        drainAmount,
        contextId,
        attestationId
    };
}
```

### Execution Flow

```typescript
async function executeDrainOperation(
    client: SignClient | null,  // null if using machine key only
    session: string | null,      // null if using machine key only
    account: string | null,      // null if using machine key only
    config: Arc402Config,
    options: DrainOptions,
    txs: Transaction[]
) {
    const machineKeySigner = new ethers.Wallet(config.machineKeyPrivateKey, provider);

    for (let i = 0; i < txs.length; i++) {
        const tx = txs[i];
        console.log(`\n[${i+1}/${txs.length}] ${tx.description}`);
        console.log(`  Function: ${tx.name}`);

        if (options.outputOnly) {
            // Don't send, just print
            console.log(`  To: ${tx.to}`);
            console.log(`  Data: ${tx.data}`);
            console.log(`  Value: ${tx.value}`);
            continue;
        }

        let txHash;

        if (client && session && account) {
            // MetaMask path (for openContext, need owner signature)
            console.log(`  Sending via MetaMask...`);
            txHash = await client.request({
                topic: session,
                chainId: `eip155:8453`,
                request: {
                    method: "eth_sendTransaction",
                    params: [{ from: account, to: tx.to, data: tx.data, gas: "0x50000" }]
                }
            });
        } else {
            // Machine key path (for attest, executeSpend, closeContext)
            console.log(`  Sending via machine key...`);
            const txResp = await machineKeySigner.sendTransaction({
                to: tx.to,
                data: tx.data,
                value: tx.value,
                gasLimit: 500000
            });
            txHash = txResp.hash;
        }

        console.log(`  ✓ TX hash: ${txHash}`);

        // Wait for confirmation
        if (options.waitBlocks) {
            console.log(`  Waiting for ${options.waitBlocks} blocks...`);
            const receipt = await provider.waitForTransaction(txHash, options.waitBlocks, 120000);
            if (!receipt) {
                throw new Error(`TX ${txHash} failed or timed out`);
            }
            console.log(`  ✓ Confirmed in block ${receipt.blockNumber}`);
        }

        // Small delay between txs
        if (i < txs.length - 1) {
            await new Promise(r => setTimeout(r, 3000));
        }
    }
}
```

### Error Handling and Recovery

```typescript
async function handleDrainError(error: any, config: Arc402Config, context: any) {
    console.error(`\n❌ Error: ${error.message}\n`);

    if (error.message.includes("category not configured")) {
        console.log(`Recovery: Configure the spending category`);
        console.log(`  arc402 wallet set-category --category general --limit 1`);
    } else if (error.message.includes("contextOpen")) {
        console.log(`Recovery: Close stale context first`);
        console.log(`  arc402 wallet close-context --force`);
        console.log(`  Then retry: arc402 wallet drain`);
    } else if (error.message.includes("stale") || error.message.includes("propagat")) {
        console.log(`Recovery: Wait a few blocks and retry`);
        console.log(`  arc402 wallet drain --force-close-context`);
    } else if (error.message.includes("machine key not authorized")) {
        console.log(`Recovery: Authorize machine key`);
        console.log(`  arc402 wallet authorize-machine-key`);
    }

    process.exit(1);
}
```

### Full CLI Integration

```typescript
program
    .command("wallet drain")
    .option("--amount <eth>", "Amount to drain in ETH (default: all - reserve)")
    .option("--recipient <address>", "Recipient address (default: wallet owner)")
    .option("--category <category>", "Spend category (default: general)", "general")
    .option("--wait-blocks <n>", "Blocks to wait for confirmation", "2")
    .option("--force-close-context", "Force-close stale context before draining")
    .option("--dry-run", "Print calldata without sending")
    .option("--output-only", "Output calldata as JSON")
    .option("--verbose", "Verbose output")
    .action(async (options) => {
        try {
            const config = loadConfig();
            validateConfig(config, ["machineKeyPrivateKey", "walletContractAddress"]);

            // Parse options
            const drainOptions = {
                amount: options.amount ? ethers.parseEther(options.amount) : undefined,
                recipient: options.recipient || config.walletOwnerAddress,
                category: options.category,
                waitBlocks: parseInt(options.waitBlocks) || 2,
                forceCloseContext: options.forceCloseContext || false,
                dryRun: options.dryRun || false,
                outputOnly: options.outputOnly || false,
                verbose: options.verbose || false
            };

            // Validate
            await validateDrainOperation(config, drainOptions);

            // Build transactions
            const { transactions, drainAmount, contextId, attestationId } = 
                await buildDrainTransactions(config, drainOptions);

            console.log(`Preparing to drain ${ethers.formatEther(drainAmount)} ETH`);
            console.log(`From: ${config.walletContractAddress}`);
            console.log(`To:   ${drainOptions.recipient}`);
            console.log(`Txs:  ${transactions.length} operations\n`);

            if (options.dryRun || options.outputOnly) {
                // Just print, don't send
                console.log(JSON.stringify(transactions, null, 2));
                process.exit(0);
            }

            // Execute (this will use WalletConnect if available, machine key otherwise)
            await executeDrainOperation(
                null, null, null,  // No WalletConnect session needed
                config,
                drainOptions,
                transactions
            );

            console.log(`\n✅ Drain complete. ${ethers.formatEther(drainAmount)} ETH sent to ${drainOptions.recipient}`);
        } catch (error) {
            await handleDrainError(error, loadConfig(), {});
        }
    });
```

---

## Additional Hidden Bugs & Design Issues

### HIDDEN-BUG-01: PolicyEngine.recordSpend requires msg.sender verification 🔓

**Discovery:** After spending, PolicyEngine.recordSpend() can be called by anyone, not just the wallet.

```solidity
function recordSpend(
    address wallet,
    string calldata category,
    uint256 amount,
    bytes32 contextId
) external {
    require(msg.sender == wallet || msg.sender == walletOwners[wallet], "PolicyEngine: not authorized");
    // ← This is correct, but...
}
```

**Risk:** If wallet is compromised, attacker could call recordSpend to create fake spend records, laundering stolen funds through PolicyEngine logs.

**Mitigation:** This is correctly implemented. No fix needed.

---

### HIDDEN-BUG-02: Attestation expiry not enforced at spend time ⏱️

**Discovery:** Attestation has `expiresAt` field, but `executeSpend()` doesn't check it.

```solidity
function executeSpend(
    address payable recipient,
    uint256 amount,
    string calldata category,
    bytes32 attestationId
) external onlyOwnerOrMachineKey requireOpenContext notFrozen {
    // ...
    if (!_intentAttestation().verify(attestationId, address(this), recipient, amount, address(0))) revert WAtt();
    // ← No expiry check!
    _intentAttestation().consume(attestationId);
    // ...
}
```

**Risk:** Attestation created 1 hour ago with expiresAt = now - 30 minutes can still be spent.

**Fix Required:**
```solidity
function executeSpend(...) external {
    if (!_intentAttestation().verify(...)) revert WAtt();
    
    // NEW: Check expiry
    (uint256 expiresAt) = _intentAttestation().getExpiresAt(attestationId);
    if (block.timestamp > expiresAt) {
        emit SpendRejected(recipient, amount, "attestation expired");
        revert WAtt();
    }
    
    _intentAttestation().consume(attestationId);
    // ...
}
```

**Severity:** MEDIUM

---

### HIDDEN-BUG-03: No velocity limit on token spending 🔄

**Discovery:** `executeTokenSpend()` is not subject to the same velocity limits as `executeSpend()` (ETH).

```solidity
function executeTokenSpend(
    address token,
    address recipient,
    uint256 amount,
    string calldata category,
    bytes32 attestationId
) external {
    // ...
    _checkTokenVelocity(amount);  // ← Uses separate token bucket
    // ...
}
```

**Issue:** If wallet has $1M in stablecoin, attacker can spend all $1M in a single transaction if velocity limits aren't configured per-token.

**Mitigation:** Velocity limits ARE separate per-token and per-ETH. This is correct design.

---

### HIDDEN-BUG-04: Guardian can only freeze, not unfreeze ⏸️

**Discovery:** Guardian address is set but can only call `freeze()`. Only owner can call `unfreeze()`.

```solidity
function freeze(string calldata reason) external {
    if (msg.sender != owner && msg.sender != guardian) revert WAuth();
    // ...
    frozen = true;
}

function unfreeze() external onlyOwner {
    frozen = false;
}
```

**Risk:** If owner key is compromised, wallet is permanently frozen (guardian can't unfreeze).

**Recommendation:** Change guardian authority:
```solidity
function unfreeze() external {
    if (msg.sender != owner && msg.sender != guardian) revert WAuth();
    // Only guardian unfreezes to avoid owner+attacker cooperation
}
```

---

## Summary: Fixed vs. Remaining Issues

| Bug | Category | Severity | Pre-Launch | Post-Launch |
|-----|----------|----------|-----------|------------|
| BUG-DRAIN-01 | ABI validation | HIGH | 🔴 FIX | ✅ |
| BUG-DRAIN-02 | Architecture | HIGH | 🔴 FIX | ✅ |
| BUG-DRAIN-03 | State mgmt | MEDIUM | 🔴 FIX | ✅ |
| BUG-DRAIN-04 | Onboarding | CRITICAL | 🔴 FIX | ✅ |
| BUG-DRAIN-05 | Infrastructure | MEDIUM | 🔴 FIX | ✅ |
| BUG-DRAIN-06 | UX | MEDIUM | 🔴 FIX | ✅ |
| HIDDEN-BUG-02 | Attestation | MEDIUM | 🔴 FIX | ✅ |
| HIDDEN-BUG-04 | Guardian | MEDIUM | 🟡 CONSIDER | ✅ |

---

## Prioritized Fix List

### 🔴 CRITICAL (P0 — Must fix before mainnet)

**P0-1: BUG-DRAIN-04 — PolicyEngine category configuration**

**Status:** Not fixed (blocks all wallet spending)

**Action:**
1. Add mandatory onboarding ceremony to WalletFactory deployment
2. Enforce PolicyEngine.setCategoryLimitFor() before wallet release
3. Add CLI command: `arc402 wallet deploy --auto-configure`
4. Implement deployment checklist (owned by operator)

**Timeline:** 2 hours (design + implementation)

**Testing:** Unit tests + E2E drain test with fresh wallet

---

**P0-2: BUG-DRAIN-02 — Remove attest() from executeContractCall path**

**Status:** Architecture decision (low risk, high benefit)

**Action:**
1. Document that attest() is direct-callable (already onlyOwnerOrMachineKey)
2. Update drain scripts to call wallet.attest() directly
3. Deprecate executeContractCall path for attest
4. Update SDK/CLI examples to use direct path
5. Add developer guide explaining direct vs. contract call paths

**Timeline:** 1 hour (documentation + script updates)

**Testing:** E2E drain test (already covers this)

---

### 🟠 HIGH (P1 — Fix before launch)

**P1-1: BUG-DRAIN-01 — ABI validation + 6-field struct enforcement**

**Status:** Not implemented (silent failures possible)

**Action:**
1. Add TypeScript ContractCallParams struct definition
2. Create ABI validation helper that checks field count and types
3. Add unit test: verify 4-field tuple rejects with clear error
4. Update wallet-router to validate struct before encoding
5. Add CLI warning if `category` field passed (common mistake)

**Timeline:** 1.5 hours

**Testing:** Unit tests for struct validation

---

**P1-2: BUG-DRAIN-03 — Context cleanup guardrails**

**Status:** Partially fixed (manual closeContext required)

**Action:**
1. Add wallet subcommand: `arc402 wallet check-context`
2. Add wallet subcommand: `arc402 wallet close-context --force`
3. Update drain command to auto-check and auto-close stale context
4. Add context age check in executeSpend (warn after 10 minutes)
5. Add try-finally to drain script ensuring closeContext on error

**Timeline:** 2 hours

**Testing:** E2E tests with intentional failures

---

**P1-3: BUG-DRAIN-06 — Full arc402 wallet drain command**

**Status:** Scripts exist (drain-v4.ts, drain-wallet.ts), not integrated into CLI

**Action:**
1. Implement `arc402 wallet drain` command (see Answer 7 spec above)
2. Pre-flight validation (category configured, machine key authorized)
3. Auto-close stale context
4. Build and sign all 4 transactions
5. Support --dry-run and --output-only
6. Full error handling and recovery suggestions

**Timeline:** 3 hours (implementation + testing)

**Testing:** E2E drain test with fresh wallet

---

**P1-4: BUG-DRAIN-05 — Enforce Alchemy RPC**

**Status:** Public RPC is default (stale state risk)

**Action:**
1. Update config schema to default to Alchemy RPC_URL
2. Add validation: warn if public RPC detected
3. Update documentation with Alchemy RPC requirement
4. Add RPC health check before drain (verify state consistency)

**Timeline:** 30 minutes

**Testing:** Config validation test

---

**P1-5: HIDDEN-BUG-02 — Attestation expiry enforcement**

**Status:** Expiry field exists but not checked at spend time

**Action:**
1. Add expiry check in executeSpend() before consume
2. Revert with "attestation expired" if expiresAt < now
3. Add SDK helper to get attestation expiry
4. Update drain script to set expiresAt = now + 10 minutes (not 60)

**Timeline:** 1 hour

**Testing:** Unit test + E2E test with expired attestation

---

### 🟡 MEDIUM (P2 — Fix before v1.0 feature complete)

**P2-1: Context-binding in attestation (security)**

**Status:** Design decision (enhance protocol security)

**Action:**
1. Modify attest() signature to include contextId parameter
2. Enforce contextId == wallet.activeContextId
3. Bind attestation to specific context (prevent reuse across contexts)
4. Update drain script to pass contextId to attest()

**Timeline:** 2 hours

**Testing:** Unit tests + E2E test verifying context binding

---

**P2-2: Guardian unfreeze authority (operational)**

**Status:** Design issue (owner-only unfreeze, guardian can only freeze)

**Action:**
1. Allow guardian to call unfreeze() (currently owner-only)
2. Update wallet spec documenting guardian authority
3. Add test: guardian can freeze and unfreeze

**Timeline:** 30 minutes

**Testing:** Unit test for guardian freeze/unfreeze

---

**P2-3: Context max age enforcement (UX)**

**Status:** Feature request (prevent stale context spending)

**Action:**
1. Add contextMaxAge mapping (owner-configurable)
2. Check context age in executeSpend: revert if > maxAge
3. Add CLI: `arc402 wallet set-context-max-age --seconds 600`
4. Default: 10 minutes (enforced unless owner disables)

**Timeline:** 1.5 hours

**Testing:** Unit test for age enforcement

---

**P2-4: Minimum category requirement enforcement**

**Status:** Design clarification (requirement exists but not enforced)

**Action:**
1. Add deployment validation: require "general" category > 0
2. Update PolicyEngine.registerWallet() to check for "general" limit
3. Revert if "general" category is zero (force reconfiguration)

**Timeline:** 1 hour

**Testing:** Unit test for category requirement

---

## Timeline & Effort Estimate

| Phase | Tasks | Effort | Days |
|-------|-------|--------|------|
| **P0 (Critical)** | P0-1, P0-2 | 3 hours | 0.5 |
| **P1 (High)** | P1-1 through P1-5 | 9 hours | 1 |
| **P2 (Medium)** | P2-1 through P2-4 | 5 hours | 0.5 |
| **Testing** | E2E full suite | 4 hours | 0.5 |
| **Documentation** | Updated specs + guides | 3 hours | 0.5 |
| **Total** | All fixes | 24 hours | ~2 days |

**Critical path:** P0 must be fixed before ANY wallet is deployed to mainnet. P1 must be fixed before article launch. P2 can follow in v1.1 patch.

---

## Deployment Freeze Recommendation

**Current status:** v4 wallet is OPERATIONAL but HIGH-RISK due to:
1. No category configuration post-deploy (P0-1)
2. Stale context risk (P1-2)
3. ABI validation gaps (P1-1)

**Recommendation:**
- ❌ **DO NOT** deploy new wallets to mainnet until P0 fixes are complete
- ❌ **DO NOT** claim "wallet drain is user-friendly" until P1-6 is complete
- ✅ **v4 wallet can remain operational** (already deployed) but mark as "EXPERIMENTAL"
- ✅ **Proceed with article** once all P0 fixes are in

---

## Next Steps

1. **Immediately (today):**
   - Implement P0-1 (category onboarding ceremony)
   - Implement P0-2 (remove attest from executeContractCall path)
   - Update drain-v4.ts and drain-wallet.ts scripts

2. **This week (before article):**
   - Implement all P1 fixes (6 items)
   - Run full E2E test suite with fresh wallet
   - Update documentation and developer guides

3. **Post-launch (v1.1):**
   - Implement P2 security enhancements
   - Add context-binding and attestation expiry enforcement
   - Enhanced UX guardrails

---

*End of post-mortem audit. Ready for review and fix prioritization.*
