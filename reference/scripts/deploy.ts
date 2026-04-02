import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";

const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// Already deployed on Base Mainnet (nonces 0–18, 2026-03-14)
const ALREADY_DEPLOYED = {
  TrustRegistryV1:        "0x6B89621c94a7105c3D8e0BD8Fb06814931CA2CB2",
  TrustRegistryV2:        "0xdA1D377991B2E580991B0DD381CdD635dd71aC39",
  TrustRegistrySA:        "0xbB5E1809D4a94D08Bf1143131312858143D018f1",
  IntentAttestation:      "0x7ad8db6C5f394542E8e9658F86C85cC99Cf6D460",
  PolicyEngine:           "0xAA5Ef3489C929bFB3BFf5D5FE15aa62d3763c847",
  SettlementCoordinator:  "0xd52d8Be9728976E0D70C89db9F8ACeb5B5e97cA2",   // SettlementCoordinatorV2 — deployed 2026-03-17
  SponsorshipAttestation: "0xD6c2edE89Ea71aE19Db2Be848e172b444Ed38f22",
  GovernedTokenWhitelist: "0xeB58896337244Bb408362Fea727054f9e7157451",
  ARC402Registry:         "0xF5825d691fcBdE45dD94EB45da7Df7CC3462f02A",
  AgentRegistry:          "0xD5c2851B00090c92Ba7F4723FB548bb30C9B6865",
  ServiceAgreement:       "0x78C8e4d26D74d8da80d03Df04767D3Fdc3D9340f",
  DisputeArbitration:     "0xc5e9324dbd214ad5c6A0F3316425FeaC7A71BE2D",
  WalletFactory:          "0x0092E5bC265103070FDB19a8bf3Fa03A46c65ED2",
  CapabilityRegistry:     "0x7becb642668B80502dD957A594E1dD0aC414c1a3",
  SessionChannels:        "0xA054d7cE9aEa267c87EB2B3787e261EBA7b0B5d0",
  AgreementTree:          "0x6a82240512619B25583b9e95783410cf782915b1",
  DisputeModule:          "0x1c9489702B8d12FfDCd843e0232EB59C569e1fA6",
  ReputationOracle:       "0x359F76a54F9A345546E430e4d6665A7dC9DaECd4",
  ARC402Guardian:         "0xED0A033B79626cdf9570B6c3baC7f699cD0032D8",
};

async function main() {
  console.log("Deploying ARC-402 contracts to", hre.network.name);

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "ETH");

  // Explicit nonce tracking to avoid Hardhat's nonce cache confusion
  let nonce = await hre.ethers.provider.getTransactionCount(deployer.address, "pending");
  console.log("Starting nonce:", nonce);

  const deployWith = async (factory: any, args: any[], label: string) => {
    const contract = await factory.deploy(...args, { nonce: nonce++ });
    await contract.waitForDeployment();
    const addr = await contract.getAddress();
    console.log(`${label}: ${addr}`);
    return { contract, addr };
  };

  const sendWith = async (fn: any, label: string) => {
    const tx = await fn({ nonce: nonce++ });
    await tx.wait();
    console.log(`${label} ✓`);
  };

  // ─── Attach already-deployed contracts ────────────────────────────────────
  const TRFactory  = await hre.ethers.getContractFactory("TrustRegistry");
  const TRV2Factory = await hre.ethers.getContractFactory("TrustRegistryV3");
  const SAFactory  = await hre.ethers.getContractFactory("ServiceAgreement");
  const DAFactory  = await hre.ethers.getContractFactory("DisputeArbitration");
  const WFFactory  = await hre.ethers.getContractFactory("WalletFactory");

  const trustRegistryAddr         = ALREADY_DEPLOYED.TrustRegistryV1;
  const trustRegistryV2Addr       = ALREADY_DEPLOYED.TrustRegistryV2;
  const trustRegistrySAAddr       = ALREADY_DEPLOYED.TrustRegistrySA;
  const intentAttestationAddr     = ALREADY_DEPLOYED.IntentAttestation;
  const policyEngineAddr          = ALREADY_DEPLOYED.PolicyEngine;
  const settlementCoordinatorAddr = ALREADY_DEPLOYED.SettlementCoordinator;
  const sponsorshipAttestationAddr = ALREADY_DEPLOYED.SponsorshipAttestation;
  const governedTokenWhitelistAddr = ALREADY_DEPLOYED.GovernedTokenWhitelist;
  const arc402RegistryAddr        = ALREADY_DEPLOYED.ARC402Registry;
  const agentRegistryAddr         = ALREADY_DEPLOYED.AgentRegistry;
  const serviceAgreementAddr      = ALREADY_DEPLOYED.ServiceAgreement;
  const disputeArbitrationAddr    = ALREADY_DEPLOYED.DisputeArbitration;
  const walletFactoryAddr         = ALREADY_DEPLOYED.WalletFactory;
  const capabilityRegistryAddr    = ALREADY_DEPLOYED.CapabilityRegistry;
  const sessionChannelsAddr       = ALREADY_DEPLOYED.SessionChannels;
  const agreementTreeAddr         = ALREADY_DEPLOYED.AgreementTree;
  const disputeModuleAddr         = ALREADY_DEPLOYED.DisputeModule;
  const reputationOracleAddr      = ALREADY_DEPLOYED.ReputationOracle;
  const arc402GuardianAddr        = ALREADY_DEPLOYED.ARC402Guardian;

  const trustRegistry    = TRFactory.attach(trustRegistryAddr)    as any;
  const trustRegistryV2  = TRV2Factory.attach(trustRegistryV2Addr) as any;
  const trustRegistrySA  = TRFactory.attach(trustRegistrySAAddr)  as any;
  const serviceAgreement = SAFactory.attach(serviceAgreementAddr)  as any;
  const disputeArbitration = DAFactory.attach(disputeArbitrationAddr) as any;
  const walletFactory    = WFFactory.attach(walletFactoryAddr)    as any;

  console.log("19 contracts already deployed [nonces 0–18]");

  // ─── Deploy remaining 4 contracts with explicit nonces ───────────────────

  const { addr: arc402GovernanceAddr } = await deployWith(
    await hre.ethers.getContractFactory("ARC402Governance"),
    [[deployer.address], 1],
    "ARC402Governance"
  );

  const { addr: watchtowerRegistryAddr } = await deployWith(
    await hre.ethers.getContractFactory("WatchtowerRegistry"),
    [serviceAgreementAddr, sessionChannelsAddr],
    "WatchtowerRegistry"
  );

  // ARC402Wallet via WalletFactory — get predicted address first
  const arc402WalletAddr = await walletFactory.createWallet.staticCall();
  const wfTx = await walletFactory.createWallet({ nonce: nonce++ });
  await wfTx.wait();
  console.log("ARC402Wallet (via factory):", arc402WalletAddr);

  const { addr: x402InterceptorAddr } = await deployWith(
    await hre.ethers.getContractFactory("X402Interceptor"),
    [arc402WalletAddr, USDC_BASE_MAINNET],
    "X402Interceptor"
  );

  // ─── POST-DEPLOY WIRING ───────────────────────────────────────────────────
  console.log("\nWiring contracts...");

  await sendWith(
    (overrides: any) => serviceAgreement.setDisputeArbitration(disputeArbitrationAddr, overrides),
    "SA.setDisputeArbitration"
  );

  await sendWith(
    (overrides: any) => serviceAgreement.setWatchtowerRegistry(watchtowerRegistryAddr, overrides),
    "SA.setWatchtowerRegistry"
  );

  await sendWith(
    (overrides: any) => serviceAgreement.setGuardian(arc402GuardianAddr, overrides),
    "SA.setGuardian"
  );

  await sendWith(
    (overrides: any) => trustRegistrySA.addUpdater(disputeArbitrationAddr, overrides),
    "TrustRegistrySA.addUpdater(DA)"
  );

  await sendWith(
    (overrides: any) => disputeArbitration.setServiceAgreement(serviceAgreementAddr, overrides),
    "DA.setServiceAgreement"
  );

  await sendWith(
    (overrides: any) => disputeArbitration.setDisputeModule(disputeModuleAddr, overrides),
    "DA.setDisputeModule"
  );

  await sendWith(
    (overrides: any) => trustRegistry.removeUpdater(deployer.address, overrides),
    "TrustRegistry.removeUpdater(deployer)"
  );

  await sendWith(
    (overrides: any) => trustRegistryV2.removeUpdater(deployer.address, overrides),
    "TrustRegistryV2.removeUpdater(deployer)"
  );

  console.log("\nAll wiring complete.");

  // ─── SAVE ADDRESSES ───────────────────────────────────────────────────────
  const addresses = {
    network: "Base Mainnet",
    chainId: 8453,
    deployedAt: new Date().toISOString().split("T")[0],
    deployer: deployer.address,
    contracts: {
      PolicyEngine:           policyEngineAddr,
      TrustRegistryV1:        trustRegistryAddr,
      TrustRegistryV2:        trustRegistryV2Addr,
      TrustRegistrySA:        trustRegistrySAAddr,
      IntentAttestation:      intentAttestationAddr,
      SettlementCoordinator:  settlementCoordinatorAddr,
      ARC402Registry:         arc402RegistryAddr,
      AgentRegistry:          agentRegistryAddr,
      WalletFactory:          walletFactoryAddr,
      SponsorshipAttestation: sponsorshipAttestationAddr,
      ServiceAgreement:       serviceAgreementAddr,
      SessionChannels:        sessionChannelsAddr,
      DisputeModule:          disputeModuleAddr,
      ReputationOracle:       reputationOracleAddr,
      ARC402Governance:       arc402GovernanceAddr,
      ARC402Guardian:         arc402GuardianAddr,
      ARC402Wallet:           arc402WalletAddr,
      AgreementTree:          agreementTreeAddr,
      CapabilityRegistry:     capabilityRegistryAddr,
      DisputeArbitration:     disputeArbitrationAddr,
      GovernedTokenWhitelist: governedTokenWhitelistAddr,
      WatchtowerRegistry:     watchtowerRegistryAddr,
      X402Interceptor:        x402InterceptorAddr,
    },
    wiring: {
      "SA.setDisputeArbitration":            disputeArbitrationAddr,
      "SA.setWatchtowerRegistry":            watchtowerRegistryAddr,
      "SA.setGuardian":                      arc402GuardianAddr,
      "TrustRegistrySA.addUpdater(DA)":      disputeArbitrationAddr,
      "DA.setServiceAgreement":              serviceAgreementAddr,
      "DA.setDisputeModule":                 disputeModuleAddr,
      "TrustRegistry.removeUpdater(deployer)":   deployer.address,
      "TrustRegistryV2.removeUpdater(deployer)": deployer.address,
    },
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  const outPath = path.join(deploymentsDir, "base-mainnet.json");
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log(`\nAddresses saved to ${outPath}`);

  console.log("\n=== DEPLOYMENT COMPLETE ===");
  console.log("Contracts:", Object.keys(addresses.contracts).length);
  for (const [name, addr] of Object.entries(addresses.contracts)) {
    console.log(`  ${name.padEnd(24)} ${addr}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
