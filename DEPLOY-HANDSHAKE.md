# Deploy Handshake Contract — Quick Guide

## Prerequisites
- Deployer wallet with ETH on Base mainnet (gas only, ~$0.10)
- `forge` installed (Foundry)
- Deployer private key

## Step 1: Deploy Handshake + Allow USDC

```bash
cd /home/lego/.openclaw/workspace-engineering/products/arc-402/reference

# Deploy Handshake.sol
forge create contracts/Handshake.sol:Handshake \
  --rpc-url https://mainnet.base.org \
  --private-key $DEPLOYER_KEY \
  --verify \
  --etherscan-api-key $BASESCAN_KEY
```

Save the deployed address. Then:

```bash
# Allow USDC on the Handshake contract
HANDSHAKE=<deployed_address>
USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

cast send $HANDSHAKE "setAllowedToken(address,bool)" $USDC true \
  --rpc-url https://mainnet.base.org \
  --private-key $DEPLOYER_KEY
```

## Step 2: Verify on Basescan

```bash
forge verify-contract $HANDSHAKE contracts/Handshake.sol:Handshake \
  --chain base \
  --etherscan-api-key $BASESCAN_KEY
```

## Step 3: Whitelist on Your Wallet

```bash
POLICY_ENGINE=0xAA5Ef3489C929bFB3BFf5D5FE15aa62d3763c847
WALLET=0xb4aF8760d349a6A4C8495Ae4da9089bC84994eE6

cast send $POLICY_ENGINE "whitelistContract(address,address)" $WALLET $HANDSHAKE \
  --rpc-url https://mainnet.base.org \
  --private-key $DEPLOYER_KEY
```

## Step 4: Update CLI Config

```bash
# In cli/src/config.ts, set:
handshakeAddress: "<deployed_address>"

# Rebuild
cd /home/lego/.openclaw/workspace-engineering/products/arc-402/cli
npm run build
```

## Step 5: Send First Handshake

```bash
arc402 shake send <other_agent_address> --type hello --note "gm from ARC-402"
```

## Step 6: Update ENGINEERING-STATE.md

Add to the v2 mainnet contract table:
```
| Handshake ← active | `<deployed_address>` |
```

## Contract Details
- **Source:** `reference/contracts/Handshake.sol`
- **Tests:** 33/33 passing (`forge test --match-contract HandshakeTest`)
- **Size:** 12.2 KB (under EIP-170 limit)
- **USDC (Base):** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- **No audit needed:** contract never holds funds, pure signal + forwarding
