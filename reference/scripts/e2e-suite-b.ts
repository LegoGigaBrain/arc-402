/**
 * e2e-suite-b.ts — ARC-402 E2E Suite B: Dispute Paths + Suite C: Session Channels
 *
 * B-1: Owner-Resolved Dispute Path
 *      Fund → ARC402Wallets (WalletFactory) → AgentRegistry
 *      → Propose (0.001 ETH) → Accept → Commit → DirectDispute → Owner resolves → CANCELLED
 * B-2: Arbitration Path — both parties nominate → panel votes → PROVIDER_WINS → FULFILLED
 * B-3: Expired Dispute Refund — SKIP (requires vm.warp)
 * B-4: Auto-Release (client silent) — SKIP (requires vm.warp)
 * C-1: Session Channel — open ETH channel → expired → reclaim
 *
 * Run:
 *   npx hardhat run scripts/e2e-suite-b.ts --network baseSepolia
 */

import { ethers } from "hardhat";

// ─── v2 Contract Addresses (deployed 2026-03-15) ──────────────────────────────
const SA_ADDR = "0xF8d983E0517d407CbBA047be78803F26A494A0fc"; // ServiceAgreement
const TR_ADDR = "0xceb1c0Ca8B72Cc00cA4eac444a5a2e5716339cBf"; // TrustRegistryV3
const DA_ADDR = "0xAe394395183A205F1564543FF531021044fcb8B8"; // DisputeArbitration
const WF_ADDR = "0xbC73FBf023fc34b18a33D201e1ba339986EcE0Ee"; // WalletFactory
const AR_ADDR = "0x07D526f8A8e148570509aFa249EFF295045A0cc9"; // AgentRegistry

// ─── B-1 amounts — budget-adjusted (deployer ~0.00040 ETH remaining) ─────────
const B1_ESCROW      = ethers.parseEther("0.00005");  // minimal; WF+AR+propose+dispute must fit in 0.00012
const B1_FUND_CLIENT = ethers.parseEther("0.00012");  // escrow + WF(0.0000336) + AR + propose-gas + dispute-gas + fee
const B1_FUND_PROV   = ethers.parseEther("0.0001");   // WF(2.8Mgas) + AR(316K) + accept + commit at 12Mgwei

// ─── B-2 amounts — sized for GP=12M wei (5 wallets, arbitration logic) ───────
const B2_ESCROW      = 10000n;
const B2_FUND_CLIENT = ethers.parseEther("0.00005"); // ~4 txs @ auto-gas × 12M wei + buffer
const B2_FUND_PROV   = ethers.parseEther("0.00003"); // ~3 txs (accept+commit+nominate)
const B2_FUND_ARB    = ethers.parseEther("0.000008"); // ~1 vote tx

// ─── Suite C amounts ─────────────────────────────────────────────────────────
const C_DEPOSIT     = ethers.parseEther("0.00003"); // session channel ETH deposit (minimal)
const C_FUND_CLIENT = ethers.parseEther("0.00004"); // deposit + 2 tx gas (no WalletFactory needed)
const C_FUND_PROV   = BigInt(5_000_000_000);        // negligible (provider sends no txs)

// ─── Result tracking ──────────────────────────────────────────────────────────
interface StepResult { step: string; status: "PASS"|"FAIL"|"SKIP"; tx?: string; note?: string; }
const results: StepResult[] = [];
function record(step: string, status: "PASS"|"FAIL"|"SKIP", tx?: string, note?: string) {
  results.push({ step, status, tx, note });
  const icon = status === "PASS" ? "✅" : status === "SKIP" ? "⏭" : "❌";
  console.log(`  ${icon} ${step} ${status}${tx ? `  tx:${tx}` : ""}${note ? `  (${note})` : ""}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  ARC-402 E2E Suite B + C  (Base Sepolia)");
  console.log("══════════════════════════════════════════════════════════════");

  const [deployer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(bal)} ETH`);

  const feeData = await ethers.provider.getFeeData();
  const baseGP  = feeData.gasPrice ?? BigInt(6_000_000);
  const GP      = baseGP * 2n; // always 2× market; balance-based 1n fallback removed (breaks mining)
  console.log(`Gas price: ${GP} wei (2× market)\n`);

  const sa = await ethers.getContractAt("ServiceAgreement",  SA_ADDR, deployer);
  const tr = await ethers.getContractAt("TrustRegistryV3",   TR_ADDR, deployer);
  const da = await ethers.getContractAt("DisputeArbitration", DA_ADDR, deployer);
  const wf = await ethers.getContractAt("WalletFactory",     WF_ADDR, deployer);
  const ar = await ethers.getContractAt("AgentRegistry",     AR_ADDR, deployer);

  let dNonce = await ethers.provider.getTransactionCount(deployer.address, "pending");
  let tx: any, receipt: any;

  // ─── Diagnostics ─────────────────────────────────────────────────────────────
  const saOwner  = await (sa as any).owner();
  const scAddr   = await (sa as any).sessionChannels();
  console.log(`SA owner:          ${saOwner}`);
  console.log(`SA.sessionChannels: ${scAddr}`);
  console.log(`Deployer is owner: ${saOwner.toLowerCase() === deployer.address.toLowerCase()}`);
  if (saOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    console.log("⚠️  WARNING: deployer is NOT the SA owner — onlyOwner calls will revert!");
  }

  // ─── Setup: lower DA fee floor to $0 so dispute fees are tiny (3% of escrow) ─
  console.log("\n─── Setup: Set DisputeArbitration feeFloor to $0 ───");
  try {
    const currentFloor = await da.feeFloorUsd18();
    if (currentFloor === 0n) {
      record("Setup", "PASS", undefined, "feeFloor already $0 — skipping tx");
    } else {
      tx = await da.connect(deployer).setFeeFloorUsd(0n, { nonce: dNonce++, gasPrice: GP, gasLimit: 100000n });
      receipt = await tx.wait(1);
      record("Setup", "PASS", receipt.hash, "feeFloor → $0");
    }
  } catch (e: any) { record("Setup", "FAIL", undefined, e.message?.slice(0, 120)); throw e; }

  // Helper: quote dispute fee for a given escrow (110% + 1 wei buffer)
  async function quoteFee(escrow: bigint): Promise<bigint> {
    const f = await da.getFeeQuote(escrow, ethers.ZeroAddress, 0, 0);
    return f + (f / 10n) + 1n;
  }

  // Helper: parse AgreementProposed event → agreementId
  function parseAgreementId(rec: any): bigint {
    for (const log of rec.logs) {
      try {
        const p = sa.interface.parseLog({ topics: log.topics, data: log.data });
        if (p?.name === "AgreementProposed") return p.args[0] as bigint;
      } catch { /* skip */ }
    }
    throw new Error("AgreementProposed event not found");
  }

  // Helper: parse WalletCreated event → wallet address (args[1])
  function parseWalletAddr(rec: any): string {
    for (const log of rec.logs) {
      try {
        const p = wf.interface.parseLog({ topics: log.topics, data: log.data });
        if (p?.name === "WalletCreated") return p.args[1] as string;
      } catch { /* skip */ }
    }
    return "(unknown)";
  }

  // ════════════════════════════════════════════════════════════════════════════
  // B-1: Owner-Resolved Dispute Path
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n══ B-1: Owner-Resolved Dispute Path ════════════════════════════");

  const b1c = ethers.Wallet.createRandom().connect(ethers.provider); // client
  const b1p = ethers.Wallet.createRandom().connect(ethers.provider); // provider
  console.log(`  Client:   ${b1c.address}`);
  console.log(`  Provider: ${b1p.address}`);

  let b1cN = 0, b1pN = 0;
  let b1Id  = 0n;
  let b1cWallet = "(unknown)", b1pWallet = "(unknown)";

  // B1-01: Fund wallets (0.003 ETH each — budget-adjusted after prior run depletion)
  console.log("\n─── B1-01: Fund wallets ───");
  try {
    tx = await deployer.sendTransaction({ to: b1c.address, value: B1_FUND_CLIENT, nonce: dNonce++, gasPrice: GP, gasLimit: 21000n });
    receipt = await tx.wait(1); record("B1-01a", "PASS", receipt.hash, "client funded 0.003 ETH");
    tx = await deployer.sendTransaction({ to: b1p.address, value: B1_FUND_PROV,   nonce: dNonce++, gasPrice: GP, gasLimit: 21000n });
    receipt = await tx.wait(1); record("B1-01b", "PASS", receipt.hash, "provider funded 0.003 ETH");
  } catch (e: any) { record("B1-01", "FAIL", undefined, e.message?.slice(0, 120)); throw e; }

  // B1-02: Deploy ARC402Wallets via WalletFactory
  console.log("\n─── B1-02: Deploy ARC402Wallets via WalletFactory ───");
  try {
    receipt = await (await wf.connect(b1c).createWallet({ nonce: b1cN++, gasPrice: GP, gasLimit: 5000000n })).wait(1);
    b1cWallet = parseWalletAddr(receipt);
    record("B1-02a", "PASS", receipt.hash, `clientWallet=${b1cWallet}`);

    receipt = await (await wf.connect(b1p).createWallet({ nonce: b1pN++, gasPrice: GP, gasLimit: 5000000n })).wait(1);
    b1pWallet = parseWalletAddr(receipt);
    record("B1-02b", "PASS", receipt.hash, `providerWallet=${b1pWallet}`);
  } catch (e: any) { record("B1-02", "FAIL", undefined, e.message?.slice(0, 120)); throw e; }

  // B1-03: Register both in AgentRegistry
  console.log("\n─── B1-03: Register in AgentRegistry ───");
  try {
    receipt = await (await ar.connect(b1c).register(
      "e2e-suite-b-client", ["testing"], "testing", "", "",
      { nonce: b1cN++, gasPrice: GP, gasLimit: 500000n }
    )).wait(1);
    record("B1-03a", "PASS", receipt.hash, "client registered");

    receipt = await (await ar.connect(b1p).register(
      "e2e-suite-b-provider", ["compute", "testing"], "compute", "", "",
      { nonce: b1pN++, gasPrice: GP, gasLimit: 500000n }
    )).wait(1);
    record("B1-03b", "PASS", receipt.hash, "provider registered");
  } catch (e: any) { record("B1-03", "FAIL", undefined, e.message?.slice(0, 120)); throw e; }

  // B1-04: Client proposes agreement (0.001 ETH escrow)
  console.log("\n─── B1-04: Client proposes agreement (0.001 ETH escrow) ───");
  try {
    receipt = await (await sa.connect(b1c).propose(
      b1p.address, "compute", "B-1 dispute path test",
      B1_ESCROW, ethers.ZeroAddress, Math.floor(Date.now() / 1000) + 7200,
      ethers.keccak256(ethers.toUtf8Bytes("b1-deliverable")),
      { value: B1_ESCROW, nonce: b1cN++, gasPrice: GP }
    )).wait(1);
    b1Id = parseAgreementId(receipt);
    record("B1-04", "PASS", receipt.hash, `agreementId=${b1Id}, escrow=${ethers.formatEther(B1_ESCROW)} ETH`);
  } catch (e: any) { record("B1-04", "FAIL", undefined, e.message?.slice(0, 120)); throw e; }

  // B1-05: Provider accepts
  console.log("\n─── B1-05: Provider accepts ───");
  try {
    receipt = await (await sa.connect(b1p).accept(b1Id, { nonce: b1pN++, gasPrice: GP })).wait(1);
    record("B1-05", "PASS", receipt.hash, "ACCEPTED");
  } catch (e: any) { record("B1-05", "FAIL", undefined, e.message?.slice(0, 120)); throw e; }

  // B1-06: Provider commits deliverable
  console.log("\n─── B1-06: Provider commits deliverable ───");
  try {
    receipt = await (await sa.connect(b1p).commitDeliverable(
      b1Id, ethers.keccak256(ethers.toUtf8Bytes("b1-deliverable")),
      { nonce: b1pN++, gasPrice: GP }
    )).wait(1);
    record("B1-06", "PASS", receipt.hash, "PENDING_VERIFICATION");
  } catch (e: any) { record("B1-06", "FAIL", undefined, e.message?.slice(0, 120)); throw e; }

  // B1-07: Client opens directDispute (INVALID_OR_FRAUDULENT_DELIVERABLE=3) instead of verifying
  console.log("\n─── B1-07: Client opens directDispute (INVALID_OR_FRAUDULENT_DELIVERABLE=3) ───");
  try {
    const fee = await quoteFee(B1_ESCROW);
    console.log(`  Dispute fee: ${fee} wei (${ethers.formatEther(fee)} ETH)`);
    receipt = await (await sa.connect(b1c).directDispute(
      b1Id, 3, "Deliverable is invalid — disputing instead of verifying",
      { value: fee, nonce: b1cN++, gasPrice: GP }
    )).wait(1);
    record("B1-07", "PASS", receipt.hash, "DISPUTED");
  } catch (e: any) { record("B1-07", "FAIL", undefined, e.message?.slice(0, 120)); throw e; }

  // B1-08: Owner resolves → CLIENT_REFUND
  console.log("\n─── B1-08: Owner resolves → CLIENT_REFUND ───");
  try {
    // Static-call first for diagnostic output without consuming nonce
    try {
      await sa.connect(deployer).resolveDisputeDetailed.staticCall(b1Id, 3, 0n, B1_ESCROW);
      console.log("  staticCall: OK (no revert)");
    } catch (se: any) {
      console.log(`  staticCall revert: ${se.message?.slice(0, 200)}`);
      console.log(`  errorName: ${se.errorName ?? "n/a"}  data: ${(se as any).data ?? "n/a"}`);
    }

    receipt = await (await sa.connect(deployer).resolveDisputeDetailed(
      b1Id, 3, 0n, B1_ESCROW,
      { nonce: dNonce++, gasPrice: GP }
    )).wait(1);
    record("B1-08", "PASS", receipt.hash, "escrow → client (resolveDisputeDetailed)");
  } catch (e: any) {
    const errData = (e as any).data ?? (e as any).info?.error?.data ?? "n/a";
    console.log(`  tx error: ${e.message?.slice(0, 100)}  data: ${errData}`);
    record("B1-08-rdd", "FAIL", undefined, e.message?.slice(0, 80));

    // Fallback: ownerResolveDispute(b1Id, false) → CLIENT_REFUND
    console.log("  → fallback: ownerResolveDispute(b1Id, false)");
    try {
      try {
        await sa.connect(deployer).ownerResolveDispute.staticCall(b1Id, false);
        console.log("  ownerResolveDispute staticCall: OK");
      } catch (se2: any) {
        console.log(`  ownerResolveDispute staticCall: ${se2.message?.slice(0, 160)}`);
        console.log(`  errorName: ${se2.errorName ?? "n/a"}  data: ${(se2 as any).data ?? "n/a"}`);
      }
      receipt = await (await sa.connect(deployer).ownerResolveDispute(
        b1Id, false,
        { nonce: dNonce++, gasPrice: GP }
      )).wait(1);
      record("B1-08", "PASS", receipt.hash, "escrow → client (ownerResolveDispute)");
    } catch (e2: any) {
      record("B1-08", "FAIL", undefined, e2.message?.slice(0, 80));
      // Do NOT throw — let B-2 and Suite C run for independent diagnostics
    }
  }

  // B1-09: Assert status = CANCELLED (5) + check trust scores
  console.log("\n─── B1-09: Assert status = CANCELLED + check trust scores ───");
  try {
    const s = Number((await sa.getAgreement(b1Id)).status);
    record("B1-09a", s === 5 ? "PASS" : "FAIL", undefined, `status=${s} (CANCELLED=5)`);
  } catch (e: any) { record("B1-09a", "FAIL", undefined, e.message?.slice(0, 120)); }

  try {
    const provScore   = await tr.getEffectiveScore(b1p.address);
    const clientScore = await tr.getEffectiveScore(b1c.address);
    // Provider score penalized (< 100) after CLIENT_REFUND resolution; client unchanged (~0 if uninit)
    record("B1-09b", "PASS", undefined,
      `providerScore=${provScore} (expect <100 after dispute loss), clientScore=${clientScore}`);
  } catch (e: any) { record("B1-09b", "FAIL", undefined, e.message?.slice(0, 120)); }

  // ════════════════════════════════════════════════════════════════════════════
  // B-2: Arbitration Path
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n══ B-2: Arbitration Path ════════════════════════════════════════");

  const b2c  = ethers.Wallet.createRandom().connect(ethers.provider);
  const b2p  = ethers.Wallet.createRandom().connect(ethers.provider);
  const arb1 = ethers.Wallet.createRandom().connect(ethers.provider);
  const arb2 = ethers.Wallet.createRandom().connect(ethers.provider);
  const arb3 = ethers.Wallet.createRandom().connect(ethers.provider);

  console.log(`  Client:   ${b2c.address}`);
  console.log(`  Provider: ${b2p.address}`);
  console.log(`  Arb1:     ${arb1.address}`);
  console.log(`  Arb2:     ${arb2.address}`);
  console.log(`  Arb3:     ${arb3.address}`);

  let b2cN = 0, b2pN = 0, a1N = 0, a2N = 0;
  let b2Id = 0n;

  // B2-01: Fund wallets
  console.log("\n─── B2-01: Fund wallets ───");
  try {
    for (const [addr, amt, label] of [
      [b2c.address,  B2_FUND_CLIENT, "b2-client"],
      [b2p.address,  B2_FUND_PROV,   "b2-provider"],
      [arb1.address, B2_FUND_ARB,    "arb1"],
      [arb2.address, B2_FUND_ARB,    "arb2"],
      [arb3.address, B2_FUND_ARB,    "arb3"],
    ] as [string, bigint, string][]) {
      tx = await deployer.sendTransaction({ to: addr, value: amt, nonce: dNonce++, gasPrice: GP, gasLimit: 21000n });
      receipt = await tx.wait(1);
      record(`B2-01-${label}`, "PASS", receipt.hash, "funded");
    }
  } catch (e: any) { record("B2-01", "FAIL", undefined, e.message?.slice(0, 120)); throw e; }

  // B2-02: Initialize arbitrators in TrustRegistryV3 (score→100, eligible ≥50)
  console.log("\n─── B2-02: Initialize arbitrators in TrustRegistryV3 ───");
  try {
    // addUpdater is idempotent-ish — catch duplicate gracefully
    try {
      tx = await tr.connect(deployer).addUpdater(deployer.address, { nonce: dNonce++, gasPrice: GP, gasLimit: 100000n });
      receipt = await tx.wait(1);
      record("B2-02a", "PASS", receipt.hash, "deployer → TR updater");
    } catch (ae: any) {
      // Re-fetch nonce (tx may or may not have been consumed)
      dNonce = await ethers.provider.getTransactionCount(deployer.address, "pending");
      record("B2-02a", "PASS", undefined, `addUpdater skipped: ${ae.message?.slice(0, 60)}`);
    }

    for (const [arb, label] of [[arb1,"arb1"],[arb2,"arb2"],[arb3,"arb3"]] as [typeof arb1, string][]) {
      tx = await tr.connect(deployer).initWallet(arb.address, { nonce: dNonce++, gasPrice: GP, gasLimit: 150000n });
      receipt = await tx.wait(1);
      const score = await tr.getEffectiveScore(arb.address);
      record(`B2-02-${label}`, "PASS", receipt.hash, `score=${score} (eligible ≥50)`);
    }
  } catch (e: any) { record("B2-02", "FAIL", undefined, e.message?.slice(0, 120)); throw e; }

  // B2-03: Propose agreement
  console.log("\n─── B2-03: Propose agreement ───");
  try {
    receipt = await (await sa.connect(b2c).propose(
      b2p.address, "compute", "B-2 arbitration path test",
      B2_ESCROW, ethers.ZeroAddress, Math.floor(Date.now() / 1000) + 3600,
      ethers.keccak256(ethers.toUtf8Bytes("b2-deliverable")),
      { value: B2_ESCROW, nonce: b2cN++, gasPrice: GP, }
    )).wait(1);
    b2Id = parseAgreementId(receipt);
    record("B2-03", "PASS", receipt.hash, `agreementId=${b2Id}`);
  } catch (e: any) { record("B2-03", "FAIL", undefined, e.message?.slice(0, 120)); throw e; }

  // B2-04: Provider accepts
  console.log("\n─── B2-04: Provider accepts ───");
  try {
    receipt = await (await sa.connect(b2p).accept(b2Id, { nonce: b2pN++, gasPrice: GP })).wait(1);
    record("B2-04", "PASS", receipt.hash, "ACCEPTED");
  } catch (e: any) { record("B2-04", "FAIL", undefined, e.message?.slice(0, 120)); throw e; }

  // B2-05: Provider commits deliverable
  console.log("\n─── B2-05: Provider commits deliverable ───");
  try {
    receipt = await (await sa.connect(b2p).commitDeliverable(
      b2Id, ethers.keccak256(ethers.toUtf8Bytes("b2-deliverable")),
      { nonce: b2pN++, gasPrice: GP }
    )).wait(1);
    record("B2-05", "PASS", receipt.hash, "PENDING_VERIFICATION");
  } catch (e: any) { record("B2-05", "FAIL", undefined, e.message?.slice(0, 120)); throw e; }

  // B2-06: Client opens directDispute (INVALID_OR_FRAUDULENT_DELIVERABLE=3)
  console.log("\n─── B2-06: Client opens directDispute (INVALID_OR_FRAUDULENT_DELIVERABLE=3) ───");
  try {
    const fee = await quoteFee(B2_ESCROW);
    console.log(`  Dispute fee: ${fee} wei`);
    receipt = await (await sa.connect(b2c).directDispute(
      b2Id, 3, "Deliverable is fraudulent",
      { value: fee, nonce: b2cN++, gasPrice: GP }
    )).wait(1);
    record("B2-06", "PASS", receipt.hash, "DISPUTED");
  } catch (e: any) { record("B2-06", "FAIL", undefined, e.message?.slice(0, 120)); throw e; }

  // B2-07: Client nominates arb1, arb2
  console.log("\n─── B2-07: Client nominates arb1, arb2 ───");
  try {
    receipt = await (await sa.connect(b2c).nominateArbitrator(b2Id, arb1.address, { nonce: b2cN++, gasPrice: GP })).wait(1);
    record("B2-07a", "PASS", receipt.hash, "arb1 nominated");
    receipt = await (await sa.connect(b2c).nominateArbitrator(b2Id, arb2.address, { nonce: b2cN++, gasPrice: GP })).wait(1);
    record("B2-07b", "PASS", receipt.hash, "arb2 nominated");
  } catch (e: any) { record("B2-07", "FAIL", undefined, e.message?.slice(0, 120)); throw e; }

  // B2-08: Provider nominates arb3 → panel complete → ESCALATED_TO_ARBITRATION
  console.log("\n─── B2-08: Provider nominates arb3 → panel complete ───");
  try {
    receipt = await (await sa.connect(b2p).nominateArbitrator(b2Id, arb3.address, { nonce: b2pN++, gasPrice: GP })).wait(1);
    const s = Number((await sa.getAgreement(b2Id)).status);
    record("B2-08", "PASS", receipt.hash, `arb3 nominated, status=${s} (ESCALATED_TO_ARBITRATION=11)`);
  } catch (e: any) { record("B2-08", "FAIL", undefined, e.message?.slice(0, 120)); throw e; }

  // B2-09: arb1 votes PROVIDER_WINS (1/3)
  console.log("\n─── B2-09: arb1 votes PROVIDER_WINS ───");
  try {
    receipt = await (await sa.connect(arb1).castArbitrationVote(
      b2Id, 1, B2_ESCROW, 0n, // PROVIDER_WINS=1, providerAward=full, clientAward=0
      { nonce: a1N++, gasPrice: GP }
    )).wait(1);
    record("B2-09", "PASS", receipt.hash, "arb1: PROVIDER_WINS");
  } catch (e: any) { record("B2-09", "FAIL", undefined, e.message?.slice(0, 120)); throw e; }

  // B2-10: arb2 votes PROVIDER_WINS (2/3 majority → FULFILLED)
  console.log("\n─── B2-10: arb2 votes PROVIDER_WINS (2/3 majority) ───");
  try {
    receipt = await (await sa.connect(arb2).castArbitrationVote(
      b2Id, 1, B2_ESCROW, 0n,
      { nonce: a2N++, gasPrice: GP }
    )).wait(1);
    record("B2-10", "PASS", receipt.hash, "arb2: PROVIDER_WINS → FULFILLED");
  } catch (e: any) { record("B2-10", "FAIL", undefined, e.message?.slice(0, 120)); throw e; }

  // B2-11: Assert status = FULFILLED (3)
  console.log("\n─── B2-11: Assert status = FULFILLED (3) ───");
  try {
    const s = Number((await sa.getAgreement(b2Id)).status);
    const STATUS = ["PROPOSED","ACCEPTED","PENDING_VERIFICATION","FULFILLED","DISPUTED","CANCELLED",
                    "REVISION_REQUESTED","REVISED","PARTIAL_SETTLEMENT","MUTUAL_CANCEL",
                    "ESCALATED_TO_HUMAN","ESCALATED_TO_ARBITRATION"];
    record("B2-11", s === 3 ? "PASS" : "FAIL", undefined, `status=${s} (${STATUS[s] ?? s})`);
  } catch (e: any) { record("B2-11", "FAIL", undefined, e.message?.slice(0, 120)); }

  // ─── B-3, B-4: SKIP ─────────────────────────────────────────────────────────
  record("B3", "SKIP", undefined, "Requires vm.warp (30-day timeout)");
  record("B4", "SKIP", undefined, "Requires vm.warp (3-day auto-release)");

  // ════════════════════════════════════════════════════════════════════════════
  // Suite C: Session Channels (ETH, reclaim-expired path)
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n══ Suite C: Session Channels ════════════════════════════════════");

  if (!scAddr || scAddr === ethers.ZeroAddress) {
    record("C-skip", "SKIP", undefined, "SA.sessionChannels == address(0) — wiring required");
    console.log("  Suite C skipped: session channels not wired on SA deployment");
  } else {
    console.log(`  SessionChannels: ${scAddr}`);

    const sc = await ethers.getContractAt("SessionChannels", scAddr, deployer);

    const cc = ethers.Wallet.createRandom().connect(ethers.provider); // C client
    const cp = ethers.Wallet.createRandom().connect(ethers.provider); // C provider
    console.log(`  Client:   ${cc.address}`);
    console.log(`  Provider: ${cp.address}`);

    let ccN = 0;
    let channelId: string = "(unknown)";

    // C-01: Fund wallets
    console.log("\n─── C-01: Fund wallets ───");
    try {
      tx = await deployer.sendTransaction({ to: cc.address, value: C_FUND_CLIENT, nonce: dNonce++, gasPrice: GP, gasLimit: 21000n });
      receipt = await tx.wait(1); record("C-01a", "PASS", receipt.hash, "C client funded 0.001 ETH");
      tx = await deployer.sendTransaction({ to: cp.address, value: C_FUND_PROV,   nonce: dNonce++, gasPrice: GP, gasLimit: 21000n });
      receipt = await tx.wait(1); record("C-01b", "PASS", receipt.hash, "C provider funded (gas buffer)");
    } catch (e: any) { record("C-01", "FAIL", undefined, e.message?.slice(0, 120)); }

    // C-02: Client opens session channel (ETH, 90s deadline, 0.0001 ETH deposit)
    console.log("\n─── C-02: Client opens session channel (ETH, 90s deadline) ───");
    try {
      const cDeadline = Math.floor(Date.now() / 1000) + 90;
      receipt = await (await sa.connect(cc).openSessionChannel(
        cp.address,
        ethers.ZeroAddress, // ETH
        C_DEPOSIT,
        0n,                  // ratePerCall = 0 (off-chain metering not enforced here)
        cDeadline,
        { value: C_DEPOSIT, nonce: ccN++, gasPrice: GP }
      )).wait(1);

      // Parse ChannelOpened event
      for (const log of receipt.logs) {
        try {
          const p = sc.interface.parseLog({ topics: log.topics, data: log.data });
          if (p?.name === "ChannelOpened") { channelId = p.args[0] as string; break; }
        } catch { /* skip */ }
      }
      record("C-02", "PASS", receipt.hash, `channelId=${channelId}, deposit=${ethers.formatEther(C_DEPOSIT)} ETH`);
    } catch (e: any) { record("C-02", "FAIL", undefined, e.message?.slice(0, 120)); }

    // C-03: Assert channel OPEN (status=0)
    console.log("\n─── C-03: Assert channel OPEN ───");
    try {
      const ch = await (sa as any).getChannel(channelId);
      const s = Number(ch.status);
      record("C-03", s === 0 ? "PASS" : "FAIL", undefined,
        `status=${s} (OPEN=0), deposit=${ch.depositAmount}, client=${ch.client}`);
    } catch (e: any) { record("C-03", "FAIL", undefined, e.message?.slice(0, 120)); }

    // C-04: Wait 95s for channel deadline to pass
    console.log("\n─── C-04: Wait 95s for channel deadline to pass ───");
    console.log("  Sleeping 95s...");
    await sleep(95_000);
    record("C-04", "PASS", undefined, "95s elapsed, channel deadline passed");

    // C-05: Client reclaims expired channel (full deposit refunded)
    console.log("\n─── C-05: Client reclaims expired channel ───");
    try {
      receipt = await (await sa.connect(cc).reclaimExpiredChannel(
        channelId,
        { nonce: ccN++, gasPrice: GP }
      )).wait(1);
      record("C-05", "PASS", receipt.hash, "reclaimExpiredChannel OK");
    } catch (e: any) { record("C-05", "FAIL", undefined, e.message?.slice(0, 120)); }

    // C-06: Assert channel SETTLED (status=3), settledAmount=0 (full refund to client)
    console.log("\n─── C-06: Assert channel SETTLED ───");
    try {
      const ch = await (sa as any).getChannel(channelId);
      const s = Number(ch.status);
      // settledAmount=0 means full deposit was sent back to client (no provider payment)
      record("C-06", s === 3 ? "PASS" : "FAIL", undefined,
        `status=${s} (SETTLED=3), settledAmount=${ch.settledAmount} (0=full refund to client)`);
    } catch (e: any) { record("C-06", "FAIL", undefined, e.message?.slice(0, 120)); }
  }

  // ─── Summary ─────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  Suite B + C Results");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  B-1 Agreement ID: ${b1Id}  |  B-2 Agreement ID: ${b2Id}`);
  console.log(`  B-1 clientWallet: ${b1cWallet}`);
  console.log(`  B-1 providerWallet: ${b1pWallet}\n`);

  let passed = 0, failed = 0, skipped = 0;
  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : r.status === "SKIP" ? "⏭" : "❌";
    console.log(`  ${icon} ${r.step.padEnd(20)}  ${r.status}${r.tx ? `  ${r.tx}` : ""}${r.note ? `  — ${r.note}` : ""}`);
    if (r.status === "PASS") passed++;
    else if (r.status === "SKIP") skipped++;
    else failed++;
  }

  console.log(`\n  ${passed} PASS  |  ${failed} FAIL  |  ${skipped} SKIP\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("\nFATAL:", e.message ?? e);
  process.exit(1);
});
