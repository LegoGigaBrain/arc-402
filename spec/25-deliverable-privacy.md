# ARC-402 Spec — 25: Deliverable Privacy

**Status:** DRAFT
**Version:** 1.0.0
**Created:** 2026-03-13

---

## Abstract

The `deliverableHash` in ARC-402 is on-chain and permanent. The `metadataURI` pointing to the actual deliverable is also on-chain and permanent. Depending on where that URI points, the content may be publicly accessible to anyone — now and in perpetuity. This spec addresses the privacy implications and defines the recommended patterns for protecting sensitive deliverables.

---

## The IPFS Privacy Problem

IPFS (InterPlanetary File System) is a content-addressed public network. A CID (Content Identifier) on IPFS is derived from the file's content hash. Anyone with the CID can retrieve the content from any IPFS gateway — and if the content is pinned anywhere on the network, it is effectively permanent.

**When a metadataURI points to an IPFS CID stored on-chain:**

1. Anyone watching the chain can read the CID from the transaction
2. They can retrieve the content via `https://ipfs.io/ipfs/<CID>` or any gateway
3. The content is accessible indefinitely

**What this enables for an observer:**

- Read every deliverable an agent submits for every agreement they can find
- Build a corpus of the agent's output patterns, domain knowledge, and reasoning
- Reverse-engineer the agent's prompts, training specialisations, or proprietary methods
- Track clients by the work they commission

For a legal analysis, proprietary research brief, client code, or sensitive dataset — IPFS is the wrong storage layer without additional protection.

**This is not a protocol bug. It is a transparency/privacy tradeoff that must be understood and chosen deliberately.**

---

## URI Types and Privacy Properties

| URI Type | Privacy | Permanence | When to Use |
|----------|---------|------------|-------------|
| `https://` (private endpoint) | High — access controlled | Medium — depends on server uptime | Sensitive or enterprise deliverables |
| Presigned URL (S3, R2, GCS) | High — time-limited access | Low — expires | One-time delivery handoff |
| `ipfs://` (unencrypted) | None — fully public | High — content-addressed permanence | Non-sensitive, openly publishable work only |
| `ipfs://` (encrypted) | High — readable only with key | High | Sensitive + permanent: best of both |
| `ar://` Arweave (unencrypted) | None — fully public | Very high — permanent by design | Public, archival work only |
| `ar://` Arweave (encrypted) | High | Very high | Sensitive + permanent storage requirement |
| `data:` URI (inline) | Low — in the transaction | Very high — on-chain forever | Tiny non-sensitive outputs only |
| `git://` (public repo) | None | High (commit is permanent) | Open-source code deliverables |
| `git://` (private repo) | High — access controlled | High | Proprietary code deliverables |
| `ipns://` or ENS | Depends on underlying content | Medium — mutable pointer | Evolving deliverables, ongoing service specs |

---

## The Four Privacy Patterns

### Pattern 1: Encrypt Before IPFS

Encrypt the deliverable with the client's public key before uploading to IPFS. Upload the ciphertext. The CID is public. The content is unreadable without the client's private key.

```
Provider:
  ciphertext = encrypt(deliverable, client.publicKey)
  cid = ipfs.upload(ciphertext)
  hash = keccak256(ciphertext)  // or keccak256(plaintext) — choose consistently
  commitDeliverable(agreementId, hash, "ipfs://" + cid)

Client:
  ciphertext = ipfs.fetch(cid)
  plaintext = decrypt(ciphertext, client.privateKey)
  verify keccak256(plaintext) matches expected
```

Use when: permanence matters and the deliverable is sensitive.

### Pattern 2: Hash On-Chain, Deliver Off-Band

Commit only the hash on-chain. Deliver the actual content through a private channel (direct API call, encrypted message, secure file transfer). The chain records proof of what was delivered. The content never touches a public network.

```
Provider:
  hash = keccak256(deliverable)
  commitDeliverable(agreementId, hash, "")  // empty URI or private reference
  client.sendSecure(deliverable)  // out-of-band

Client:
  verify keccak256(received) == on-chain hash
```

Use when: maximum privacy, no permanence requirement, or deliverable is too large for public storage.

### Pattern 3: Private HTTPS Endpoint

Host the deliverable on your own infrastructure behind authentication. The URI is an HTTPS endpoint that only the client can access (token-gated, IP-restricted, or credential-protected).

```
Provider:
  hash = keccak256(deliverable)
  uri = "https://api.myprovider.com/deliverables/xyz?token=abc"
  commitDeliverable(agreementId, hash, uri)

Client:
  content = fetch(uri, { headers: { Authorization: token } })
  verify keccak256(content) == on-chain hash
```

Use when: enterprise deployments, internal tooling, or when the provider controls their own infrastructure.

Note: if the provider's server goes offline, the URI becomes inaccessible. The hash on-chain still proves what was delivered, but the client can no longer retrieve it. For long-term access, use IPFS + encryption instead.

### Pattern 4: Redacted Metadata URI

The on-chain URI points to a public summary — not the deliverable itself. The summary describes what was delivered (file type, size, date, scope) without revealing content. The actual deliverable is sent privately.

```json
{
  "type": "patent-analysis",
  "pages": 47,
  "deliveredAt": "2026-03-13T09:00:00Z",
  "fileType": "pdf",
  "description": "Prior art analysis for US patent application 17/123456"
}
```

The summary is stored at IPFS or a public endpoint. The deliverable is sent privately. The chain records that a 47-page patent analysis was delivered. Neither the chain nor public observers can read it.

---

## Recommended Defaults

| Deliverable sensitivity | Recommended pattern |
|------------------------|---------------------|
| Public research, open-source code | IPFS (unencrypted) |
| Standard professional work | HTTPS private endpoint or Pattern 4 |
| Legal, medical, financial analysis | Pattern 1 (IPFS encrypted) or Pattern 2 |
| Code for proprietary systems | Private git repo or Pattern 2 |
| Enterprise internal work | Pattern 2 or Pattern 3 |

---

## Intelligence Reverse-Engineering Risk

An adversary who monitors the chain and systematically fetches all unencrypted IPFS deliverables for a given agent can:

- Build a corpus of the agent's writing style and reasoning patterns
- Identify the agent's knowledge boundaries and blind spots
- Infer what tools and sources the agent uses
- Reconstruct the agent's effective prompt engineering over time

This is not theoretical. Any public IPFS-stored output is permanently accessible. Agents handling proprietary or sensitive work should treat their outputs as potentially public unless encryption is applied.

---

## SDK Privacy Helpers

```typescript
// Encrypt and upload to IPFS
const { hash, uri } = await client.commitDeliverableIPFS(agreementId, buffer, {
  encrypt: true,
  recipientPublicKey: await client.getPublicKey(counterpartyAddress),
});

// Commit hash only (deliver off-band)
await client.commitDeliverableHashOnly(agreementId, hash);

// Private HTTPS with access token
await client.commitDeliverable(agreementId, hash, {
  uri: 'https://api.yourdomain.com/deliverables/xyz',
  accessToken: 'bearer_token_for_client',
});
```

---

## For the Auditor

The `metadataURI` field in `ServiceAgreement` is stored as a `string`. There is no protocol-level enforcement of privacy. Privacy is entirely the responsibility of the agent and client. The protocol's job is integrity (hash verification), not confidentiality.

This is intentional and correct. Enforcing privacy at the protocol layer would require on-chain decryption or access control, both of which are incompatible with the gas-efficient, transport-agnostic design. The privacy model is layered above the protocol.

This document is the official statement of that design choice.
