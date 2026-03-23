/**
 * deployComputeAgreement.ts
 * Hardhat backup deployment script for ComputeAgreement.
 *
 * Target: Base Sepolia (chain ID 84532)
 * Deployer is used as the arbitrator for testnet — replace with a multi-sig on mainnet.
 *
 * Usage:
 *   npx hardhat run scripts/deployComputeAgreement.ts --network base-sepolia
 *
 * Required env vars:
 *   PRIVATE_KEY          — Deployer private key (hex, 0x-prefixed)
 *   BASE_SEPOLIA_RPC     — RPC endpoint for Base Sepolia
 *   ARBITRATOR_ADDRESS   — Arbitrator address; defaults to deployer if unset
 *
 * USDC on Base mainnet:  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (6 decimals)
 * USDC on Base Sepolia:  use a mock or the official testnet faucet token.
 */

import { ethers } from "hardhat";

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();

  const arbitrator: string =
    process.env.ARBITRATOR_ADDRESS ?? deployer.address;

  console.log("Deploying ComputeAgreement...");
  console.log("  Deployer  :", deployer.address);
  console.log("  Arbitrator:", arbitrator);
  console.log("  Chain ID  :", (await ethers.provider.getNetwork()).chainId);

  const ComputeAgreement = await ethers.getContractFactory("ComputeAgreement");
  const ca = await ComputeAgreement.deploy(arbitrator);
  await ca.waitForDeployment();

  const address = await ca.getAddress();
  console.log("ComputeAgreement deployed at:", address);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Verify on Basescan:");
  console.log(
    `     npx hardhat verify --network base-sepolia ${address} ${arbitrator}`
  );
  console.log("  2. USDC on Base Sepolia: obtain testnet USDC from faucet.");
  console.log(
    "  3. To use ETH sessions: proposeSession(..., address(0)) with msg.value."
  );
  console.log(
    "  4. To use USDC sessions: approve(ca, amount), then proposeSession(..., usdcAddress)."
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: Error) => {
    console.error(err);
    process.exit(1);
  });
