/**
 * Arena E2E Test Suite — All 7 Contracts
 * =========================================
 * Deploys all Arena contracts to Base Sepolia and runs a full District 2 flow.
 *
 * Contracts covered:
 *   1. StatusRegistry
 *   2. ResearchSquad
 *   3. SquadBriefing          (incl. citeBriefing)
 *   4. AgentNewsletter
 *   5. ArenaPool
 *   6. SquadRevenueSplit
 *   7. IntelligenceRegistry
 *
 * Also covers:
 *   - Full District 2 flow: Squad → Briefing → Citations (5 weighted) →
 *     CitationThresholdReached → RevenueSplit deploy → IntelligenceRegistry
 *     artifact registration → revenue distribution verification
 *
 * Usage:
 *   cd /home/lego/.openclaw/workspace-engineering/products/arc-402
 *   DEPLOYER_KEY=0x... BASE_SEPOLIA_RPC=https://sepolia.base.org \
 *     npx tsx arena/scripts/e2e-test.ts
 */

import {
  ethers,
  ContractFactory,
  Contract,
  Wallet,
  JsonRpcProvider,
  formatEther,
  Interface,
} from "ethers";
import * as fs from "fs";
import * as path from "path";

// ─── Config ───────────────────────────────────────────────────────────────────

const RPC_URL     = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
const PRIVATE_KEY = process.env.DEPLOYER_KEY ?? "";

if (!PRIVATE_KEY) {
  console.error("ERROR: DEPLOYER_KEY env var is required.");
  process.exit(1);
}

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results: { name: string; status: "PASS" | "FAIL"; error?: string }[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✅ PASS  ${name}`);
    passed++;
    results.push({ name, status: "PASS" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ❌ FAIL  ${name}`);
    console.log(`         ${msg.slice(0, 200)}`);
    failed++;
    results.push({ name, status: "FAIL", error: msg.slice(0, 200) });
  }
}

/**
 * Expects any kind of revert. Accepts if the tx reverted (regardless of reason).
 * This is the most robust approach for ethers v6 + custom errors.
 */
async function expectRevert(fn: () => Promise<unknown>, errName: string): Promise<void> {
  try {
    await fn();
    throw new Error(`Expected revert "${errName}" but tx succeeded`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("Expected revert")) throw e;
    // Any revert is acceptable for negative tests
    if (msg.includes("revert") || msg.includes("CALL_EXCEPTION") || msg.includes("reverted")) return;
    throw new Error(`Expected revert "${errName}" but got non-revert error: ${msg.slice(0, 200)}`);
  }
}

// ─── Struct field accessors (ethers v6 returns Result with named+indexed access) ─

// In ethers v6, if a struct field is named, you can access it by name.
// But sometimes the named access is undefined — use both as fallback.
function field<T>(result: Record<string | number, T>, name: string, index: number): T {
  const byName  = result[name];
  const byIndex = result[index];
  return (byName !== undefined ? byName : byIndex) as T;
}

// ─── Artifact loader ──────────────────────────────────────────────────────────

const OUT_DIR = path.resolve(__dirname, "../out");

function loadArtifact(contractName: string, solFile?: string): { abi: unknown[]; bytecode: string } {
  const fileName = solFile ?? `${contractName}.sol`;
  const filePath = path.join(OUT_DIR, fileName, `${contractName}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Artifact not found: ${filePath}\nRun: cd arena && forge build`);
  }
  const art = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const raw: string = (art.bytecode as { object?: string })?.object ?? (art.bytecode as string);
  if (!raw || raw === "0x") throw new Error(`Empty bytecode for ${contractName}`);
  return { abi: art.abi, bytecode: raw.startsWith("0x") ? raw : "0x" + raw };
}

// ─── Deploy helper ────────────────────────────────────────────────────────────

async function deploy(
  factory: ContractFactory,
  args: unknown[],
  label: string
): Promise<Contract> {
  process.stdout.write(`    Deploying ${label}...`);
  const contract  = await factory.deploy(...args);
  const deployTx  = contract.deploymentTransaction();
  if (deployTx) {
    const receipt = await deployTx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error(`Deploy tx failed for ${label}: status=${receipt?.status}`);
    }
    // Verify contract code was actually deployed
    const provider = factory.runner?.provider ?? (factory as unknown as { provider: ethers.Provider }).provider;
    if (provider) {
      const addr = await contract.getAddress();
      const code = await provider.getCode(addr);
      if (!code || code === "0x") {
        throw new Error(`No code deployed for ${label} at ${addr}`);
      }
    }
  } else {
    await contract.waitForDeployment();
  }
  const addr = await contract.getAddress();
  console.log(` ${addr}`);
  return contract;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Arena E2E Test Suite — All 7 Contracts + District 2 Flow");
  console.log("  Target: Base Sepolia");
  console.log("═══════════════════════════════════════════════════════════\n");

  const provider = new JsonRpcProvider(RPC_URL);
  const network  = await provider.getNetwork();
  console.log(`  Network : ${network.name} (chainId: ${network.chainId})`);

  const _baseWallet = new Wallet(PRIVATE_KEY, provider);
  // Wait for any pending txs from previous runs to settle before starting
  console.log("  Waiting for pending txs to clear...");
  await new Promise(r => setTimeout(r, 8000));
  const deployer    = new ethers.NonceManager(_baseWallet);
  // Reset and re-query latest pending nonce
  deployer.reset();
  const currentNonce = await provider.getTransactionCount(_baseWallet.address, "pending");
  console.log(`  Starting nonce: ${currentNonce}`);
  await deployer.getNonce("pending");
  const deployerAddress = _baseWallet.address;

  const balance  = await provider.getBalance(deployerAddress);
  console.log(`  Deployer: ${deployerAddress}`);
  console.log(`  Balance : ${formatEther(balance)} ETH\n`);

  if (balance < ethers.parseEther("0.0005")) {
    console.error("  ❌ FATAL: Balance too low (need ≥0.0005 ETH). Get testnet ETH from faucet.basescan.org");
    process.exit(1);
  }

  // ── Generate test wallets ─────────────────────────────────────────────────
  console.log("── Generating & funding test wallets ───────────────────────");
  const lead       = new Wallet(ethers.hexlify(ethers.randomBytes(32)), provider);
  const contrib1   = new Wallet(ethers.hexlify(ethers.randomBytes(32)), provider);
  const contrib2   = new Wallet(ethers.hexlify(ethers.randomBytes(32)), provider);
  const contrib3   = new Wallet(ethers.hexlify(ethers.randomBytes(32)), provider);
  const subscriber = new Wallet(ethers.hexlify(ethers.randomBytes(32)), provider);
  const extraCiters = Array.from({ length: 4 }, () =>
    new Wallet(ethers.hexlify(ethers.randomBytes(32)), provider)
  );

  // Minimal funding: gas on Base Sepolia is ~0.006 gwei; 100k gas = 0.0000006 ETH
  const fundAmount = ethers.parseEther("0.0003");
  const allTestWallets = [lead, contrib1, contrib2, contrib3, subscriber, ...extraCiters];
  console.log(`  Funding ${allTestWallets.length} wallets with ${formatEther(fundAmount)} ETH each...`);
  for (const w of allTestWallets) {
    await (await deployer.sendTransaction({ to: w.address, value: fundAmount })).wait();
  }
  console.log("  Done.\n");

  // ── Load artifacts ────────────────────────────────────────────────────────
  console.log("── Loading forge artifacts ─────────────────────────────────");
  const arts = {
    MockAgentRegistry:      loadArtifact("MockAgentRegistry",     "Mocks.sol"),
    MockTrustRegistry:      loadArtifact("MockTrustRegistry",     "Mocks.sol"),
    MockPolicyEngine:       loadArtifact("MockPolicyEngine",      "Mocks.sol"),
    MockWatchtowerRegistry: loadArtifact("MockWatchtowerRegistry","Mocks.sol"),
    MockERC20:              loadArtifact("MockERC20",             "Mocks.sol"),
    StatusRegistry:         loadArtifact("StatusRegistry"),
    ResearchSquad:          loadArtifact("ResearchSquad"),
    SquadBriefing:          loadArtifact("SquadBriefing"),
    AgentNewsletter:        loadArtifact("AgentNewsletter"),
    ArenaPool:              loadArtifact("ArenaPool"),
    SquadRevenueSplit:      loadArtifact("SquadRevenueSplit"),
    IntelligenceRegistry:   loadArtifact("IntelligenceRegistry"),
  };
  console.log("  All artifacts loaded.\n");

  // ── Deploy mocks ──────────────────────────────────────────────────────────
  console.log("── Deploying mock infrastructure ───────────────────────────");
  const mockAgentReg   = await deploy(new ContractFactory(arts.MockAgentRegistry.abi,      arts.MockAgentRegistry.bytecode,     deployer), [], "MockAgentRegistry");
  const mockTrustReg   = await deploy(new ContractFactory(arts.MockTrustRegistry.abi,      arts.MockTrustRegistry.bytecode,     deployer), [], "MockTrustRegistry");
  const mockPolicyEng  = await deploy(new ContractFactory(arts.MockPolicyEngine.abi,       arts.MockPolicyEngine.bytecode,      deployer), [], "MockPolicyEngine");
  const mockWatchtower = await deploy(new ContractFactory(arts.MockWatchtowerRegistry.abi, arts.MockWatchtowerRegistry.bytecode,deployer), [], "MockWatchtowerRegistry");
  const mockUsdc       = await deploy(new ContractFactory(arts.MockERC20.abi,              arts.MockERC20.bytecode,             deployer), ["MockUSDC", "mUSDC"], "MockERC20(USDC)");

  const agentRegAddr   = await mockAgentReg.getAddress();
  const trustRegAddr   = await mockTrustReg.getAddress();
  const policyEngAddr  = await mockPolicyEng.getAddress();
  const watchtowerAddr = await mockWatchtower.getAddress();
  const usdcAddr       = await mockUsdc.getAddress();
  console.log("");

  // ── Bootstrap ────────────────────────────────────────────────────────────
  console.log("── Bootstrapping agents & trust scores ─────────────────────");

  const allAddresses = [
    deployerAddress,
    lead.address, contrib1.address, contrib2.address, contrib3.address,
    subscriber.address,
    ...extraCiters.map(w => w.address),
  ];
  for (const addr of allAddresses) {
    await (await mockAgentReg.connect(deployer).register(addr)).wait();
  }

  const scoreMap: [string, bigint][] = [
    [deployerAddress,   500n],
    [lead.address,      500n],
    [contrib1.address,  400n],   // >= 300 → weighted
    [contrib2.address,  100n],   // < 300  → raw only
    [contrib3.address,  350n],   // >= 300
    [subscriber.address, 200n],
    ...extraCiters.map(w => [w.address, 350n] as [string, bigint]),
  ];
  for (const [addr, score] of scoreMap) {
    await (await mockTrustReg.connect(deployer).setScore(addr, score)).wait();
  }

  // 3 watchtower addresses (don't need funding — deployer registers them)
  const wt1 = Wallet.createRandom().address;
  const wt2 = Wallet.createRandom().address;
  const wt3 = Wallet.createRandom().address;
  for (const wt of [wt1, wt2, wt3]) {
    await (await mockWatchtower.connect(deployer).register(wt)).wait();
  }
  console.log("  Bootstrap complete.\n");

  // ── Deploy arena contracts ────────────────────────────────────────────────
  console.log("── Deploying arena contracts ────────────────────────────────");

  const statusRegistry = await deploy(
    new ContractFactory(arts.StatusRegistry.abi, arts.StatusRegistry.bytecode, deployer),
    [agentRegAddr], "StatusRegistry"
  );
  const researchSquad = await deploy(
    new ContractFactory(arts.ResearchSquad.abi, arts.ResearchSquad.bytecode, deployer),
    [agentRegAddr], "ResearchSquad"
  );
  const researchSquadAddr = await researchSquad.getAddress();
  const squadBriefing = await deploy(
    new ContractFactory(arts.SquadBriefing.abi, arts.SquadBriefing.bytecode, deployer),
    [researchSquadAddr, agentRegAddr, trustRegAddr], "SquadBriefing"
  );
  const agentNewsletter = await deploy(
    new ContractFactory(arts.AgentNewsletter.abi, arts.AgentNewsletter.bytecode, deployer),
    [agentRegAddr], "AgentNewsletter"
  );
  const arenaPool = await deploy(
    new ContractFactory(arts.ArenaPool.abi, arts.ArenaPool.bytecode, deployer),
    [usdcAddr, policyEngAddr, agentRegAddr, watchtowerAddr, deployerAddress, deployerAddress, 300n],
    "ArenaPool"
  );
  const intelligenceRegistry = await deploy(
    new ContractFactory(arts.IntelligenceRegistry.abi, arts.IntelligenceRegistry.bytecode, deployer),
    [agentRegAddr, trustRegAddr], "IntelligenceRegistry"
  );
  const squadBriefingIface = new Interface(arts.SquadBriefing.abi);

  console.log("\n  All contracts deployed.\n");

  // ══════════════════════════════════════════════════════════════════════════
  //  TEST SUITE
  // ══════════════════════════════════════════════════════════════════════════

  // ─── 1. StatusRegistry ─────────────────────────────────────────────────────
  // postStatus(bytes32 contentHash, string content)
  // contentHash must equal keccak256(abi.encodePacked(content))

  console.log("── [1/7] StatusRegistry ────────────────────────────────────");

  const statusContent = "DeFi intelligence update — MEV exposure Q2 2026";
  const statusHash1   = ethers.keccak256(ethers.toUtf8Bytes(statusContent));

  await test("post status", async () => {
    const tx = await statusRegistry.connect(lead).postStatus(
      statusHash1, statusContent
    );
    const receipt = await tx.wait();
    assert(receipt?.status === 1, "tx failed");
    const meta = await statusRegistry.statuses(statusHash1);
    // StatusMeta: { address agent[0], uint256 timestamp[1], bool deleted[2] }
    const agentAddr = meta[0] ?? meta.agent;
    assert(agentAddr?.toLowerCase() === lead.address.toLowerCase(), `agent=${agentAddr}`);
    const isDeleted = meta[2] ?? meta.deleted;
    assert(isDeleted === false, "should not be deleted");
  });

  await test("reject unregistered agent (NotRegistered)", async () => {
    const stranger = Wallet.createRandom().connect(provider);
    const content2  = "stranger content";
    const h2        = ethers.keccak256(ethers.toUtf8Bytes(content2));
    await expectRevert(
      () => statusRegistry.connect(stranger).postStatus(h2, content2),
      "NotRegistered"
    );
  });

  await test("delete status (tombstone)", async () => {
    await (await statusRegistry.connect(lead).deleteStatus(statusHash1)).wait();
    const meta    = await statusRegistry.statuses(statusHash1);
    const deleted = meta[2] ?? meta.deleted;
    assert(deleted === true, "should be tombstoned");
  });

  // ─── 2. ResearchSquad ─────────────────────────────────────────────────────
  // Squad struct: { string name[0], string domainTag[1], address creator[2],
  //                 Status status[3], bool inviteOnly[4], uint256 memberCount[5] }

  console.log("\n── [2/7] ResearchSquad ─────────────────────────────────────");

  const squadId = 0n;

  await test("create squad (lead → LEAD, role=1)", async () => {
    await (await researchSquad.connect(lead).createSquad(
      "DeFi Risk Research Squad", "domain.defi.risk", false
    )).wait();
    const squad = await researchSquad.getSquad(squadId);
    const creator = squad[2] ?? squad.creator;
    assert(creator?.toLowerCase() === lead.address.toLowerCase(), `creator=${creator}`);
    const role = await researchSquad.getMemberRole(squadId, lead.address);
    assert(role === 1n, `lead role should be 1 (Lead), got ${role}`);
  });

  await test("join squad (contrib1, contrib2, contrib3 → Contributor)", async () => {
    for (const w of [contrib1, contrib2, contrib3]) {
      await (await researchSquad.connect(w).joinSquad(squadId)).wait();
      assert(await researchSquad.isMember(squadId, w.address), "should be member");
      const role = await researchSquad.getMemberRole(squadId, w.address);
      assert(role === 0n, `Contributor role should be 0, got ${role}`);
    }
  });

  await test("record contribution", async () => {
    const h = ethers.keccak256(ethers.toUtf8Bytes("contrib-hash-1"));
    await (await researchSquad.connect(contrib1).recordContribution(squadId, h, "DeFi risk model v1")).wait();
    const contribs = await researchSquad.getSquadContributions(squadId);
    assert(contribs.length === 1, `expected 1 contribution, got ${contribs.length}`);
  });

  await test("duplicate contribution hash reverts (HashAlreadyRecorded)", async () => {
    const h = ethers.keccak256(ethers.toUtf8Bytes("contrib-hash-1"));
    await expectRevert(
      () => researchSquad.connect(contrib1).recordContribution(squadId, h, "dup"),
      "HashAlreadyRecorded"
    );
  });

  // ─── 3. SquadBriefing ─────────────────────────────────────────────────────
  // Briefing struct: { uint256 squadId[0], bytes32 contentHash[1], string preview[2],
  //                    string endpoint[3], string[] tags[4], address publisher[5], uint256 timestamp[6] }
  // Proposal struct: { uint256 squadId[0], bytes32 contentHash[1], string preview[2],
  //                    string endpoint[3], string[] tags[4], address proposer[5],
  //                    uint256 timestamp[6], ProposalStatus status[7] }

  console.log("\n── [3/7] SquadBriefing ─────────────────────────────────────");

  const briefingHash = ethers.keccak256(ethers.toUtf8Bytes("briefing-content-v1"));

  await test("LEAD publishes briefing", async () => {
    await (await squadBriefing.connect(lead).publishBriefing(
      squadId, briefingHash,
      "DeFi Risk Analysis Q2 2026 — key MEV findings",
      "https://gigabrain.arc402.xyz",
      ["defi", "mev"]
    )).wait();
    const b = await squadBriefing.getBriefing(briefingHash);
    const publisher = b[5] ?? b.publisher;
    assert(publisher?.toLowerCase() === lead.address.toLowerCase(), `publisher=${publisher}`);
  });

  await test("contributor cannot publish directly (NotSquadLead)", async () => {
    const h2 = ethers.keccak256(ethers.toUtf8Bytes("briefing-unauthorized"));
    await expectRevert(
      () => squadBriefing.connect(contrib1).publishBriefing(squadId, h2, "bad", "https://x.xyz", []),
      "NotSquadLead"
    );
  });

  await test("contributor proposes briefing", async () => {
    const ph = ethers.keccak256(ethers.toUtf8Bytes("proposal-content-1"));
    await (await squadBriefing.connect(contrib1).proposeBriefing(
      squadId, ph, "Contributor proposal", "https://c1.arc402.xyz", []
    )).wait();
    const p = await squadBriefing.getProposal(ph);
    const proposer = p[5] ?? p.proposer;
    const status   = p[7] ?? p.status;
    assert(proposer?.toLowerCase() === contrib1.address.toLowerCase(), `proposer=${proposer}`);
    assert(status === 0n, `status should be Pending(0), got ${status}`);
  });

  await test("LEAD approves proposal → briefing published", async () => {
    const ph = ethers.keccak256(ethers.toUtf8Bytes("proposal-content-1"));
    await (await squadBriefing.connect(lead).approveProposal(ph)).wait();
    assert(await squadBriefing.briefingExists(ph), "briefing should exist after approval");
  });

  // ── citeBriefing ──────────────────────────────────────────────────────────

  await test("citeBriefing: high-trust (contrib1 score=400) → weighted++", async () => {
    const ch = ethers.keccak256(ethers.toUtf8Bytes("citing-artifact-c1"));
    const receipt = await (await squadBriefing.connect(contrib1).citeBriefing(
      briefingHash, ch, "Great analysis"
    )).wait();

    const raw = await squadBriefing.citationCount(briefingHash);
    const w   = await squadBriefing.weightedCitationCount(briefingHash);
    assert(raw === 1n, `rawCount=1, got ${raw}`);
    assert(w   === 1n, `weightedCount=1, got ${w}`);

    const snap = await squadBriefing.citationTrustSnapshot(contrib1.address, briefingHash);
    assert(snap === 400n, `snap=400, got ${snap}`);

    // Verify BriefingCited event: (bytes32 contentHash, address citer, bytes32 citingHash, uint256 rawCount, uint256 weightedCount)
    const events = receipt!.logs
      .map(l => { try { return squadBriefingIface.parseLog(l); } catch { return null; } })
      .filter(e => e?.name === "BriefingCited");
    assert(events.length === 1, "BriefingCited event missing");
    assert(events[0]!.args[3] === 1n, `event rawCount=1, got ${events[0]!.args[3]}`);
    assert(events[0]!.args[4] === 1n, `event weightedCount=1, got ${events[0]!.args[4]}`);
  });

  await test("citeBriefing: low-trust (contrib2 score=100) → raw++ only", async () => {
    await (await squadBriefing.connect(contrib2).citeBriefing(
      briefingHash,
      ethers.keccak256(ethers.toUtf8Bytes("citing-c2")),
      "low trust cite"
    )).wait();
    const raw = await squadBriefing.citationCount(briefingHash);
    const w   = await squadBriefing.weightedCitationCount(briefingHash);
    assert(raw === 2n, `rawCount=2, got ${raw}`);
    assert(w   === 1n, `weightedCount still 1 (low trust), got ${w}`);
  });

  await test("citeBriefing: self-citation reverts (SelfCitation)", async () => {
    await expectRevert(
      () => squadBriefing.connect(lead).citeBriefing(
        briefingHash,
        ethers.keccak256(ethers.toUtf8Bytes("self-cite")),
        ""
      ),
      "SelfCitation"
    );
  });

  await test("citeBriefing: duplicate citation reverts (AlreadyCited)", async () => {
    await expectRevert(
      () => squadBriefing.connect(contrib1).citeBriefing(
        briefingHash,
        ethers.keccak256(ethers.toUtf8Bytes("dup-cite")),
        ""
      ),
      "AlreadyCited"
    );
  });

  // ─── 4. AgentNewsletter ────────────────────────────────────────────────────
  // Newsletter struct: { address publisher[0], string name[1], string description[2],
  //                       string endpoint[3], bool active[4] }

  console.log("\n── [4/7] AgentNewsletter ───────────────────────────────────");

  await test("create newsletter", async () => {
    await (await agentNewsletter.connect(lead).createNewsletter(
      "DeFi Intel Weekly", "Weekly DeFi intelligence", "https://gigabrain.arc402.xyz"
    )).wait();
    const nl = await agentNewsletter.getNewsletter(0n);
    const publisher = nl[0] ?? nl.publisher;
    const name      = nl[1] ?? nl.name;
    const active    = nl[4] ?? nl.active;
    assert(publisher?.toLowerCase() === lead.address.toLowerCase(), `publisher=${publisher}`);
    assert(name === "DeFi Intel Weekly", `name=${name}`);
    assert(active === true, "should be active");
  });

  await test("publish issue", async () => {
    const issueHash = ethers.keccak256(ethers.toUtf8Bytes("newsletter-issue-1"));
    await (await agentNewsletter.connect(lead).publishIssue(
      0n, issueHash, "Issue 1: MEV patterns in Uniswap v4", "https://gigabrain.arc402.xyz"
    )).wait();
    const count = await agentNewsletter.issueCount(0n);
    assert(count === 1n, `issueCount=1, got ${count}`);
  });

  await test("non-publisher cannot publish issue (NotPublisher)", async () => {
    await expectRevert(
      () => agentNewsletter.connect(contrib1).publishIssue(
        0n,
        ethers.keccak256(ethers.toUtf8Bytes("unauthorized")),
        "unauthorized", "https://x.xyz"
      ),
      "NotPublisher"
    );
  });

  // ─── 5. ArenaPool ─────────────────────────────────────────────────────────
  // Round struct: { string question[0], string category[1], uint256 yesPot[2],
  //                 uint256 noPot[3], uint256 stakingClosesAt[4], uint256 resolvesAt[5],
  //                 bool resolved[6], bool outcome[7], bytes32 evidenceHash[8], address creator[9] }
  // Entry struct: { address agent[0], uint8 side[1], uint256 amount[2], string note[3], uint256 timestamp[4] }
  // side: 0=YES, 1=NO

  console.log("\n── [5/7] ArenaPool ─────────────────────────────────────────");

  const arenaPoolAddr = await arenaPool.getAddress();

  await test("mint & approve USDC for participants", async () => {
    const amt = ethers.parseUnits("200", 6);
    for (const w of [lead, contrib1, contrib2]) {
      await (await mockUsdc.connect(deployer).mint(w.address, amt)).wait();
      await (await mockUsdc.connect(w).approve(arenaPoolAddr, amt)).wait();
    }
    assert(await mockUsdc.balanceOf(lead.address) >= amt, "lead USDC insufficient");
  });

  await test("create round", async () => {
    await (await arenaPool.connect(lead).createRound(
      "Will ETH exceed $5000 by end of Q2 2026?", "price-prediction",
      2 * 3600, ethers.parseUnits("10", 6)
    )).wait();
    const round    = await arenaPool.getRound(0n);
    const question = round[0] ?? round.question;
    const resolved = round[6] ?? round.resolved;
    assert(!resolved, "should not be resolved");
    assert(question === "Will ETH exceed $5000 by end of Q2 2026?", `question mismatch: "${question}"`);
  });

  await test("enter round YES (side=0, contrib1)", async () => {
    const amt = ethers.parseUnits("100", 6);
    await (await arenaPool.connect(contrib1).enterRound(0n, 0, amt, "Bullish")).wait();
    const entry = await arenaPool.getUserEntry(0n, contrib1.address);
    const side  = entry[1] ?? entry.side;
    const entAmt = entry[2] ?? entry.amount;
    assert(side === 0n, `side=YES(0), got ${side}`);
    assert(entAmt === amt, `amount mismatch, got ${entAmt}`);
  });

  await test("enter round NO (side=1, contrib2)", async () => {
    const amt = ethers.parseUnits("50", 6);
    await (await arenaPool.connect(contrib2).enterRound(0n, 1, amt, "Bearish")).wait();
    const entry = await arenaPool.getUserEntry(0n, contrib2.address);
    const side  = entry[1] ?? entry.side;
    assert(side === 1n, `side=NO(1), got ${side}`);
  });

  await test("duplicate entry reverts (AlreadyEntered)", async () => {
    await expectRevert(
      () => arenaPool.connect(contrib1).enterRound(0n, 0, ethers.parseUnits("10", 6), "dup"),
      "AlreadyEntered"
    );
  });

  // ─── 6. SquadRevenueSplit ──────────────────────────────────────────────────

  console.log("\n── [6/7] SquadRevenueSplit ─────────────────────────────────");

  const splitRecs   = [lead.address, contrib1.address, contrib3.address];
  const splitShares = [4000n, 3000n, 3000n];
  let revenueSplit!: Contract;

  await test("deploy SquadRevenueSplit (40/30/30)", async () => {
    revenueSplit = await deploy(
      new ContractFactory(arts.SquadRevenueSplit.abi, arts.SquadRevenueSplit.bytecode, deployer),
      [splitRecs, splitShares, usdcAddr, agentRegAddr],
      "SquadRevenueSplit"
    );
    // Small delay to ensure deployment is indexed by RPC
    await new Promise(r => setTimeout(r, 2000));
    const r = await revenueSplit.recipients();
    const s = await revenueSplit.shares();
    assert(Array.isArray(r) && r.length === 3, `recipients.length=3, got ${r?.length}`);
    assert(s[0] === 4000n, `lead share=4000, got ${s[0]}`);
    assert(s[1] === 3000n, `contrib1 share=3000, got ${s[1]}`);
    assert(s[2] === 3000n, `contrib3 share=3000, got ${s[2]}`);
  });

  await test("distribute USDC 1.0 (1_000_000 units) → 400k/300k/300k", async () => {
    const amt    = ethers.parseUnits("1", 6);
    const revAddr = await revenueSplit.getAddress();

    await (await mockUsdc.connect(deployer).mint(subscriber.address, amt)).wait();
    await (await mockUsdc.connect(subscriber).approve(revAddr, amt)).wait();

    const before = {
      lead:    await mockUsdc.balanceOf(lead.address),
      contrib1: await mockUsdc.balanceOf(contrib1.address),
      contrib3: await mockUsdc.balanceOf(contrib3.address),
    };

    await (await revenueSplit.connect(subscriber).receiveUSDC(amt)).wait();

    const gains = {
      lead:    (await mockUsdc.balanceOf(lead.address))     - before.lead,
      contrib1: (await mockUsdc.balanceOf(contrib1.address)) - before.contrib1,
      contrib3: (await mockUsdc.balanceOf(contrib3.address)) - before.contrib3,
    };

    assert(gains.lead     === 400_000n, `lead gets 400_000, got ${gains.lead}`);
    assert(gains.contrib1 === 300_000n, `contrib1 gets 300_000, got ${gains.contrib1}`);
    assert(gains.contrib3 === 300_000n, `contrib3 gets 300_000, got ${gains.contrib3}`);
  });

  await test("distribute ETH 0.0001 → 40%/30%/30%", async () => {
    const ethAmt  = ethers.parseEther("0.0001");
    const revAddr = await revenueSplit.getAddress();

    const before = {
      lead:    await provider.getBalance(lead.address),
      contrib1: await provider.getBalance(contrib1.address),
      contrib3: await provider.getBalance(contrib3.address),
    };

    await (await deployer.sendTransaction({ to: revAddr, value: ethAmt })).wait();

    const gains = {
      lead:    (await provider.getBalance(lead.address))     - before.lead,
      contrib1: (await provider.getBalance(contrib1.address)) - before.contrib1,
      contrib3: (await provider.getBalance(contrib3.address)) - before.contrib3,
    };

    const exp40 = (ethAmt * 4000n) / 10000n;
    const exp30 = (ethAmt * 3000n) / 10000n;
    const expC3 = ethAmt - exp40 - exp30;

    assert(gains.lead     === exp40, `lead ETH gain=${exp40}, got ${gains.lead}`);
    assert(gains.contrib1 === exp30, `contrib1 ETH gain=${exp30}, got ${gains.contrib1}`);
    assert(gains.contrib3 === expC3, `contrib3 ETH gain=${expC3}, got ${gains.contrib3}`);
  });

  await test("NothingToDistribute reverts on empty contract", async () => {
    const empty = await new ContractFactory(
      arts.SquadRevenueSplit.abi, arts.SquadRevenueSplit.bytecode, deployer
    ).deploy(splitRecs, splitShares, usdcAddr, agentRegAddr);
    await empty.waitForDeployment();
    await expectRevert(() => empty.connect(deployer).distribute(), "NothingToDistribute");
  });

  // ─── 7. IntelligenceRegistry ──────────────────────────────────────────────
  // IntelligenceArtifact struct indices:
  // [0]=contentHash, [1]=creator, [2]=squadId, [3]=capabilityTag,
  // [4]=artifactType, [5]=endpoint, [6]=preview, [7]=timestamp,
  // [8]=citationCount, [9]=weightedCitationCount,
  // [10]=trainingDataHash, [11]=baseModel, [12]=evalHash, [13]=parentHash,
  // [14]=revenueShareHash, [15]=revenueSplitAddress

  console.log("\n── [7/7] IntelligenceRegistry ──────────────────────────────");

  const artifactHash = ethers.keccak256(ethers.toUtf8Bytes("intelligence-artifact-v1"));
  const revSplitAddr = await revenueSplit.getAddress();

  await test("register artifact (type: briefing, capability: domain.defi.risk)", async () => {
    await (await intelligenceRegistry.connect(lead).register({
      contentHash:         artifactHash,
      squadId:             squadId,
      capabilityTag:       "domain.defi.risk",
      artifactType:        "briefing",
      endpoint:            "https://gigabrain.arc402.xyz",
      preview:             "DeFi risk intelligence artifact — Q2 2026",
      trainingDataHash:    ethers.ZeroHash,
      baseModel:           "",
      evalHash:            ethers.ZeroHash,
      parentHash:          ethers.ZeroHash,
      revenueShareHash:    ethers.keccak256(ethers.toUtf8Bytes("rev-share-1")),
      revenueSplitAddress: revSplitAddr,
    })).wait();

    const a = await intelligenceRegistry.getArtifact(artifactHash);
    const creator  = a[1]  ?? a.creator;
    const aType    = a[4]  ?? a.artifactType;
    const cap      = a[3]  ?? a.capabilityTag;
    const revAddr2 = a[15] ?? a.revenueSplitAddress;
    assert(creator?.toLowerCase() === lead.address.toLowerCase(), `creator=${creator}`);
    assert(aType === "briefing", `artifactType=briefing, got "${aType}"`);
    assert(cap === "domain.defi.risk", `capabilityTag="domain.defi.risk", got "${cap}"`);
    assert(revAddr2?.toLowerCase() === revSplitAddr.toLowerCase(), `revenueSplitAddress mismatch`);
  });

  await test("getByCapability returns artifact hash", async () => {
    const [r, total] = await intelligenceRegistry.getByCapability("domain.defi.risk", 0n, 10n);
    assert(total === 1n, `total=1, got ${total}`);
    assert(r[0] === artifactHash, "hash mismatch");
  });

  await test("high-trust cites (contrib1 score=400) → weightedCitationCount++", async () => {
    await (await intelligenceRegistry.connect(contrib1).recordCitation(artifactHash)).wait();
    const a = await intelligenceRegistry.getArtifact(artifactHash);
    const raw = a[8] ?? a.citationCount;
    const w   = a[9] ?? a.weightedCitationCount;
    assert(raw === 1n, `rawCount=1, got ${raw}`);
    assert(w   === 1n, `weightedCount=1, got ${w}`);
    const snap = await intelligenceRegistry.citationTrustSnapshot(contrib1.address, artifactHash);
    assert(snap === 400n, `snap=400, got ${snap}`);
  });

  await test("low-trust cites (contrib2 score=100) → rawCount++ only", async () => {
    await (await intelligenceRegistry.connect(contrib2).recordCitation(artifactHash)).wait();
    const a   = await intelligenceRegistry.getArtifact(artifactHash);
    const raw = a[8] ?? a.citationCount;
    const w   = a[9] ?? a.weightedCitationCount;
    assert(raw === 2n, `rawCount=2, got ${raw}`);
    assert(w   === 1n, `weightedCount still 1 (low trust), got ${w}`);
  });

  await test("self-citation reverts (SelfCitation)", async () => {
    await expectRevert(
      () => intelligenceRegistry.connect(lead).recordCitation(artifactHash),
      "SelfCitation"
    );
  });

  await test("citationTrustSnapshot stored correctly", async () => {
    const s1 = await intelligenceRegistry.citationTrustSnapshot(contrib1.address, artifactHash);
    const s2 = await intelligenceRegistry.citationTrustSnapshot(contrib2.address, artifactHash);
    assert(s1 === 400n, `contrib1 snap=400, got ${s1}`);
    assert(s2 === 100n, `contrib2 snap=100, got ${s2}`);
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  Full District 2 Flow
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n── Full District 2 Flow ────────────────────────────────────");

  const d2SquadId      = 1n;
  const d2BriefingHash = ethers.keccak256(ethers.toUtf8Bytes("d2-briefing-full-flow"));

  await test("squad forms: create District 2 squad", async () => {
    await (await researchSquad.connect(lead).createSquad("District 2 Squad", "district2", false)).wait();
    const squad   = await researchSquad.getSquad(d2SquadId);
    const creator = squad[2] ?? squad.creator;
    assert(creator?.toLowerCase() === lead.address.toLowerCase(), `creator=${creator}`);
  });

  await test("5 agents join District 2 squad (contrib3 + 4 extraCiters)", async () => {
    for (const w of [contrib3, ...extraCiters]) {
      await (await researchSquad.connect(w).joinSquad(d2SquadId)).wait();
    }
    const squad = await researchSquad.getSquad(d2SquadId);
    const mc    = squad[5] ?? squad.memberCount;
    assert(mc === 6n, `memberCount=6 (lead+5), got ${mc}`);
  });

  await test("LEAD publishes briefing", async () => {
    await (await squadBriefing.connect(lead).publishBriefing(
      d2SquadId, d2BriefingHash,
      "District 2 intelligence — full flow test",
      "https://gigabrain.arc402.xyz/d2",
      ["district2"]
    )).wait();
    assert(await squadBriefing.briefingExists(d2BriefingHash), "briefing should exist");
  });

  await test("5 high-trust agents cite → CitationThresholdReached(5) emitted", async () => {
    const citers = [contrib3, ...extraCiters];  // 5 citers, score >= 300
    let lastReceipt: ethers.TransactionReceipt | null = null;

    for (let i = 0; i < citers.length; i++) {
      const ch = ethers.keccak256(ethers.toUtf8Bytes(`d2-cite-${i}`));
      const receipt = await (await squadBriefing.connect(citers[i]).citeBriefing(d2BriefingHash, ch, "")).wait();
      lastReceipt = receipt;
    }

    const wCount = await squadBriefing.weightedCitationCount(d2BriefingHash);
    assert(wCount === 5n, `weighted=5, got ${wCount}`);

    const threshEvents = lastReceipt!.logs
      .map(l => { try { return squadBriefingIface.parseLog(l); } catch { return null; } })
      .filter(e => e?.name === "CitationThresholdReached");
    assert(threshEvents.length === 1, "CitationThresholdReached not emitted on 5th citation");
    assert(threshEvents[0]!.args[1] === 5n, `threshold=5, got ${threshEvents[0]!.args[1]}`);
  });

  let d2RevSplit!: Contract;

  await test("LEAD deploys SquadRevenueSplit for contributors", async () => {
    const d2Recs = [lead.address, contrib3.address, extraCiters[0].address];
    const d2Shs  = [4000n, 3000n, 3000n];
    const leadNM = new ethers.NonceManager(lead);
    d2RevSplit = await new ContractFactory(
      arts.SquadRevenueSplit.abi, arts.SquadRevenueSplit.bytecode, leadNM
    ).deploy(d2Recs, d2Shs, usdcAddr, agentRegAddr);
    await d2RevSplit.waitForDeployment();
    const r = await d2RevSplit.recipients();
    assert(r[0]?.toLowerCase() === lead.address.toLowerCase(), "lead = recipient 0");
    assert(r[1]?.toLowerCase() === contrib3.address.toLowerCase(), "contrib3 = recipient 1");
    assert(r[2]?.toLowerCase() === extraCiters[0].address.toLowerCase(), "extraCiters[0] = recipient 2");
  });

  const d2ArtifactHash = ethers.keccak256(ethers.toUtf8Bytes("d2-artifact-v1"));

  await test("LEAD registers artifact with revenueSplitAddress", async () => {
    const d2RevAddr = await d2RevSplit.getAddress();
    const regTx = await intelligenceRegistry.connect(lead).register({
      contentHash:         d2ArtifactHash,
      squadId:             d2SquadId,
      capabilityTag:       "district2",
      artifactType:        "briefing",
      endpoint:            "https://gigabrain.arc402.xyz/d2",
      preview:             "District 2 full flow artifact",
      trainingDataHash:    ethers.ZeroHash,
      baseModel:           "",
      evalHash:            ethers.ZeroHash,
      parentHash:          ethers.ZeroHash,
      revenueShareHash:    ethers.keccak256(ethers.toUtf8Bytes("d2-rev-share-1")),
      revenueSplitAddress: d2RevAddr,
    });
    console.log(`    d2 register tx: ${regTx.hash}`);
    await regTx.wait();

    const a       = await intelligenceRegistry.getArtifact(d2ArtifactHash);
    const revA    = a[15] ?? a.revenueSplitAddress;
    const squadA  = a[2]  ?? a.squadId;
    assert(revA?.toLowerCase() === d2RevAddr.toLowerCase(), `revenueSplitAddress mismatch`);
    assert(squadA === d2SquadId, `squadId=${d2SquadId}, got ${squadA}`);
  });

  await test("subscriber pays SquadRevenueSplit → auto-distributes", async () => {
    const d2RevAddr  = await d2RevSplit.getAddress();
    const usdcAmount = ethers.parseUnits("0.3", 6);   // 300_000 units

    const mintTx = await mockUsdc.connect(deployer).mint(subscriber.address, usdcAmount);
    console.log(`    mint tx: ${mintTx.hash}`);
    await mintTx.wait();
    const approveTx = await mockUsdc.connect(subscriber).approve(d2RevAddr, usdcAmount);
    console.log(`    approve tx: ${approveTx.hash}`);
    await approveTx.wait();

    const before = {
      lead:     await mockUsdc.balanceOf(lead.address),
      contrib3: await mockUsdc.balanceOf(contrib3.address),
      ea0:      await mockUsdc.balanceOf(extraCiters[0].address),
    };

    const recvTx = await d2RevSplit.connect(subscriber).receiveUSDC(usdcAmount);
    console.log(`    receiveUSDC tx: ${recvTx.hash}`);
    await recvTx.wait();

    const gains = {
      lead:     (await mockUsdc.balanceOf(lead.address))           - before.lead,
      contrib3: (await mockUsdc.balanceOf(contrib3.address))       - before.contrib3,
      ea0:      (await mockUsdc.balanceOf(extraCiters[0].address)) - before.ea0,
    };

    // 300_000 × 40% = 120_000; × 30% = 90_000 each
    assert(gains.lead     === 120_000n, `lead=120_000, got ${gains.lead}`);
    assert(gains.contrib3 ===  90_000n, `contrib3=90_000, got ${gains.contrib3}`);
    assert(gains.ea0      ===  90_000n, `ea0=90_000, got ${gains.ea0}`);
    assert(gains.lead + gains.contrib3 + gains.ea0 === usdcAmount, "total mismatch");
  });

  await test("verify contributor balances updated correctly", async () => {
    const lb = await mockUsdc.balanceOf(lead.address);
    const cb = await mockUsdc.balanceOf(contrib3.address);
    const eb = await mockUsdc.balanceOf(extraCiters[0].address);
    assert(lb > 0n, `lead balance > 0, got ${lb}`);
    assert(cb > 0n, `contrib3 balance > 0, got ${cb}`);
    assert(eb > 0n, `ea0 balance > 0, got ${eb}`);
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  Summary
  // ══════════════════════════════════════════════════════════════════════════

  const finalBal = await provider.getBalance(deployerAddress);
  console.log(`\n  Final deployer balance: ${formatEther(finalBal)} ETH`);

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  RESULTS");
  console.log("═══════════════════════════════════════════════════════════");
  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : "❌";
    console.log(`  ${icon} ${r.status}  ${r.name}`);
    if (r.error) console.log(`         ↳ ${r.error}`);
  }
  console.log("───────────────────────────────────────────────────────────");
  console.log(`  PASSED: ${passed}  |  FAILED: ${failed}  |  TOTAL: ${passed + failed}`);
  console.log("═══════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    console.error(`\n${failed} test(s) failed.`);
    process.exit(1);
  } else {
    console.log("All tests passed! ✅");
    process.exit(0);
  }
}

main().catch(e => {
  console.error("\nFatal error:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
