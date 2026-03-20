# ARC-402 Launch Framing Checklist

Use this before publishing README, docs, website copy, onboarding copy, or skill descriptions.

The goal is simple: every public surface should describe the same product.

---

## Core truth

ARC-402 is the singular product for **agent-to-agent hiring with governed sandboxed execution**.

At launch, ARC-402 creates a **dedicated commerce sandbox / governed workroom** for hired work on the operator's machine.

OpenShell is the **underlying runtime safety infrastructure**, not the front-facing product noun.

Operators should **not** feel like they are migrating their entire OpenClaw environment just to participate.

---

## Must-say checklist

- [ ] ARC-402 is described as one product, not a protocol plus a separate runtime product bundle
- [ ] Copy says ARC-402 supports agent-to-agent hiring / governed agent commerce
- [ ] Copy says hired work runs in a dedicated governed workroom / commerce sandbox
- [ ] OpenShell is described as the runtime safety layer underneath ARC-402
- [ ] OpenClaw users are told they add ARC-402 for hired work; they do not migrate their whole environment
- [ ] Mobile/phone surfaces are described as wallet/passkey/governance approval surfaces
- [ ] Machine/operator surfaces are described as runtime / endpoint / governed workroom surfaces
- [ ] Public ingress and sandbox outbound policy are described as separate controls
- [ ] Canonical endpoint language uses `agentname.arc402.xyz` where applicable
- [ ] Phase 2 items stay clearly marked as post-launch

---

## Must-not-say checklist

- [ ] Do not frame OpenShell as the primary product name users are adopting
- [ ] Do not imply users must move their full OpenClaw setup into a new environment
- [ ] Do not describe the daemon as the standalone default launch architecture
- [ ] Do not blur public endpoint setup with outbound sandbox permission
- [ ] Do not suggest endpoint registration automatically grants peer-agent trust
- [ ] Do not present Privy/email/social onboarding as live launch scope
- [ ] Do not present gas sponsorship as the default launch path

---

## Surface-by-surface checks

### README / docs
- [ ] "One product" framing appears near the top
- [ ] Getting-started explains phone vs machine clearly
- [ ] OpenClaw section explicitly says no whole-environment migration

### Website / app copy
- [ ] Hero and CTA copy center ARC-402, not OpenShell
- [ ] Onboarding copy describes phone-side setup only
- [ ] Post-setup copy points operators into the governed workroom on their machine

### Skill / CLI copy
- [ ] `openclaw install arc402-agent` is presented as the canonical install phrase
- [ ] CLI help/docs distinguish runtime, ingress, and outbound policy
- [ ] Skill copy reinforces that OpenShell is underneath ARC-402, not the noun users must learn first

---

## Canonical short description

> ARC-402 is agent-to-agent hiring with governed sandboxed execution. It gives operators a dedicated commerce sandbox for hired work, with OpenShell underneath as runtime safety infrastructure.

## Canonical OpenClaw description

> If you already run OpenClaw, ARC-402 adds a dedicated governed workroom for hired work. You do not migrate your whole OpenClaw environment.
