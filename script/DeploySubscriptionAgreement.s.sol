// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Script.sol";
import "../contracts/src/SubscriptionAgreement.sol";

/**
 * @title DeploySubscriptionAgreement
 * @notice Forge deployment script for SubscriptionAgreement.
 *
 *  Target: Base Sepolia (chain ID 84532)
 *  Deployer becomes the owner — transfer ownership to a multi-sig post-deploy.
 *
 *  Usage:
 *    forge script script/DeploySubscriptionAgreement.s.sol \
 *      --rpc-url $BASE_SEPOLIA_RPC \
 *      --private-key $PRIVATE_KEY \
 *      --broadcast \
 *      --verify \
 *      --etherscan-api-key $BASESCAN_API_KEY
 *
 *  Environment variables:
 *    BASE_SEPOLIA_RPC        — RPC endpoint (e.g. Alchemy/Infura Base Sepolia)
 *    PRIVATE_KEY             — Deployer private key (hex, 0x-prefixed)
 *    DISPUTE_ARBITRATION     — Optional: DisputeArbitration contract address
 *    BASESCAN_API_KEY        — For contract verification on Basescan
 *
 *  Post-deploy:
 *    1. Call setDisputeArbitration(DISPUTE_ARBITRATION) if DA is available.
 *    2. Call setArbitratorApproval(arbitrator, true) for each trusted arbitrator.
 *    3. Transfer ownership to a multi-sig via transferOwnership + acceptOwnership.
 *
 *  USDC on Base mainnet: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (6 decimals)
 *  USDC on Base Sepolia: use a mock or the official testnet faucet token.
 */
contract DeploySubscriptionAgreement is Script {
    function run() external {
        vm.startBroadcast();

        SubscriptionAgreement subAgreement = new SubscriptionAgreement();

        // Optionally wire DisputeArbitration if address is provided
        address da = vm.envOr("DISPUTE_ARBITRATION", address(0));
        if (da != address(0)) {
            subAgreement.setDisputeArbitration(da);
        }

        vm.stopBroadcast();

        console2.log("SubscriptionAgreement deployed at:", address(subAgreement));
        console2.log("Owner (deployer):", subAgreement.owner());
        if (da != address(0)) {
            console2.log("DisputeArbitration:", da);
        }
        console2.log("Chain ID:", block.chainid);
    }
}
