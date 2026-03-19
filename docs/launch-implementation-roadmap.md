# ARC-402 Launch Implementation Roadmap
*Status: Active*
*Owner: Engineering (Forge)*
*Created: 2026-03-19*

---

## 1. Architecture truth to preserve

These are locked truths for launch implementation. Every doc, CLI surface, and validation pass should preserve them.

### Runtime layer — ARC-402 governed workroom
- ARC-402 runtime fully runs inside an OpenShell-backed sandbox.
- `arc402 daemon start` is the operator command, but for launch it starts the ARC-402 governed workroom rather than a separate standalone daemon product.
- The daemon, its worker processes, and the selected harness all inherit the same sandbox policy.
- OpenShell is the machine safety boundary underneath ARC-402 runtime, not a replacement for protocol endpoint behavior.

### Endpoint layer — public ingress
- Public reachability is a separate layer from runtime execution.
- Launch default is **host-managed Cloudflare Tunnel outside the sandbox**.
- Canonical public endpoint shape is `https://<agentname>.arc402.xyz`.
- Public ingress points at a host-level ingress target that forwards to the correct local ARC-402 surface; it does **not** make the sandbox itself the public boundary.

### Outbound policy layer — sandbox allowlist
- Sandbox outbound traffic is independently controlled by OpenShell policy.
- Another ARC-402 agent is treated like any other external host from the sandbox’s perspective.
- No wildcard `*.arc402.xyz` trust by default.
- Peer-agent HTTPS calls require explicit allowlist entries.

### Operator policy layer — presets and toggles
- Operators need human-readable policy presets rather than raw YAML-only thinking.
- Launch should expose preset/toggle mental models:
  - core protocol only
  - peer-agent HTTPS allowlist
  - model/API expansion pack
  - custom business API additions
- CLI and docs must clearly distinguish public ingress setup from outbound runtime permission.

---

## 2. Launch roadmap in build order

## Phase 1 — OpenShell premium hardening
**Goal:** make ARC-402 feel like one product with a dedicated commerce sandbox, not three glued tools.

### Done already
- `arc402 openshell init` provisions the ARC-402 CLI runtime bundle into the sandbox.
- `arc402 daemon start` launches against the provisioned in-sandbox runtime.
- CLI config secrets can be reused for provider setup.
- `arc402 openshell status` verifies remote runtime bundle presence.

### Remaining build items
1. **Doctor / proof UX**
   - Add `arc402 openshell doctor` if MacBook validation shows remaining ambiguity.
   - Report Docker, OpenShell, sandbox, provider, runtime bundle, and daemon readiness in one pass.
2. **Provider/secret hardening**
   - Validate update/recovery paths when machine key or Telegram credentials change.
   - Verify behavior when only partial credentials exist.
3. **Remote state bridge validation**
   - Prove the in-sandbox daemon config/state/log paths behave cleanly across restart.
   - Confirm logs and PID behavior stay operator-readable.
4. **Launch-safe error wording**
   - Every failure should say which layer is broken: Docker, OpenShell, sandbox, runtime sync, or daemon boot.

### Exit criteria
- Clean from-scratch init on PC and MacBook.
- Status/doctor can prove readiness without manual SSH reasoning.
- Restart/resync path is stable.

---

## Phase 2 — Endpoint / tunnel CLI
**Goal:** make canonical public endpoint setup first-class instead of ad hoc.

### Required launch commands
1. `arc402 endpoint init`
   - Scaffold endpoint config for `agentname.arc402.xyz`
   - Record chosen hostname, local ingress target, and tunnel mode
   - Default to host-managed Cloudflare Tunnel
2. `arc402 endpoint status`
   - Verify hostname, DNS/tunnel, local ingress target, daemon health, and registered AgentRegistry endpoint all match
3. `arc402 endpoint claim <agentname>`
   - Combine subdomain claim + local config lock + optional AgentRegistry endpoint wiring
4. `arc402 endpoint doctor`
   - Diagnose the exact broken layer:
     - subdomain claim
     - DNS/Cloudflare
     - tunnel process
     - local host ingress target
     - daemon/runtime
     - AgentRegistry metadata mismatch

### Design rules
- Endpoint config lives at the public-ingress layer, not inside outbound sandbox policy.
- Host-managed tunnel is launch default.
- Support alternate tunnel placement later, but do not blur launch truth.
- `agent register` should prefer endpoint config references over manual raw endpoint strings once endpoint CLI lands.

### Exit criteria
- Operator can claim, verify, and troubleshoot `agentname.arc402.xyz` without stitching five tools together.

---

## Phase 3 — Policy UX
**Goal:** turn sandbox policy from raw YAML management into operator-safe presets and toggles.

### Required launch outputs
1. **Core preset**
   - Base RPC
   - ARC-402 relay
   - bundler
   - Telegram
   - zero peer wildcard access
2. **Peer-agent toggle**
   - add/remove one named peer endpoint at a time
   - no `*.arc402.xyz`
3. **Harness/API expansion preset**
   - OpenAI
   - Anthropic
   - search APIs
   - optional custom APIs
4. **Clear CLI language**
   - ingress ≠ outbound policy
   - public registration ≠ sandbox trust

### First usable commands now implemented
- `arc402 openshell policy concepts`
- `arc402 openshell policy preset core-launch|harness|search|all`
- `arc402 openshell policy preset-remove harness|search|all`
- `arc402 openshell policy peer add|remove|list <host>`
- `arc402 openshell policy add|remove|list` remains as the advanced escape hatch

### Exit criteria
- Operators can reason in presets/toggles instead of editing YAML blindly.
- Docs include examples for core-only, peer-agent, and harness/API modes.

---

## Phase 4 — MacBook validation
**Goal:** validate the premium install story on a truly clean machine.

### Validation script
1. Install Docker
2. Install OpenClaw / ARC-402 skill
3. Run `arc402 daemon init`
4. Run `arc402 openshell init`
5. Verify `arc402 openshell status`
6. Start the governed workroom with `arc402 daemon start`
7. Validate logs/status
8. Validate passkey web flow from the same operator journey
9. Validate host-managed endpoint path
10. Record every friction point and convert each into doc/CLI fixes

### Required outputs
- MacBook validation notes
- exact blockers
- any doctor/preset/wording fixes required before launch

### Exit criteria
- A clean MacBook install works without founder hand-holding.

---

## Phase 5 — GitHub polish order
**Goal:** present launch work cleanly and in a sequence that mirrors the architecture.

### Commit / PR order
1. **Architecture + roadmap docs**
   - roadmap doc
   - PRD integration
   - spec/skill wording corrections
2. **CLI wording / safety alignment**
   - daemon/OpenShell copy
   - agent/endpoint language
   - policy wording split
3. **Endpoint CLI scaffold**
   - config + status + claim + doctor
4. **Policy UX presets/toggles**
   - first-class commands and docs
5. **MacBook validation fixes**
   - doctor polish, setup ergonomics, troubleshooting
6. **Public repo polish**
   - README nav
   - getting started
   - launch checklist
   - generated artifact cleanup plan

### Repo hygiene order
- Separate generated artifacts from intentional source/docs changes.
- Keep launch-scope architecture edits reviewable on their own.
- Do not mix endpoint CLI implementation with unrelated contract/runtime churn.

---

## 3. What can be implemented safely now

### Safe now
- Roadmap artifact and PRD integration
- Spec/skill/doc corrections that reinforce the clarified architecture
- CLI copy updates that distinguish:
  - sandboxed runtime
  - public endpoint registration
  - outbound allowlist policy
  - operator presets/toggles

### Needs dedicated implementation
- endpoint command family
- tunnel health inspection and doctoring
- policy preset engine / named toggle persistence
- MacBook clean-room validation pass
- deeper remote daemon IPC/status bridge for in-sandbox runtime introspection

---

## 4. Immediate next build sequence

1. Merge roadmap + PRD + launch-copy corrections
2. Implement endpoint CLI scaffold (`init`, `status`, `claim`, `doctor`)
3. Implement policy presets / peer-agent allowlist helpers
4. Run MacBook validation from clean install
5. Apply validation fixes
6. Do GitHub polish and launch checklist pass

---

## 5. Current blockers requiring dedicated implementation

- No first-class endpoint namespace yet for canonical host-managed ingress setup.
- No doctor command yet that spans Docker → OpenShell → runtime sync → daemon → endpoint layers.
- No preset/toggle UX yet for peer-agent allowlists and harness/API expansions.
- MacBook validation has not yet been rerun from a clean install.
- Remote daemon status still exposes only a thin OpenShell-aware shell instead of full in-sandbox status parity.

---

## 6. Definition of success for this phase

This phase is complete when the repo has:
- a concrete launch implementation roadmap
- PRD alignment to that roadmap
- corrected launch-facing wording across CLI/docs/skill surfaces
- a clear next build order for endpoint CLI, policy UX, MacBook validation, and GitHub polish
