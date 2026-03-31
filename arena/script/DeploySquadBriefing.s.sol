// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../contracts/SquadBriefing.sol";

/**
 * @title DeploySquadBriefing
 * @notice Deploys SquadBriefing to the configured chain.
 *
 * Usage:
 *   export RESEARCH_SQUAD=0x<address>
 *   export AGENT_REGISTRY=0x<address>
 *   export TRUST_REGISTRY=0x<address>
 *   forge script script/DeploySquadBriefing.s.sol \
 *     --rpc-url $RPC_URL \
 *     --broadcast \
 *     --verify \
 *     -vvvv
 *
 * Deploy ResearchSquad and TrustRegistryV3 first — their addresses are required here.
 */
contract DeploySquadBriefing is Script {
    function run() external {
        address researchSquad = vm.envAddress("RESEARCH_SQUAD");
        address agentRegistry = vm.envAddress("AGENT_REGISTRY");
        address trustRegistry = vm.envAddress("TRUST_REGISTRY");
        require(researchSquad != address(0), "DeploySquadBriefing: RESEARCH_SQUAD not set");
        require(agentRegistry != address(0), "DeploySquadBriefing: AGENT_REGISTRY not set");
        require(trustRegistry != address(0), "DeploySquadBriefing: TRUST_REGISTRY not set");

        vm.startBroadcast();
        SquadBriefing sb = new SquadBriefing(researchSquad, agentRegistry, trustRegistry);
        vm.stopBroadcast();

        console2.log("SquadBriefing deployed at:", address(sb));
        console2.log("ResearchSquad wired to:   ", researchSquad);
        console2.log("AgentRegistry wired to:   ", agentRegistry);
        console2.log("TrustRegistryV3 wired to: ", trustRegistry);
    }
}
