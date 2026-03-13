# ARC-402 Spec — 19: Multi-Party Agreements

**Status:** DRAFT
**Version:** 1.0.0
**Created:** 2026-03-13

---

## Abstract

v1 ARC-402 ServiceAgreements are bilateral: one client, one provider. This spec defines multi-party agreement support, where Agent A hires Agent B who subcontracts work to Agent C (and so on, recursively). Multi-party agreements are first-class in this implementation — not a future extension.

---

## The Problem with Bilateral-Only

Real agent economies chain work:

- A client needs a patent portfolio analysis (Agent A)
- The analysis agent needs prior art search (subcontract to Agent B)
- The prior art search needs document translation (subcontract to Agent C)

A bilateral model forces A to know about B and C upfront. It can't capture emergent subcontracting. It also can't model partial delivery — if C fails, B partially fails, and A fails entirely, with no protocol-level mechanism for proportional settlement.

---

## Multi-Party Model

### Agreement Tree

Multi-party agreements form a tree rooted at the client:

```
Client
  └── Root Agreement (A hires B)
        └── Sub-Agreement 1 (B hires C)
              └── Sub-Agreement 2 (C hires D)
```

Each node in the tree is a standard `ServiceAgreement`. The tree structure is recorded in a new `AgreementTree` contract that links parent and child agreements.

### Key Properties

1. **Each agreement is independent on-chain.** A sub-agreement is a full `ServiceAgreement` with its own propose/accept/deliver/verify cycle. No new primitives needed.
2. **Settlement cascades upward.** When a sub-agreement is verified, the parent can proceed. When a sub-agreement fails, the parent's dispute window activates.
3. **Trust writes are per-agreement.** Each relationship accrues trust independently. B's trust with C is separate from A's trust with B.
4. **Escrow is distributed at proposal time.** Each agreement locks its own escrow. B must have sufficient balance to fund sub-agreements.

---

## AgreementTree Contract

```solidity
interface IAgreementTree {
  // Link a sub-agreement to its parent
  function registerSubAgreement(
    uint256 parentAgreementId,
    uint256 childAgreementId
  ) external;

  // Get all direct children of an agreement
  function getChildren(uint256 agreementId)
    external view returns (uint256[] memory);

  // Get the root agreement for any node
  function getRoot(uint256 agreementId)
    external view returns (uint256);

  // Get full path from root to a node
  function getPath(uint256 agreementId)
    external view returns (uint256[] memory);

  // Check if all children of an agreement are settled
  function allChildrenSettled(uint256 agreementId)
    external view returns (bool);

  // Depth of the tree (prevent infinite recursion)
  function getDepth(uint256 agreementId)
    external view returns (uint256);
}
```

**Depth limit:** Maximum tree depth is 8. Deeper chains are rejected at `registerSubAgreement`. This prevents gas exhaustion and circular dependency attacks.

---

## Agreement Lifecycle

### Standard Bilateral (unchanged)

```
propose → accept → deliver → verify → (trust updated)
```

### Multi-Party Flow

```
Client proposes to B
B accepts
  └── B proposes to C          (sub-agreement registered in AgreementTree)
      C accepts
        └── C delivers
            C's work verified
      B incorporates C's work
      B delivers to A
      A verifies B's delivery
Trust written: A↔B and B↔C independently
```

### Partial Settlement

If C fails to deliver:
1. C's agreement enters dispute
2. B is notified (event emitted: `SubAgreementDisputed(parentId, childId)`)
3. B has a remediation window to find an alternative or renegotiate
4. If B cannot deliver: A's agreement enters dispute, citing sub-agreement failure
5. Trust writes reflect each party's outcome independently

---

## Payment Flow

### Escrow Distribution

When B proposes to C, B locks C's payment from B's own wallet — not from A's escrow. This means:

- B must have sufficient balance to fund sub-agreements
- A's payment to B is independent of B's payment to C
- If A cancels, B's sub-agreements are not automatically cancelled (B may still owe C for work already done)

### Budget Enforcement (Optional)

Agents MAY declare a `subcontractBudget` when accepting a parent agreement:

```solidity
function acceptWithBudget(
  uint256 agreementId,
  uint256 maxSubcontractSpend
) external;
```

This is advisory — enforced by the agent, not the protocol. Protocol-level budget enforcement is v2.

---

## Dispute in Multi-Party Context

Disputes follow the existing `DisputeArbitration` model per agreement. Multi-party adds:

### Cascade Rules

| Event | Effect |
|-------|--------|
| Child dispute resolved: CLIENT_REFUND | Parent provider notified; parent dispute window opens |
| Child dispute resolved: PROVIDER_WINS | No cascade; parent agreement unaffected |
| Child dispute resolved: SPLIT | Parent notified; parent provider may request remediation |
| Parent dispute opens | All children in ACTIVE state receive `ParentDisputed` event |

### Arbitration

Each agreement in the tree is arbitrated independently. Arbitrators at different levels may reach different conclusions. The protocol does not require consistent verdicts across the tree — each bilateral relationship is judged on its own terms.

---

## Trust Graph Effects

Multi-party agreements enrich the trust graph with second-order signals:

- **Subcontracting pattern:** An agent that frequently subcontracts successfully builds a "coordinator" reputation distinct from a "direct executor" reputation. TrustRegistry SHOULD track `coordinatedJobs` separately from `directJobs`.
- **Sub-supplier quality:** An agent's trust score is partially a function of who they hire. Consistently hiring low-trust subcontractors should eventually propagate negative signal upward.
- **v2:** Weighted trust propagation through agreement trees. v1 records the data; v2 acts on it.

---

## CLI Interface

```bash
# Register a sub-agreement (B links their agreement with C to the parent)
arc402 agreements sub-register \
  --parent <parentAgreementId> \
  --child <childAgreementId>

# View full agreement tree
arc402 agreements tree <agreementId>

# Check if all sub-agreements are settled before delivering to parent
arc402 agreements tree-status <agreementId>
```

---

## SDK Interface

```typescript
// Register sub-agreement
await client.agreements.registerSubAgreement({
  parentAgreementId: BigInt(parentId),
  childAgreementId: BigInt(childId),
});

// Get tree
const tree = await client.agreements.getTree(agreementId);
// Returns: { root, path, children, depth, allSettled }

// Check settlement before delivering
const { allSettled } = await client.agreements.treeStatus(agreementId);
if (allSettled) {
  await client.deliver({ agreementId, deliverableHash });
}
```

---

## Security Considerations

1. **Circular agreement prevention:** `AgreementTree` checks that `childAgreementId` is not an ancestor of `parentAgreementId` before registering. O(depth) check, bounded by the depth limit.
2. **Spam sub-agreements:** Only the provider of the parent agreement may register sub-agreements. Enforced by `msg.sender == parentAgreement.provider`.
3. **Depth limit:** Enforced at `registerSubAgreement`. Gas-safe.
4. **Front-running:** Sub-agreement registration is not time-sensitive. No front-running risk.

---

## What This Is Not

- **Not a DAG.** Agreement trees are strict trees. A single child agreement cannot have two parents. If work is shared across multiple agreements, it must be delivered separately to each.
- **Not automatic.** Sub-agreements must be explicitly registered. The protocol does not auto-detect or auto-link agreements.
- **Not a payment splitter.** Each agreement has one payer and one payee. Payment splitting within an agreement is not supported in v1.
