import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying from:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // Existing v1 addresses (Base Sepolia)
  const POLICY_ENGINE       = "0x44102e70c2A366632d98Fe40d892a2501fC7fFF2";
  const INTENT_ATTESTATION  = "0x942c807Cc6E0240A061e074b61345618aBadc457";
  const SETTLEMENT_COORD    = "0x52b565797975781f069368Df40d6633b2aD03390";
  const AGENT_REGISTRY      = "0x07D526f8A8e148570509aFa249EFF295045A0cc9";
  const REPUTATION_ORACLE   = "0x410e650113fd163389C956BC7fC51c5642617187";
  const V1_TRUST_REGISTRY   = "0x1D38Cf67686820D970C146ED1CC98fc83613f02B";

  // Already deployed in previous runs (nonces 210-217)
  const TRUST_V3_ADDR    = "0xf2aE072BB8575c23B0efbF44bDc8188aA900cA7a";
  const VOUCHING_ADDR    = "0x96432aDc7aC06256297AdF11B94C47f68b2F13A2";
  const MIGRATION_ADDR   = "0x3aeAaD32386D6fC40eeb5c2C27a5aCFE6aDf9ABD";
  const DISPUTE_MODULE_ADDR    = "0x01866144495fBBbBB7aaD81605de051B2A62594A";
  const SESSION_CHANNELS_ADDR  = "0x5EF144AE2C8456d014e6E3F293c162410C043564";
  const SERVICE_AGREEMENT_ADDR = "0xbbb1DA355D810E9baEF1a7D072B2132E4755976B";
  const DISPUTE_ARBI_ADDR      = "0xa4f6F77927Da53a25926A5f0bffBEB0210108cA8";

  console.log("\n--- Attaching to already-deployed contracts ---\n");

  const TrustRegistryV3  = await ethers.getContractFactory("TrustRegistryV3");
  const trustV3          = TrustRegistryV3.attach(TRUST_V3_ADDR);
  console.log("TrustRegistryV3:     ", TRUST_V3_ADDR);

  const VouchingRegistry = await ethers.getContractFactory("VouchingRegistry");
  const vouchingRegistry = VouchingRegistry.attach(VOUCHING_ADDR);
  console.log("VouchingRegistry:    ", VOUCHING_ADDR);

  const MigrationRegistry = await ethers.getContractFactory("MigrationRegistry");
  const migrationRegistry = MigrationRegistry.attach(MIGRATION_ADDR);
  console.log("MigrationRegistry:   ", MIGRATION_ADDR);

  const DisputeModule    = await ethers.getContractFactory("DisputeModule");
  const disputeModule    = DisputeModule.attach(DISPUTE_MODULE_ADDR);
  console.log("DisputeModule:       ", DISPUTE_MODULE_ADDR);

  const SessionChannels  = await ethers.getContractFactory("SessionChannels");
  const sessionChannels  = SessionChannels.attach(SESSION_CHANNELS_ADDR);
  console.log("SessionChannels:     ", SESSION_CHANNELS_ADDR);

  console.log("\n--- Deploying remaining 2 contracts (nonces 218-219) ---\n");

  // SA already deployed at nonce 217
  const ServiceAgreement = await ethers.getContractFactory("ServiceAgreement");
  const serviceAgreement = ServiceAgreement.attach(SERVICE_AGREEMENT_ADDR);
  const saAddr = SERVICE_AGREEMENT_ADDR;
  console.log("ServiceAgreement:    ", saAddr, "(already deployed)");

  // Nonce 218: DisputeArbitration — already deployed
  const DisputeArbitration = await ethers.getContractFactory("DisputeArbitration");
  const disputeArbitration = DisputeArbitration.attach(DISPUTE_ARBI_ADDR);
  const daAddr = DISPUTE_ARBI_ADDR;
  console.log("DisputeArbitration:  ", daAddr, "(already deployed)");

  // Nonce 219: ARC402RegistryV2
  const ARC402RegistryV2 = await ethers.getContractFactory("ARC402RegistryV2");
  const registry = await ARC402RegistryV2.deploy(
    POLICY_ENGINE,
    TRUST_V3_ADDR,
    INTENT_ATTESTATION,
    SETTLEMENT_COORD,
    "v2.0.0"
  );
  await registry.waitForDeployment();
  const regAddr = await registry.getAddress();
  console.log("ARC402RegistryV2:    ", regAddr);

  console.log("\n--- Wiring ---\n");

  // SA → DA
  await (await serviceAgreement.setDisputeArbitration(daAddr)).wait();
  console.log("SA.setDisputeArbitration: done");

  // TrustV3 updaters
  await (await (trustV3 as any).addUpdater(saAddr)).wait();
  console.log("TrustV3.addUpdater(SA): done");

  await (await (trustV3 as any).addUpdater(SESSION_CHANNELS_ADDR)).wait();
  console.log("TrustV3.addUpdater(SC): done");

  await (await (trustV3 as any).addUpdater(daAddr)).wait();
  console.log("TrustV3.addUpdater(DA): done");

  await (await (trustV3 as any).addUpdater(VOUCHING_ADDR)).wait();
  console.log("TrustV3.addUpdater(VR): done");

  await (await (trustV3 as any).setMigrationRegistry(MIGRATION_ADDR)).wait();
  console.log("TrustV3.setMigrationRegistry: done");

  // Populate ARC402RegistryV2
  await (await (registry as any).update({
    policyEngine:         POLICY_ENGINE,
    trustRegistry:        TRUST_V3_ADDR,
    intentAttestation:    INTENT_ATTESTATION,
    serviceAgreement:     saAddr,
    sessionChannels:      SESSION_CHANNELS_ADDR,
    agentRegistry:        AGENT_REGISTRY,
    reputationOracle:     REPUTATION_ORACLE,
    settlementCoordinator: SETTLEMENT_COORD,
    vouchingRegistry:     VOUCHING_ADDR,
    migrationRegistry:    MIGRATION_ADDR,
  }, "v2.0.0")).wait();
  console.log("ARC402RegistryV2.update: done");

  console.log("\n=== ARC-402 V2 DEPLOYMENT COMPLETE ===");
  console.log("\nALL CONTRACTS (Base Sepolia):");
  console.log("  TrustRegistryV3:     ", TRUST_V3_ADDR);
  console.log("  VouchingRegistry:    ", VOUCHING_ADDR);
  console.log("  MigrationRegistry:   ", MIGRATION_ADDR);
  console.log("  DisputeModule:       ", DISPUTE_MODULE_ADDR);
  console.log("  SessionChannels:     ", SESSION_CHANNELS_ADDR);
  console.log("  ServiceAgreement:    ", saAddr);
  console.log("  DisputeArbitration:  ", daAddr);
  console.log("  ARC402RegistryV2:    ", regAddr);
  console.log("\nNEXT STEP:");
  console.log("  wallet.proposeRegistryUpdate(" + regAddr + ")");
  console.log("  Wait 2 days → executeRegistryUpdate()");
}

main().catch((e) => { console.error(e); process.exit(1); });
