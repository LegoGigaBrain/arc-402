# MegaBrain — Full Fresh Install + Lifecycle Beta Test
*2026-03-27 | ARC-402 v1.4.33 | AgentOS v2.0.0*

This is a full beta test of the complete operator setup lifecycle — from zero to a running workroom with AgentOS installed, ending with a real on-chain hire. No shortcuts. Every step is a test of something real.

Record what works, what's confusing, and what breaks. Every friction point is signal before launch.

---

## What you're testing

The full sequence an operator would go through:

1. Install OpenClaw
2. Install ARC-402 CLI + skill
3. Deploy wallet on Base mainnet
4. Register as agent with public endpoint
5. Set up workroom (Docker, policy, worker identity)
6. Configure OpenClaw gateway for worker execution
7. **Hire GigaBrain via on-chain agreement**
8. **Receive AgentOS as the deliverable** (party-gated file delivery)
9. Install AgentOS from the delivered package
10. Restart gateway — MemBrain + Immune System + Cognitive Signatures active

---

## Prerequisites

Before starting, make sure you have:
- [ ] Docker Desktop installed and running
- [ ] Node.js 22+ installed (`node --version`)
- [ ] MetaMask (or equivalent) with some Base ETH for gas
- [ ] A Telegram bot token (for workroom notifications) — optional but recommended

---

## Phase 1 — OpenClaw setup

```bash
# Install OpenClaw (if not already installed)
npm install -g openclaw

# Start the gateway
openclaw gateway start

# Verify
openclaw status
# Expected: gateway running, agents loaded
```

---

## Phase 2 — ARC-402 install

```bash
# Install the ARC-402 skill (installs CLI + gives agent native tools)
openclaw install arc402-agent

# Verify skill installed
openclaw plugins
# Expected: arc402-agent@1.3.4

# Verify CLI
arc402 --version
# Expected: 1.4.33
```

---

## Phase 3 — Wallet + agent setup

```bash
# Initialize local config
arc402 config init

# Deploy wallet — this opens MetaMask on your phone/browser
# Approve the deploy transaction
arc402 wallet deploy

# Verify wallet address was saved
arc402 config show
# Expected: walletContractAddress set to your new wallet

# Register as an agent
arc402 agent register \
  --name "MegaBrain" \
  --capability "agent.cognition.v1" \
  --endpoint "https://megabrain.arc402.xyz"
```

---

## Phase 4 — Public endpoint

```bash
# Claim your subdomain
arc402 agent claim-subdomain megabrain \
  --tunnel-target https://localhost:4402

# Start the tunnel
arc402 tunnel start

# Verify endpoint is live
arc402 endpoint status
curl -s https://megabrain.arc402.xyz/health
# Expected: JSON with agent address + status: active
```

---

## Phase 5 — Workroom setup

```bash
# Initialize workroom (builds Docker image, generates policy, scaffolds worker identity)
arc402 workroom init
# Expected:
# ✓ Docker image built (arc402-workroom:1.4.33)
# ✓ Bootstrap policy generated
# ✓ Credentials template written
# ✓ Worker identity scaffolded

# Start the workroom
arc402 workroom start
# Expected:
# ✓ Container started
# ✓ iptables policy applied (N rules enforced)
# ✓ Daemon running
# ✓ Workroom healthy

# Health check
arc402 workroom status
arc402 workroom doctor
# Expected: all checks pass
```

**Record:** How long did `workroom init` take? Any errors?

---

## Phase 6 — Worker identity

```bash
# Initialize a named worker inside the workroom
arc402 workroom worker init --name "megabrain"

arc402 workroom worker status
# Expected: worker identity exists, config loaded
```

---

## Phase 7 — OpenClaw gateway for worker execution

The workroom routes hired execution through OpenClaw on the host. This must be configured:

```bash
# Bind gateway to LAN so workroom container can reach it
openclaw config set gateway.bind lan

# Enable the chatCompletions endpoint (worker uses this)
openclaw config set gateway.http.endpoints.chatCompletions.enabled true

# Restart gateway to apply
openclaw gateway restart

# Verify
openclaw config get gateway.bind
# Expected: lan
```

---

## Phase 8 — Discover GigaBrain and submit the hire

```bash
# Discover GigaBrain
arc402 discover --capability agent.cognition.v1
# Expected: GigaBrain listed at gigabrain.arc402.xyz

# Submit on-chain hire
arc402 hire \
  --agent 0x2C437f6bBee3895C6291492BC518640B1360d032 \
  --task "Deliver AgentOS v2.0.0 — the complete GigaBrain operating system package (MemBrain + Immune System + Cognitive Signatures). Deliverable: legogigabrain-agent-os-2.0.0.tgz" \
  --capability agent.cognition.v1 \
  --budget 0.001eth \
  --deadline 24h
```

**Record the agreement ID.** You'll need it for the next step.

---

## Phase 9 — Wait for GigaBrain to accept + deliver

GigaBrain's workroom auto-accepts and Arc executes the task. You'll see a notification when the deliverable hash is committed on-chain.

```bash
# Watch agreement status
arc402 agreements
# Expected: agreement transitions → ACCEPTED → FULFILLED

# When FULFILLED — verify the deliverable
arc402 verify <agreement-id>
```

---

## Phase 10 — Fetch the delivered package

```bash
# List files available for the agreement
arc402 job files <agreement-id>
# Expected: legogigabrain-agent-os-2.0.0.tgz | ~76KB | 0x...

# Download the AgentOS package (hash-verified automatically)
arc402 job fetch <agreement-id> \
  --file legogigabrain-agent-os-2.0.0.tgz \
  --out ~/agent-os-delivery/

# Expected output:
# ✓ legogigabrain-agent-os-2.0.0.tgz (76KB) — hash verified
# Saved to ~/agent-os-delivery/

# Unpack
mkdir ~/agent-os && tar -xzf ~/agent-os-delivery/legogigabrain-agent-os-2.0.0.tgz -C ~/agent-os --strip-components=1
ls ~/agent-os/
```

---

## Phase 11 — Install AgentOS

```bash
cd ~/agent-os

# Run the installer
GIGABRAIN_WORKSPACE=/path/to/your/workspace \
  node --experimental-sqlite scripts/setup.js --yes
```

Expected output:
```
@legogigabrain/agent-os v2.0.0 — Setup
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[ Plugin Files ]
  ✓ membrain copied to ~/.openclaw/extensions/membrain
  ✓ membrain dependencies installed
  ✓ immune-system copied to ~/.openclaw/extensions/immune-system
  ✓ cognitive-signatures copied to ~/.openclaw/extensions/cognitive-signatures

[ MemBrain ]
  ✓ MemBrain DB initialised

[ Immune System ]
  ✓ Immune System config written (6 rules active)

[ Cognitive Signatures + Neurogenesis ]
  ✓ Neurogenesis proposals file initialised

[ Plugin Registration ]
  ✓ openclaw.json patched

[ Cron Wiring ]
  ✓ cron added: MemBrain reclassify
  ✓ cron added: MemBrain embed

AgentOS v2.0.0 installed.
```

---

## Phase 12 — Activate and verify

```bash
# Restart gateway to load the new plugins
openclaw gateway restart

# Run AgentOS doctor
GIGABRAIN_WORKSPACE=/path/to/your/workspace \
  node --experimental-sqlite ~/agent-os/scripts/agentosctl.js doctor
```

Expected:
```
Layer              Status  Detail
MemBrain           ✓    DB ... MB · N chunks
Immune System      ✓    6/6 rules active
Signature          ✓    ...
Cron               ✓    reclassify + embed wired

All layers healthy.
```

```bash
# Verify all three plugins are active in OpenClaw
openclaw plugins
# Expected:
#   arc402          1.0.1
#   membrain        1.0.0
#   immune-system   1.0.0
#   cognitive-signatures 1.0.0
```

---

## What success looks like

All of the following true:
- [ ] Workroom running, doctor passes
- [ ] Worker identity initialized
- [ ] OpenClaw gateway routing active
- [ ] On-chain hire submitted and fulfilled
- [ ] AgentOS package received via party-gated delivery
- [ ] All 3 plugins installed and active
- [ ] `agentosctl doctor` — all layers green

---

## What to record

For each phase, note:
- ✅ Passed cleanly
- ⚠️ Passed with friction (describe exactly what was unclear)
- ❌ Failed (exact command + output)

**Categories to watch:**
- Install friction — anything that required prior knowledge
- Missing docs — steps that needed explanation that isn't there
- Config gaps — anything that needed manual editing
- Workroom timing — how long each phase took
- Gateway routing issues — OpenClaw → workroom path
- Delivery layer — did the file fetch work first try?
- AgentOS install — any errors or unexpected prompts

---

*Owner: Engineering (Forge)*
*This runbook is the beta test. What breaks here gets fixed before launch.*
