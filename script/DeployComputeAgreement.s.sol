// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Script.sol";
import "../contracts/src/ComputeAgreement.sol";

/**
 * @title DeployComputeAgreement
 * @notice Forge deployment script for ComputeAgreement.
 *
 *  Target: Base Sepolia (chain ID 84532)
 *  Deployer is used as the arbitrator for testnet — replace with a multi-sig on mainnet.
 *
 *  Usage:
 *    forge script script/DeployComputeAgreement.s.sol \
 *      --rpc-url $BASE_SEPOLIA_RPC \
 *      --private-key $PRIVATE_KEY \
 *      --broadcast \
 *      --verify \
 *      --etherscan-api-key $BASESCAN_API_KEY
 *
 *  Environment variables:
 *    BASE_SEPOLIA_RPC    — RPC endpoint (e.g. Alchemy/Infura Base Sepolia)
 *    PRIVATE_KEY         — Deployer private key (hex, 0x-prefixed)
 *    ARBITRATOR_ADDRESS  — Arbitrator address; defaults to deployer if unset
 *    BASESCAN_API_KEY    — For contract verification on Basescan
 *
 *  USDC on Base mainnet: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (6 decimals)
 *  USDC on Base Sepolia: use a mock or the official testnet faucet token.
 */
contract DeployComputeAgreement is Script {
    function run() external {
        // Resolve arbitrator — default to deployer for testnet convenience.
        address arbitrator = vm.envOr("ARBITRATOR_ADDRESS", msg.sender);

        vm.startBroadcast();

        ComputeAgreement ca = new ComputeAgreement(arbitrator);

        vm.stopBroadcast();

        console2.log("ComputeAgreement deployed at:", address(ca));
        console2.log("Arbitrator:", arbitrator);
        console2.log("Chain ID:", block.chainid);
    }
}
