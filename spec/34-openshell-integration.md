# Spec 34 — OpenShell Integration
*Status: Ready to Build | Date: 2026-03-17*
*Schema confirmed from: github.com/NVIDIA/openshell + docs.nvidia.com/openshell/latest*

---

## Why This Exists

The ARC-402 daemon governs the agreement boundary — who hired this agent, at what price, under what trust level, with what settlement guarantees. It does not govern what the agent can touch while it works.

OpenShell is the open source runtime sandbox that governs the execution boundary — which network endpoints, file paths, and system resources a running agent process can access. It is the OS-level policy layer for agent work.

These are peer systems. They solve adjacent problems at different layers. When OpenShell is present, they meet at exactly one point: `arc402 daemon start`, which runs the entire daemon inside the sandbox.

**ARC-402:** Who can hire this agent? At what price? Under what trust? What happens when delivery fails?
**OpenShell:** What can the running process touch? What endpoints can it call? What files can it write?

Neither can answer the other's question. Both are required.

---

## Prerequisites

- **Spec 32** (Daemon) — work execution hook, exec_command config, daemon lifecycle
- **OpenShell CLI** installed (see §3)
- **Docker Desktop** (or Docker daemon) — OpenShell runs K3s inside a Docker container

---

## 1. Architecture

### The Daemon IS the Sandboxed Process

```
Host OS
  └── OpenShell sandbox (arc402-daemon)
        └── ARC-402 daemon (sandboxed, --foreground mode)
              └── worker process (inherits sandbox)
```

The entire ARC-402 daemon runs inside OpenShell. When `arc402 daemon start` is called, the CLI internally wraps the daemon in the sandbox:

```bash
# What arc402 daemon start does internally (with OpenShell configured):
openshell sandbox exec arc402-daemon -- arc402 daemon --foreground
```

The daemon is the sandboxed process. The worker process it spawns inherits the same sandbox — same network policy, same filesystem constraints, same credential injections. There is no separate sandbox for the worker.

### What This Changes

The seam is no longer `exec_command` in `daemon.toml` — it is `arc402 daemon start`. The daemon has no OpenShell awareness. The CLI wraps it transparently. If OpenShell is not configured, the CLI runs the daemon directly. Same call from the operator's perspective either way.

### What the Sandbox Needs

The daemon sandbox requires access to:

| Resource | Why |
|----------|-----|
| Base RPC (`mainnet.base.org`) | Agreement transactions, escrow, settlement |
| ARC-402 relay (`relay.arc402.xyz`) | Inbound task discovery, protocol messages |
| Bundler (`public.pimlico.io`) | UserOp submission |
| Telegram API (`api.telegram.org`) | Operator notifications |
| `~/.arc402/` | Config, keys, logs, daemon state |
| Node.js runtime | Daemon and worker both run on Node |
| Credentials (via providers) | Machine key, Telegram token |

Additional endpoints the operator's chosen harness needs (LLM APIs, web search, external tools) are added to the daemon sandbox policy. Workers inherit them automatically.

### What the Daemon Does When Work Arrives

```
daemon receives hire
→ policy evaluation (trust score, price, capability, capacity)
→ accepts via UserOp on Base
→ fires work hook
         ↓
exec_command runs {worker} — already inside the sandbox, inherits policy
         ↓
worker does work inside bounded environment
process exits, prints delivery hash to stdout
         ↓
daemon receives delivery hash
→ builds fulfill() UserOp
→ submits to bundler
→ escrow releases
→ trust score updates
```

**ARC-402 owns:** everything before and after the process call.
**OpenShell owns:** everything inside the sandbox — daemon and worker alike.
**The seam:** `arc402 daemon start` in the CLI.

### Layer Separation

| Layer | System | Policy Question |
|-------|--------|-----------------|
| Economic identity | ARC-402 Wallet | Who is this agent? |
| Agreement governance | ARC-402 ServiceAgreement | What was promised? Who's accountable? |
| Trust | TrustRegistry | Can these parties transact? |
| Context | Context Binding | What task is this spending for? |
| Communication | Daemon | Are messages signed? Is the relay trusted? |
| **Execution** | **OpenShell** | **What can this process touch?** |
| Settlement | ServiceAgreement + Bundler | How does payment release? |
| Reputation | ReputationOracle | What did this earn? |

Each layer is sovereign. None knows about the others. Each enforces its own policy surface independently.

---

## 2. OpenShell Policy Schema

Policy files are YAML, version 1. Confirmed from `github.com/NVIDIA/OpenShell`.

### Policy Domains

| Domain | Hot-reloadable? | Locked when? |
|--------|----------------|--------------|
| `filesystem_policy` | No | Sandbox creation |
| `landlock` | No | Sandbox creation |
| `process` | No | Sandbox creation |
| `network_policies` | **Yes** | Hot-reload via `openshell policy set` |

### ARC-402 Default Policy (`~/.arc402/openshell-policy.yaml`)

```yaml
version: 1

# Static — locked at sandbox creation
filesystem_policy:
  include_workdir: true
  read_only:
    - /usr
    - /lib
    - /proc
    - /etc
    - /var/log
  read_write:
    - ~/.arc402
    - /tmp
    - /dev/null

landlock:
  compatibility: best_effort

process:
  run_as_user: sandbox
  run_as_group: sandbox

# Dynamic — hot-reloadable via `openshell policy set`
network_policies:

  base_rpc:
    name: base-mainnet-rpc
    endpoints:
      - host: mainnet.base.org
        port: 443
        protocol: rest
        tls: terminate
        enforcement: enforce
        access: read-write
    binaries:
      - { path: /usr/bin/node }
      - { path: /usr/local/bin/node }

  arc402_relay:
    name: arc402-relay
    endpoints:
      - host: relay.arc402.xyz
        port: 443
        protocol: rest
        tls: terminate
        enforcement: enforce
        access: read-write
    binaries:
      - { path: /usr/bin/node }
      - { path: /usr/local/bin/node }

  bundler:
    name: pimlico-bundler
    endpoints:
      - host: public.pimlico.io
        port: 443
        protocol: rest
        tls: terminate
        enforcement: enforce
        access: read-write
    binaries:
      - { path: /usr/bin/node }
      - { path: /usr/local/bin/node }

  telegram:
    name: telegram-notifications
    endpoints:
      - host: api.telegram.org
        port: 443
        protocol: rest
        tls: terminate
        enforcement: enforce
        access: read-write
    binaries:
      - { path: /usr/bin/node }
      - { path: /usr/local/bin/node }
```

Default: Base RPC, relay, bundler, and Telegram API. Everything else is blocked. The daemon and every worker process it spawns are bounded by this policy.

### Extending the Policy

Agents doing real work (web research, LLM calls, external APIs) need additional endpoints. Operators extend the policy for their use case:

```yaml
# Add to network_policies: section
  openai:
    name: openai-inference
    endpoints:
      - host: api.openai.com
        port: 443
        protocol: rest
        tls: terminate
        enforcement: enforce
        access: read-write
    binaries:
      - { path: /usr/bin/node }
      - { path: /usr/local/bin/python3 }
```

After editing, hot-reload on the running sandbox:
```bash
openshell policy set arc402-daemon --policy ~/.arc402/openshell-policy.yaml --wait
```

No restart required. No daemon restart. The change takes effect within seconds.

### Credential Injection

Credentials are never in the policy file. Never in the sandbox filesystem. OpenShell injects them as environment variables at sandbox creation via **providers**:

```bash
# Create a provider for the ARC-402 machine key
openshell provider create arc402-machine-key \
  --env ARC402_MACHINE_KEY=$ARC402_MACHINE_KEY

# Create a provider for Telegram notifications
openshell provider create arc402-notifications \
  --env TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN \
  --env TELEGRAM_CHAT_ID=$TELEGRAM_CHAT_ID
```

The `arc402 openshell init` command creates these providers automatically from the CLI config. Credentials are never written to any file — loaded from environment at init time, stored in OpenShell's gateway, injected at runtime.

---

## 3. Installation

### Install OpenShell

```bash
# Binary (recommended)
curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | sh

# Or via PyPI (requires uv)
uv tool install -U openshell
```

**Docker required.** OpenShell runs K3s inside a Docker container. Docker Desktop must be running before any sandbox commands — and before `arc402 daemon start`.

### Verify

```bash
openshell --version
openshell gateway status
```

### NemoClaw (optional)

If you want NVIDIA's full stack (Nemotron models + OpenShell + broader OpenClaw wiring):

```bash
openclaw install nemoclaw
```

NemoClaw bundles OpenShell. If both are present, `arc402 openshell init` uses standalone OpenShell (the dedicated path). NemoClaw is detected as a fallback only — never pulled in automatically.

---

## 4. Daemon Configuration

### `daemon.toml` with OpenShell

When OpenShell is configured, the daemon itself runs inside the sandbox. The `exec_command` in `daemon.toml` runs the worker directly — no additional sandbox wrapping needed, because the daemon and its child processes are already inside the `arc402-daemon` sandbox:

```toml
[work]
harness = "openclaw"   # set by arc402 daemon init — see §5
# exec_command auto-generated from harness — worker inherits daemon sandbox
http_url = ""
http_auth_token = "env:WORKER_AUTH_TOKEN"
```

The `harness` field tells the daemon which agent runtime to invoke for work. See §5 (Harness Registry) for all supported values. The operator never writes `exec_command` manually.

### Without OpenShell (fallback)

```toml
[work]
harness = "openclaw"   # same — harness field unchanged
exec_command = "openclaw run {task}"
```

Works without sandboxing. The skill writes the correct config based on what's detected at install time.

---

## 5. Harness Registry

The daemon supports a fixed set of known agent harnesses. `arc402 daemon init` asks the operator which harness to use and auto-generates the corresponding `exec_command`. The operator never writes `exec_command` manually.

### Supported Harnesses

| Harness | Agent Runtime | Auto-generated exec_command |
|---------|--------------|------------------------------|
| `openclaw` | OpenClaw (default) | `openclaw run {task}` |
| `claude` | Claude Code (Anthropic) | `claude --dangerously-skip-permissions {task}` |
| `codex` | Codex CLI (OpenAI) | `codex {task}` |
| `opencode` | OpenCode | `opencode {task}` |
| `custom` | User-provided | (operator enters command) |

### Prompt During `arc402 daemon init`

```
Which harness should execute work tasks?

  1. openclaw  (OpenClaw agent runtime — default)
  2. claude    (Claude Code — Anthropic)
  3. codex     (Codex CLI — OpenAI)
  4. opencode  (OpenCode)
  5. custom    (enter your own exec_command)

Select [1]:
```

After selection, `daemon.toml` is written with the `harness` field and a comment showing the generated command:

```toml
[work]
harness = "openclaw"
# exec_command: openclaw run {task}
# To change: arc402 daemon init --reconfigure-harness
```

For `custom`:
```toml
[work]
harness = "custom"
exec_command = "myrunner --task {task}"
```

### Sandbox Inheritance

When the daemon runs inside the `arc402-daemon` OpenShell sandbox, the selected harness — OpenClaw, Claude Code, Codex, or OpenCode — inherits the same sandbox policy. The harness process is a child of the daemon. It gets the same network whitelist, the same filesystem constraints, the same credential injections.

The operator does not configure sandbox policy per harness; they configure it once for the daemon. To allow an LLM API call from Claude Code or Codex, add the endpoint to the daemon sandbox policy. The harness will be able to reach it. Endpoints not in the policy are blocked at L7 regardless of which harness makes the request.

---

## 6. CLI Commands

### `arc402 openshell install`

Installs OpenShell from the official source. Handles binary download, PATH setup, Docker check.

```bash
arc402 openshell install
# Checks Docker is running
# Downloads from https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh
# Verifies: openshell --version
# Prints: "OpenShell installed. Run: arc402 openshell init"
```

### `arc402 openshell init`

Creates the `arc402-daemon` sandbox, generates the default policy file, creates credential providers, and configures `arc402 daemon start` to use the sandbox.

```bash
arc402 openshell init
```

Steps:
1. Check OpenShell is installed — if not, suggest `arc402 openshell install`
2. Check Docker is running
3. Generate `~/.arc402/openshell-policy.yaml` with ARC-402 default policy (Base RPC, relay, bundler, Telegram API, `~/.arc402` filesystem access)
4. Create credential providers from CLI config:
   - `arc402-machine-key` → `ARC402_MACHINE_KEY`
   - `arc402-notifications` → `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
5. Create sandbox: `openshell sandbox create arc402-daemon --policy ~/.arc402/openshell-policy.yaml --provider arc402-machine-key --provider arc402-notifications`
6. Record sandbox config in `~/.arc402/openshell.toml` (read by `arc402 daemon start` to decide whether to wrap)
7. Verify wiring: run a test echo inside the sandbox
8. Print confirmation:

```
OpenShell integration configured.

  Sandbox:   arc402-daemon
  Policy:    ~/.arc402/openshell-policy.yaml
  Runtime:   daemon + all worker processes run inside the sandbox

arc402 daemon start will now run inside the arc402-daemon sandbox.
Default policy: Base RPC + relay + bundler + Telegram API. All other network access blocked.

To allow additional endpoints for your harness or worker tools:
  Edit ~/.arc402/openshell-policy.yaml → network_policies section
  Then hot-reload: openshell policy set arc402-daemon --policy ~/.arc402/openshell-policy.yaml --wait
  No daemon restart needed.
```

### `arc402 daemon start` (updated behaviour)

When `~/.arc402/openshell.toml` exists and `sandbox = "arc402-daemon"`:

```bash
# arc402 daemon start internally runs:
openshell sandbox exec arc402-daemon -- arc402 daemon --foreground
```

When OpenShell is not configured: runs `arc402 daemon --foreground` directly.

The operator always runs the same command. The CLI handles the wrapping transparently.

### `arc402 openshell status`

```bash
arc402 openshell status

OpenShell Integration
─────────────────────
Installed:    yes (v0.1.0)
Docker:       running
Sandbox:      arc402-daemon (running)
Policy file:  ~/.arc402/openshell-policy.yaml ✓
Daemon mode:  sandboxed (arc402 daemon start → openshell sandbox exec)

Network policy (allowed outbound):
  mainnet.base.org         (Base RPC)
  relay.arc402.xyz         (ARC-402 Relay)
  public.pimlico.io        (Bundler)
  api.telegram.org         (Telegram notifications)
  [all others blocked]

Credential providers:
  arc402-machine-key       ✓
  arc402-notifications     ✓
```

### `arc402 openshell policy add <name> <host>`

Add a network endpoint to the running policy without editing YAML manually.

```bash
arc402 openshell policy add openai api.openai.com
# Adds to policy file + hot-reloads the running sandbox
# Prints: "✓ api.openai.com added to daemon sandbox policy (hot-reloaded)"
```

### `arc402 openshell policy list`

Show all allowed outbound endpoints for the running sandbox.

### `arc402 openshell policy remove <name>`

Remove an endpoint from the policy and hot-reload.

---

## 7. Skill Auto-Detection Flow

When `openclaw install arc402-agent` runs:

```
Step 1: Check standalone OpenShell
  → which openshell || uv tool list | grep openshell
  → FOUND → run arc402 openshell init automatically
             creates arc402-daemon sandbox
             print: "OpenShell detected. Daemon sandbox configured."
  → NOT FOUND → Step 2

Step 2: Check NemoClaw
  → openclaw skill list | grep nemoclaw
  → FOUND → use NemoClaw's bundled OpenShell binary
             run arc402 openshell init (pointing at NemoClaw's binary)
             print: "NemoClaw detected. Using bundled OpenShell."
  → NOT FOUND → Step 3

Step 3: Unsandboxed fallback
  → skip sandbox creation
  → print: "OpenShell not found. Daemon will run unsandboxed."
  → print: "For sandboxed execution: arc402 openshell install && arc402 openshell init"
  → continue — ARC-402 works without OpenShell
```

**Priority:** Standalone OpenShell first. NemoClaw second. Unsandboxed third. NemoClaw is never installed automatically — operators choose it separately if they want the full NVIDIA stack.

---

## 8. Onboarding Flow (Full Stack)

Four commands. Full stack configured.

```bash
# 1. Install ARC-402 skill (installs CLI, detects OpenShell, creates daemon sandbox)
openclaw install arc402-agent

# 2. Deploy your wallet
arc402 wallet deploy
# → MetaMask approval → wallet on Base mainnet

# 3. Configure daemon (select harness, set wallet address, bundler, relay)
arc402 daemon init
# → Prompts for harness: openclaw, claude, codex, opencode, or custom
# → Writes ~/.arc402/daemon.toml with harness field and auto-generated exec_command

# 4. Start (tunnel + daemon — daemon runs inside OpenShell sandbox automatically)
cloudflared tunnel run --url http://localhost:4402 <your-tunnel> &
arc402 daemon start
# → If OpenShell configured: openshell sandbox exec arc402-daemon -- arc402 daemon --foreground
# → If not: arc402 daemon --foreground

# That's the full stack:
# ARC-402 contracts on Base (identity, trust, agreements, settlement)
# + OpenShell daemon sandbox (entire daemon + workers bounded at the OS level)
# + Selected harness (openclaw, claude, codex, opencode) — inherits sandbox policy
# + Cloudflare tunnel (public endpoint, no exposed port)
```

---

## 9. Security Properties

### What OpenShell Adds to ARC-402

Without OpenShell, the execution surface is unbounded once the daemon starts. A malicious hire spec could trick the worker into calling external endpoints, reading sensitive paths, or exfiltrating data. ARC-402 blocks the economic attack (bad hirer rejected at policy evaluation). But once work begins, the worker process has whatever access the OS allows.

With the daemon-inside-OpenShell architecture, even the daemon itself is bounded. The daemon cannot call endpoints outside the network whitelist. The worker it spawns cannot either. Even if a work payload contains a prompt injection that tries to exfiltrate data, the sandbox blocks the network call before any packet leaves.

OpenShell closes the runtime gap end-to-end. The worst case drops from "system breach" to "failed delivery". ARC-402 then handles the failed delivery through dispute resolution and trust score consequences.

### What ARC-402 Adds to OpenShell

OpenShell secures the process. It has no concept of who commissioned the process, under what terms, at what trust level, or what happens after the process exits.

ARC-402 provides the accountability layer that surrounds OpenShell's execution:
- Both parties' trust scores verified before work starts
- Escrow locked before any process fires (no payment risk)
- Context Binding declares task scope before execution begins
- Delivery hash committed on-chain (immutable proof of what was delivered)
- Dispute resolution if delivery is wrong or missing
- Trust score consequences that compound over time

A sandboxed process with no accountability can still deliver garbage deliberately. ARC-402 makes delivering garbage economically costly.

### Together

```
ARC-402:   prevents bad actors from entering the market
OpenShell: prevents bad actors from escaping the sandbox
```

Both required. Neither sufficient alone.

### The Credential Isolation Alignment

OpenShell never lets credentials touch the sandbox filesystem — providers inject environment variables at runtime, sourced from the gateway. This is architecturally identical to the ARC-402 machine key model:

- Machine key: never in `daemon.toml`, never in any config file, loaded from `env:ARC402_MACHINE_KEY`
- OpenShell credentials: never in the sandbox, never in the policy file, injected by the gateway at creation

Same principle. Same security property. The two systems share a philosophy — credentials exist in memory at the moment they're needed, nowhere else.

---

## 10. Build Sequence

```
1. Implement arc402 openshell install
   → Download + install from official source
   → Check Docker is running
   → Verify: openshell --version, openshell gateway status

2. Implement arc402 openshell init
   → Generate ~/.arc402/openshell-policy.yaml with confirmed YAML schema
   → Include Telegram API in default network policy
   → Include ~/.arc402 in read_write filesystem policy
   → Create credential providers from CLI config
   → Create sandbox: arc402-daemon (the full daemon sandbox)
   → Write ~/.arc402/openshell.toml recording sandbox = "arc402-daemon"
   → Verify with test echo inside sandbox

3. Update arc402 daemon start
   → Read ~/.arc402/openshell.toml — if sandbox configured, wrap daemon in openshell sandbox exec
   → Signature: openshell sandbox exec arc402-daemon -- arc402 daemon --foreground
   → If no sandbox config: run daemon directly (arc402 daemon --foreground)

4. Update arc402 daemon init
   → Add harness selection prompt (openclaw, claude, codex, opencode, custom)
   → Auto-generate exec_command from harness selection
   → Write harness field + generated exec_command comment to daemon.toml
   → Operator never writes exec_command manually

5. Implement arc402 openshell status
   → Read ~/.arc402/openshell.toml, check sandbox via openshell gateway
   → Parse policy YAML, show allowed endpoints
   → Show provider list
   → Show daemon mode (sandboxed / unsandboxed)

6. Implement arc402 openshell policy add/list/remove
   → YAML update + openshell policy set arc402-daemon hot-reload

7. Update skill install flow
   → OpenShell auto-detection (standalone → NemoClaw → unsandboxed)
   → Auto-run arc402 openshell init when detected (creates arc402-daemon sandbox)
   → Update install confirmation messages

8. E2E test: full hire → sandboxed daemon → work → deliver flow
   → Verify daemon starts inside sandbox (openshell sandbox exec wrapping)
   → Verify delivery hash returns correctly from sandboxed worker
   → Verify network blocking (daemon/worker cannot call non-whitelisted endpoint)
   → Verify filesystem isolation (daemon/worker cannot read ~/.ssh/)
   → Verify credential provider injection (ARC402_MACHINE_KEY available inside sandbox)
   → Verify harness selection: test each known harness (openclaw, claude, codex, opencode)
   → Verify harness subprocess inherits sandbox policy (no extra policy config needed)
```

---

## 11. What Does NOT Change

The ARC-402 contracts, SDK, and protocol are unchanged by this integration. The CLI's `arc402 daemon start` gains transparent sandbox wrapping, but the operator interface is identical. `daemon.toml` gains the `harness` field; `exec_command` becomes managed (auto-generated, not hand-written).

The integration is additive. ARC-402 works without OpenShell. OpenShell makes execution safer at the daemon level. The skill handles detection and wiring. The daemon calls whatever command the harness generates — and neither the daemon nor the harness knows it is inside a sandbox.

---

*Spec 34 — OpenShell Integration*
*Written: 2026-03-17*
*Schema confirmed from: github.com/NVIDIA/OpenShell*
*Docs: docs.nvidia.com/openshell/latest*
*Status: Ready to build — no open blockers*
