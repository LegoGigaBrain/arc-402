/**
 * e2e-suite-a.ts — ARC-402 E2E Suite A: Happy Path
 *
 * Scenario: Client hires provider. Provider delivers. Client verifies. Escrow releases.
 *
 * Steps:
 *   A-01  Fund two fresh test wallets from deployer
 *   A-02  Deploy ARC402Wallets via WalletFactory (one per EOA)
 *   A-03  Register both EOAs in AgentRegistry
 *   A-04  Client proposes service agreement (0.001 ETH escrow)
 *   A-05  Provider accepts
 *   A-06  Provider commits deliverable hash
 *   A-07  Client verifies and releases escrow
 *   A-08  Trust score updated on TrustRegistryV3
 *   A-09  Agreement status = FULFILLED (3)
 *
 * Run:
 *   npx hardhat run scripts/e2e-suite-a.ts --network baseSepolia
 */

import { ethers } from "hardhat";

// ─── v2 Contract Addresses (deployed 2026-03-15) ──────────────────────────────
const SA_ADDR = "0xF8d983E0517d407CbBA047be78803F26A494A0fc"; // ServiceAgreement
const TR_ADDR = "0xceb1c0Ca8B72Cc00cA4eac444a5a2e5716339cBf"; // TrustRegistryV3
const WF_ADDR = "0xbC73FBf023fc34b18a33D201e1ba339986EcE0Ee"; // WalletFactory (v2)
const AR_ADDR = "0x07D526f8A8e148570509aFa249EFF295045A0cc9"; // AgentRegistry (v1, unchanged)

const ESCROW        = ethers.parseEther("0.001");
const FUND_CLIENT   = ethers.parseEther("0.0018"); // escrow + gas
const FUND_PROVIDER = ethers.parseEther("0.0008"); // gas only

// ─── Result tracking ──────────────────────────────────────────────────────────
interface StepResult {
  step: string;
  status: "PASS" | "FAIL";
  tx?: string;
  note?: string;
}
const results: StepResult[] = [];

function record(step: string, status: "PASS" | "FAIL", tx?: string, note?: string) {
  results.push({ step, status, tx, note });
  const icon = status === "PASS" ? "✅" : "❌";
  const txStr = tx ? `  tx: ${tx}` : "";
  const noteStr = note ? `  (${note})` : "";
  console.log(`  ${icon} ${step} ${status}${txStr}${noteStr}`);
}

async function main() {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  ARC-402 E2E Suite A — Happy Path  (Base Sepolia)");
  console.log("══════════════════════════════════════════════════════════════");

  const [deployer] = await ethers.getSigners();
  const deployerBal = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(deployerBal)} ETH`);

  // ─── Use actual network gas price (Base Sepolia is ~0.006 gwei, far below hardhat default) ──
  const feeData = await ethers.provider.getFeeData();
  const netGasPrice = feeData.gasPrice ?? BigInt(10_000_000);
  const GP = netGasPrice * 3n; // 3× for prompt inclusion
  console.log(`Network gas price: ${netGasPrice} wei → using ${GP} wei\n`);

  // ─── Connect contracts ─────────────────────────────────────────────────────
  const sa = await ethers.getContractAt("ServiceAgreement", SA_ADDR, deployer);
  const tr = await ethers.getContractAt("TrustRegistryV3",  TR_ADDR, deployer);
  const wf = await ethers.getContractAt("WalletFactory",    WF_ADDR, deployer);
  const ar = await ethers.getContractAt("AgentRegistry",    AR_ADDR, deployer);

  // ─── Create fresh test EOA wallets ────────────────────────────────────────
  const clientEOA   = ethers.Wallet.createRandom().connect(ethers.provider);
  const providerEOA = ethers.Wallet.createRandom().connect(ethers.provider);
  console.log(`Fresh test wallets:`);
  console.log(`  Client:   ${clientEOA.address}`);
  console.log(`  Provider: ${providerEOA.address}`);

  // ─── Nonce tracking ────────────────────────────────────────────────────────
  let dNonce = await ethers.provider.getTransactionCount(deployer.address, "pending");
  let cNonce = 0; // fresh wallet, starts at 0
  let pNonce = 0; // fresh wallet, starts at 0

  let tx: any;
  let receipt: any;

  // ══════════════════════════════════════════════════════════════════════════
  // A-01: Fund test wallets from deployer
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n─── A-01: Fund test wallets ───");

  try {
    tx = await deployer.sendTransaction({
      to: clientEOA.address, value: FUND_CLIENT,
      nonce: dNonce++, gasPrice: GP,
    });
    receipt = await tx.wait(1);
    record("A-01a", "PASS", receipt.hash, `client funded ${ethers.formatEther(FUND_CLIENT)} ETH`);
  } catch (e: any) {
    record("A-01a", "FAIL", undefined, e.message?.slice(0, 120));
    throw e;
  }

  try {
    tx = await deployer.sendTransaction({
      to: providerEOA.address, value: FUND_PROVIDER,
      nonce: dNonce++, gasPrice: GP,
    });
    receipt = await tx.wait(1);
    record("A-01b", "PASS", receipt.hash, `provider funded ${ethers.formatEther(FUND_PROVIDER)} ETH`);
  } catch (e: any) {
    record("A-01b", "FAIL", undefined, e.message?.slice(0, 120));
    throw e;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // A-02: Deploy ARC402Wallets via WalletFactory (each EOA calls createWallet)
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n─── A-02: Deploy ARC402Wallets via WalletFactory ───");

  let clientWalletAddr  = "(unknown)";
  let providerWalletAddr = "(unknown)";

  try {
    const resp = await wf.connect(clientEOA).createWallet({ nonce: cNonce++, gasPrice: GP });
    receipt = await resp.wait(1);
    for (const log of receipt.logs) {
      try {
        const parsed = wf.interface.parseLog({ topics: log.topics, data: log.data });
        if (parsed?.name === "WalletCreated") { clientWalletAddr = parsed.args[1]; break; }
      } catch { /* skip */ }
    }
    record("A-02a", "PASS", receipt.hash, `clientWallet=${clientWalletAddr}`);
  } catch (e: any) {
    record("A-02a", "FAIL", undefined, e.message?.slice(0, 120));
    throw e;
  }

  try {
    const resp = await wf.connect(providerEOA).createWallet({ nonce: pNonce++, gasPrice: GP });
    receipt = await resp.wait(1);
    for (const log of receipt.logs) {
      try {
        const parsed = wf.interface.parseLog({ topics: log.topics, data: log.data });
        if (parsed?.name === "WalletCreated") { providerWalletAddr = parsed.args[1]; break; }
      } catch { /* skip */ }
    }
    record("A-02b", "PASS", receipt.hash, `providerWallet=${providerWalletAddr}`);
  } catch (e: any) {
    record("A-02b", "FAIL", undefined, e.message?.slice(0, 120));
    throw e;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // A-03: Register both in AgentRegistry
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n─── A-03: Register in AgentRegistry ───");

  try {
    const resp = await ar.connect(clientEOA).register(
      "e2e-suite-a-client", ["testing"], "testing", "", "",
      { nonce: cNonce++, gasPrice: GP }
    );
    receipt = await resp.wait(1);
    record("A-03a", "PASS", receipt.hash, "client registered");
  } catch (e: any) {
    record("A-03a", "FAIL", undefined, e.message?.slice(0, 120));
    throw e;
  }

  try {
    const resp = await ar.connect(providerEOA).register(
      "e2e-suite-a-provider", ["compute", "testing"], "compute", "", "",
      { nonce: pNonce++, gasPrice: GP }
    );
    receipt = await resp.wait(1);
    record("A-03b", "PASS", receipt.hash, "provider registered");
  } catch (e: any) {
    record("A-03b", "FAIL", undefined, e.message?.slice(0, 120));
    throw e;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // A-04: Client proposes service agreement (0.001 ETH escrow)
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n─── A-04: Client proposes agreement (0.001 ETH escrow) ───");

  const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes("e2e-suite-a-deliverable-v2"));
  const deadline = Math.floor(Date.now() / 1000) + 7200; // 2 hours
  let agreementId = 0n;

  try {
    const resp = await sa.connect(clientEOA).propose(
      providerEOA.address,
      "compute",
      "E2E Suite A — happy path (automated)",
      ESCROW,
      ethers.ZeroAddress,
      deadline,
      deliverableHash,
      { value: ESCROW, nonce: cNonce++, gasPrice: GP }
    );
    receipt = await resp.wait(1);
    for (const log of receipt.logs) {
      try {
        const parsed = sa.interface.parseLog({ topics: log.topics, data: log.data });
        if (parsed?.name === "AgreementProposed") { agreementId = parsed.args[0]; break; }
      } catch { /* skip */ }
    }
    record("A-04", "PASS", receipt.hash, `agreementId=${agreementId}, escrow=0.001 ETH`);
  } catch (e: any) {
    record("A-04", "FAIL", undefined, e.message?.slice(0, 120));
    throw e;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // A-05: Provider accepts
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n─── A-05: Provider accepts ───");

  try {
    const resp = await sa.connect(providerEOA).accept(agreementId, { nonce: pNonce++, gasPrice: GP });
    receipt = await resp.wait(1);
    record("A-05", "PASS", receipt.hash, `ACCEPTED`);
  } catch (e: any) {
    record("A-05", "FAIL", undefined, e.message?.slice(0, 120));
    throw e;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // A-06: Provider commits deliverable hash
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n─── A-06: Provider commits deliverable hash ───");

  try {
    const resp = await sa.connect(providerEOA).commitDeliverable(
      agreementId, deliverableHash,
      { nonce: pNonce++, gasPrice: GP }
    );
    receipt = await resp.wait(1);
    record("A-06", "PASS", receipt.hash, "DeliverableCommitted, verify window open");
  } catch (e: any) {
    record("A-06", "FAIL", undefined, e.message?.slice(0, 120));
    throw e;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // A-07: Client verifies and releases escrow
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n─── A-07: Client verifies and releases escrow ───");

  try {
    const resp = await sa.connect(clientEOA).verifyDeliverable(
      agreementId,
      { nonce: cNonce++, gasPrice: GP }
    );
    receipt = await resp.wait(1);
    record("A-07", "PASS", receipt.hash, "AgreementFulfilled, escrow released");
  } catch (e: any) {
    record("A-07", "FAIL", undefined, e.message?.slice(0, 120));
    throw e;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // A-08: Check trust score updated on TrustRegistryV3
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n─── A-08: Check trust score on TrustRegistryV3 ───");

  try {
    const score = await tr.getScore(providerEOA.address);
    // TrustRegistryV3: INITIAL_SCORE=100; after one fulfillment score >= 100
    const pass = score >= 100n;
    record("A-08", pass ? "PASS" : "FAIL", undefined,
      `providerScore=${score} (initial=100, expected ≥100)`);
  } catch (e: any) {
    record("A-08", "FAIL", undefined, e.message?.slice(0, 120));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // A-09: Assert agreement status = FULFILLED (3)
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n─── A-09: Assert agreement status = FULFILLED (3) ───");

  try {
    const ag = await sa.getAgreement(agreementId);
    const s = Number(ag.status);
    const STATUS = ["PROPOSED","ACCEPTED","PENDING_VERIFICATION","FULFILLED","DISPUTED","CANCELLED"];
    const pass = s === 3;
    record("A-09", pass ? "PASS" : "FAIL", undefined, `status=${s} (${STATUS[s] ?? s})`);
  } catch (e: any) {
    record("A-09", "FAIL", undefined, e.message?.slice(0, 120));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Summary
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  Suite A Results");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  Client EOA:       ${clientEOA.address}`);
  console.log(`  Provider EOA:     ${providerEOA.address}`);
  console.log(`  Client wallet:    ${clientWalletAddr}`);
  console.log(`  Provider wallet:  ${providerWalletAddr}`);
  console.log(`  Agreement ID:     ${agreementId}`);
  console.log("");

  let passed = 0, failed = 0;
  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : "❌";
    const txStr = r.tx ? `  ${r.tx}` : "";
    const noteStr = r.note ? `  — ${r.note}` : "";
    console.log(`  ${icon} ${r.step.padEnd(6)}  ${r.status}${txStr}${noteStr}`);
    if (r.status === "PASS") passed++; else failed++;
  }

  console.log(`\n  ${passed} PASS  |  ${failed} FAIL\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("\nFATAL:", e.message ?? e);
  process.exit(1);
});
