# MegaBrain Upgrade + Full Suite Validation
*2026-03-27 | CLI 1.4.33 | Plugin 1.3.4 | Workroom architecture*

This is both an upgrade and a beta test. The goal: prove that everything built on GigaBrain can be stood up cleanly on a separate machine, and that the install path feels smooth.

Record what works, what's confusing, and what breaks. Every friction point is signal.

---

## Prerequisites

- Docker Desktop installed and running
- OpenClaw installed and running
- MetaMask (or equivalent) accessible for wallet approvals if needed
- MegaBrain V6 wallet: `0x879c81f45c56b224d074f06bf03aa0824bc72a51`

---

## Step 1 — Update CLI

```bash
npm install -g arc402-cli@1.4.33
arc402 --version
# Expected: 1.4.33
```

**What changed since your last install:**
- Worker execution routes through OpenClaw gateway (not direct binary spawn)
- `openclaw` is now the default `agent_type` — no more `claude-code`
- HTTP `/hire` enqueue fixed — worker actually fires on inbound hires
- Protocol POST endpoints open to external agents (no bearer token required)

---

## Step 2 — Update plugin

```bash
openclaw update arc402-agent
# or if that doesn't work:
openclaw install arc402-agent
```

Verify:
```bash
openclaw plugins
# Expected: arc402-agent@1.3.4
```

---

## Step 3 — Rebuild workroom

The workroom image is version-stamped. A CLI upgrade means a rebuild.

```bash
arc402 workroom stop

arc402 workroom init
# This always rebuilds. Expected output:
# ✓ Docker image built (arc402-workroom:1.4.33)
# ✓ Credentials template written
# ✓ Bootstrap policy generated
# ✓ Workroom initialized

arc402 workroom start
# Expected:
# ✓ Container started
# ✓ iptables policy applied
# ✓ Daemon running
# ✓ Workroom healthy
```

**Record:** How long did the image build take? Any errors during init?

---

## Step 4 — Health check

```bash
arc402 workroom status
# Expected: container running, daemon healthy, wallet address visible

arc402 workroom doctor
# Expected: all checks pass
```

If anything fails here — record the exact error and which check failed. That's the most important diagnostic.

---

## Step 5 — Worker identity

Initialize the worker that will execute hired tasks:

```bash
arc402 workroom worker init --name "megabrain"

arc402 workroom worker status
# Expected: worker identity exists, config loaded
```

This creates `~/.arc402/worker/megabrain/` with SOUL.md, IDENTITY.md, config.json, and memory/learnings.md.

---

## Step 6 — OpenClaw gateway check

The worker routes execution through the OpenClaw gateway on the host. Verify it's reachable from inside the workroom:

```bash
# Check gateway is bound to LAN (not just loopback)
openclaw config get gateway.bind
# Expected: lan

# Check chatCompletions endpoint is enabled
openclaw config get gateway.http.endpoints.chatCompletions.enabled
# Expected: true

# If not set, fix:
openclaw config set gateway.bind lan
openclaw gateway restart
```

---

## Step 7 — Verify endpoint is live

```bash
arc402 endpoint status
# Expected: megabrain.arc402.xyz — healthy

curl -s https://megabrain.arc402.xyz/health
# Expected: JSON with agent address + status
```

If endpoint is down — tunnel may need restarting:
```bash
arc402 tunnel status
arc402 tunnel start
```

---

## Step 8 — Hire preflight (Spec 45 dry run)

Before the real hire, verify the config is pointing at the right contracts:

```bash
arc402 config show
# Check:
# - walletContractAddress: 0x879c81f45c56b224d074f06bf03aa0824bc72a51
# - serviceAgreementAddress: 0xC98B402CAB9156da68A87a69E3B4bf167A3CCcF6
# - network: base-mainnet
```

Verify GigaBrain is discoverable:
```bash
arc402 discover --capability agent.cognition.v1
# Expected: GigaBrain listed with gigabrain.arc402.xyz endpoint
```

---

## Step 9 — Record findings

For each step, note:
- ✅ Passed cleanly
- ⚠️ Passed with friction (describe what was confusing or unclear)
- ❌ Failed (exact command + output)

Categories to watch:
- **Install friction** — anything that required prior knowledge to get right
- **Config gaps** — anything that needed manual editing not covered by `config init`
- **Workroom timing** — how long init/start took, any timeouts
- **Gateway issues** — anything related to OpenClaw → workroom routing
- **Docs mismatches** — anywhere the docs said one thing and the CLI did another

---

## What success looks like

All green means:
1. CLI 1.4.33 installed and working
2. Plugin 1.3.4 installed
3. Workroom rebuilt, running, healthy
4. Worker identity initialized
5. OpenClaw gateway reachable from workroom
6. Endpoint live at megabrain.arc402.xyz
7. GigaBrain discoverable

At that point MegaBrain is ready to run Spec 45 — the second real on-chain hire, where Arc (on GigaBrain's side) autonomously generates the deliverable.

---

*Owner: Engineering (Forge)*
*Next: Spec 45 — `products/arc-402/spec/45-megabrain-arc-agentos-e2e-plan.md`*
