import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying from:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("Network: Base Mainnet");

  // Existing v1 mainnet addresses (unchanged)
  const POLICY_ENGINE       = "0xAA5Ef3489C929bFB3BFf5D5FE15aa62d3763c847";
  const INTENT_ATTESTATION  = "0x7ad8db6C5f394542E8e9658F86C85cC99Cf6D460";
  const SETTLEMENT_COORD    = "0x6653F385F98752575db3180b9306e2d9644f9Eb1";
  const AGENT_REGISTRY      = "0xD5c2851B00090c92Ba7F4723FB548bb30C9B6865";
  const REPUTATION_ORACLE   = "0x359F76a54F9A345546E430e4d6665A7dC9DaECd4";
  const V1_TRUST_REGISTRY   = "0x6B89621c94a7105c3D8e0BD8Fb06814931CA2CB2";

  console.log("\n--- Deploying 8 v2 contracts to Base Mainnet ---\n");

  // 1. TrustRegistryV3
  const TrustRegistryV3 = await ethers.getContractFactory("TrustRegistryV3");
  const trustV3 = await TrustRegistryV3.deploy(V1_TRUST_REGISTRY);
  await trustV3.waitForDeployment();
  const tv3 = await trustV3.getAddress();
  console.log("TrustRegistryV3:    ", tv3);

  // 2. VouchingRegistry
  const VouchingRegistry = await ethers.getContractFactory("VouchingRegistry");
  const vouchingRegistry = await VouchingRegistry.deploy(tv3);
  await vouchingRegistry.waitForDeployment();
  const vr = await vouchingRegistry.getAddress();
  console.log("VouchingRegistry:   ", vr);

  // 3. MigrationRegistry
  const MigrationRegistry = await ethers.getContractFactory("MigrationRegistry");
  const migrationRegistry = await MigrationRegistry.deploy(tv3, AGENT_REGISTRY);
  await migrationRegistry.waitForDeployment();
  const mr = await migrationRegistry.getAddress();
  console.log("MigrationRegistry:  ", mr);

  // 4-6. Circular dependency: pre-compute SA address
  const deployerNonce = await ethers.provider.getTransactionCount(deployer.address);
  const expectedSA = ethers.getCreateAddress({ from: deployer.address, nonce: deployerNonce + 2 });
  console.log("Pre-computed SA:    ", expectedSA);

  const DisputeModule = await ethers.getContractFactory("DisputeModule");
  const disputeModule = await DisputeModule.deploy(expectedSA);
  await disputeModule.waitForDeployment();
  const dm = await disputeModule.getAddress();
  console.log("DisputeModule:      ", dm);

  const SessionChannels = await ethers.getContractFactory("SessionChannels");
  const sessionChannels = await SessionChannels.deploy(expectedSA);
  await sessionChannels.waitForDeployment();
  const sc = await sessionChannels.getAddress();
  console.log("SessionChannels:    ", sc);

  const ServiceAgreement = await ethers.getContractFactory("ServiceAgreement");
  const serviceAgreement = await ServiceAgreement.deploy(tv3, dm, sc);
  await serviceAgreement.waitForDeployment();
  const sa = await serviceAgreement.getAddress();
  if (sa.toLowerCase() !== expectedSA.toLowerCase()) throw new Error(`Nonce mismatch! Expected ${expectedSA}, got ${sa}`);
  console.log("ServiceAgreement:   ", sa, "✓");

  // 7. DisputeArbitration (treasury = deployer for now)
  const DisputeArbitration = await ethers.getContractFactory("DisputeArbitration");
  const disputeArbitration = await DisputeArbitration.deploy(tv3, deployer.address, sa, dm);
  await disputeArbitration.waitForDeployment();
  const da = await disputeArbitration.getAddress();
  console.log("DisputeArbitration: ", da);

  // 8. ARC402RegistryV2
  const ARC402RegistryV2 = await ethers.getContractFactory("ARC402RegistryV2");
  const registry = await ARC402RegistryV2.deploy(POLICY_ENGINE, tv3, INTENT_ATTESTATION, SETTLEMENT_COORD, "v2.0.0");
  await registry.waitForDeployment();
  const reg = await registry.getAddress();
  console.log("ARC402RegistryV2:   ", reg);

  console.log("\n--- Wiring ---\n");

  await (await serviceAgreement.setDisputeArbitration(da)).wait();
  console.log("SA.setDisputeArbitration: done");

  await (await (trustV3 as any).addUpdater(sa)).wait();
  await (await (trustV3 as any).addUpdater(sc)).wait();
  await (await (trustV3 as any).addUpdater(da)).wait();
  await (await (trustV3 as any).addUpdater(vr)).wait();
  console.log("TrustV3 updaters: SA SC DA VR done");

  await (await (trustV3 as any).setMigrationRegistry(mr)).wait();
  console.log("TrustV3.setMigrationRegistry: done");

  // Set ETH USD rate on DA ($2000)
  await (await (disputeArbitration as any).setTokenUsdRate("0x0000000000000000000000000000000000000000", "2000000000000000000000")).wait();
  console.log("DA.setTokenUsdRate(ETH, $2000): done");

  await (await (registry as any).update({
    policyEngine: POLICY_ENGINE, trustRegistry: tv3, intentAttestation: INTENT_ATTESTATION,
    serviceAgreement: sa, sessionChannels: sc, agentRegistry: AGENT_REGISTRY,
    reputationOracle: REPUTATION_ORACLE, settlementCoordinator: SETTLEMENT_COORD,
    vouchingRegistry: vr, migrationRegistry: mr,
  }, "v2.0.0")).wait();
  console.log("ARC402RegistryV2.update: done");

  console.log("\n=== ARC-402 V2 MAINNET DEPLOYMENT COMPLETE ===");
  console.log("\nNEW CONTRACTS (Base Mainnet):");
  console.log("  TrustRegistryV3:    ", tv3);
  console.log("  VouchingRegistry:   ", vr);
  console.log("  MigrationRegistry:  ", mr);
  console.log("  DisputeModule:      ", dm);
  console.log("  SessionChannels:    ", sc);
  console.log("  ServiceAgreement:   ", sa);
  console.log("  DisputeArbitration: ", da);
  console.log("  ARC402RegistryV2:   ", reg);
  console.log("\nNEXT STEP:");
  console.log("  wallet.proposeRegistryUpdate(" + reg + ")");
  console.log("  Wait 2 days → executeRegistryUpdate()");

  const finalBalance = await ethers.provider.getBalance(deployer.address);
  console.log("\nRemaining balance:", ethers.formatEther(finalBalance), "ETH");
}

main().catch((e) => { console.error(e); process.exit(1); });
