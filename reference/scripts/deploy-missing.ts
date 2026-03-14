/**
 * ARC-402 Deploy Script — Missing 8 contracts to Base Sepolia
 *
 * Pre-condition: The following 14 contracts are already deployed on Base Sepolia.
 * This script deploys only the 8 that are missing and wires them to the existing addresses.
 *
 * MA-04 FIX: Script includes all required wiring steps for DisputeArbitration,
 * including SA.setDisputeArbitration() and TrustRegistry.addUpdater().
 *
 * Run: npx hardhat run scripts/deploy-missing.ts --network baseSepolia
 */

import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ─── Already-deployed Base Sepolia addresses ──────────────────────────────────

const DEPLOYED = {
  PolicyEngine:              "0x44102e70c2A366632d98Fe40d892a2501fC7fFF2",
  TrustRegistryV1:          "0x1D38Cf67686820D970C146ED1CC98fc83613f02B",
  TrustRegistryV2:          "0xfCc2CDC42654e05Dad5F6734cE5caFf3dAE0E94F",
  TrustRegistrySA:          "0xbd3f2F15F794FDE8B3A59B6643e4b7e985Ee1389", // SA-dedicated
  IntentAttestation:        "0x942c807Cc6E0240A061e074b61345618aBadc457",
  SettlementCoordinator:    "0x52b565797975781f069368Df40d6633b2aD03390",
  ARC402Registry:           "0x638C7d106a2B7beC9ef4e0eA7d64ed8ab656A7e6",
  AgentRegistry:            "0x07D526f8A8e148570509aFa249EFF295045A0cc9",
  WalletFactory:            "0xD560C22aD5372Aa830ee5ffBFa4a5D9f528e7B87",
  SponsorshipAttestation:   "0xc0d927745AcF8DEeE551BE11A12c97c492DDC989",
  ServiceAgreement:         "0xa214D30906A934358f451514dA1ba732AD79f158",
  SessionChannels:          "0x21340f81F5ddc9C213ff2AC45F0f34FB2449386d",
  DisputeModule:            "0xcAcf606374E29bbC573620afFd7f9f739D25317F",
  ReputationOracle:         "0x410e650113fd163389C956BC7fC51c5642617187",
};

const DEPLOYER_WALLET = "0x59A32A792d0f25B0E0a4A4aFbFDf514b94B102fB";

// Governance signers — deployer wallet is initial signer for testnet.
// Replace with multisig keys for mainnet.
const GOVERNANCE_SIGNERS = [DEPLOYER_WALLET];
const GOVERNANCE_THRESHOLD = 1; // 1-of-1 for testnet; upgrade to N-of-M for mainnet

async function main() {
  const network = hre.network.name;
  console.log(`\n🚀  ARC-402 Deploy Missing Contracts — ${network}`);
  console.log("════════════════════════════════════════════════════════\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Balance:  ${hre.ethers.formatEther(balance)} ETH\n`);

  const newAddresses: Record<string, string> = {};

  // ─── 1. ARC402Governance ─────────────────────────────────────────────────

  console.log("1/8  Deploying ARC402Governance...");
  const ARC402Governance = await hre.ethers.getContractFactory("ARC402Governance");
  const governance = await ARC402Governance.deploy(GOVERNANCE_SIGNERS, GOVERNANCE_THRESHOLD);
  await governance.waitForDeployment();
  newAddresses.ARC402Governance = await governance.getAddress();
  console.log(`     ✅ ARC402Governance: ${newAddresses.ARC402Governance}`);

  // ─── 2. ARC402Guardian ───────────────────────────────────────────────────

  console.log("2/8  Deploying ARC402Guardian...");
  const ARC402Guardian = await hre.ethers.getContractFactory("ARC402Guardian");
  const guardian = await ARC402Guardian.deploy();
  await guardian.waitForDeployment();
  newAddresses.ARC402Guardian = await guardian.getAddress();
  console.log(`     ✅ ARC402Guardian: ${newAddresses.ARC402Guardian}`);

  // ─── 3. ARC402Wallet (via WalletFactory) ─────────────────────────────────

  console.log("3/8  Deploying ARC402Wallet via WalletFactory...");
  const WalletFactory = await hre.ethers.getContractAt("WalletFactory", DEPLOYED.WalletFactory);
  const createWalletTx = await WalletFactory.createWallet();
  const receipt = await createWalletTx.wait();
  // Parse WalletCreated event to get the new wallet address
  const walletCreatedEvent = receipt?.logs
    .map((log: any) => {
      try { return WalletFactory.interface.parseLog(log); } catch { return null; }
    })
    .find((e: any) => e?.name === "WalletCreated");
  newAddresses.ARC402Wallet = walletCreatedEvent?.args?.walletAddress ?? "PARSE_ERROR";
  console.log(`     ✅ ARC402Wallet: ${newAddresses.ARC402Wallet}`);

  // ─── 4. AgreementTree ────────────────────────────────────────────────────

  console.log("4/8  Deploying AgreementTree...");
  const AgreementTree = await hre.ethers.getContractFactory("AgreementTree");
  const agreementTree = await AgreementTree.deploy(DEPLOYED.ServiceAgreement, deployer.address);
  await agreementTree.waitForDeployment();
  newAddresses.AgreementTree = await agreementTree.getAddress();
  console.log(`     ✅ AgreementTree: ${newAddresses.AgreementTree}`);

  // ─── 5. CapabilityRegistry ───────────────────────────────────────────────

  console.log("5/8  Deploying CapabilityRegistry...");
  const CapabilityRegistry = await hre.ethers.getContractFactory("CapabilityRegistry");
  const capabilityRegistry = await CapabilityRegistry.deploy(DEPLOYED.AgentRegistry, deployer.address);
  await capabilityRegistry.waitForDeployment();
  newAddresses.CapabilityRegistry = await capabilityRegistry.getAddress();
  console.log(`     ✅ CapabilityRegistry: ${newAddresses.CapabilityRegistry}`);

  // ─── 6. DisputeArbitration ───────────────────────────────────────────────

  console.log("6/8  Deploying DisputeArbitration...");
  const DisputeArbitration = await hre.ethers.getContractFactory("DisputeArbitration");
  const disputeArbitration = await DisputeArbitration.deploy(
    DEPLOYED.TrustRegistrySA,  // SA-dedicated trust registry
    deployer.address           // treasury (update after governance handoff)
  );
  await disputeArbitration.waitForDeployment();
  newAddresses.DisputeArbitration = await disputeArbitration.getAddress();
  console.log(`     ✅ DisputeArbitration: ${newAddresses.DisputeArbitration}`);

  // ─── 7. GovernedTokenWhitelist ────────────────────────────────────────────

  console.log("7/8  Deploying GovernedTokenWhitelist...");
  const GovernedTokenWhitelist = await hre.ethers.getContractFactory("GovernedTokenWhitelist");
  const tokenWhitelist = await GovernedTokenWhitelist.deploy(deployer.address);
  await tokenWhitelist.waitForDeployment();
  newAddresses.GovernedTokenWhitelist = await tokenWhitelist.getAddress();
  console.log(`     ✅ GovernedTokenWhitelist: ${newAddresses.GovernedTokenWhitelist}`);

  // ─── 8. WatchtowerRegistry (MA-01 FIX: requires sessionChannels address) ──

  console.log("8/8  Deploying WatchtowerRegistry (MA-01 fix: uses SessionChannels)...");
  const WatchtowerRegistry = await hre.ethers.getContractFactory("WatchtowerRegistry");
  const watchtowerRegistry = await WatchtowerRegistry.deploy(
    DEPLOYED.ServiceAgreement,
    DEPLOYED.SessionChannels   // MA-01 fix: queries SessionChannels for channel client lookup
  );
  await watchtowerRegistry.waitForDeployment();
  newAddresses.WatchtowerRegistry = await watchtowerRegistry.getAddress();
  console.log(`     ✅ WatchtowerRegistry: ${newAddresses.WatchtowerRegistry}`);

  // ─── Wiring ──────────────────────────────────────────────────────────────

  console.log("\n🔌  Wiring contracts...\n");

  // Wire DisputeArbitration ←→ ServiceAgreement (MA-04)
  console.log("  [1/6] SA.setDisputeArbitration...");
  const SA = await hre.ethers.getContractAt("ServiceAgreement", DEPLOYED.ServiceAgreement);
  const tx1 = await SA.setDisputeArbitration(newAddresses.DisputeArbitration);
  await tx1.wait();
  console.log("        ✅ SA now knows DisputeArbitration");

  // Wire DisputeArbitration → TrustRegistry (SA-dedicated) as updater (MA-04)
  console.log("  [2/6] TrustRegistry(SA).addUpdater(DisputeArbitration)...");
  const TrustRegistrySA = await hre.ethers.getContractAt("TrustRegistry", DEPLOYED.TrustRegistrySA);
  const tx2 = await TrustRegistrySA.addUpdater(newAddresses.DisputeArbitration);
  await tx2.wait();
  console.log("        ✅ DisputeArbitration can now write to SA-dedicated TrustRegistry");

  // Wire DisputeArbitration → ServiceAgreement (DA needs to know SA)
  console.log("  [3/6] DA.setServiceAgreement...");
  const DA = await hre.ethers.getContractAt("DisputeArbitration", newAddresses.DisputeArbitration);
  const tx3 = await DA.setServiceAgreement(DEPLOYED.ServiceAgreement);
  await tx3.wait();
  console.log("        ✅ DisputeArbitration now knows ServiceAgreement");

  // Wire DisputeArbitration → DisputeModule (DA accepts DM calls)
  console.log("  [4/6] DA.setDisputeModule...");
  const tx4 = await DA.setDisputeModule(DEPLOYED.DisputeModule);
  await tx4.wait();
  console.log("        ✅ DisputeArbitration now accepts DisputeModule calls");

  // Wire WatchtowerRegistry → ServiceAgreement
  console.log("  [5/6] SA.setWatchtowerRegistry...");
  const tx5 = await SA.setWatchtowerRegistry(newAddresses.WatchtowerRegistry);
  await tx5.wait();
  console.log("        ✅ SA now knows WatchtowerRegistry");

  // Wire Guardian → ServiceAgreement
  console.log("  [6/6] SA.setGuardian...");
  const tx6 = await SA.setGuardian(newAddresses.ARC402Guardian);
  await tx6.wait();
  console.log("        ✅ SA now has Guardian set");

  // ─── MA-11: Remove deployer updater privilege ─────────────────────────
  // Deployer is auto-granted updater rights when deploying TrustRegistry contracts.
  // Remove after all wiring so only protocol contracts can write trust records.
  console.log("  [MA-11] TrustRegistrySA.removeUpdater(deployer)...");
  const tx7 = await TrustRegistrySA.removeUpdater(deployer.address);
  await tx7.wait();
  console.log("        ✅ Deployer updater privilege removed from TrustRegistrySA");

  const TrustRegistryV2Contract = await hre.ethers.getContractAt("TrustRegistryV2", DEPLOYED.TrustRegistryV2);
  try {
    const tx8 = await TrustRegistryV2Contract.removeUpdater(deployer.address);
    await tx8.wait();
    console.log("        ✅ Deployer updater privilege removed from TrustRegistryV2");
  } catch { /* deployer may not have been added as updater on V2 — skip */ }

  // ─── Save addresses ──────────────────────────────────────────────────────

  const allAddresses = {
    network: hre.network.name,
    chainId: hre.network.config.chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    existing: DEPLOYED,
    new: newAddresses,
    all: { ...DEPLOYED, ...newAddresses },
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  const outPath = path.join(deploymentsDir, `${hre.network.name}-missing.json`);
  fs.writeFileSync(outPath, JSON.stringify(allAddresses, null, 2));

  console.log(`\n📄  All addresses saved to ${outPath}`);
  console.log("\n✅  Deployment complete!\n");
  console.log("New contracts:");
  for (const [name, addr] of Object.entries(newAddresses)) {
    console.log(`  ${name.padEnd(25)} ${addr}`);
  }

  console.log("\n⚠️  Post-deploy checklist:");
  console.log("  1. Update cli/src/config.ts base-sepolia with new addresses");
  console.log("  2. Call SA.setProtocolTreasury(treasury) if not already set");
  console.log("  3. Call DA.setTokenUsdRate(USDC_ADDRESS, rate) for each payment token");
  console.log("  4. Transfer SA ownership to ARC402Governance (F-06)");
  console.log("  5. Call TrustRegistry.removeUpdater(deployer) (MA-11)");
  console.log("  6. GovernedTokenWhitelist.setToken(USDC, true) — then SA.allowToken(USDC) separately");

  return newAddresses;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
