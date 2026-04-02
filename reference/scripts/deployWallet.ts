/**
 * Deploy a fresh ARC402Wallet pointing at ARC402RegistryV2.
 *
 * Usage (testnet):  npx hardhat run scripts/deployWallet.ts --network base-sepolia
 * Usage (mainnet):  npx hardhat run scripts/deployWallet.ts --network base-mainnet
 *
 * The wallet auto-registers on PolicyEngine and enables DeFi access during construction.
 */
import { ethers } from "hardhat";

// ─── Config ───────────────────────────────────────────────────────────────────

const MAINNET = {
  registry: "0xcc0D8731ccCf6CFfF4e66F6d68cA86330Ea8B622",  // ARC402RegistryV2
  owner:    "0x7745772d67cd52c1f38706bf5550adcd925c7c00",  // Lego's MetaMask
};

const TESTNET = {
  registry: "0x92E71f040742EBF7819b082cc3AAF8c611f3C281",  // ARC402RegistryV2 — v2 fresh deploy 2026-03-15
  owner:    "0x7745772d67cd52c1f38706bf5550adcd925c7c00",
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const isMainnet = network.chainId === 8453n;
  const cfg = isMainnet ? MAINNET : TESTNET;

  console.log("Network:   ", isMainnet ? "Base Mainnet" : "Base Sepolia");
  console.log("Deployer:  ", deployer.address);
  console.log("Balance:   ", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("Registry:  ", cfg.registry);
  console.log("Owner:     ", cfg.owner);
  console.log();

  // Verify registry resolves before deploying
  const regAbi = ["function getContracts() view returns (tuple(address,address,address,address,address,address,address,address,address,address))"];
  const reg = new ethers.Contract(cfg.registry, regAbi, ethers.provider);
  try {
    await reg.getContracts();
    console.log("✅ Registry getContracts() — OK");
  } catch (e: any) {
    console.error("❌ Registry getContracts() failed:", e.reason || e.message);
    if (isMainnet) process.exit(1); // Don't deploy on mainnet with broken registry
    console.warn("⚠ Proceeding on testnet anyway...");
  }

  // Deploy wallet
  const WalletFactory = await ethers.getContractFactory("ARC402Wallet");

  // Use EIP-1559 market pricing — Base Sepolia basefee is typically ~0.001–0.01 gwei,
  // far below the hardhat.config.ts legacy gasPrice of 2 gwei.
  console.log("\nDeploying ARC402Wallet...");
  const feeData = await ethers.provider.getFeeData();
  const wallet = await WalletFactory.deploy(cfg.registry, cfg.owner, {
    maxFeePerGas:         feeData.maxFeePerGas         ?? ethers.parseUnits("0.1",   "gwei"),
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? ethers.parseUnits("0.001", "gwei"),
  });
  await wallet.waitForDeployment();
  const addr = await wallet.getAddress();

  console.log("✅ ARC402Wallet deployed:", addr);
  console.log("   Tx:", wallet.deploymentTransaction()?.hash);
  console.log();

  // Verify via low-level call (ARC402Wallet may expose owner/registry under different ABI slots)
  try {
    const walletContract = await ethers.getContractAt("ARC402Wallet", addr);
    const ownerOnChain    = await walletContract.owner();
    const registryOnChain = await walletContract.registry();
    console.log("Owner on-chain:    ", ownerOnChain);
    console.log("Registry on-chain: ", registryOnChain);
  } catch (_) {
    console.log("(Skipping on-chain read — ABI mismatch in verify step; deployment is confirmed by tx receipt)");
  }
  console.log();

  if (isMainnet) {
    console.log("── Next steps ──────────────────────────────────────────────────────");
    console.log("1. Update CLI config:");
    console.log("   arc402 config set walletContractAddress", addr);
    console.log("2. Set guardian key:");
    console.log("   arc402 wallet set-guardian");
    console.log("3. Set velocity limit:");
    console.log("   arc402 wallet set-velocity-limit 0.05");
    console.log("4. Set spending limits:");
    console.log("   arc402 wallet policy set-limit --category general --amount 0.02");
    console.log("   arc402 wallet policy set-limit --category research --amount 0.05");
    console.log("   arc402 wallet policy set-limit --category compute --amount 0.10");
    console.log("5. Update gigabrain.arc402.xyz endpoint:");
    console.log("   arc402 agent update --endpoint https://gigabrain.arc402.xyz");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
