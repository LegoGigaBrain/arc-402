import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Wiring from:", deployer.address);
  console.log("Nonce:", await ethers.provider.getTransactionCount(deployer.address));

  const TRUST_V3_ADDR    = "0xf2aE072BB8575c23B0efbF44bDc8188aA900cA7a";
  const VOUCHING_ADDR    = "0x96432aDc7aC06256297AdF11B94C47f68b2F13A2";
  const MIGRATION_ADDR   = "0x3aeAaD32386D6fC40eeb5c2C27a5aCFE6aDf9ABD";
  const SESSION_CHANNELS_ADDR  = "0x5EF144AE2C8456d014e6E3F293c162410C043564";
  const SERVICE_AGREEMENT_ADDR = "0xbbb1DA355D810E9baEF1a7D072B2132E4755976B";
  const DISPUTE_ARBI_ADDR      = "0xa4f6F77927Da53a25926A5f0bffBEB0210108cA8";
  const REGISTRY_V2_ADDR       = "0x0461b2b7A1E50866962CB07326000A94009c58Ff";
  const DISPUTE_MODULE_ADDR    = "0x01866144495fBBbBB7aaD81605de051B2A62594A";

  const POLICY_ENGINE       = "0x44102e70c2A366632d98Fe40d892a2501fC7fFF2";
  const INTENT_ATTESTATION  = "0x942c807Cc6E0240A061e074b61345618aBadc457";
  const SETTLEMENT_COORD    = "0x52b565797975781f069368Df40d6633b2aD03390";
  const AGENT_REGISTRY      = "0x07D526f8A8e148570509aFa249EFF295045A0cc9";
  const REPUTATION_ORACLE   = "0x410e650113fd163389C956BC7fC51c5642617187";

  const TrustRegistryV3  = await ethers.getContractFactory("TrustRegistryV3");
  const trustV3          = TrustRegistryV3.attach(TRUST_V3_ADDR) as any;

  const ARC402RegistryV2 = await ethers.getContractFactory("ARC402RegistryV2");
  const registry         = ARC402RegistryV2.attach(REGISTRY_V2_ADDR) as any;

  // Already done: SA.setDisputeArbitration, addUpdater(SA), addUpdater(SC), addUpdater(DA)
  // Remaining:

  console.log("addUpdater(VR)...");
  await (await trustV3.addUpdater(VOUCHING_ADDR)).wait();
  console.log("done");

  console.log("setMigrationRegistry...");
  await (await trustV3.setMigrationRegistry(MIGRATION_ADDR)).wait();
  console.log("done");

  console.log("ARC402RegistryV2.update...");
  await (await registry.update({
    policyEngine:         POLICY_ENGINE,
    trustRegistry:        TRUST_V3_ADDR,
    intentAttestation:    INTENT_ATTESTATION,
    serviceAgreement:     SERVICE_AGREEMENT_ADDR,
    sessionChannels:      SESSION_CHANNELS_ADDR,
    agentRegistry:        AGENT_REGISTRY,
    reputationOracle:     REPUTATION_ORACLE,
    settlementCoordinator: SETTLEMENT_COORD,
    vouchingRegistry:     VOUCHING_ADDR,
    migrationRegistry:    MIGRATION_ADDR,
  }, "v2.0.0")).wait();
  console.log("done");

  console.log("\n=== ARC-402 V2 FULLY WIRED ===");
  console.log("\nFULL CONTRACT TABLE (Base Sepolia v2):");
  console.log("  TrustRegistryV3:     ", TRUST_V3_ADDR);
  console.log("  VouchingRegistry:    ", VOUCHING_ADDR);
  console.log("  MigrationRegistry:   ", MIGRATION_ADDR);
  console.log("  DisputeModule:       ", DISPUTE_MODULE_ADDR);
  console.log("  SessionChannels:     ", SESSION_CHANNELS_ADDR);
  console.log("  ServiceAgreement:    ", SERVICE_AGREEMENT_ADDR);
  console.log("  DisputeArbitration:  ", DISPUTE_ARBI_ADDR);
  console.log("  ARC402RegistryV2:    ", REGISTRY_V2_ADDR);
  console.log("\nNEXT STEP:");
  console.log("  wallet.proposeRegistryUpdate(" + REGISTRY_V2_ADDR + ")");
}

main().catch((e) => { console.error(e); process.exit(1); });
