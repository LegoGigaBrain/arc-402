/**
 * ARC-402 Deploy Continuation Script
 *
 * Continues from where deploy-missing.ts left off.
 * Contracts 1-5 were deployed in the previous run:
 *   ARC402Governance:  0x504b3D73A8dFbcAB9551d8a11Bb0B07C90C4c926
 *   ARC402Guardian:    0x5c1D2cD6B9B291b436BF1b109A711F0E477EB6fe
 *   ARC402Wallet:      0xc77854f9091A25eD1f35EA24E9bdFb64d0850E45
 *   AgreementTree:     0x8F46F31FcEbd60f526308AD20e4a008887709720
 *   CapabilityRegistry:0x6a413e74b65828A014dD8DA61861Bf9E1b6372D2
 *
 * This script deploys the remaining 3 + wires everything.
 *
 * Run: npx hardhat run scripts/deploy-continuation.ts --network baseSepolia
 */

import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ─── Already-deployed Base Sepolia addresses ──────────────────────────────────

const DEPLOYED = {
  PolicyEngine:              "0x44102e70c2A366632d98Fe40d892a2501fC7fFF2",
  TrustRegistryV1:          "0x1D38Cf67686820D970C146ED1CC98fc83613f02B",
  TrustRegistryV2:          "0xfCc2CDC42654e05Dad5F6734cE5caFf3dAE0E94F",
  TrustRegistrySA:          "0xbd3f2F15F794FDE8B3A59B6643e4b7e985Ee1389",
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

// ─── Already deployed in previous run ────────────────────────────────────────

const PREV = {
  ARC402Governance:   "0x504b3D73A8dFbcAB9551d8a11Bb0B07C90C4c926",
  ARC402Guardian:     "0x5c1D2cD6B9B291b436BF1b109A711F0E477EB6fe",
  ARC402Wallet:       "0xc77854f9091A25eD1f35EA24E9bdFb64d0850E45",
  AgreementTree:      "0x8F46F31FcEbd60f526308AD20e4a008887709720",
  CapabilityRegistry: "0x6a413e74b65828A014dD8DA61861Bf9E1b6372D2",
};

async function main() {
  const network = hre.network.name;
  console.log(`\n🚀  ARC-402 Deploy Continuation — ${network}`);
  console.log("════════════════════════════════════════════════════════\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Balance:  ${hre.ethers.formatEther(balance)} ETH\n`);
  console.log("Previously deployed contracts:");
  for (const [name, addr] of Object.entries(PREV)) {
    console.log(`  ${name.padEnd(25)} ${addr}`);
  }
  console.log();

  const newAddresses: Record<string, string> = { ...PREV };

  // ─── 6. DisputeArbitration ───────────────────────────────────────────────

  console.log("6/8  Deploying DisputeArbitration...");
  const DisputeArbitration = await hre.ethers.getContractFactory("DisputeArbitration");
  const disputeArbitration = await DisputeArbitration.deploy(
    DEPLOYED.TrustRegistrySA,
    deployer.address
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

  // ─── 8. WatchtowerRegistry ───────────────────────────────────────────────

  console.log("8/8  Deploying WatchtowerRegistry (MA-01 fix: uses SessionChannels)...");
  const WatchtowerRegistry = await hre.ethers.getContractFactory("WatchtowerRegistry");
  const watchtowerRegistry = await WatchtowerRegistry.deploy(
    DEPLOYED.ServiceAgreement,
    DEPLOYED.SessionChannels
  );
  await watchtowerRegistry.waitForDeployment();
  newAddresses.WatchtowerRegistry = await watchtowerRegistry.getAddress();
  console.log(`     ✅ WatchtowerRegistry: ${newAddresses.WatchtowerRegistry}`);

  // ─── Wiring ──────────────────────────────────────────────────────────────

  console.log("\n🔌  Wiring contracts...\n");

  console.log("  [1/6] SA.setDisputeArbitration...");
  const SA = await hre.ethers.getContractAt("ServiceAgreement", DEPLOYED.ServiceAgreement);
  const tx1 = await SA.setDisputeArbitration(newAddresses.DisputeArbitration);
  await tx1.wait();
  console.log("        ✅ SA now knows DisputeArbitration");

  console.log("  [2/6] TrustRegistry(SA).addUpdater(DisputeArbitration)...");
  const TrustRegistrySA = await hre.ethers.getContractAt("TrustRegistry", DEPLOYED.TrustRegistrySA);
  const tx2 = await TrustRegistrySA.addUpdater(newAddresses.DisputeArbitration);
  await tx2.wait();
  console.log("        ✅ DisputeArbitration can now write to SA-dedicated TrustRegistry");

  console.log("  [3/6] DA.setServiceAgreement...");
  const DA = await hre.ethers.getContractAt("DisputeArbitration", newAddresses.DisputeArbitration);
  const tx3 = await DA.setServiceAgreement(DEPLOYED.ServiceAgreement);
  await tx3.wait();
  console.log("        ✅ DisputeArbitration now knows ServiceAgreement");

  console.log("  [4/6] DA.setDisputeModule...");
  const tx4 = await DA.setDisputeModule(DEPLOYED.DisputeModule);
  await tx4.wait();
  console.log("        ✅ DisputeArbitration now accepts DisputeModule calls");

  console.log("  [5/6] SA.setWatchtowerRegistry...");
  const tx5 = await SA.setWatchtowerRegistry(newAddresses.WatchtowerRegistry);
  await tx5.wait();
  console.log("        ✅ SA now knows WatchtowerRegistry");

  console.log("  [6/6] SA.setGuardian...");
  const tx6 = await SA.setGuardian(newAddresses.ARC402Guardian);
  await tx6.wait();
  console.log("        ✅ SA now has Guardian set");

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
