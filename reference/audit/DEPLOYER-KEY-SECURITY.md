# ARC-402 Deployer Key Security Guide

## Current State (Base Sepolia — Testnet)

- **Deployer wallet:** 0x59A32A792d0f25B0E0a4A4aFbFDf514b94B102fB
- **Key storage:** `.env` file (local only)
- **Risk level:** LOW — testnet only, funds not significant
- **Git exposure:** NONE — `.env` was never committed to git history ✅

---

## Git History Audit Results

| Check | Result |
|-------|--------|
| `.env` ever committed to git? | **NO** — 0 commits touch this file ✅ |
| `.gitignore` existed before this audit? | **NO** — created during this audit ⚠️ |
| Private key value in any script/commit? | **NO** — scripts reference `$DEPLOYER_PRIVATE_KEY` env var by name only ✅ |
| Key in git commit messages? | **NO** — no grep hits for private/key patterns ✅ |

> **Finding:** The `.env` file was never tracked by git. However, a `.gitignore` did not exist prior to this audit, meaning any future `git add .` could have accidentally staged it. `.gitignore` has now been created and `.env` / `*.env` are explicitly excluded.

---

## Before Mainnet Deploy — Required Actions

### 1. Rotate to Hardware Wallet

The mainnet deploy **MUST** be done from a hardware wallet (Ledger or Trezor), not from a software key in a `.env` file.

Steps:
1. Get a Ledger Nano X or Trezor Model T
2. Set up a dedicated "ARC-402 Protocol" account (separate from personal wallet)
3. Fund it with ETH for deployment gas
4. Use Foundry's Ledger integration:
   ```bash
   forge script --ledger --hd-paths "m/44'/60'/0'/0/0" --broadcast
   ```
5. After deployment, this hardware wallet becomes the owner of all canonical contracts

### 2. Or: Use a Gnosis Safe as Deployer (Preferred for a Protocol)

1. Create a Gnosis Safe with 3-of-5 threshold
2. Signers: Lego's hardware wallet + 2–4 trusted parties
3. Deploy canonical contracts with the Safe as owner
4. All governance actions (registry updates, updater changes) require multisig

This eliminates single-point-of-failure on the deployer key entirely.

### 3. .env File Handling

- **NEVER** commit `.env` to git (now gitignored — maintain this)
- **NEVER** share `.env` contents in Telegram, Discord, or any messaging platform
- Testnet `.env` can live in the repo directory (gitignored)
- Mainnet: use environment variables set at deployment time, **never stored in files**

### 4. After Mainnet Deploy

1. The testnet `.env` key should be considered potentially exposed (shared across multiple sessions)
2. For mainnet: generate a fresh key on hardware wallet
3. The testnet deployer wallet (`0x59A32A...`) should **not** be reused for mainnet
4. If the testnet `.env` was ever shared in any message (Telegram, etc.) — treat it as compromised; rotate testnet deployment contracts if you care about testnet integrity

---

## Blast Radius of a Compromised Deployer Key

| Action attacker can take | Impact |
|--------------------------|--------|
| Drain deployer wallet ETH | Financial loss |
| Deploy malicious `ARC402Registry` | Can trick wallets into using malicious infrastructure |
| Update `ARC402Registry` to point to malicious contracts | All wallets using `setRegistry()` at risk |
| Add themselves as authorized updater in `TrustRegistry` | Can manipulate trust scores |
| Deploy malicious `WalletFactory` | Can deploy backdoored wallets |

> **Critical architecture note:** Existing wallets that have **NOT** called `setRegistry()` are safe — they still point to the original registry address. This is why the user-sovereign upgrade model (no forced upgrades) is a core security property of ARC-402, not just a product choice.

---

## Immediate Action Checklist

- [x] Audit `.env` git history for exposure
- [x] Create `.gitignore` with `.env` and `*.env` excluded
- [ ] Plan hardware wallet purchase before mainnet (Ledger Nano X or Trezor Model T)
- [ ] Decide: hardware wallet solo OR Gnosis Safe multisig for mainnet deploy
- [ ] Generate fresh deployer key on hardware wallet (do not reuse testnet key)
- [ ] Document mainnet deployer wallet address in this file once decided
- [ ] Set `DEPLOYER_PRIVATE_KEY` as ephemeral env var at deploy time (not stored in any file)

---

## Audit Log

| Date | Auditor | Finding |
|------|---------|---------|
| 2026-03-11 | Forge (Engineering Subagent) | `.env` never committed. `.gitignore` missing — created. No key exposure in git history. |
