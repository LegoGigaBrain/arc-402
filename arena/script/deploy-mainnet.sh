#!/bin/bash
# Arena V2 — Base Mainnet Deploy
# Run from repo root: bash arena/script/deploy-mainnet.sh

set -e

export DEPLOYER_PRIVATE_KEY=$(grep "^DEPLOYER_PRIVATE_KEY=" reference/.env | cut -d= -f2)
export BASESCAN_API_KEY=$(grep "^BASESCAN_API_KEY=" reference/.env | cut -d= -f2)
export TREASURY_ADDRESS=$(grep "^TREASURY_ADDRESS=" reference/.env | cut -d= -f2)
export DEPLOYER_ADDRESS=$(grep "^DEPLOYER_ADDRESS=" reference/.env | cut -d= -f2)

RPC_URL="https://base-mainnet.g.alchemy.com/v2/4qLWAyk8_-2ExU6SDKgNU"

# Mainnet addresses (from ENGINEERING-STATE.md)
export AGENT_REGISTRY="0xD5c2851B00090c92Ba7F4723FB548bb30C9B6865"
export POLICY_ENGINE="0x9449B15268bE7042C0b473F3f711a41A29220866"
export WATCHTOWER_REGISTRY="0xbC811d1e3c5C5b67CA57df1DFb08847b1c8c458A"
export GOVERNANCE="0xE931DD2EEb9Af9353Dd5E2c1250492A0135E0EC4"
export USDC_ADDRESS="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
export TREASURY="${TREASURY_ADDRESS:-0xb55B6e4A6A8F52c3e3087A1199d6779ee0AB3DE4}"
export FEE_BPS="300"
export TRUST_REGISTRY="0x22366D6dabb03062Bc0a5E893EfDff15D8E329b1"
export SERVICE_AGREEMENT="0xC98B402CAB9156da68A87a69E3B4bf167A3CCcF6"
export MIN_CITER_TRUST="300"

# Already deployed — passed as env vars for dependent contracts
export STATUS_REGISTRY="0x5367C514C733cc5A8D16DaC35E491d1839a5C244"
export RESEARCH_SQUAD="0xa758d4a9f2EE2b77588E3f24a2B88574E3BF451C"

echo "=================================================="
echo "  ARC Arena V2 — Base Mainnet Deploy"
echo "=================================================="
echo "  RPC:       $RPC_URL"
echo "  Deployer:  $DEPLOYER_ADDRESS"
echo "  Treasury:  $TREASURY"
echo ""
echo "  Already deployed:"
echo "    StatusRegistry: $STATUS_REGISTRY"
echo "    ResearchSquad:  $RESEARCH_SQUAD"
echo ""

ARENA_DIR="$(pwd)/arena"

deploy() {
  local name=$1
  local script=$2
  echo "── Deploying $name ─────────────────────────"
  cd "$ARENA_DIR"
  forge script "script/${script}" \
    --rpc-url "$RPC_URL" \
    --private-key "$DEPLOYER_PRIVATE_KEY" \
    --broadcast \
    -vvv 2>&1 | grep -v "^.\[2m" | grep -v "WARN.*failed to parse"
  cd - > /dev/null
  echo "  ✅ $name deployed"
  echo ""
}

deploy "SquadBriefing"        "DeploySquadBriefing.s.sol"
deploy "AgentNewsletter"      "DeployAgentNewsletter.s.sol"
deploy "ArenaPool"            "DeployArenaPool.s.sol"
deploy "IntelligenceRegistry" "DeployIntelligenceRegistry.s.sol"
deploy "SquadRevenueSplit"    "DeploySquadRevenueSplit.s.sol"

echo "=================================================="
echo "  All 7 Arena contracts deployed ✅"
echo "  Update ENGINEERING-STATE.md with addresses."
echo "=================================================="
