# ARC-402 OpenClaw Plugin — Architecture Review

**Date:** 2026-03-23
**Reviewer:** Claude Opus 4.6
**Scope:** plugin/src/**, spec/42, spec/38, workroom/entrypoint.sh
**Verdict:** Structurally sound. Nine missing tools, one critical security gap, several medium issues.

---

## Findings

---

### PLG-1
**Severity:** CRITICAL
**Title:** Delivery routes have no party-gated access control
**Description:** `plugin/src/routes/delivery.ts` serves files at `GET /job/:id/files/:name` and `POST /job/:id/upload` with zero authentication. The workroom daemon's equivalent routes enforce `verifyPartyAccess()` (EIP-191 signature verification, per spec/38 §8). The plugin routes are reachable by anyone who can hit the gateway — any agent (or crawler) can download deliverables or upload arbitrary files to any job directory. The comment on line 5 explicitly says "Replaces FileDeliveryManager HTTP surface from the daemon" — but it dropped the access control that surface provides.
**Recommendation:** Port `verifyPartyAccess()` to the plugin delivery routes. Require an `Authorization: ARC402-Sig <signature>` header on all `/job/` routes. At minimum, verify the caller is a party to the agreement referenced by the job ID.

---

### PLG-2
**Severity:** HIGH
**Title:** Nine tools from Spec 42 §5B are missing
**Description:** The spec defines ~51 tools across 11 domains. The plugin implements ~42. Missing tools:

| Domain | Missing Tool | Spec §5B Name |
|--------|-------------|----------------|
| Hiring | cancel hire | `arc402_cancel` |
| Compute | withdraw escrow | `arc402_compute_withdraw` |
| Compute | publish GPU offer | `arc402_compute_offer` |
| Compute | find GPU offers | `arc402_compute_discover` |
| Subscriptions | create plan (provider-side) | `arc402_subscription_create` |
| Subscriptions | check subscription state | `arc402_subscription_status` |
| Subscriptions | find subscriptions | `arc402_subscription_discover` |
| Disputes | resolve/accept arbitration | `arc402_dispute_resolve` |
| System | run config migration | `arc402_migrate` |

The commit message and index.ts both claim "50 tools covering full CLI" but the actual count is ~42.
**Recommendation:** Implement the 9 missing tools. Most can follow the existing shell-delegation pattern (`execSync("arc402 ...")`). Update the commit message / plugin description to match actual count.

---

### PLG-3
**Severity:** HIGH
**Title:** Plugin config allows raw private key in JSON — no encryption or vault reference
**Description:** `openclaw.plugin.json` configSchema accepts `privateKey` and `machineKey` as plain string fields. While `config.ts:78-87` supports an `env:VAR_NAME` indirection pattern, nothing prevents (or warns against) writing the raw hex key directly into the config file. This file is likely committed to dotfiles or synced by OpenClaw, making key leakage probable.
**Recommendation:** (1) Reject raw hex keys at config resolution time — require `env:` prefix or a new `vault:` / `keystore:` scheme. (2) Add a validation warning in `arc402_doctor` that flags raw keys in config. (3) Document the `env:` pattern prominently in SKILL.md §4 (Security Contract).

---

### PLG-4
**Severity:** HIGH
**Title:** No authentication on inbound POST routes
**Description:** Routes in `hire.ts`, `compute.ts`, and `dispute.ts` accept POST requests (e.g., `POST /hire`, `POST /compute/propose`, `POST /dispute`) with no signature verification, API key check, or origin validation. Any network-reachable caller can inject fake hire proposals, forge compute session starts, or fabricate disputes into the in-memory stores. These routes are the plugin's "inbox" — they must verify the sender is the on-chain counterparty.
**Recommendation:** Require signed payloads on all inbound POST routes. Verify the signature recovers to the `client` address in the payload and that the agreement/session exists on-chain.

---

### PLG-5
**Severity:** MEDIUM
**Title:** In-memory state stores have no persistence or eviction
**Description:** `hire.ts`, `compute.ts`, and `dispute.ts` routes store protocol state in `Map<>` objects that survive only as long as the plugin process. A gateway restart loses all pending hires, active compute sessions, and disputes. No TTL or eviction — a busy agent accumulates unbounded entries.
**Recommendation:** Either (1) persist to `~/.arc402/plugin-state.json` with periodic flush, or (2) treat the in-memory maps as a cache and re-derive state from on-chain data on startup. Add a TTL/max-size eviction policy.

---

### PLG-6
**Severity:** MEDIUM
**Title:** Delivery routes operate on host filesystem, not workroom filesystem
**Description:** `delivery.ts` reads/writes `~/.arc402/jobs/:id/files/` on the **host**. But the workroom spec (spec/38) says deliverables live at `~/.arc402/deliveries/<agreement-id>/` **inside the container**, served by the daemon with party-gated access. The plugin and workroom use different paths and different storage locations for the same concept. This means: (a) files delivered by the workroom are not visible via plugin routes, and (b) files uploaded via the plugin are not visible inside the workroom.
**Recommendation:** Clarify the delivery model: either the plugin proxies to the workroom daemon for delivery operations (preferred — maintains single source of truth and access control), or the plugin only handles deliveries for non-workroom jobs (host-only hiring). Document which path applies when.

---

### PLG-7
**Severity:** MEDIUM
**Title:** Config dual-source-of-truth with ~/.arc402/config.json
**Description:** The plugin defines its own config schema in `openclaw.plugin.json` with fields that overlap `~/.arc402/config.json` (network, wallet address, contract addresses, keys). The CLI reads from `~/.arc402/config.json`; the plugin reads from OpenClaw's plugin config system. Shell-delegated tools (`negotiate`, `dispute`, `agent`, `endpoint`, etc.) invoke the CLI, which reads the **CLI config**, not the plugin config. If these diverge (e.g., user sets `base-sepolia` in plugin but CLI config says `base-mainnet`), shell-delegated tools operate on a different network than direct-contract tools.
**Recommendation:** Either (1) have `resolveConfig()` write a synchronized `~/.arc402/config.json` on every resolution, or (2) pass `--network`, `--wallet`, etc. as explicit flags to every CLI invocation so the plugin config is authoritative. Option 2 is cleaner.

---

### PLG-8
**Severity:** MEDIUM
**Title:** wallet_status exposes machine address to tool output
**Description:** `wallet.ts:49-56` derives the machine address from the private key and includes it in the tool result. While this is the *public* address (not the key itself), exposing it in tool output means it flows into the LLM context and potentially into logs, chat history, or MCP transport. The machine address is operationally sensitive — it can be used to correlate the agent's on-chain identity with its off-chain infrastructure.
**Recommendation:** Redact `machineAddress` from default output. Show it only when a `--verbose` or `showMachineAddress: true` parameter is passed.

---

### PLG-9
**Severity:** MEDIUM
**Title:** Shell command injection surface in CLI-delegating tools
**Description:** Tools in `negotiate.ts`, `dispute.ts`, `agent.ts`, `endpoint.ts`, `trust.ts`, `workroom.ts`, `arena.ts`, `channel.ts`, and `system.ts` construct shell commands via string interpolation and execute with `execSync`. While there is a `quote()` helper for argument escaping, a single missed call or a bypass in the quoting logic (e.g., null bytes, multi-byte sequences) could allow command injection from LLM-supplied tool parameters. The attack surface is the LLM itself — a prompt-injected agent could craft malicious parameters.
**Recommendation:** Switch from `execSync(cmdString)` to `execFileSync("arc402", [...args])` (array form), which avoids shell interpretation entirely. This eliminates the injection surface regardless of quoting correctness.

---

### PLG-10
**Severity:** LOW
**Title:** Workroom tools correctly delegate — no boundary violation
**Description:** All 10 workroom tools (`workroom_init`, `workroom_start`, `workroom_stop`, etc.) delegate to `arc402 workroom ...` CLI commands. None attempt to run Docker commands directly, manipulate iptables, or access workroom-internal paths. The plugin correctly stays on the host side of the boundary.
**Recommendation:** None — this is correct. Noting for completeness.

---

### PLG-11
**Severity:** LOW
**Title:** SKILL.md is accurate and comprehensive
**Description:** The bundled `plugin/skill/SKILL.md` correctly describes: (1) all three billing primitives (ServiceAgreement, ComputeAgreement, SubscriptionAgreement), (2) RegistryV3 at `0x6EafeD4F...`, (3) USDC/ERC-20 support, (4) file delivery with party-gated access, (5) workroom architecture with iptables enforcement, execution receipts, and worker identity, (6) key separation (owner vs agent/machine key). The skill correctly tells agents that hired work executes in the workroom, not on the host.
**Recommendation:** None — this is correct.

---

### PLG-12
**Severity:** LOW
**Title:** Route path overlap between plugin and workroom daemon is safe
**Description:** The plugin registers routes on the OpenClaw gateway (host process). The workroom daemon listens on port 4402 inside the container, reached via Cloudflare tunnel. Both expose `/job/:id/files/:name`, but on different network paths: gateway routes handle host-side requests; tunnel routes hit the workroom daemon. No port conflict occurs because the Cloudflare tunnel terminates at the container's 4402, not the gateway. However, the semantic overlap is confusing (see PLG-6).
**Recommendation:** See PLG-6. Consider removing delivery routes from the plugin entirely if the workroom daemon is the authoritative file server.

---

### PLG-13
**Severity:** LOW
**Title:** Sepolia contract addresses are empty strings
**Description:** `config.ts:36-41` defines `SEPOLIA_CONTRACTS` with all addresses set to `""`. Any tool invoked with `network: "base-sepolia"` will attempt contract calls to address `0x0000...`, which will silently fail or revert with unhelpful errors.
**Recommendation:** Either populate Sepolia addresses or throw a clear error: `"base-sepolia not yet supported — set network to base-mainnet"`.

---

### PLG-14
**Severity:** INFO
**Title:** Two extra workroom tools beyond Spec 42
**Description:** The plugin implements `arc402_workroom_worker_init` and `arc402_workroom_policy_reload`, which are not listed in Spec 42 §5B. Both are useful operational tools — `worker_init` creates named workers, `policy_reload` hot-reloads policy without restart.
**Recommendation:** Add these to the spec in the next revision to keep spec and implementation aligned.

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 1 |
| HIGH | 3 |
| MEDIUM | 5 |
| LOW | 4 |
| INFO | 1 |

**Priority fixes:**
1. **PLG-1** — Add `verifyPartyAccess()` to delivery routes (CRITICAL)
2. **PLG-4** — Add signature verification to all inbound POST routes (HIGH)
3. **PLG-3** — Reject raw private keys in config (HIGH)
4. **PLG-2** — Implement 9 missing tools (HIGH)
5. **PLG-9** — Switch to `execFileSync` array form (MEDIUM)

**Architectural verdict:** The plugin correctly maintains the host/workroom boundary (PLG-10). The two-tier tool pattern (direct contract + shell delegation) is reasonable but creates a config sync risk (PLG-7). The biggest issue is the delivery routes replacing the daemon's file server without porting its access control (PLG-1).
