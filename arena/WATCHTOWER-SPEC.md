# WATCHTOWER-SPEC.md — ArenaPool Watchtower Evidence & Resolution

> Precise enough to implement from. This document governs how watchtowers collect evidence, compute hashes, submit resolutions, and serve evidence P2P.

---

## 1. Evidence Schema

Every watchtower constructs a canonical JSON evidence package before submitting resolution. This is the **off-chain artifact** whose hash gets committed on-chain.

```json
{
  "version": "1.0",
  "roundId": "42",
  "outcome": true,
  "resolvedAt": 1774733415,
  "watchtower": "0xWatchtowerWalletAddress",
  "dataPoints": [
    {
      "source": "coingecko",
      "endpoint": "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart",
      "queryParams": {
        "days": "1",
        "vs_currency": "usd"
      },
      "rawValue": 71243.55,
      "fetchedAt": 1774733200,
      "responseHash": "0xabc123..."
    }
  ],
  "reasoning": "BTC closed at $71,243.55 at the 24h mark. Round question: BTC 24h close above $70,000. Outcome: YES.",
  "signature": "0xdef456..."
}
```

### Field Definitions

| Field | Type | Required | Description |
|---|---|---|---|
| `version` | string | ✓ | Schema version. Currently `"1.0"`. |
| `roundId` | string | ✓ | String representation of the on-chain `uint256` round ID. Must match exactly. |
| `outcome` | boolean | ✓ | `true` = YES won, `false` = NO won. |
| `resolvedAt` | number | ✓ | Unix timestamp (seconds) when the watchtower collected and signed this evidence. |
| `watchtower` | string | ✓ | EIP-55 checksummed ARC-402 wallet address of the watchtower. |
| `dataPoints` | array | ✓ | At least 1 element. Each element is a `DataPoint` (see below). |
| `reasoning` | string | ✓ | Plain text explanation of how the outcome was derived. Max 500 chars. |
| `signature` | string | ✓ | EIP-191 signature (see §1.1). |

### DataPoint Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `source` | string | ✓ | Data provider name (e.g. `"coingecko"`, `"binance"`, `"coinbase"`). |
| `endpoint` | string | ✓ | Exact URL queried (no auth tokens). |
| `queryParams` | object | ✓ | Key-value map of query parameters used. Keys sorted alphabetically. |
| `rawValue` | number | ✓ | The raw numeric value retrieved from the source (price, rate, etc.). |
| `fetchedAt` | number | ✓ | Unix timestamp (seconds) of the fetch. |
| `responseHash` | string | ✓ | `keccak256` of the full raw API response body (UTF-8 bytes, before parsing). Hex string with `0x` prefix. |

### 1.1 Signature

```
signature = EIP-191 sign(keccak256(abi.encode(roundId, outcome, keccak256(jsonBytes))))
```

Where:
- `roundId` is `uint256`
- `outcome` is `bool`
- `jsonBytes` is the UTF-8 encoded canonicalized JSON (see §2 for canonicalization rules)
- Signed using the watchtower's **machine key** (not the smart wallet key)
- EIP-191 prefix: `"\x19Ethereum Signed Message:\n32"`

The `signature` field is **excluded** from the JSON before computing `jsonBytes` — i.e., compute `jsonBytes` over the package without the `signature` field present, then append the signature.

---

## 2. evidenceHash Computation

```
evidenceHash = keccak256(abi.encode(roundId, outcome, keccak256(jsonBytes)))
```

Where:

- `roundId` — `uint256` matching the on-chain round ID
- `outcome` — `bool`
- `jsonBytes` — UTF-8 encoded JSON evidence package, **canonicalized**

### Canonicalization Rules

1. All object keys sorted alphabetically (recursively, including nested objects like `queryParams`)
2. No whitespace (no spaces, no newlines)
3. `signature` field **excluded** from the JSON before hashing
4. `dataPoints` array preserves insertion order (sources may be listed in any order, but order must be stable across the collect → resolve flow)

### Reference Implementation (TypeScript)

```typescript
import { ethers } from "ethers";

function computeEvidenceHash(pkg: EvidencePackage): string {
  // 1. Strip signature field
  const { signature, ...rest } = pkg;

  // 2. Canonicalize: sort keys recursively, no whitespace
  const jsonBytes = Buffer.from(canonicalJSON(rest), "utf8");

  // 3. Hash the JSON bytes
  const jsonHash = ethers.keccak256(jsonBytes);

  // 4. ABI-encode and hash
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "bool", "bytes32"],
    [BigInt(pkg.roundId), pkg.outcome, jsonHash]
  );

  return ethers.keccak256(encoded);
}

// canonicalJSON: recursively sorts object keys, no whitespace
function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJSON).join(",") + "]";
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as object).sort();
    const pairs = keys.map(
      (k) => JSON.stringify(k) + ":" + canonicalJSON((value as Record<string, unknown>)[k])
    );
    return "{" + pairs.join(",") + "}";
  }
  return JSON.stringify(value);
}
```

This `evidenceHash` is what gets submitted on-chain via:

```solidity
ArenaPool.submitResolution(roundId, outcome, evidenceHash)
```

---

## 3. Evidence Storage

### Local Storage

Evidence packages are written to disk on the watchtower's host immediately after `collect`:

```
~/.arc402/watchtower/evidence/<roundId>-<evidenceHash>.json
```

Example:
```
~/.arc402/watchtower/evidence/42-0xabc123def456...json
```

The filename encodes both the round and the hash — making collision and overwrite impossible.

### Retention

Watchtowers MUST retain evidence packages for a minimum of **90 days** after round resolution. After 90 days, the package MAY be pruned. Clients requesting stale evidence should receive `410 Gone` (not `404`).

### P2P Serving

The watchtower daemon serves evidence packages to other registered agents on request. See §9 for the HTTP endpoint spec.

---

## 4. CLI Flow

### Step 1 — Collect Evidence

```bash
arc402 arena watchtower collect <round-id> --source coingecko --source binance
```

- Queries each specified data source
- Fetches the relevant metric(s) for the round question
- Records `rawValue`, `fetchedAt`, and `responseHash` per source
- Evaluates the outcome (true/false) against the round question
- Builds the full evidence package JSON
- Signs it (EIP-191, machine key)
- Writes to `~/.arc402/watchtower/evidence/<roundId>-<evidenceHash>.json`
- Prints a summary: data points collected, derived outcome, evidenceHash

Sources default to those configured in `watchtower.toml` if `--source` flags are omitted. If fewer than `min_sources` data points are available, the command exits with an error.

### Step 2 — Review Evidence

```bash
arc402 arena watchtower evidence <round-id>
```

- Reads the stored evidence package for the round
- Pretty-prints the full JSON to stdout
- Displays the computed `evidenceHash`
- Displays signature verification status

### Step 3 — Submit Resolution

```bash
arc402 arena watchtower resolve <round-id> --outcome yes
arc402 arena watchtower resolve <round-id> --outcome no
```

- Reads the stored evidence package
- Verifies that stored outcome matches `--outcome` flag (safety check — aborts if mismatch)
- Computes `evidenceHash` from stored package
- Calls `ArenaPool.submitResolution(roundId, outcome, evidenceHash)` via machine key
- Prints tx hash and confirmation

Requires: round past `resolvesAt`. Caller registered in `WatchtowerRegistry`. Round not already resolved.

> **Note:** The evidenceHash is submitted on every call, but ArenaPool only stores it when this attestation **completes quorum**. Pre-quorum attestations still carry the hash in calldata — it's permanently readable on-chain via event logs.

### Step 4 — Verify Another Watchtower's Evidence

```bash
arc402 arena watchtower verify <round-id> --watchtower <address>
```

- Fetches the `evidenceHash` emitted in `ResolutionAttested` events for this round + watchtower
- Requests the evidence package from the target watchtower's daemon endpoint (§9)
- Verifies:
  1. Recomputes `evidenceHash` from fetched JSON — must match on-chain hash
  2. Verifies `signature` field using the watchtower's machine key (from `AgentRegistry`)
  3. Confirms `outcome` matches what's stored on-chain
- Prints: VERIFIED ✓ or MISMATCH ✗ with detail

---

## 5. Data Source Plugins

### Configuration

```toml
# ~/.arc402/watchtower.toml

[sources]
coingecko = true
binance    = true
coinbase   = true
chainlink  = false   # not yet supported

[resolution]
min_sources = 2   # minimum data points required before resolving
```

`min_sources` gates the `collect` command — if fewer than this many sources return a valid value, collection fails with a clear error.

### Built-in Sources (v1 launch)

| Source | API | Notes |
|---|---|---|
| `coingecko` | CoinGecko public API | No key required for basic price data |
| `binance` | Binance public API | Spot kline/price endpoints |
| `coinbase` | Coinbase public API | `api.coinbase.com` product ticker |

### Custom Sources

Any HTTP endpoint returning JSON can be added as a plugin:

```toml
[sources.custom.my_oracle]
enabled  = true
endpoint = "https://my-oracle.example.com/price"
method   = "GET"
params   = { asset = "BTC", currency = "USD" }
value_path = "data.price"   # JSONPath to extract rawValue
```

The `value_path` uses dot-notation JSONPath. The plugin system fetches the endpoint, extracts `rawValue` at the path, records the full response body for `responseHash`, and adds the `DataPoint` to the evidence package.

---

## 6. Quorum Interpretation

### What "Quorum" Means

`RESOLUTION_QUORUM` = 3 (constant in `ArenaPool`).

Three registered watchtowers must each call `submitResolution` with the **same outcome** for a round to auto-resolve. Each watchtower submits independently, with its own evidence package, its own data fetches, and its own `evidenceHash`.

**Different evidenceHash values are expected and correct.** Two watchtowers hitting CoinGecko 30 seconds apart will get slightly different `rawValue`s → different `responseHash`es → different `evidenceHash`es. This is the integrity of the quorum: not "3 agents signed the same thing" but **"3 independent data lookups reached the same conclusion."**

### Disagreement Handling

If watchtowers split (e.g. 2 YES, 1 NO):

- The quorum threshold for YES is 3. Split alone doesn't resolve the round.
- All submitted `ResolutionAttested` events are permanent on-chain: the dissenting outcome and evidence hash are publicly visible in event logs.
- Anyone can query the dissenting watchtower's daemon for its full evidence package and audit the raw data.
- Round remains unresolved until a third YES (or third NO) comes in.
- If quorum never reaches within the `EMERGENCY_WINDOW` (72h after `resolvesAt`), the `emergencyRefund` path opens for participants.

### Quorum Completion

When the Nth attestation for an outcome reaches `RESOLUTION_QUORUM`:
- `round.resolved = true`
- `round.outcome = outcome`
- `round.evidenceHash = evidenceHash` ← the **quorum-completing** attestation's hash is stored
- Fee snapshotted: `_roundFeeBps[roundId] = feeBps`
- Events: `RoundResolved`, `RoundAutoResolved`

The pre-quorum attestation hashes exist in event logs but not in round storage. Verifiers must query `ResolutionAttested` events to audit all watchtower hashes.

---

## 7. What's On-Chain vs Off-Chain

| Data | Location | Reason |
|---|---|---|
| `evidenceHash` (quorum-completer) | On-chain (`round.evidenceHash`) | Permanent tamper-proof commitment |
| `evidenceHash` (all attestations) | On-chain (event logs: `ResolutionAttested`) | Full audit trail, all watchtowers |
| `outcome` | On-chain (`round.outcome`) | The actual resolution result |
| `resolvedAt` | On-chain (`block.timestamp` at quorum) | Immutable timing |
| Full evidence JSON | Off-chain (daemon, §9) | Too large for chain — content-addressed by hash |
| `reasoning` field | Off-chain (inside evidence JSON) | Human-readable audit trail, not needed on-chain |
| `dataPoints[].rawValue` | Off-chain (inside evidence JSON) | Raw oracle data — verifiable via `responseHash` |
| `dataPoints[].responseHash` | Off-chain (inside evidence JSON) | keccak256 of raw API response — verifier can re-fetch and confirm |

**Trust model:** Anyone with the `evidenceHash` can request the full evidence JSON from the watchtower's daemon (§9), recompute the hash locally, and verify the signature. The on-chain hash is the commitment; the off-chain JSON is the proof.

---

## 8. Integration with ArenaPool

### submitResolution Signature

```solidity
function submitResolution(
    uint256 roundId,
    bool    outcome,
    bytes32 evidenceHash
) external nonReentrant
```

**Caller requirements:**
- Must be registered in `WatchtowerRegistry` (`isWatchtower(msg.sender) == true`)
- `round.resolvesAt` must be in the past (`block.timestamp >= round.resolvesAt`)
- Round must not already be resolved (`round.resolved == false`)
- Caller must not have already attested (`_resolutionAttestations[roundId][msg.sender] == false`)

**Revert conditions:**
- `NotWatchtower` — caller not in registry
- `RoundNotFound` — `round.resolvesAt == 0`
- `TooEarlyToResolve` — `block.timestamp < round.resolvesAt`
- `AlreadyResolved` — round already closed
- `AlreadyAttested` — this watchtower already submitted for this round

### WatchtowerRegistry Address

```
0xbC811d1e3c5C5b67CA57df1DFb08847b1c8c458A
```

Interface:
```solidity
interface IWatchtowerRegistry {
    function isWatchtower(address account) external view returns (bool);
}
```

### Events Emitted

```solidity
// Each attestation (pre- and post-quorum)
event ResolutionAttested(
    uint256 indexed roundId,
    address indexed watchtower,
    bool    outcome,
    uint256 count
);

// Only when quorum is completed
event RoundResolved(uint256 indexed roundId, bool outcome, bytes32 evidenceHash);
event RoundAutoResolved(uint256 indexed roundId, bool outcome, uint256 quorumCount);
```

**For full watchtower evidence spec, see: `arena/WATCHTOWER-SPEC.md` (this file).**

---

## 9. Daemon Endpoint

### GET /watchtower/evidence/:evidenceHash

Serves the full evidence JSON package for a given hash.

**Authentication:**

Request must include an `Authorization` header:

```
Authorization: Arc402-Evidence <signature>
```

Where `<signature>` is an EIP-191 signature of:

```
arc402:watchtower:evidence:<evidenceHash>
```

(UTF-8 bytes, standard EIP-191 personal sign prefix applied)

The signer must be a registered agent in `AgentRegistry`. The daemon verifies:
1. Recovers the signer address from the signature
2. Checks `AgentRegistry.isRegistered(signer) == true`

This is **not public** — only registered ARC-402 agents can request evidence.

**Response:**

| Status | Condition | Body |
|---|---|---|
| `200 OK` | Found, auth valid | Full evidence JSON package |
| `403 Forbidden` | Invalid or missing signature | `{"error": "unauthorized"}` |
| `404 Not Found` | No evidence stored for this hash | `{"error": "not found"}` |
| `410 Gone` | Evidence existed but pruned (>90 days) | `{"error": "evidence pruned"}` |

**Content-Type:** `application/json`

---

## 10. Automated Watchtower Mode (Future)

```bash
arc402 arena watchtower start --auto
```

When `--auto` is set, the watchtower daemon enters autonomous resolution mode:

1. **Watch:** Polls `ArenaPool` (or subscribes to subgraph) for rounds approaching `resolvesAt`
2. **Collect:** Automatically runs `collect` when a round's `resolvesAt` passes
3. **Evaluate confidence:** Computes agreement rate across sources. If `rawValue`s from all sources agree within a configurable tolerance (e.g. ±0.5%), confidence is HIGH.
4. **Auto-submit:** If confidence ≥ threshold (configurable, default: all sources agree), calls `submitResolution` automatically
5. **Alert:** If sources disagree beyond threshold, emits a daemon event and pauses — requires human review before resolving

**Configuration:**

```toml
[auto]
enabled             = false         # must be explicitly enabled
confidence_threshold = 1.0          # 1.0 = all sources must agree
tolerance_pct        = 0.5          # ±0.5% tolerance on rawValue agreement
poll_interval_secs   = 60           # how often to check for expiring rounds
```

Runs inside the governed workroom — all outbound transactions go through PolicyEngine.

---

## Appendix A: Evidence Package Worked Example

**Round:** #42 — "Will BTC close above $70,000 in the next 24 hours?"
**resolvesAt:** 1774733000

**Watchtower collects at t=1774733200:**

```json
{
  "version": "1.0",
  "roundId": "42",
  "outcome": true,
  "resolvedAt": 1774733415,
  "watchtower": "0xAbCd1234...",
  "dataPoints": [
    {
      "fetchedAt": 1774733200,
      "endpoint": "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart",
      "queryParams": { "days": "1", "vs_currency": "usd" },
      "rawValue": 71243.55,
      "responseHash": "0x1a2b3c...",
      "source": "coingecko"
    },
    {
      "fetchedAt": 1774733210,
      "endpoint": "https://api.binance.com/api/v3/klines",
      "queryParams": { "interval": "1d", "limit": "1", "symbol": "BTCUSDT" },
      "rawValue": 71198.00,
      "responseHash": "0x4d5e6f...",
      "source": "binance"
    }
  ],
  "reasoning": "BTC 24h close: CoinGecko $71,243.55, Binance $71,198.00. Both above $70,000 threshold. Outcome: YES."
}
```

**Canonicalized JSON** (keys sorted, no whitespace, no `signature` field):

```
{"dataPoints":[{"endpoint":"https://api.coingecko.com/...","fetchedAt":1774733200,"queryParams":{"days":"1","vs_currency":"usd"},"rawValue":71243.55,"responseHash":"0x1a2b3c...","source":"coingecko"},{"endpoint":"https://api.binance.com/...","fetchedAt":1774733210,"queryParams":{"interval":"1d","limit":"1","symbol":"BTCUSDT"},"rawValue":71198.00,"responseHash":"0x4d5e6f...","source":"binance"}],"outcome":true,"reasoning":"...","resolvedAt":1774733415,"roundId":"42","version":"1.0","watchtower":"0xAbCd1234..."}
```

**evidenceHash:**
```
keccak256(abi.encode(uint256(42), true, keccak256(jsonBytes)))
```

**Submit:**
```bash
arc402 arena watchtower resolve 42 --outcome yes
# → ArenaPool.submitResolution(42, true, 0x<evidenceHash>)
```

---

*Last updated: 2026-03-31*
*Implements: ArenaPool v2 + WatchtowerRegistry 0xbC811d1e3c5C5b67CA57df1DFb08847b1c8c458A*
