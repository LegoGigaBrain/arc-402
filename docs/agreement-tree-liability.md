# AgreementTree: Liability Chain in v1

This document defines the liability model for multi-party agreement chains in ARC-402 v1. Read this before using AgreementTree in production.

---

## What AgreementTree Tracks

`AgreementTree` records parent/child relationships between `ServiceAgreement` IDs. When Agent B (hired by A) subcontracts to Agent C, B registers the new agreement as a child of the A↔B agreement:

```
Agreement A↔B  (parent)
└── Agreement B↔C  (child)
```

Maximum depth: 8 levels. Only the provider of a parent agreement can register sub-agreements under it.

---

## Liability is Bilateral Per Agreement Link

**In v1, each agreement link is an independent bilateral contract.** Liability does not flow across links.

### Does Agent A have direct recourse against Agent C if C fails?

**No.** A has a contract with B only. If C fails to deliver to B, that is a breach of the B↔C agreement. A's recourse is against B — not against C. A cannot call `dispute()` on the B↔C agreement, cannot submit evidence in it, and cannot receive a payout from it.

The liability chain:
- A → enforces against B (via the A↔B ServiceAgreement)
- B → enforces against C (via the B↔C ServiceAgreement)

The two disputes are **independent**. B resolving a dispute with C does not automatically resolve B's dispute with A.

### Does Agent A know C exists?

A can discover subcontracting by querying:

```solidity
AgreementTree.getChildren(agreementId_AB)
// returns [agreementId_BC, ...]
```

This reveals the existence of B↔C and its agreement ID. A can then query `ServiceAgreement.getAgreement(agreementId_BC)` to see the provider (C), price, and status of that sub-agreement.

**However, A cannot enforce against C directly, even knowing C exists.** Visibility is read-only. A is not a party to the B↔C agreement.

### Can A's PolicyEngine see subcontracting risk before hiring B?

**No.** PolicyEngine evaluates B's trust score at hire time (`ServiceAgreement.propose()`) using B's current `TrustRegistry` score. PolicyEngine has no visibility into:
- Whether B intends to subcontract
- Who B's subcontractors are
- What trust scores B's subcontractors hold

PolicyEngine operates on the direct counterparty (B), not on B's dependency chain.

### What happens if C fails and B cannot deliver?

1. C fails to deliver → B is unable to fulfil its agreement with A.
2. B is in breach of the A↔B agreement.
3. A may open a dispute against B via `ServiceAgreement.dispute(agreementId_AB)`.
4. B may simultaneously open a dispute against C via `ServiceAgreement.dispute(agreementId_BC)`.
5. The two disputes are processed independently by separate arbitration panels.
6. B receiving a favourable arbitration outcome in the B↔C dispute does **not** automatically resolve the A↔B dispute — B must still fulfil or settle separately with A.

There is no cross-chain atomicity in v1.

---

## Explicit v1 Scope Statement

Multi-party agreements in v1 create chains of bilateral agreements. Each link is independent. Enforcement flows up the chain, not across it:

- A enforces against B. B enforces against C. These are separate proceedings.
- A payout from C does not automatically flow to A.
- A failure by C does not automatically excuse B's obligation to A.
- Subcontracting visibility (via `getChildren`) is informational, not enforceable from A's position.

---

## v2 Planned Extensions

The following capabilities are planned for v2 and are **not** present in v1:

- **Direct recourse:** Allow A to trigger a claim directly against C when B is insolvent or unresponsive.
- **Cross-chain policy evaluation:** PolicyEngine evaluating B's subcontractor trust scores at hire time, not just B's own score.
- **Atomicity:** A resolution at one level of the chain propagating to adjacent levels automatically.

Until v2, operators who require direct recourse against subcontractors must negotiate that right out-of-band or use a single flat agreement with all parties.
