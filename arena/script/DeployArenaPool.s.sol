// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../contracts/ArenaPool.sol";

/**
 * @title DeployArenaPool
 * @notice Deployment script for ArenaPool V2 — fully agentically governed.
 *
 * Required environment variables:
 *   USDC_ADDRESS         — USDC token address (Base mainnet: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
 *   POLICY_ENGINE        — PolicyEngine contract address
 *   AGENT_REGISTRY       — AgentRegistry contract address
 *   WATCHTOWER_REGISTRY  — WatchtowerRegistry address (0xbC811d1e3c5C5b67CA57df1DFb08847b1c8c458A)
 *   GOVERNANCE           — ARC402Governance timelock address (0xE931DD2EEb9Af9353Dd5E2c1250492A0135E0EC4)
 *   TREASURY             — Protocol fee destination
 *   FEE_BPS              — Initial fee in basis points (e.g. 300 = 3%)
 *
 * Usage:
 *   forge script script/DeployArenaPool.s.sol \
 *     --rpc-url $BASE_RPC_URL \
 *     --broadcast \
 *     --verify \
 *     --etherscan-api-key $BASESCAN_API_KEY \
 *     -vvvv
 */
contract DeployArenaPool is Script {
    function run() external returns (ArenaPool pool) {
        // ─── Read env vars ────────────────────────────────────────────────────

        address usdc              = vm.envAddress("USDC_ADDRESS");
        address policyEngine      = vm.envAddress("POLICY_ENGINE");
        address agentRegistry     = vm.envAddress("AGENT_REGISTRY");
        address watchtowerRegistry = vm.envAddress("WATCHTOWER_REGISTRY");
        address governance        = vm.envAddress("GOVERNANCE");
        address treasury          = vm.envAddress("TREASURY");
        uint256 feeBps            = vm.envUint("FEE_BPS");

        // ─── Validation ───────────────────────────────────────────────────────

        require(usdc               != address(0), "DeployArenaPool: USDC_ADDRESS not set");
        require(policyEngine       != address(0), "DeployArenaPool: POLICY_ENGINE not set");
        require(agentRegistry      != address(0), "DeployArenaPool: AGENT_REGISTRY not set");
        require(watchtowerRegistry != address(0), "DeployArenaPool: WATCHTOWER_REGISTRY not set");
        require(governance         != address(0), "DeployArenaPool: GOVERNANCE not set");
        require(treasury           != address(0), "DeployArenaPool: TREASURY not set");
        require(feeBps             <= 1_000,      "DeployArenaPool: FEE_BPS exceeds 10%");

        // ─── Deploy ───────────────────────────────────────────────────────────

        vm.startBroadcast();

        pool = new ArenaPool(
            usdc,
            policyEngine,
            agentRegistry,
            watchtowerRegistry,
            governance,
            treasury,
            feeBps
        );

        vm.stopBroadcast();

        // ─── Log ─────────────────────────────────────────────────────────────

        console2.log("ArenaPool V2 deployed at:", address(pool));
        console2.log("  USDC:               ", usdc);
        console2.log("  PolicyEngine:       ", policyEngine);
        console2.log("  AgentRegistry:      ", agentRegistry);
        console2.log("  WatchtowerRegistry: ", watchtowerRegistry);
        console2.log("  Governance:         ", governance);
        console2.log("  Treasury:           ", treasury);
        console2.log("  Fee (bps):          ", feeBps);
        console2.log("  ResolutionQuorum:   ", pool.RESOLUTION_QUORUM());
        console2.log("");
        console2.log("AGENTIC GOVERNANCE: No resolver. No admin keys.");
        console2.log("  Resolution: WatchtowerRegistry quorum (", pool.RESOLUTION_QUORUM(), "-of-M)");
        console2.log("  Fee changes: ARC402Governance timelock only");
    }
}
