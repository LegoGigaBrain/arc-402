import { ethers } from "hardhat";

/**
 * deployTestnetV2.ts — Complete fresh v2 deployment on Base Sepolia.
 *
 * Deploys all 8 v2 contracts from scratch, wires them, deploys ARC402Wallet.
 * Does NOT reuse any stale testnet addresses from previous runs.
 *
 * Nonce management: we track nonces manually to avoid hardhat-ethers signer
 * re-using nonces after confirmed txs on live testnets.
 *
 * Circular dependency (SA ↔ DM, SA ↔ SC) resolved by pre-computing SA's
 * address from its future nonce before deploying DM/SC.
 */

// ─── Existing v1 testnet addresses (do not redeploy) ─────────────────────────
const POLICY_ENGINE        = "0x44102e70c2A366632d98Fe40d892a2501fC7fFF2";
const INTENT_ATTESTATION   = "0x942c807Cc6E0240A061e074b61345618aBadc457";
const SETTLEMENT_COORD     = "0x52b565797975781f069368Df40d6633b2aD03390";
const AGENT_REGISTRY       = "0x07D526f8A8e148570509aFa249EFF295045A0cc9";
const REPUTATION_ORACLE    = "0x410e650113fd163389C956BC7fC51c5642617187";
const V1_TRUST_REGISTRY    = "0x1D38Cf67686820D970C146ED1CC98fc83613f02B";

// ─── Target wallet owner ──────────────────────────────────────────────────────
const WALLET_OWNER = "0x7745772d67cd52c1f38706bf5550adcd925c7c00";

// ─── ETH USD rate for DisputeArbitration ($2000 per ETH, 1e18 = $1) ──────────
const ETH_USD_RATE_18 = ethers.parseUnits("2000", 18);

// ─── Nonce manager ───────────────────────────────────────────────────────────
// Wraps a signer to track and explicitly pass nonces, avoiding the hardhat-ethers
// signer bug where it re-uses the last confirmed nonce on live networks.
class NonceManager {
  private nonce: number;
  private signer: any;

  constructor(signer: any, startNonce: number) {
    this.signer = signer;
    this.nonce = startNonce;
  }

  next(): number {
    return this.nonce++;
  }

  current(): number {
    return this.nonce;
  }
}

async function deployWith(
  label: string,
  factory: any,
  args: any[],
  nm: NonceManager
): Promise<any> {
  const nonce = nm.next();
  process.stdout.write(`Deploying ${label} (nonce=${nonce})... `);
  const contract = await factory.deploy(...args, { nonce });
  const tx = contract.deploymentTransaction()!;
  console.log(`tx ${tx.hash}`);
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log(`  ✓ ${label}: ${addr}`);
  return contract;
}

async function wireWith(label: string, contractCallFn: (nonce: number) => Promise<any>, nm: NonceManager): Promise<void> {
  const nonce = nm.next();
  process.stdout.write(`  ${label} (nonce=${nonce})... `);
  const tx = await contractCallFn(nonce);
  const receipt = await tx.wait(1);
  console.log(`done (tx ${receipt.hash})`);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("\n=== ARC-402 V2 FRESH TESTNET DEPLOY ===");
  console.log("Deployer:  ", deployer.address);
  console.log("Balance:   ", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // Read the current pending nonce from the chain (source of truth)
  const startNonce = await ethers.provider.getTransactionCount(deployer.address, "pending");
  console.log("Starting nonce (pending):", startNonce);

  // Pre-compute ServiceAgreement address.
  // Deploy order: TrustV3(+0), Vouching(+1), Migration(+2), DM(+3), SC(+4), SA(+5)
  const saFutureNonce = startNonce + 5;
  const saFutureAddr = ethers.getCreateAddress({ from: deployer.address, nonce: saFutureNonce });
  console.log("Pre-computed SA address (nonce", saFutureNonce, "):", saFutureAddr);

  const nm = new NonceManager(deployer, startNonce);

  // ─── Deploy 8 v2 contracts ──────────────────────────────────────────────────
  console.log("\n--- Deploying v2 contracts ---\n");

  const TrustRegistryV3F = await ethers.getContractFactory("TrustRegistryV3");
  const trustV3 = await deployWith("TrustRegistryV3", TrustRegistryV3F, [V1_TRUST_REGISTRY], nm);
  const trustV3Addr = await trustV3.getAddress();

  const VouchingRegistryF = await ethers.getContractFactory("VouchingRegistry");
  const vouchingRegistry = await deployWith("VouchingRegistry", VouchingRegistryF, [trustV3Addr], nm);
  const vouchingAddr = await vouchingRegistry.getAddress();

  const MigrationRegistryF = await ethers.getContractFactory("MigrationRegistry");
  const migrationRegistry = await deployWith("MigrationRegistry", MigrationRegistryF, [trustV3Addr, AGENT_REGISTRY], nm);
  const migrationAddr = await migrationRegistry.getAddress();

  // DM and SC point to the pre-computed SA address
  const DisputeModuleF = await ethers.getContractFactory("DisputeModule");
  const disputeModule = await deployWith("DisputeModule", DisputeModuleF, [saFutureAddr], nm);
  const dmAddr = await disputeModule.getAddress();

  const SessionChannelsF = await ethers.getContractFactory("SessionChannels");
  const sessionChannels = await deployWith("SessionChannels", SessionChannelsF, [saFutureAddr], nm);
  const scAddr = await sessionChannels.getAddress();

  // SA — must land at saFutureAddr
  const ServiceAgreementF = await ethers.getContractFactory("ServiceAgreement");
  const serviceAgreement = await deployWith("ServiceAgreement", ServiceAgreementF, [trustV3Addr, dmAddr, scAddr], nm);
  const saAddr = await serviceAgreement.getAddress();

  if (saAddr.toLowerCase() !== saFutureAddr.toLowerCase()) {
    throw new Error(
      `SA address mismatch!\n  Expected: ${saFutureAddr}\n  Got:      ${saAddr}\n` +
      "A transaction was inserted out-of-band — check the deployer account."
    );
  }
  console.log("  ✓ SA address verified against pre-computed value");

  const DisputeArbitrationF = await ethers.getContractFactory("DisputeArbitration");
  const disputeArbitration = await deployWith("DisputeArbitration", DisputeArbitrationF, [
    trustV3Addr,
    deployer.address, // treasury = deployer for testnet
    saAddr,
    dmAddr,
  ], nm);
  const daAddr = await disputeArbitration.getAddress();

  const ARC402RegistryV2F = await ethers.getContractFactory("ARC402RegistryV2");
  const registry = await deployWith("ARC402RegistryV2", ARC402RegistryV2F, [
    POLICY_ENGINE,
    trustV3Addr,
    INTENT_ATTESTATION,
    SETTLEMENT_COORD,
    "v2.0.0",
  ], nm);
  const regAddr = await registry.getAddress();

  const WalletFactoryF = await ethers.getContractFactory("WalletFactory");
  const walletFactory = await deployWith("WalletFactory", WalletFactoryF, [regAddr], nm);
  const wfAddr = await walletFactory.getAddress();

  // ─── Wiring ─────────────────────────────────────────────────────────────────
  console.log("\n--- Wiring contracts ---\n");

  await wireWith("TrustV3.addUpdater(SA)",               (n) => trustV3.addUpdater(saAddr,      { nonce: n }), nm);
  await wireWith("TrustV3.addUpdater(SC)",               (n) => trustV3.addUpdater(scAddr,      { nonce: n }), nm);
  await wireWith("TrustV3.addUpdater(DM)",               (n) => trustV3.addUpdater(dmAddr,      { nonce: n }), nm);
  await wireWith("TrustV3.addUpdater(DA)",               (n) => trustV3.addUpdater(daAddr,      { nonce: n }), nm);
  await wireWith("TrustV3.addUpdater(VouchingRegistry)", (n) => trustV3.addUpdater(vouchingAddr, { nonce: n }), nm);
  await wireWith("TrustV3.addUpdater(WalletFactory)",    (n) => trustV3.addUpdater(wfAddr,      { nonce: n }), nm);
  await wireWith("TrustV3.setMigrationRegistry",         (n) => trustV3.setMigrationRegistry(migrationAddr, { nonce: n }), nm);

  await wireWith(
    "ServiceAgreement.setDisputeArbitration",
    (n) => serviceAgreement.setDisputeArbitration(daAddr, { nonce: n }),
    nm
  );

  // ETH at $2000 (ETH = address(0) in ServiceAgreement allowedTokens)
  await wireWith(
    "DisputeArbitration.setTokenUsdRate(ETH, $2000)",
    (n) => disputeArbitration.setTokenUsdRate(ethers.ZeroAddress, ETH_USD_RATE_18, { nonce: n }),
    nm
  );

  // Populate ARC402RegistryV2 with all v2 addresses
  await wireWith(
    "ARC402RegistryV2.update(v2.0.0)",
    (n) => (registry as any).update(
      {
        policyEngine:          POLICY_ENGINE,
        trustRegistry:         trustV3Addr,
        intentAttestation:     INTENT_ATTESTATION,
        serviceAgreement:      saAddr,
        sessionChannels:       scAddr,
        agentRegistry:         AGENT_REGISTRY,
        reputationOracle:      REPUTATION_ORACLE,
        settlementCoordinator: SETTLEMENT_COORD,
        vouchingRegistry:      vouchingAddr,
        migrationRegistry:     migrationAddr,
      },
      "v2.0.0",
      { nonce: n }
    ),
    nm
  );

  // ─── Deploy ARC402Wallet ─────────────────────────────────────────────────────
  // Deploy directly (not via factory.createWallet()) so we control the owner address.
  // The wallet constructor calls trustRegistry.initWallet(address(this)) itself (self-init).
  console.log("\n--- Deploying ARC402Wallet ---\n");
  let walletAddr = "(skipped — insufficient funds; run deployWallet.ts to finish)";
  try {
    const ARC402WalletF = await ethers.getContractFactory("ARC402Wallet");
    const wallet = await deployWith("ARC402Wallet", ARC402WalletF, [regAddr, WALLET_OWNER], nm);
    walletAddr = await wallet.getAddress();
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    if (msg.includes("insufficient funds")) {
      console.log("  ⚠ Wallet deploy skipped: deployer has insufficient ETH.");
      console.log("  Top up deployer then run:");
      console.log(`  REGISTRY=${regAddr} npx hardhat run scripts/deployWallet.ts --network baseSepolia`);
    } else {
      throw err;
    }
  }

  // ─── Summary ─────────────────────────────────────────────────────────────────
  console.log("\n=== DEPLOYMENT COMPLETE ===");
  console.log("\nCopy-paste into docs/networks.md (Base Sepolia v2):\n");
  console.log("| TrustRegistryV3         | `" + trustV3Addr   + "` |");
  console.log("| VouchingRegistry        | `" + vouchingAddr   + "` |");
  console.log("| MigrationRegistry       | `" + migrationAddr  + "` |");
  console.log("| DisputeModule (v2)      | `" + dmAddr         + "` |");
  console.log("| SessionChannels (v2)    | `" + scAddr         + "` |");
  console.log("| ServiceAgreement (v2)   | `" + saAddr         + "` |");
  console.log("| DisputeArbitration      | `" + daAddr         + "` |");
  console.log("| ARC402RegistryV2        | `" + regAddr        + "` |");
  console.log("| WalletFactory (v2)      | `" + wfAddr         + "` |");
  console.log("| ARC402Wallet (testnet)  | `" + walletAddr     + "` |");
  console.log("\nRetained v1 addresses (unchanged):");
  console.log("| PolicyEngine            | `" + POLICY_ENGINE       + "` |");
  console.log("| IntentAttestation       | `" + INTENT_ATTESTATION  + "` |");
  console.log("| SettlementCoordinator   | `" + SETTLEMENT_COORD    + "` |");
  console.log("| AgentRegistry           | `" + AGENT_REGISTRY      + "` |");
  console.log("| ReputationOracle        | `" + REPUTATION_ORACLE   + "` |");
  console.log("\nWallet owner:", WALLET_OWNER);
  console.log("\nNEXT STEPS:");
  console.log("  Update docs/networks.md with the v2 addresses above.");
  console.log("  Update CLI / SDK config to point to new ARC402RegistryV2:", regAddr);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
