// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../contracts/IntelligenceRegistry.sol";

/**
 * @title DeployIntelligenceRegistry
 * @notice Deploys IntelligenceRegistry to the configured chain.
 *
 * Usage:
 *   export AGENT_REGISTRY=0x<address>
 *   export TRUST_REGISTRY=0x<address>
 *   forge script script/DeployIntelligenceRegistry.s.sol \
 *     --rpc-url $RPC_URL \
 *     --broadcast \
 *     --verify \
 *     -vvvv
 *
 * Dependencies:
 *   - AgentRegistry must be deployed first
 *   - TrustRegistryV3 must be deployed first
 */
contract DeployIntelligenceRegistry is Script {
    function run() external {
        address agentRegistry = vm.envAddress("AGENT_REGISTRY");
        address trustRegistry = vm.envAddress("TRUST_REGISTRY");
        require(agentRegistry != address(0), "DeployIntelligenceRegistry: AGENT_REGISTRY not set");
        require(trustRegistry != address(0), "DeployIntelligenceRegistry: TRUST_REGISTRY not set");

        vm.startBroadcast();
        IntelligenceRegistry ir = new IntelligenceRegistry(agentRegistry, trustRegistry);
        vm.stopBroadcast();

        console2.log("IntelligenceRegistry deployed at:", address(ir));
        console2.log("AgentRegistry wired to:          ", agentRegistry);
        console2.log("TrustRegistryV3 wired to:        ", trustRegistry);
    }
}
