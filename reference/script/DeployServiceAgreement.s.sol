// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../contracts/ServiceAgreement.sol";
import "../contracts/TrustRegistry.sol";

/**
 * @title DeployServiceAgreement
 * @notice Deploys the ServiceAgreement contract (with TrustRegistry integration) for
 *         ARC-402 bilateral agent agreements. The deployer becomes the initial owner
 *         (dispute arbiter) and the ServiceAgreement is added as the only authorized
 *         TrustRegistry updater (T-02: trust scores tied to real fulfillments).
 *
 * Usage:
 *   # Deploy with a new TrustRegistry (standard):
 *   forge script script/DeployServiceAgreement.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL \
 *     --private-key $DEPLOYER_PRIVATE_KEY --broadcast --verify
 *
 *   # Deploy with an existing TrustRegistry:
 *   TRUST_REGISTRY_ADDRESS=0x... forge script script/DeployServiceAgreement.s.sol \
 *     --rpc-url $BASE_SEPOLIA_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY --broadcast --verify
 */
contract DeployServiceAgreement is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        // Optional: reuse an existing TrustRegistry. If unset, deploy a fresh one.
        address existingTrustRegistry = vm.envOr("TRUST_REGISTRY_ADDRESS", address(0));

        vm.startBroadcast(deployerKey);

        address trustRegistryAddr;
        if (existingTrustRegistry != address(0)) {
            trustRegistryAddr = existingTrustRegistry;
            console.log("TrustRegistry (existing): ", trustRegistryAddr);
        } else {
            TrustRegistry trustReg = new TrustRegistry();
            trustRegistryAddr = address(trustReg);
            console.log("TrustRegistry (new):      ", trustRegistryAddr);
        }

        ServiceAgreement serviceAgreement = new ServiceAgreement(trustRegistryAddr);
        console.log("ServiceAgreement:          ", address(serviceAgreement));
        console.log("Owner (arbiter):           ", serviceAgreement.owner());

        // T-02: ServiceAgreement is the ONLY authorized trust updater.
        //       Add it to the registry and remove the deployer's own updater access.
        TrustRegistry(trustRegistryAddr).addUpdater(address(serviceAgreement));
        TrustRegistry(trustRegistryAddr).removeUpdater(vm.addr(deployerKey));
        console.log("TrustRegistry updater set to ServiceAgreement only.");

        vm.stopBroadcast();

        console.log("\n=== ServiceAgreement DEPLOYMENT COMPLETE ===");
        console.log("The deployer is the initial dispute arbiter.");
        console.log("Transfer ownership via transferOwnership() (Ownable2Step on TrustRegistry).");
        console.log("Only ServiceAgreement can update trust scores — farming vector closed.");
    }
}
