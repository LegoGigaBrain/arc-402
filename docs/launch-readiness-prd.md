# ARC-402 Launch Readiness PRD
*Status: Active*
*Owner: Engineering (Forge)*
*Created: 2026-03-19*

---

## 1. Purpose

This document is the working launch-readiness PRD for ARC-402.

It exists to turn the current state of the protocol, CLI, SDKs, web onboarding, OpenClaw/OpenShell runtime, docs, and GitHub-facing materials into a single tracked plan that can be updated until launch.

This is not a vision doc. It is an execution tracker.

Companion roadmap: `docs/launch-implementation-roadmap.md`

---

## 2. Current truths

### Already true
- ARC-402 v1, v2, v3, v4, and active v5 are live on Base mainnet.
- Launch docs now frame ARC-402 as one product with OpenShell underneath as runtime safety infrastructure.
- Launch web hub, onboarding, passkey pages, and signing pages are live.
- Device E2E for the onboarding path has been completed once already.
- Phase 2 items remain excluded from launch:
  - Privy / email / social onboarding
  - gas sponsorship / paymaster path

### Still true
- We need a clean, explicit launch-readiness pass across docs, runtime, setup, and GitHub-facing surfaces.
- Current PC setup has progressed, but the clean-room validation pass still matters more than local familiarity.
- We still need a from-scratch OpenClaw/OpenShell setup validation path, especially for the MacBook install.
- Tunnel / endpoint architecture is now decision-locked, but the endpoint/tunnel CLI does not yet exist as a first-class operator surface.
- Inter-agent endpoint reachability and sandbox outbound policy now have clear launch rules, but still need first-class UX and validation.

---

## 3. Launch objective

Ship a launch-ready ARC-402 experience where an operator can:

1. understand what ARC-402 is and is not
2. choose a clear onboarding path
3. deploy and configure an ARC-402 wallet
4. register a passkey and approve governance actions
5. run the ARC-402 governed workroom through OpenClaw on the operator machine
6. register an agent and participate in protocol flows
7. understand supported payment/agreement patterns
8. verify setup from docs without founder hand-holding

---

## 4. Launch paths we must support clearly

### Path A — Mobile-first onboarding
Best for operators who want the fastest path to a wallet and passkey.

Flow:
1. open `app.arc402.xyz/onboard`
2. deploy wallet
3. register passkey
4. optionally apply policy
5. optionally register agent
6. continue into OpenClaw/OpenShell operator setup

### Path B — CLI-first onboarding
Best for technical operators who want to start from local runtime and config.

Flow:
1. install CLI / OpenClaw
2. configure ARC-402 locally
3. deploy or connect wallet
4. use mobile pages for passkey-related signing when needed
5. initialize OpenShell runtime path
6. start the ARC-402 runtime

### Requirement
README and getting-started docs must present these as explicit choices, not an implied single route.

---

## 5. Definition of launch-ready

ARC-402 is launch-ready when all of the following are true:

### Product truth
- [ ] README accurately explains ARC-402 as a singular product, launch scope, and onboarding choices
- [ ] docs explain every launch-scope feature with scenarios
- [ ] phase 2 and post-launch boundaries are explicit everywhere

### Runtime truth
- [ ] OpenShell install/init/status flow is tested locally on PC
- [ ] OpenShell install/init/status flow is tested from scratch on MacBook
- [ ] `arc402 openshell init` provisions the ARC-402 runtime bundle into the sandbox without manual copy steps
- [ ] daemon startup works through the OpenShell-owned path using the provisioned in-sandbox bundle
- [ ] daemon restart behavior preserves OpenShell wrapping and runtime provisioning
- [ ] policy extension flow is documented and tested

### Operator truth
- [ ] mobile onboarding path is documented end to end
- [ ] CLI-first operator path is documented end to end
- [ ] passkey-sign approval flow is documented end to end
- [ ] agent registration path is documented with real endpoint requirements

### Protocol truth
- [ ] CLI command surface is aligned with launch-scope protocol actions
- [ ] SDKs are aligned with current deployed protocol surface
- [ ] docs do not overclaim unsupported payment primitives
- [ ] launch-safe examples exist for one-time, recurring, multi-step, escrow, and API/session patterns

### GitHub truth
- [ ] repo diff is cleaned and intentional
- [ ] generated artifacts are separated from meaningful changes
- [ ] GitHub-facing docs are coherent enough for first public readers
- [ ] launch checklist exists and is current

---

## 5A. Locked launch architecture decisions

### D1 — Tunnel placement
**Recommendation:** support both host-mode and sandbox-mode in the long run, but ship **host-managed tunnel as the launch default**.

Why host default:
- Cloudflare Tunnel is infrastructure, not agent work. It should survive daemon restarts, harness crashes, and sandbox reprovisioning.
- Host-managed tunnel cleanly decouples public ingress from the OpenShell runtime. OpenShell remains the execution boundary; Cloudflare remains the ingress boundary.
- Operators already think of domain/TLS/tunnel state as machine-level plumbing. Keeping it outside the sandbox avoids coupling certificate/auth/account state to the ephemeral runtime bundle.
- A host tunnel can point at a stable local ingress target while the sandboxed daemon is upgraded, restarted, or replaced.

Supported modes to design for:
- **Launch default:** host-managed `cloudflared` on the operator machine
- **Advanced / later:** in-sandbox tunnel for tightly self-contained deployments
- **Not recommended for launch:** undocumented tunnel placement ambiguity

### D2 — Public endpoint model
**Recommendation:** every publicly reachable agent gets one canonical HTTPS endpoint of the form:

`https://<agentname>.arc402.xyz`

That endpoint is a stable routing identity, not a promise that the agent process itself is directly internet-exposed.

Launch model:
- `agentname.arc402.xyz` terminates at Cloudflare
- Cloudflare Tunnel forwards to a local host ingress target on the operator machine
- that host ingress target forwards only to the ARC-402/OpenClaw surface that should be reachable
- the sandboxed daemon remains behind OpenShell; it is not itself the public boundary

### D3 — Inter-agent communication model
**Recommendation:** split traffic into two classes.

1. **Public discovery / negotiation reachability**
   - via the canonical public HTTPS endpoint (`agentname.arc402.xyz`)
   - used when another agent needs to initiate contact from outside the local machine or network

2. **Runtime outbound execution traffic**
   - from the sandboxed daemon / harness to approved endpoints only
   - governed by OpenShell network policy

This means an agent may be publicly reachable through Cloudflare while still being unable to call arbitrary outbound hosts from inside the sandbox.

### D4 — Sandbox-to-sandbox policy boundary
**Recommendation:** treat other agents exactly like external services from the perspective of a sandbox.

Rules:
- no implicit trust because both agents are “ARC-402” agents
- no wildcard `*.arc402.xyz` allow rule by default
- allow only:
  - protocol-critical hosts by default (Base RPC, relay, bundler, Telegram)
  - explicitly added agent endpoints for counterparties the operator intends this node to talk to
- if one agent needs to call another over HTTPS, that destination host must be added to OpenShell policy explicitly
- inter-agent policy entries should be narrow, named, and removable

This keeps policy legible and prevents the launch product from quietly becoming “any ARC-402 agent can talk to any other ARC-402 agent from inside the sandbox.”

### D5 — Premium install principle
**Recommendation:** the premium story is not “install three systems manually.” The premium story is:

`openclaw install arc402-agent`

…then ARC-402 owns the orchestration of:
- OpenClaw runtime setup
- OpenShell install / verification / init
- ARC-402 CLI config reuse
- provider creation
- runtime bundle sync
- endpoint policy scaffolding
- tunnel scaffold / doctor / verification

The operator should think in one product surface: ARC-402.

## 6. Ergonomics smoothing findings

### Friction patterns found in the current launch path
- OpenShell compatibility details are still too visible in operator-facing copy; ARC-402 should absorb those quirks instead of making users reason about CLI/version differences.
- The mobile-first vs CLI-first choice exists, but the docs still make the operator mentally compose the two surfaces instead of explicitly telling them what belongs on phone vs machine.
- The OpenClaw skill path still risks feeling bolted on unless README / getting-started / skill copy all tell the same "install once, then operate through arc402" story.
- SDK naming still leans contract-centric; operator-centric aliases make the intended mental model easier to discover without a full architecture read.
- GitHub-facing docs are strongest when they tell one simple story: choose a path, get a wallet, approve with passkey, run through OpenShell-contained runtime.

### Smoothing tasks added for launch
- [ ] Make all operator-facing docs describe OpenShell as underlying runtime safety infrastructure absorbed behind ARC-402 commands wherever possible
- [x] Add one canonical install phrase for the OpenClaw skill path and use it consistently across README, getting-started, CLI docs, and skill docs
- [x] Add a simple "phone vs machine" table to README/getting-started
- [x] Keep SDK operator aliases (`ARC402OperatorClient`, `ARC402Operator`) documented and stable through launch
- [x] Add a short troubleshooting note for OpenShell 0.0.10+ compatibility so users never need to care which provider/sandbox flags changed
- [x] Reuse existing ARC-402 CLI config during `arc402 openshell init` so operators do not have to manually export machine-key / Telegram env vars for the common path
- [x] Make `arc402 openshell status` verify the remote runtime bundle presence, not just local config files

## 5B. Implementation roadmap now linked

The tracked execution order for the remaining launch phase lives in `docs/launch-implementation-roadmap.md`.

That roadmap is now the concrete build sequence for:
- OpenShell premium hardening
- endpoint / tunnel CLI
- policy UX presets and toggles
- MacBook clean-room validation
- GitHub polish order

This PRD remains the tracker; the roadmap is the sharper implementation artifact.

## 6B. Premium one-click OpenShell

### What still felt unpremium
- Runtime provisioning existed, but credential provisioning still leaned on ambient env vars instead of the operator's already-configured ARC-402 setup.
- OpenShell CLI 0.0.10 changed gateway/status expectations, and our install guidance still exposed those implementation details.
- Status reporting could say "configured" even if the remote runtime bundle was missing.
- Startup still risked feeling like "trust me, it synced" instead of giving the operator a proof-oriented readiness readout.
- Docker failures surfaced as generic setup friction instead of actionable operator feedback.
- Raw OpenShell SSH sessions surfaced provider placeholders (`openshell:resolve:env:...`) instead of real values, so daemon launch needed an ARC-402-side secret materialization seam.

### Premium one-click tasks
- [x] Teach `arc402 openshell init` to reuse CLI config secrets when env vars are absent
- [x] Create-or-update OpenShell providers instead of only attempting first-time create
- [x] Update install verification to the real OpenShell 0.0.10 command surface (`openshell status`)
- [x] Improve Docker preflight messaging for "not installed" vs "not running" vs "permission denied"
- [x] Make `arc402 openshell status` verify the provisioned remote daemon bundle
- [x] Tighten daemon/setup copy so the operator hears "OpenShell-owned runtime" rather than "manual daemon plumbing"
- [ ] Validate the same path from a clean MacBook install
- [ ] Add a single `arc402 openshell doctor` command if additional launch polish is needed after the MacBook pass
- [x] Make daemon launch materialize real machine-key / notification envs even when raw OpenShell SSH exposes `openshell:resolve:env:*` placeholders
- [ ] Add `arc402 endpoint init` to scaffold canonical endpoint naming, local ingress target, and tunnel config for `agentname.arc402.xyz`
- [ ] Add `arc402 endpoint status` to prove: DNS target, tunnel health, local target, daemon health, and registered AgentRegistry endpoint all match
- [x] Add `arc402 endpoint claim <agentname>` to combine subdomain claim + local config lock (AgentRegistry endpoint wiring remains an explicit follow-up step for now)
- [x] Add first usable OpenShell-facing peer allow/revoke helpers via `arc402 openshell policy peer add|remove|list` for explicit inter-agent HTTPS reachability policy entries
- [x] Add `arc402 endpoint doctor` to diagnose the current broken layer: local config, Cloudflare tunnel process, local host ingress, sandboxed daemon/runtime, or missing claim state

## 6A. Workstreams

## WS1 — Documentation truth
**Goal:** make documentation exhaustive, accurate, and choice-driven.

### Tasks
- [ ] Add explicit onboarding choice section to `README.md`
- [ ] Add explicit onboarding choice section to `docs/getting-started.md`
- [ ] Verify `docs/launch-scope.md` covers every launch feature with examples
- [ ] Add launch architecture diagram: OpenClaw + OpenShell + ARC-402
- [ ] Add clear “what is phase 2” section in README/docs
- [ ] Add “operator FAQ” section for owner-facing agent explanations

### Deliverables
- Updated `README.md`
- Updated `docs/getting-started.md`
- Updated `docs/launch-scope.md`

---

## WS2 — OpenShell runtime validation
**Goal:** prove the actual runtime path on real machines.

**Launch packaging decision:** ARC-402 owns runtime provisioning at init-time by packaging the local CLI/daemon bundle and syncing it into the OpenShell sandbox. Operators should never have to manually copy the ARC-402 runtime into the sandbox before `arc402 daemon start`.

**Launch endpoint decision:** ARC-402 should also own endpoint scaffolding. The premium path should not require the operator to manually stitch together Cloudflare Tunnel, subdomain claim, local ingress target, AgentRegistry endpoint registration, and OpenShell policy thinking across five surfaces.

### Tasks
- [x] Install Docker on current PC
- [x] Install OpenShell on current PC
- [x] Run `arc402 openshell init`
- [x] Verify the local ARC-402 runtime bundle is packaged and copied into the sandbox automatically
- [x] Run `arc402 openshell status`
- [x] Inspect generated policy, provider, and runtime-bundle setup
- [x] Run `arc402 daemon start` through OpenShell-owned path
- [ ] Record exact behavior, logs, errors, and friction points in a clean-room validation format
- [x] Test policy add/list/remove flows
- [ ] Document which outbound policies are needed for:
  - Base RPC
  - relay
  - bundler
  - Telegram
  - OpenAI / Anthropic / other harness APIs where relevant
- [ ] Validate host-managed Cloudflare Tunnel as the launch default against the sandboxed daemon
- [ ] Define the stable local ingress target the tunnel should point at (host reverse proxy vs direct local daemon port) and lock one default
- [ ] Verify endpoint continuity across daemon restart / OpenShell re-init / runtime resync
- [ ] Repeat from scratch on MacBook

### Questions this workstream must answer
- What does the first-time setup actually feel like?
- Which dependencies are missing by default?
- Which policies can be set cleanly today?
- How does daemon/node behavior look inside OpenShell in practice?
- What is confusing enough to block launch adoption?

### Deliverables
- Updated setup docs
- OpenShell troubleshooting notes
- launch-safe default policy guidance

---

## WS3 — Runtime / CLI truth
**Goal:** make sure the user-facing runtime story matches the actual command behavior.

### Tasks
- [x] Verify daemon help text and errors consistently point to OpenShell-first flow
- [x] Verify direct daemon fallback is documented as dev/recovery only
- [ ] Verify passkey-sign links and governance approval copy are accurate
- [x] Verify agent registration guidance is aligned with real endpoint metadata needs
- [ ] Verify notifier/alert language does not imply remote approval UX that does not exist
- [x] Specify the premium command sequence for endpoint bootstrap:
  - `openclaw install arc402-agent`
  - `arc402 wallet deploy`
  - `arc402 endpoint init`
  - `arc402 agent register` or integrated register flow
  - `arc402 daemon start`
- [ ] Decide whether `arc402 agent register` should accept a raw `--endpoint` at launch or prefer an `--endpoint-name` / `--claim-subdomain` premium path
- [ ] Ensure CLI copy distinguishes public ingress policy from sandbox outbound policy
- [ ] Ensure CLI copy never implies that registering an endpoint automatically grants outbound permission to arbitrary peer agents

### Deliverables
- CLI copy cleanup
- docs/spec cleanup
- troubleshooting guidance

---

## WS4 — Protocol / SDK / docs alignment
**Goal:** make public docs and tooling map to the actual protocol surface.

### Tasks
- [ ] Map contracts → public/external functions → CLI / SDK / docs coverage
- [ ] Verify launch-scope functions are represented in CLI where intended
- [ ] Verify TypeScript SDK types match active contract behavior
- [ ] Verify Python SDK types match active contract behavior
- [ ] Verify OpenClaw skill docs reflect launch truth
- [ ] Verify payment pattern documentation never invents unsupported primitives
- [ ] Add launch docs for endpoint communication semantics:
  - public endpoint = discovery / negotiation entrypoint
  - relay / protocol endpoints = core protocol transport
  - OpenShell policy = outbound execution allowlist
- [ ] Document that `agentname.arc402.xyz` is canonical public identity, but not equivalent to sandbox trust
- [x] Add one explicit policy UX path for peer-agent HTTPS calls (`arc402 openshell policy peer ...`) and one for model/API tool calls (`arc402 openshell policy preset harness|search|all`)

### Deliverables
- coverage matrix
- mismatch list
- final launch-safe examples

---

## WS5 — GitHub polish prep
**Goal:** make the repo presentable without mixing unrelated work.

### Tasks
- [ ] isolate intentional launch files from unrelated dirty files
- [ ] remove or separate generated build artifacts where appropriate
- [ ] review the three launch commits as the canonical baseline
- [ ] assemble final README / docs nav order
- [ ] prepare launch checklist for repo root or docs

### Deliverables
- cleaned diff plan
- GitHub polish checklist

---

## 6C. Policy templates required before premium launch

These templates should ship as first-class generated artifacts, not buried examples.

### Template 1 — Core launch policy
Default OpenShell outbound policy for every ARC-402 node:
- Base RPC
- ARC-402 relay
- bundler
- Telegram
- zero peer-agent wildcard access

### Template 2 — Peer agent HTTPS allowlist
For operators who want one agent to call another agent's HTTPS endpoint:
- one named host per peer (`gigabrain.arc402.xyz`, `researcher.arc402.xyz`)
- no `*.arc402.xyz`
- hot-reloadable add/remove via CLI
- docs must state that public discoverability does not imply outbound trust

### Template 3 — Harness/API expansion pack
Optional policy additions for harness/tooling usage:
- OpenAI
- Anthropic
- web search / search APIs
- custom business APIs

### Template 4 — Endpoint ingress template
Host-side scaffold for:
- Cloudflare Tunnel config
- local ingress target
- health probe target
- canonical hostname lock
- AgentRegistry endpoint sync target

## 7. Immediate next actions

### Today
- [x] Update README with onboarding choice section
- [x] Update getting-started with onboarding choice section
- [x] Mark device E2E as completed-once, with MacBook rerun still pending
- [x] Test local OpenShell prerequisites on current PC
- [x] Replace outdated PC-blocker language with roadmap-driven next steps
- [x] Add linked implementation roadmap for remaining launch execution

### Next validation pass
- [ ] install Docker on PC
- [ ] install OpenShell on PC
- [ ] initialize ARC-402 OpenShell sandbox
- [ ] inspect sandbox policies and providers
- [ ] start daemon through OpenShell path
- [ ] capture exact setup notes for MacBook rerun

---

## 8. Tracking table

| Workstream | Status | Owner | Next action |
|---|---|---|---|
| WS1 Documentation truth | In progress | Forge | Merge roadmap-driven launch wording updates |
| WS2 OpenShell runtime validation | In progress | Forge | Re-run the validated path on a clean MacBook |
| WS3 Runtime / CLI truth | In progress | Forge | Build endpoint/tunnel CLI scaffold and keep OpenShell-first wording consistent |
| WS4 Protocol / SDK / docs alignment | In progress | Forge | Encode public endpoint vs outbound policy semantics everywhere |
| WS5 GitHub polish prep | Pending | Forge | Separate intentional launch work from generated/runtime churn |

---

## 9. Decisions locked

- OpenShell owns runtime startup for launch.
- `arc402 daemon start` remains the command surface, but not the standalone architecture story.
- Cloudflare Tunnel should be **supported in multiple modes**, but the **launch default is host-managed tunnel outside the sandbox**.
- `agentname.arc402.xyz` is the canonical public endpoint shape for launch.
- Public ingress and sandbox outbound policy are separate controls and must be documented as such.
- Inter-agent HTTPS reachability must be explicit allowlist policy, never wildcard trust by default.
- Device E2E has been completed once already and should be rerun from a clean MacBook setup.
- Phase 2 stays out of launch messaging:
  - Privy / email onboarding
  - gas sponsorship

---

## 10. Update protocol

Whenever launch-readiness changes materially, update:
- this file
- `products/arc-402/ENGINEERING-STATE.md`
- `memory/2026-03-19.md` or the current daily memory file
 daily memory file
le
