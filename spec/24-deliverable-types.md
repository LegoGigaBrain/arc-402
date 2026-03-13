# ARC-402 Spec — 24: Deliverable Types

**Status:** DRAFT
**Version:** 1.0.0
**Created:** 2026-03-13

---

## Abstract

ARC-402 is delivery-agnostic. The protocol commits a hash of whatever was delivered and a URI pointing to where it lives. What the deliverable actually is — a document, a codebase, a dataset, an API endpoint — is entirely open. This spec catalogues supported delivery patterns and when to use each.

**Design principle:** The `deliverableHash` is the integrity layer. The `metadataURI` is logistics. These are decoupled by design.

---

## How Delivery Works in the Protocol

When a provider completes work:

1. They produce the deliverable (whatever form it takes)
2. They compute `keccak256(deliverable)` — the integrity hash
3. They store the deliverable at a URI of their choice
4. They call `commitDeliverable(agreementId, hash, metadataURI)`
5. The hash and URI are permanently on-chain

When the client verifies:
1. They retrieve the deliverable from the URI
2. They compute `keccak256(retrieved_content)` 
3. They compare to the on-chain hash — if they match, the deliverable is authentic
4. They evaluate quality — if satisfied, `verifyDeliverable()` releases escrow

The chain records what was delivered. Where it lives is the provider's choice.

---

## Supported Deliverable Types

### Text and Documents

| Format | Use case |
|--------|----------|
| Plain text | Simple outputs, summaries, briefs |
| Markdown | Structured documents, reports, specifications |
| JSON | Structured data, API responses, configuration |
| PDF | Formal reports, legal documents, client-facing deliverables |
| DOCX / ODT | Editable documents for human review |
| HTML | Web content, formatted reports |

Hash the raw bytes of the file. URI points to where the file is stored.

### Code

| Format | Use case |
|--------|----------|
| Single file | Scripts, contracts, components |
| `.zip` / `.tar.gz` archive | Full codebases, multi-file projects |
| Git commit hash | Code deliverables pinned to exact repository state |
| Container image digest | Deployable software with all dependencies |

For code: the hash can cover either the archive or the git commit hash (which itself is a content hash). Git URI format: `git://github.com/org/repo#commitSHA` — the commit SHA ties the delivery to an immutable snapshot.

### Data

| Format | Use case |
|--------|----------|
| CSV / TSV | Tabular data, research results |
| JSON / JSONL | Structured datasets, model outputs |
| Parquet | Large-scale analytical datasets |
| Database dump | Full schema + data snapshots |
| IPFS dataset | Large datasets with content-addressed permanence |

For large datasets: hash a manifest file (list of file hashes + sizes) rather than the full data. The manifest becomes the verifiable root. Individual files are verified against the manifest.

### Media

| Format | Use case |
|--------|----------|
| Images (PNG, JPG, SVG) | Design work, generated assets, charts |
| Audio (MP3, WAV, FLAC) | Voice synthesis, audio processing, music |
| Video (MP4, WebM) | Video generation, edited content |
| 3D (GLB, FBX, OBJ) | 3D models, rendered scenes |

Hash the binary file directly. URI points to storage (HTTPS endpoint, IPFS with encryption if sensitive).

### API Endpoints

For ongoing service agreements or session channel work, the "deliverable" may be:

- An API endpoint the client can call
- A deployed contract address
- A running service with an SLA

In these cases, `deliverableHash` covers a spec document (endpoint URL, authentication method, expected response format) rather than the service output. The hash proves the provider delivered what was agreed, not the entire service history.

### Composite Deliverables

Complex projects often involve multiple file types. Options:

1. **Archive:** Bundle everything into a `.zip`, hash the archive
2. **Manifest:** Hash a JSON manifest listing all component file hashes
3. **AgreementTree:** Use multi-party agreement structure — each sub-deliverable has its own hash and agreement, the parent agreement collects them

---

## The Null Deliverable

For purely on-chain operations (deploying a contract, executing a transaction, configuring a protocol parameter), the deliverable may be a transaction hash:

```json
{
  "type": "transaction",
  "chainId": 8453,
  "txHash": "0x...",
  "description": "Deployed Vlossom escrow contract"
}
```

`deliverableHash = keccak256(JSON.stringify(this object))`

The transaction hash is independently verifiable on-chain. The protocol records the proof of work.

---

## Deliverable Size Considerations

| Size | Recommended approach |
|------|---------------------|
| < 1KB | Data URI — inline in the transaction |
| 1KB – 10MB | HTTPS endpoint or IPFS (encrypted if sensitive) |
| 10MB – 1GB | IPFS (encrypted), S3/R2 presigned URL, or Arweave |
| > 1GB | Chunked + manifest, torrent, or direct transfer |

Large deliverables should never be stored in calldata. Hash the content, store the content elsewhere.

---

## What the Protocol Does Not Dictate

- How the deliverable is transmitted to the client
- What format the client expects (that's negotiated off-chain in the service agreement spec)
- Whether the deliverable is encrypted
- How long the URI remains accessible
- What the client does with the deliverable after verification

These are commercial terms, not protocol rules. Providers and clients agree on them during negotiation.

---

## For Developers

The SDK provides helpers for common patterns:

```typescript
// Hash any buffer
const hash = await client.hashDeliverable(buffer);

// Hash a file
const hash = await client.hashDeliverableFile('/path/to/output.zip');

// Commit with IPFS upload (encrypted)
const { hash, uri } = await client.commitDeliverableIPFS(
  agreementId,
  buffer,
  { encrypt: true, recipientPublicKey: client.publicKey }
);

// Commit with HTTPS endpoint
const { hash } = await client.commitDeliverable(
  agreementId,
  hash,
  'https://api.myprovider.com/deliverables/xyz'
);
```
