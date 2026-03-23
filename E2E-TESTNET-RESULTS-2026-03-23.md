# E2E Testnet Results — ComputeAgreement on Base Sepolia
**Date:** 2026-03-23
**Contract:** `0x975afa11b9107a6467c7A04C80C2BAd92a405cA0`
**Chain:** Base Sepolia (84532)
**RPC:** https://sepolia.base.org
**Deployer/Client:** `0x59A32A792d0f25B0E0a4A4aFbFDf514b94B102fB`
**Provider (ephemeral test wallet):** `0x9e7A25e88d13e38dc1f8df929B43b3305aCf866B`

---

## Test 3: Read Contract Constants

| Constant | Raw | Decoded |
|---|---|---|
| `PROPOSAL_TTL()` | `0x2a300` | 172800 seconds = **48 hours** |
| `DISPUTE_TIMEOUT()` | `0x93a80` | 604800 seconds = **168 hours** |
| `arbitrator()` | — | `0x59A32A792d0f25B0E0a4A4aFbFDf514b94B102fB` ✓ |

**Result: PASS**

---

## Test 1: Full ETH Session Lifecycle

### Pre-flight: SelfDealing Guard (CA-9)

Before the main flow, a `proposeSession` using the same address for both client and provider was attempted:

```
cast send 0x975afa11b9107a6467c7A04C80C2BAd92a405cA0 \
  "proposeSession(bytes32,address,uint256,uint256,bytes32,address)" \
  $SESSION_ID $DEPLOYER_ADDRESS 5000000000000000 2 $(cast keccak "test-gpu-spec") 0x0000...0000 \
  --value 0.01ether ...
```

**Result:** Reverted with `SelfDealing` (selector `0x74ca9bd8`) — CA-9 protection confirmed working.

A fresh provider wallet was generated for the remainder of Test 1:
- Provider address: `0x9e7A25e88d13e38dc1f8df929B43b3305aCf866B`
- Funded with 0.005 ETH for gas (TX: `0xc2831872cf73c5e446d80595b81e8201ad0c65f78608918d5c75a3429eb06f5a`, Status: SUCCESS)

**Session ID:** `0x8838502f9d2a8223c4b49bd60b39a98cc5d53f6b64768c875131b777fba0b85e`

---

### Step 1: proposeSession

**Command:**
```bash
cast send 0x975afa11b9107a6467c7A04C80C2BAd92a405cA0 \
  "proposeSession(bytes32,address,uint256,uint256,bytes32,address)" \
  0x8838502f9d2a8223c4b49bd60b39a98cc5d53f6b64768c875131b777fba0b85e \
  0x9e7A25e88d13e38dc1f8df929B43b3305aCf866B \
  5000000000000000 2 $(cast keccak "test-gpu-spec") \
  0x0000000000000000000000000000000000000000 \
  --value 0.01ether --rpc-url https://sepolia.base.org --private-key $DEPLOYER_PRIVATE_KEY
```

**TX Hash:** `0x39d455c3b375ba76790f3b8faed116ddbff05c505385a457c4c22d99da8b7d21`
**Status: SUCCESS**

---

### Step 2: acceptSession (provider)

**Command:**
```bash
cast send 0x975afa11b9107a6467c7A04C80C2BAd92a405cA0 \
  "acceptSession(bytes32)" \
  0x8838502f9d2a8223c4b49bd60b39a98cc5d53f6b64768c875131b777fba0b85e \
  --rpc-url https://sepolia.base.org --private-key $PROVIDER_KEY
```

**TX Hash:** `0x19970249d288b40f86e424ccb8ef93048616fac4477b15cffc6b1be78ea533e8`
**Status: SUCCESS**

---

### Step 3: startSession (provider)

**Command:**
```bash
cast send 0x975afa11b9107a6467c7A04C80C2BAd92a405cA0 \
  "startSession(bytes32)" \
  0x8838502f9d2a8223c4b49bd60b39a98cc5d53f6b64768c875131b777fba0b85e \
  --rpc-url https://sepolia.base.org --private-key $PROVIDER_KEY
```

**TX Hash:** `0x4984aca5c6e953a63053b745d11ba0536781e3afaea353acd2052440e54e7dd9`
**Status: SUCCESS**

---

### Step 4: getSession — Decoded State

**Command:**
```bash
cast call 0x975afa11b9107a6467c7A04C80C2BAd92a405cA0 \
  "getSession(bytes32)" \
  0x8838502f9d2a8223c4b49bd60b39a98cc5d53f6b64768c875131b777fba0b85e \
  --rpc-url https://sepolia.base.org
```

**Decoded `ComputeSession` struct:**

| Field | Value |
|---|---|
| `client` | `0x59A32A792d0f25B0E0a4A4aFbFDf514b94B102fB` ✓ |
| `provider` | `0x9e7A25e88d13e38dc1f8df929B43b3305aCf866B` ✓ |
| `token` | `address(0)` (ETH) ✓ |
| `ratePerHour` | 5000000000000000 wei = 0.005 ETH/hr ✓ |
| `maxHours` | 2 ✓ |
| `depositAmount` | 10000000000000000 wei = 0.01 ETH ✓ |
| `startedAt` | 1774237178 |
| `endedAt` | 0 (active) ✓ |
| `consumedMinutes` | 0 (no usage reports) ✓ |
| `proposedAt` | 1774237150 |
| `disputedAt` | 0 (no dispute) ✓ |
| `gpuSpecHash` | `0x3b36c43bb17d33dd60f79f07ffa4e7320c749335b43da73ff292dd8516cbebee` ✓ |
| `status` | `1` = `Active` ✓ |

**Result: PASS** — Session Active, startedAt set, all fields correct.

---

### Step 5: endSession (client)

**Command:**
```bash
cast send 0x975afa11b9107a6467c7A04C80C2BAd92a405cA0 \
  "endSession(bytes32)" \
  0x8838502f9d2a8223c4b49bd60b39a98cc5d53f6b64768c875131b777fba0b85e \
  --rpc-url https://sepolia.base.org --private-key $DEPLOYER_PRIVATE_KEY
```

**TX Hash:** `0x8266379717e7198e7754eb27d4da45f4f7ceaaba3526294288d8e22ac28f5389`
**Status: SUCCESS**

---

### Step 6: pendingWithdrawals

**Command:**
```bash
cast call 0x975afa11b9107a6467c7A04C80C2BAd92a405cA0 \
  "pendingWithdrawals(address,address)" \
  0x59A32A792d0f25B0E0a4A4aFbFDf514b94B102fB \
  0x0000000000000000000000000000000000000000 \
  --rpc-url https://sepolia.base.org
```

**Raw:** `0x000000000000000000000000000000000000000000000000002386f26fc10000`
**Decoded:** 10000000000000000 wei = **0.01 ETH**

**Result: PASS** — Full deposit refunded to client (consumedMinutes=0, provider earned nothing). Pull-payment pattern (CA-1) confirmed.

---

### Step 7: withdraw

**Command:**
```bash
cast send 0x975afa11b9107a6467c7A04C80C2BAd92a405cA0 \
  "withdraw(address)" \
  0x0000000000000000000000000000000000000000 \
  --rpc-url https://sepolia.base.org --private-key $DEPLOYER_PRIVATE_KEY
```

**TX Hash:** `0xf30626436c7b29023a8f68826027bcd08cfec1ccd1e0d5feb20361dadc68fc02`
**Status: SUCCESS**

**Test 1 Result: PASS** — Full ETH session lifecycle completed successfully. All 7 steps succeeded.

---

## Test 2: Cancel after TTL

**Session ID:** `0x8b7e383a283f6014d1552d8c72ac4d5804af6e2775928fb73960aead86fe1dc2`

### Step 1: proposeSession (dummy provider = address(1))

**Command:**
```bash
cast send 0x975afa11b9107a6467c7A04C80C2BAd92a405cA0 \
  "proposeSession(bytes32,address,uint256,uint256,bytes32,address)" \
  0x8b7e383a283f6014d1552d8c72ac4d5804af6e2775928fb73960aead86fe1dc2 \
  0x0000000000000000000000000000000000000001 \
  5000000000000000 2 $(cast keccak "test-gpu") \
  0x0000000000000000000000000000000000000000 \
  --value 0.01ether --rpc-url https://sepolia.base.org --private-key $DEPLOYER_PRIVATE_KEY
```

**TX Hash:** `0xb11426799e233e3948cf5fe17305b5b6b3215b21420a1fcec296e4ffff5ac960`
**Status: SUCCESS**

### Step 2: getSession — Confirmed Proposed State

**Decoded fields:**

| Field | Value |
|---|---|
| `client` | `0x59A32A792d0f25B0E0a4A4aFbFDf514b94B102fB` ✓ |
| `provider` | `0x0000000000000000000000000000000000000001` ✓ |
| `depositAmount` | 10000000000000000 wei = 0.01 ETH ✓ |
| `proposedAt` | 1774237296 |
| `status` | `0` = `Proposed` ✓ |

### Step 3: cancelSession immediately (should FAIL)

**Command:**
```bash
cast send 0x975afa11b9107a6467c7A04C80C2BAd92a405cA0 \
  "cancelSession(bytes32)" \
  0x8b7e383a283f6014d1552d8c72ac4d5804af6e2775928fb73960aead86fe1dc2 \
  --rpc-url https://sepolia.base.org --private-key $DEPLOYER_PRIVATE_KEY
```

**Result:** Reverted with `ProposalNotExpired` (selector `0x8251df30`) — TTL guard (CA-3) confirmed working.

**Test 2 Result: PASS** — Session correctly rejects early cancellation. PROPOSAL_TTL=48h enforced.

---

## Test 4: calculateCost (post-endSession)

**Command:**
```bash
cast call 0x975afa11b9107a6467c7A04C80C2BAd92a405cA0 \
  "calculateCost(bytes32)" \
  0x8838502f9d2a8223c4b49bd60b39a98cc5d53f6b64768c875131b777fba0b85e \
  --rpc-url https://sepolia.base.org
```

**Raw:** `0x0000000000000000000000000000000000000000000000000000000000000000`
**Decoded:** 0 wei

**Test 4 Result: PASS** — calculateCost returns 0 when consumedMinutes=0 (no usage reports submitted).

---

## Summary

| Test | Description | Result |
|---|---|---|
| 1 | Full ETH session lifecycle (propose → accept → start → end → withdraw) | **PASS** |
| 2 | Cancel before PROPOSAL_TTL (ProposalNotExpired guard) | **PASS** |
| 3 | Read contract constants (PROPOSAL_TTL, DISPUTE_TIMEOUT, arbitrator) | **PASS** |
| 4 | calculateCost = 0 with no usage reports | **PASS** |
| CA-9 | SelfDealing guard rejects client==provider | **PASS** |

**All tests passed. No failures.**

### Security Properties Verified
- **CA-1** Pull-payment pattern — no push ETH in endSession ✓
- **CA-3** Session expiry — ProposalNotExpired enforced ✓
- **CA-9** Self-dealing prevented — SelfDealing error on client==provider ✓

### Notes
- Provider wallet needed explicit ETH funding for gas (new wallet starts at 0 balance — expected on testnet).
- The `acceptSession` transitions status directly to `Active`; `startSession` sets `startedAt` while keeping status `Active`.
- Full deposit refund confirmed when `consumedMinutes == 0`.
