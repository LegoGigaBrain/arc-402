/**
 * Deploy WalletFactory v2 on Base Mainnet, pointing at ARC402RegistryV2.
 *
 * Usage: npx hardhat run scripts/deployWalletFactoryMainnet.ts --network baseMainnet
 *
 * After deploy, update the factory address in:
 *   - cli/src/config.ts
 *   - reference/sdk/src/types.ts
 *   - python-sdk/arc402/types.py
 */
import { ethers } from "hardhat";

const ARC402_REGISTRY_V2 = "0xcc0D8731ccCf6CFfF4e66F6d68cA86330Ea8B622";
const TRUST_REGISTRY_V3  = "0x22366D6dabb03062Bc0a5E893EfDff15D8E329b1";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  if (network.chainId !== 8453n) {
    console.error("❌ Wrong network. This script is for Base Mainnet (8453) only.");
    process.exit(1);
  }

  console.log("Network:   Base Mainnet");
  console.log("Deployer:  ", deployer.address);
  console.log("Balance:   ", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("Registry:  ", ARC402_REGISTRY_V2, "(ARC402RegistryV2)");
  console.log();

  // Verify registry is reachable
  const regAbi = ["function getContracts() view returns (tuple(address,address,address,address,address,address,address,address,address,address))"];
  const reg = new ethers.Contract(ARC402_REGISTRY_V2, regAbi, ethers.provider);
  try {
    await reg.getContracts();
    console.log("✅ Registry getContracts() — OK");
  } catch (e: any) {
    console.error("❌ Registry getContracts() failed:", e.reason || e.message);
    process.exit(1);
  }

  // Deploy WalletFactory
  console.log("\nDeploying WalletFactory v2...");
  const Factory = await ethers.getContractFactory("WalletFactory");
  const factory = await Factory.deploy(ARC402_REGISTRY_V2);
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();

  console.log("✅ WalletFactory v2 deployed:", factoryAddr);
  console.log("   Tx:", factory.deploymentTransaction()?.hash);

  // Register WalletFactory as authorized updater on TrustRegistryV3
  console.log("\nRegistering WalletFactory as TrustRegistry updater...");
  const trAbi = ["function addUpdater(address updater) external", "function isAuthorizedUpdater(address) view returns (bool)"];
  const trustRegistry = new ethers.Contract(TRUST_REGISTRY_V3, trAbi, deployer);
  const addTx = await trustRegistry.addUpdater(factoryAddr);
  await addTx.wait();
  console.log("✅ WalletFactory added as updater on TrustRegistryV3");

  console.log("\n────────────────────────────────────────────────────────");
  console.log("WalletFactory v2:", factoryAddr);
  console.log("────────────────────────────────────────────────────────");
  console.log("\nNext — update these 3 files with the address above:");
  console.log("  cli/src/config.ts          line ~80");
  console.log("  reference/sdk/src/types.ts line ~89");
  console.log("  python-sdk/arc402/types.py line ~35");
  console.log("\nThen rebuild CLI: cd cli && npm run build");
  console.log("Then deploy your wallet: npx hardhat run scripts/deployWallet.ts --network baseMainnet");
}

main().catch((e) => { console.error(e); process.exit(1); });
