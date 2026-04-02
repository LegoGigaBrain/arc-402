/**
 * ARC-402 Deploy Final Script
 *
 * Deploys the last 2 contracts (GovernedTokenWhitelist + WatchtowerRegistry)
 * then runs all wiring steps.
 *
 * All 6 previously deployed:
 *   ARC402Governance:   0x504b3D73A8dFbcAB9551d8a11Bb0B07C90C4c926
 *   ARC402Guardian:     0x5c1D2cD6B9B291b436BF1b109A711F0E477EB6fe
 *   ARC402Wallet:       0xc77854f9091A25eD1f35EA24E9bdFb64d0850E45
 *   AgreementTree:      0x8F46F31FcEbd60f526308AD20e4a008887709720
 *   CapabilityRegistry: 0x6a413e74b65828A014dD8DA61861Bf9E1b6372D2
 *   DisputeArbitration: 0x62FB9E6f6366B75FDe1D78a870D0B1D7334e2a4e
 *
 * Run: npx hardhat run scripts/deploy-final.ts --network baseSepolia
 */

import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";

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

const PREV_DEPLOYED = {
  ARC402Governance:   "0x504b3D73A8dFbcAB9551d8a11Bb0B07C90C4c926",
  ARC402Guardian:     "0x5c1D2cD6B9B291b436BF1b109A711F0E477EB6fe",
  ARC402Wallet:       "0xc77854f9091A25eD1f35EA24E9bdFb64d0850E45",
  AgreementTree:      "0x8F46F31FcEbd60f526308AD20e4a008887709720",
  CapabilityRegistry: "0x6a413e74b65828A014dD8DA61861Bf9E1b6372D2",
  DisputeArbitration: "0x62FB9E6f6366B75FDe1D78a870D0B1D7334e2a4e",
};

async function main() {
  const network = hre.network.name;
  console.log(`\n🚀  ARC-402 Deploy Final — ${network}`);
  console.log("════════════════════════════════════════════════════════\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Balance:  ${hre.ethers.formatEther(balance)} ETH\n`);

  const allNew: Record<string, string> = { ...PREV_DEPLOYED };

  // ─── 7. GovernedTokenWhitelist ────────────────────────────────────────────

  console.log("7/8  Deploying GovernedTokenWhitelist...");
  const GovernedTokenWhitelist = await hre.ethers.getContractFactory("GovernedTokenWhitelist");
  const tokenWhitelist = await GovernedTokenWhitelist.deploy(deployer.address);
  await tokenWhitelist.waitForDeployment();
  allNew.GovernedTokenWhitelist = await tokenWhitelist.getAddress();
  console.log(`     ✅ GovernedTokenWhitelist: ${allNew.GovernedTokenWhitelist}`);

  // ─── 8. WatchtowerRegistry ───────────────────────────────────────────────

  console.log("8/8  Deploying WatchtowerRegistry (MA-01 fix)...");
  const WatchtowerRegistry = await hre.ethers.getContractFactory("WatchtowerRegistry");
  const watchtowerRegistry = await WatchtowerRegistry.deploy(
    DEPLOYED.ServiceAgreement,
    DEPLOYED.SessionChannels
  );
  await watchtowerRegistry.waitForDeployment();
  allNew.WatchtowerRegistry = await watchtowerRegistry.getAddress();
  console.log(`     ✅ WatchtowerRegistry: ${allNew.WatchtowerRegistry}`);

  // ─── Wiring ──────────────────────────────────────────────────────────────

  console.log("\n🔌  Wiring contracts...\n");

  const SA = await hre.ethers.getContractAt("ServiceAgreement", DEPLOYED.ServiceAgreement);
  const DA = await hre.ethers.getContractAt("DisputeArbitration", PREV_DEPLOYED.DisputeArbitration);
  const TrustRegistrySA = await hre.ethers.getContractAt("TrustRegistry", DEPLOYED.TrustRegistrySA);

  console.log("  [1/6] SA.setDisputeArbitration...");
  const tx1 = await SA.setDisputeArbitration(PREV_DEPLOYED.DisputeArbitration);
  await tx1.wait();
  console.log("        ✅ SA now knows DisputeArbitration");

  console.log("  [2/6] TrustRegistry(SA).addUpdater(DisputeArbitration)...");
  const tx2 = await TrustRegistrySA.addUpdater(PREV_DEPLOYED.DisputeArbitration);
  await tx2.wait();
  console.log("        ✅ DisputeArbitration can now write to SA-dedicated TrustRegistry");

  console.log("  [3/6] DA.setServiceAgreement...");
  const tx3 = await DA.setServiceAgreement(DEPLOYED.ServiceAgreement);
  await tx3.wait();
  console.log("        ✅ DisputeArbitration now knows ServiceAgreement");

  console.log("  [4/6] DA.setDisputeModule...");
  const tx4 = await DA.setDisputeModule(DEPLOYED.DisputeModule);
  await tx4.wait();
  console.log("        ✅ DisputeArbitration now accepts DisputeModule calls");

  console.log("  [5/6] SA.setWatchtowerRegistry...");
  const tx5 = await SA.setWatchtowerRegistry(allNew.WatchtowerRegistry);
  await tx5.wait();
  console.log("        ✅ SA now knows WatchtowerRegistry");

  console.log("  [6/6] SA.setGuardian...");
  const tx6 = await SA.setGuardian(PREV_DEPLOYED.ARC402Guardian);
  await tx6.wait();
  console.log("        ✅ SA now has Guardian set");

  // ─── Save addresses ──────────────────────────────────────────────────────

  const output = {
    network: hre.network.name,
    chainId: hre.network.config.chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    existing: DEPLOYED,
    new: allNew,
    all: { ...DEPLOYED, ...allNew },
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  const outPath = path.join(deploymentsDir, `${hre.network.name}-missing.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log(`\n📄  All addresses saved to ${outPath}`);
  console.log("\n✅  Deployment complete!\n");
  console.log("All 8 new contracts:");
  for (const [name, addr] of Object.entries(allNew)) {
    console.log(`  ${name.padEnd(25)} ${addr}`);
  }

  return allNew;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
