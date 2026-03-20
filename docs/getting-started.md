# Getting Started with ARC-402

Launch-scope setup only. This guide reflects the current production surface:

- `app.arc402.xyz/onboard` for wallet + passkey + optional policy + optional agent registration
- `app.arc402.xyz/passkey-sign` for OpenShell-contained governance approvals
- OpenClaw with ARC-402's governed workroom as the default operator path
- OpenShell as the underlying containment layer behind ARC-402 commands, not a separate product story

Phase 2 items are intentionally out of scope here: no Privy/email onboarding and no gas sponsorship flow.

---

## Choose your setup path

ARC-402 launch setup deliberately splits into two surfaces:
- **phone** for owner-wallet and passkey approvals
- **operator machine** for the always-on governed workroom

That split is intentional. The docs should remove the cognitive burden of deciding where each action belongs while still making ARC-402 feel like one product.

### Option A — Mobile-first onboarding
Use this if you want the fastest path to a launch-ready wallet and passkey.

1. Fund your owner wallet with a small amount of Base ETH.
2. Open `https://app.arc402.xyz/onboard` on your phone.
3. Complete the four-step launch flow:
   - deploy ARC-402 wallet
   - register Face ID / passkey
   - apply launch-safe policy defaults (optional but recommended)
   - register the agent (optional at onboarding time)
4. Start your operator runtime through the OpenClaw/OpenShell path.
5. Use `https://app.arc402.xyz/passkey-sign` whenever the OpenShell-contained ARC-402 runtime requests a passkey governance signature.

### Option B — CLI-first operator setup
Use this if you want to begin from local tooling and runtime setup.

1. Install the CLI and initialize local config.
2. Configure your ARC-402 operator environment.
3. Deploy or connect your wallet.
4. Use the mobile passkey pages when governance approval is required.
5. Initialize OpenShell.
6. Start the ARC-402 runtime through the OpenShell-owned path.

Both paths converge on the same launch architecture: ARC-402 on Base, OpenClaw as the existing agent runtime, and an OpenShell-backed sandboxed workroom dedicated to hired execution. You are not migrating your whole OpenClaw environment; ARC-402 adds a governed commerce sandbox for the paid-work path.

| Surface | What belongs there |
|---|---|
| **Phone / approval device** | owner-wallet confirmation, passkey registration, passkey-sign approvals |
| **Operator machine** | CLI install/config, OpenClaw skill install, OpenShell init, daemon/runtime start, endpoint setup |

---

## Web launch flow

### 1. Deploy wallet

The onboarding page connects to your existing wallet over WalletConnect and deploys an ARC-402 wallet on Base mainnet. If you already have one, it is detected and reused.

### 2. Register Face ID / passkey

The passkey is created in the device secure enclave and the public key is activated on-chain against your ARC-402 wallet. After activation, governance signing moves from the owner EOA to the passkey flow.

### 3. Apply policy defaults

Launch scope supports:

- velocity limit
- optional guardian address
- max hire price / category policy

### 4. Register agent

If you already know the endpoint and launch metadata, finish agent registration in the same onboarding flow. If not, you can skip it and register later via CLI.

Endpoint options at launch — choose one:

| Path | When to use | How |
|------|-------------|-----|
| **Claim `youragent.arc402.xyz`** (recommended) | You want the fastest path to a discoverable agent endpoint | Enter your preferred subdomain name during onboarding or run `arc402 agent claim-subdomain <name> --tunnel-target <url>` from the CLI |
| **Bring your own URL** | You already operate public HTTPS ingress on your own domain | Enter your custom HTTPS URL in the endpoint field during onboarding or pass `--endpoint <url>` to `arc402 agent register` |

The canonical `arc402.xyz` subdomain path has first-class ARC-402 claim, scaffold, and endpoint doctor tooling built around it. Custom URLs work but you manage your own DNS, TLS, and ingress.

---

## Operator runtime

Install and configure the CLI tooling:

```bash
npm install -g arc402-cli
arc402 --version
arc402 config init
```

For launch deployments, treat ARC-402 runtime behavior as a governed workroom attached to your existing OpenClaw setup.

The CLI still exposes daemon commands, but they should be understood as implementation tooling behind that ARC-402 runtime path rather than the default standalone architecture.

---

## OpenShell runtime

ARC-402's launch-default runtime path is a dedicated sandboxed workroom backed by OpenShell.

```bash
arc402 openshell install
arc402 openshell init
arc402 openshell status
arc402 openshell doctor
```

The premium path here is deliberate:
- `arc402 openshell init` auto-reuses machine key / Telegram details from your ARC-402 CLI config when possible
- it creates or updates the OpenShell credential providers for you
- it syncs the current ARC-402 CLI runtime into the sandbox automatically
- `arc402 openshell status` verifies both the policy wiring and that the remote daemon bundle is actually present
- `arc402 openshell doctor` isolates the broken layer when a clean-machine install fails: Docker, OpenShell gateway, providers, sandbox, runtime sync, or daemon boot

OpenShell contains the ARC-402 runtime path and sandboxes the worker behavior plus inherited subprocesses. In practice, ARC-402 gives the operator a dedicated commerce sandbox on the machine. Default allowed outbound access is limited to Base RPC, relay, bundler, and Telegram unless the operator extends the policy.

OpenShell version quirks are intentionally meant to stay behind ARC-402 commands. If OpenShell 0.0.10+ changes internal provider or sandbox CLI details again, the operator path should still remain the same: `arc402 openshell init` once, then `arc402 daemon start` — without making the operator reason about a full environment migration.

---

## Passkey approvals after launch

When the OpenShell-contained ARC-402 runtime needs a governance approval, it generates a link to `app.arc402.xyz/passkey-sign`. Open that page on the device that holds the passkey and approve with Face ID / fingerprint.

---

## Before GitHub polish

- verify onboarding end-to-end on a real phone wallet
- verify daemon → passkey-sign round trip with a real passkey
- verify the OpenShell-owned runtime start path (`arc402 openshell init` → `arc402 daemon start`)
- verify direct daemon fallback only as recovery/development behavior, not launch architecture
- verify agent registration only after endpoint details are real
