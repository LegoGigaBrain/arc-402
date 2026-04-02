/**
 * ARC-402 Wiring Script (raw ethers, no Hardhat)
 *
 * Completes the 5 remaining wiring steps after:
 *   SA.setDisputeArbitration already done in deploy-final.ts
 *
 * Run: node scripts/wire-contracts.mjs
 */

import { ethers } from "ethers";
import { readFileSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// ─── Config ───────────────────────────────────────────────────────────────────

const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
if (!PRIVATE_KEY) throw new Error("DEPLOYER_PRIVATE_KEY not set");

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// ─── Addresses ────────────────────────────────────────────────────────────────

const SA_ADDR        = "0xa214D30906A934358f451514dA1ba732AD79f158";
const TR_SA_ADDR     = "0xbd3f2F15F794FDE8B3A59B6643e4b7e985Ee1389";
const DA_ADDR        = "0x62FB9E6f6366B75FDe1D78a870D0B1D7334e2a4e";
const DM_ADDR        = "0xcAcf606374E29bbC573620afFd7f9f739D25317F";
const WATCHTOWER     = "0x70c4E53E3A916eB8A695630f129B943af9C61C57";
const GUARDIAN       = "0x5c1D2cD6B9B291b436BF1b109A711F0E477EB6fe";

// ─── ABIs (minimal) ───────────────────────────────────────────────────────────

const TR_ABI = ["function addUpdater(address) external"];
const DA_ABI = [
  "function setServiceAgreement(address) external",
  "function setDisputeModule(address) external",
];
const SA_ABI = [
  "function setWatchtowerRegistry(address) external",
  "function setGuardian(address) external",
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function send(contract, method, args, label, nonce) {
  console.log(`  Sending: ${label} (nonce ${nonce})...`);
  const tx = await contract[method](...args, {
    nonce,
    maxFeePerGas: ethers.parseUnits("2", "gwei"),
    maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
    gasLimit: 200000,
  });
  const receipt = await tx.wait();
  console.log(`    ✅ ${label} — tx: ${receipt.hash}`);
}

async function main() {
  console.log("\n🔌  ARC-402 Wiring (raw ethers)\n");
  console.log(`Deployer: ${wallet.address}`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH\n`);

  let nonce = await provider.getTransactionCount(wallet.address, "pending");
  console.log(`Starting nonce: ${nonce}\n`);

  const TR = new ethers.Contract(TR_SA_ADDR, TR_ABI, wallet);
  const DA = new ethers.Contract(DA_ADDR, DA_ABI, wallet);
  const SA = new ethers.Contract(SA_ADDR, SA_ABI, wallet);

  // [2/6] TrustRegistry(SA).addUpdater(DisputeArbitration)
  await send(TR, "addUpdater", [DA_ADDR], "TrustRegistry.addUpdater(DA)", nonce++);

  // [3/6] DA.setServiceAgreement
  await send(DA, "setServiceAgreement", [SA_ADDR], "DA.setServiceAgreement", nonce++);

  // [4/6] DA.setDisputeModule
  await send(DA, "setDisputeModule", [DM_ADDR], "DA.setDisputeModule", nonce++);

  // [5/6] SA.setWatchtowerRegistry
  await send(SA, "setWatchtowerRegistry", [WATCHTOWER], "SA.setWatchtowerRegistry", nonce++);

  // [6/6] SA.setGuardian
  await send(SA, "setGuardian", [GUARDIAN], "SA.setGuardian", nonce++);

  console.log("\n✅  All wiring complete!\n");
  console.log("Final deployed addresses:");
  console.log("  ARC402Governance:    0x504b3D73A8dFbcAB9551d8a11Bb0B07C90C4c926");
  console.log("  ARC402Guardian:      0x5c1D2cD6B9B291b436BF1b109A711F0E477EB6fe");
  console.log("  ARC402Wallet:        0xc77854f9091A25eD1f35EA24E9bdFb64d0850E45");
  console.log("  AgreementTree:       0x8F46F31FcEbd60f526308AD20e4a008887709720");
  console.log("  CapabilityRegistry:  0x6a413e74b65828A014dD8DA61861Bf9E1b6372D2");
  console.log("  DisputeArbitration:  0x62FB9E6f6366B75FDe1D78a870D0B1D7334e2a4e");
  console.log("  GovernedTokenWhitelist: 0x64C15CA701167C7c901a8a5575a5232b37CAF213");
  console.log("  WatchtowerRegistry:  0x70c4E53E3A916eB8A695630f129B943af9C61C57");
}

main().catch((e) => { console.error(e); process.exit(1); });
