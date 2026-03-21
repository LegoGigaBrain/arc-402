import { Command } from "commander";
import { PolicyClient, TrustClient } from "@arc402/sdk";
import { ethers } from "ethers";
import prompts from "prompts";
import fs from "fs";
import path from "path";
import os from "os";
import { spawnSync } from "child_process";
import { Arc402Config, getConfigPath, getUsdcAddress, loadConfig, NETWORK_DEFAULTS, saveConfig } from "../config";
import { getClient, requireSigner } from "../client";
import { getTrustTier } from "../utils/format";
import { AGENT_REGISTRY_ABI, ARC402_WALLET_EXECUTE_ABI, ARC402_WALLET_GUARDIAN_ABI, ARC402_WALLET_MACHINE_KEY_ABI, ARC402_WALLET_OWNER_ABI, ARC402_WALLET_PASSKEY_ABI, ARC402_WALLET_PROTOCOL_ABI, ARC402_WALLET_REGISTRY_ABI, POLICY_ENGINE_GOVERNANCE_ABI, POLICY_ENGINE_LIMITS_ABI, TRUST_REGISTRY_ABI, WALLET_FACTORY_ABI } from "../abis";
import { warnIfPublicRpc } from "../config";
import { connectPhoneWallet, sendTransactionWithSession, requestPhoneWalletSignature } from "../walletconnect";
import { BundlerClient, buildSponsoredUserOp, PaymasterClient, DEFAULT_ENTRY_POINT } from "../bundler";
import { clearWCSession } from "../walletconnect-session";
import { handleWalletError } from "../wallet-router";
import { requestCoinbaseSmartWalletSignature } from "../coinbase-smart-wallet";
import { sendTelegramMessage } from "../telegram-notify";
import { renderTree } from "../ui/tree";
import { startSpinner } from "../ui/spinner";
import { c } from "../ui/colors";
import { formatAddress } from "../ui/format";

const POLICY_ENGINE_DEFAULT = "0x44102e70c2A366632d98Fe40d892a2501fC7fFF2";
const GUARDIAN_KEY_PATH = path.join(os.homedir(), ".arc402", "guardian.key");

/** Save guardian private key to a restricted standalone file (never to config.json). */
function saveGuardianKey(privateKey: string): void {
  fs.mkdirSync(path.dirname(GUARDIAN_KEY_PATH), { recursive: true, mode: 0o700 });
  fs.writeFileSync(GUARDIAN_KEY_PATH, privateKey + "\n", { mode: 0o400 });
}

/** Load guardian private key from file, falling back to config for backwards compat. */
function loadGuardianKey(config: Arc402Config): string | null {
  try {
    return fs.readFileSync(GUARDIAN_KEY_PATH, "utf-8").trim();
  } catch {
    // Migration: if key still in config, migrate it to the file now
    if (config.guardianPrivateKey) {
      saveGuardianKey(config.guardianPrivateKey);
      return config.guardianPrivateKey;
    }
    return null;
  }
}

function parseAmount(raw: string): bigint {
  const lower = raw.toLowerCase();
  if (lower.endsWith("eth")) {
    return ethers.parseEther(lower.slice(0, -3).trim());
  }
  return BigInt(raw);
}

// Standard onboarding categories required for a newly deployed wallet.
const ONBOARDING_CATEGORIES = [
  { name: "general",  amountEth: "0.001" },
  { name: "compute",  amountEth: "0.05" },
  { name: "research", amountEth: "0.05" },
  { name: "protocol", amountEth: "0.1" },
] as const;

/**
 * P0: Mandatory post-deploy onboarding ceremony.
 * Registers wallet on PolicyEngine, enables DeFi access, and sets required spend limits.
 * Uses a sendTx callback so it works with any signing method (WalletConnect, private key, etc.).
 * Skips registerWallet/enableDeFiAccess if they were already done by the wallet constructor.
 */
async function runWalletOnboardingCeremony(
  walletAddress: string,
  ownerAddress: string,
  config: Arc402Config,
  provider: ethers.JsonRpcProvider,
  sendTx: (call: { to: string; data: string; value: string }, description: string) => Promise<string>,
): Promise<void> {
  const policyAddress = config.policyEngineAddress ?? POLICY_ENGINE_DEFAULT;
  const executeIface = new ethers.Interface(ARC402_WALLET_EXECUTE_ABI);
  const govIface = new ethers.Interface(POLICY_ENGINE_GOVERNANCE_ABI);
  const limitsIface = new ethers.Interface(POLICY_ENGINE_LIMITS_ABI);
  const policyGov = new ethers.Contract(policyAddress, POLICY_ENGINE_GOVERNANCE_ABI, provider);

  // Check what's already done (constructor may have done registerWallet + enableDefiAccess)
  let alreadyRegistered = false;
  let alreadyDefiEnabled = false;
  try {
    const registeredOwner: string = await policyGov.walletOwners(walletAddress);
    alreadyRegistered = registeredOwner !== ethers.ZeroAddress;
  } catch { /* older PolicyEngine without this getter — assume not registered */ }
  try {
    alreadyDefiEnabled = await policyGov.defiAccessEnabled(walletAddress);
  } catch { /* assume not enabled */ }

  console.log("\n" + c.dim("── Onboarding ceremony ────────────────────────────────────────"));
  console.log(" " + c.dim("PolicyEngine:") + " " + c.white(policyAddress));
  console.log(" " + c.dim("Wallet:      ") + " " + c.white(walletAddress));

  // Step 1: registerWallet (if not already done)
  if (!alreadyRegistered) {
    const registerCalldata = govIface.encodeFunctionData("registerWallet", [walletAddress, ownerAddress]);
    await sendTx({
      to: walletAddress,
      data: executeIface.encodeFunctionData("executeContractCall", [{
        target: policyAddress,
        data: registerCalldata,
        value: 0n,
        minReturnValue: 0n,
        maxApprovalAmount: 0n,
        approvalToken: ethers.ZeroAddress,
      }]),
      value: "0x0",
    }, "registerWallet on PolicyEngine");
  } else {
    console.log(" " + c.success + c.dim(" registerWallet — already done by constructor"));
  }

  // Step 2: enableDefiAccess (if not already done)
  if (!alreadyDefiEnabled) {
    await sendTx({
      to: policyAddress,
      data: govIface.encodeFunctionData("enableDefiAccess", [walletAddress]),
      value: "0x0",
    }, "enableDefiAccess on PolicyEngine");
  } else {
    console.log(" " + c.success + c.dim(" enableDefiAccess — already done by constructor"));
  }

  // Steps 3–6: category limits (always set — idempotent)
  for (const { name, amountEth } of ONBOARDING_CATEGORIES) {
    await sendTx({
      to: policyAddress,
      data: limitsIface.encodeFunctionData("setCategoryLimitFor", [
        walletAddress,
        name,
        ethers.parseEther(amountEth),
      ]),
      value: "0x0",
    }, `setCategoryLimitFor: ${name} → ${amountEth} ETH`);
  }

  console.log(c.dim("── Onboarding complete ─────────────────────────────────────────"));
  console.log(c.dim("Tip: For production security, also configure:"));
  console.log(" " + c.dim("arc402 wallet set-velocity-limit <eth>   — wallet-level hourly ETH cap"));
  console.log(" " + c.dim("arc402 wallet policy set-daily-limit --category general --amount <eth>   — daily per-category cap"));
}

/**
 * Complete ARC-402 onboarding ceremony — matches web flow at app.arc402.xyz/onboard.
 * Runs in a single WalletConnect session (or any sendTx provider). Idempotent.
 *
 * Steps:
 *   2. Machine key — generate + authorizeMachineKey
 *   3. Passkey    — CLI shows browser URL (WebAuthn requires browser)
 *   4. Policy     — v5 protocol bypass; set hire limit + optional guardian
 *   5. Agent      — register on AgentRegistry via executeContractCall
 *   6. Summary    — branded tree
 */
async function runCompleteOnboardingCeremony(
  walletAddress: string,
  ownerAddress: string,
  config: Arc402Config,
  provider: ethers.JsonRpcProvider,
  sendTx: (call: { to: string; data: string; value: string }, description: string) => Promise<string>,
): Promise<void> {
  const policyAddress = config.policyEngineAddress ?? POLICY_ENGINE_DEFAULT;
  const agentRegistryAddress =
    config.agentRegistryV2Address ??
    NETWORK_DEFAULTS[config.network]?.agentRegistryV2Address;
  const handshakeAddress =
    config.handshakeAddress ??
    NETWORK_DEFAULTS[config.network]?.handshakeAddress ??
    "0x4F5A38Bb746d7E5d49d8fd26CA6beD141Ec2DDb3";

  // ── Step 2: Machine Key ────────────────────────────────────────────────────
  console.log("\n" + c.dim("── Step 2: Machine Key ────────────────────────────────────────"));

  let machineKeyAddress: string;
  if (config.privateKey) {
    machineKeyAddress = new ethers.Wallet(config.privateKey).address;
  } else {
    const mk = ethers.Wallet.createRandom();
    machineKeyAddress = mk.address;
    config.privateKey = mk.privateKey;
    saveConfig(config);
    console.log(" " + c.dim("Machine key generated: ") + c.white(machineKeyAddress));
    console.log(" " + c.dim("Private key saved to ~/.arc402/config.json (chmod 600)"));
  }

  let mkAlreadyAuthorized = false;
  try {
    const mkContract = new ethers.Contract(walletAddress, ARC402_WALLET_MACHINE_KEY_ABI, provider);
    mkAlreadyAuthorized = await mkContract.authorizedMachineKeys(machineKeyAddress) as boolean;
  } catch { /* older wallet — will try to authorize */ }

  if (mkAlreadyAuthorized) {
    console.log(" " + c.success + c.dim(" Machine key already authorized: ") + c.white(machineKeyAddress));
  } else {
    console.log(" " + c.dim("Authorizing machine key: ") + c.white(machineKeyAddress));
    const mkIface = new ethers.Interface(ARC402_WALLET_MACHINE_KEY_ABI);
    await sendTx(
      { to: walletAddress, data: mkIface.encodeFunctionData("authorizeMachineKey", [machineKeyAddress]), value: "0x0" },
      "authorizeMachineKey",
    );
    console.log(" " + c.success + " Machine key authorized");
  }
  // Save progress after machine key step
  config.onboardingProgress = { walletAddress, step: 2, completedSteps: ["machineKey"] };
  saveConfig(config);

  // ── Step 3: Passkey ───────────────────────────────────────────────────────
  console.log("\n" + c.dim("── Step 3: Passkey (Face ID / WebAuthn) ──────────────────────"));

  let passkeyActive = false;
  try {
    const walletC = new ethers.Contract(walletAddress, ARC402_WALLET_PASSKEY_ABI, provider);
    const auth = await walletC.ownerAuth() as [bigint, string, string];
    passkeyActive = Number(auth[0]) === 1;
  } catch { /* ignore */ }

  if (passkeyActive) {
    console.log(" " + c.success + c.dim(" Passkey already active"));
  } else {
    const passkeyUrl = `https://app.arc402.xyz/passkey-setup?wallet=${walletAddress}`;
    console.log("\n " + c.white("Open this URL in your browser to set up Face ID:"));
    console.log("   " + c.cyan(passkeyUrl));
    console.log(" " + c.dim("Complete Face ID registration, then press Enter. Type 'n' + Enter to skip.\n"));
    const passkeyAns = await prompts({
      type: "text",
      name: "done",
      message: "Press Enter when done (or type 'n' to skip)",
      initial: "",
    });
    if ((passkeyAns.done as string | undefined)?.toLowerCase() === "n") {
      console.log(" " + c.warning + " Passkey skipped");
    } else {
      passkeyActive = true;
      console.log(" " + c.success + " Passkey set (via browser)");
    }
  }
  // Save progress after passkey step
  config.onboardingProgress = { walletAddress, step: 3, completedSteps: ["machineKey", "passkey"] };
  saveConfig(config);

  // ── Step 4: Policy ────────────────────────────────────────────────────────
  console.log("\n" + c.dim("── Step 4: Policy ─────────────────────────────────────────────"));

  // 4a) setVelocityLimit
  let velocityLimitEth = "0.05";
  let velocityAlreadySet = false;
  try {
    const ownerC = new ethers.Contract(walletAddress, ARC402_WALLET_OWNER_ABI, provider);
    const existing = await ownerC.velocityLimit() as bigint;
    if (existing > 0n) {
      velocityAlreadySet = true;
      velocityLimitEth = ethers.formatEther(existing);
      console.log(" " + c.success + c.dim(` Velocity limit already set: ${velocityLimitEth} ETH`));
    }
  } catch { /* ignore */ }

  if (!velocityAlreadySet) {
    const velAns = await prompts({
      type: "text",
      name: "limit",
      message: "Velocity limit (ETH / rolling window)?",
      initial: "0.05",
    });
    velocityLimitEth = (velAns.limit as string | undefined) || "0.05";
    const velIface = new ethers.Interface(["function setVelocityLimit(uint256 limit) external"]);
    await sendTx(
      { to: walletAddress, data: velIface.encodeFunctionData("setVelocityLimit", [ethers.parseEther(velocityLimitEth)]), value: "0x0" },
      `setVelocityLimit: ${velocityLimitEth} ETH`,
    );
    saveConfig(config);
  }

  // 4b) setGuardian (optional — address, 'g' to generate, or skip)
  let guardianAddress: string | null = null;
  try {
    const guardianC = new ethers.Contract(walletAddress, ARC402_WALLET_GUARDIAN_ABI, provider);
    const existing = await guardianC.guardian() as string;
    if (existing && existing !== ethers.ZeroAddress) {
      guardianAddress = existing;
      console.log(" " + c.success + c.dim(` Guardian already set: ${existing}`));
    }
  } catch { /* ignore */ }

  if (!guardianAddress) {
    const guardianAns = await prompts({
      type: "text",
      name: "guardian",
      message: "Guardian address? (address, 'g' to generate, Enter to skip)",
      initial: "",
    });
    const guardianInput = (guardianAns.guardian as string | undefined)?.trim() ?? "";
    if (guardianInput.toLowerCase() === "g") {
      const generatedGuardian = ethers.Wallet.createRandom();
      // Save guardian private key to a separate restricted file, NOT config.json
      const guardianKeyPath = path.join(os.homedir(), ".arc402", "guardian.key");
      fs.mkdirSync(path.dirname(guardianKeyPath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(guardianKeyPath, generatedGuardian.privateKey + "\n", { mode: 0o400 });
      // Only save address (not private key) to config
      config.guardianAddress = generatedGuardian.address;
      saveConfig(config);
      guardianAddress = generatedGuardian.address;
      console.log("\n " + c.warning + " Guardian key saved to ~/.arc402/guardian.key — move offline for security");
      console.log("   " + c.dim("Address: ") + c.white(generatedGuardian.address) + "\n");
      const guardianIface = new ethers.Interface(["function setGuardian(address _guardian) external"]);
      await sendTx(
        { to: walletAddress, data: guardianIface.encodeFunctionData("setGuardian", [guardianAddress]), value: "0x0" },
        "setGuardian",
      );
      saveConfig(config);
    } else if (guardianInput && ethers.isAddress(guardianInput)) {
      guardianAddress = guardianInput;
      config.guardianAddress = guardianInput;
      const guardianIface = new ethers.Interface(["function setGuardian(address _guardian) external"]);
      await sendTx(
        { to: walletAddress, data: guardianIface.encodeFunctionData("setGuardian", [guardianAddress]), value: "0x0" },
        "setGuardian",
      );
      saveConfig(config);
    } else if (guardianInput) {
      console.log(" " + c.warning + " Invalid address — guardian skipped");
    }
  }

  // 4c) setCategoryLimitFor('hire')
  let hireLimit = "0.1";
  let hireLimitAlreadySet = false;
  try {
    const limitsContract = new ethers.Contract(policyAddress, POLICY_ENGINE_LIMITS_ABI, provider);
    const existing = await limitsContract.categoryLimits(walletAddress, "hire") as bigint;
    if (existing > 0n) {
      hireLimitAlreadySet = true;
      hireLimit = ethers.formatEther(existing);
      console.log(" " + c.success + c.dim(` Hire limit already set: ${hireLimit} ETH`));
    }
  } catch { /* ignore */ }

  if (!hireLimitAlreadySet) {
    const limitAns = await prompts({
      type: "text",
      name: "limit",
      message: "Max price per hire (ETH)?",
      initial: "0.1",
    });
    hireLimit = (limitAns.limit as string | undefined) || "0.1";
    const hireLimitWei = ethers.parseEther(hireLimit);
    const policyIface = new ethers.Interface([
      "function setCategoryLimitFor(address wallet, string category, uint256 limitPerTx) external",
    ]);
    await sendTx(
      { to: policyAddress, data: policyIface.encodeFunctionData("setCategoryLimitFor", [walletAddress, "hire", hireLimitWei]), value: "0x0" },
      `setCategoryLimitFor: hire → ${hireLimit} ETH`,
    );
    saveConfig(config);
  }

  // 4d) enableContractInteraction(wallet, Handshake)
  const contractInteractionIface = new ethers.Interface([
    "function enableContractInteraction(address wallet, address target) external",
  ]);
  await sendTx(
    { to: policyAddress, data: contractInteractionIface.encodeFunctionData("enableContractInteraction", [walletAddress, handshakeAddress]), value: "0x0" },
    "enableContractInteraction: Handshake",
  );
  saveConfig(config);

  console.log(" " + c.success + " Policy configured");
  // Save progress after policy step
  config.onboardingProgress = { walletAddress, step: 4, completedSteps: ["machineKey", "passkey", "policy"] };
  saveConfig(config);

  // ── Step 5: Agent Registration ─────────────────────────────────────────────
  console.log("\n" + c.dim("── Step 5: Agent Registration ─────────────────────────────────"));

  let agentAlreadyRegistered = false;
  let agentName = "";
  let agentServiceType = "";
  let agentEndpoint = "";

  if (agentRegistryAddress) {
    try {
      const regContract = new ethers.Contract(agentRegistryAddress, AGENT_REGISTRY_ABI, provider);
      agentAlreadyRegistered = await regContract.isRegistered(walletAddress) as boolean;
      if (agentAlreadyRegistered) {
        const info = await regContract.getAgent(walletAddress) as { name: string; serviceType: string; endpoint: string };
        agentName = info.name;
        agentServiceType = info.serviceType;
        agentEndpoint = info.endpoint;
        console.log(" " + c.success + c.dim(` Agent already registered: ${agentName}`));
      }
    } catch { /* ignore */ }

    if (!agentAlreadyRegistered) {
      const rawHostname = os.hostname();
      const cleanHostname = rawHostname.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      const answers = await prompts([
        { type: "text", name: "name",        message: "Agent name?",                          initial: cleanHostname },
        { type: "text", name: "serviceType", message: "Service type?",                        initial: "intelligence" },
        { type: "text", name: "caps",        message: "Capabilities? (comma-separated)",       initial: "research" },
        { type: "text", name: "endpoint",    message: "Endpoint?",                            initial: `https://${cleanHostname}.arc402.xyz` },
      ]);

      agentName        = (answers.name        as string | undefined) || cleanHostname;
      agentServiceType = (answers.serviceType as string | undefined) || "intelligence";
      agentEndpoint    = (answers.endpoint    as string | undefined) || `https://${cleanHostname}.arc402.xyz`;
      const capabilities: string[] = ((answers.caps as string | undefined) || "research")
        .split(",").map((s) => s.trim()).filter(Boolean);

      // 5a) enableDefiAccess (check first)
      const peExtIface = new ethers.Interface([
        "function enableDefiAccess(address wallet) external",
        "function whitelistContract(address wallet, address target) external",
        "function defiAccessEnabled(address) external view returns (bool)",
        "function isContractWhitelisted(address wallet, address target) external view returns (bool)",
      ]);
      const peContract = new ethers.Contract(policyAddress, peExtIface, provider);

      const defiEnabled = await peContract.defiAccessEnabled(walletAddress).catch(() => false) as boolean;
      if (!defiEnabled) {
        await sendTx(
          { to: policyAddress, data: peExtIface.encodeFunctionData("enableDefiAccess", [walletAddress]), value: "0x0" },
          "enableDefiAccess on PolicyEngine",
        );
        saveConfig(config);
      } else {
        console.log(" " + c.success + c.dim(" enableDefiAccess — already done"));
      }

      // 5b) whitelistContract for AgentRegistry (check first)
      const whitelisted = await peContract.isContractWhitelisted(walletAddress, agentRegistryAddress).catch(() => false) as boolean;
      if (!whitelisted) {
        await sendTx(
          { to: policyAddress, data: peExtIface.encodeFunctionData("whitelistContract", [walletAddress, agentRegistryAddress]), value: "0x0" },
          "whitelistContract: AgentRegistry on PolicyEngine",
        );
        saveConfig(config);
      } else {
        console.log(" " + c.success + c.dim(" whitelistContract(AgentRegistry) — already done"));
      }

      // 5c+d) executeContractCall → register
      const regIface  = new ethers.Interface(AGENT_REGISTRY_ABI);
      const execIface = new ethers.Interface(ARC402_WALLET_EXECUTE_ABI);
      const regData   = regIface.encodeFunctionData("register", [agentName, capabilities, agentServiceType, agentEndpoint, ""]);
      const execData  = execIface.encodeFunctionData("executeContractCall", [{
        target: agentRegistryAddress,
        data: regData,
        value: 0n,
        minReturnValue: 0n,
        maxApprovalAmount: 0n,
        approvalToken: ethers.ZeroAddress,
      }]);
      await sendTx({ to: walletAddress, data: execData, value: "0x0" }, `register agent: ${agentName}`);
      console.log(" " + c.success + " Agent registered: " + agentName);
    }
  } else {
    console.log(" " + c.warning + " AgentRegistry address not configured — skipping");
  }
  // Save progress after agent step, then clear on ceremony complete
  config.onboardingProgress = { walletAddress, step: 5, completedSteps: ["machineKey", "passkey", "policy", "agent"] };
  saveConfig(config);

  // ── Step 7: Workroom Init ─────────────────────────────────────────────────
  console.log("\n" + c.dim("── Step 7: Workroom ────────────────────────────────────────────"));

  let workroomInitialized = false;
  let dockerFound = false;
  try {
    const dockerCheck = spawnSync("docker", ["--version"], { encoding: "utf-8", timeout: 5000 });
    dockerFound = dockerCheck.status === 0;
  } catch { dockerFound = false; }

  if (dockerFound) {
    console.log(" " + c.dim("Docker found — initializing workroom..."));
    try {
      const initResult = spawnSync(process.execPath, [process.argv[1], "workroom", "init"], {
        encoding: "utf-8",
        timeout: 120000,
        env: { ...process.env },
      });
      workroomInitialized = initResult.status === 0;
      if (workroomInitialized) {
        console.log(" " + c.success + " Workroom initialized");
      } else {
        console.log(" " + c.warning + " Workroom init incomplete — run: arc402 workroom init");
      }
    } catch {
      console.log(" " + c.warning + " Workroom init failed — run: arc402 workroom init");
    }
  } else {
    console.log(" " + c.warning + " Docker not found");
    console.log("   Install Docker: https://docs.docker.com/get-docker/");
    console.log("   Or run daemon in host mode: " + c.white("arc402 daemon start --host"));
  }

  // ── Step 8: Daemon Start ──────────────────────────────────────────────────
  console.log("\n" + c.dim("── Step 8: Daemon ──────────────────────────────────────────────"));

  let daemonRunning = false;
  const relayPort = 4402;

  if (workroomInitialized) {
    try {
      const startResult = spawnSync(process.execPath, [process.argv[1], "workroom", "start"], {
        encoding: "utf-8",
        timeout: 30000,
        env: { ...process.env },
      });
      daemonRunning = startResult.status === 0;
      if (daemonRunning) {
        console.log(" " + c.success + " Daemon online (port " + relayPort + ")");
      } else {
        console.log(" " + c.warning + " Daemon start failed — run: arc402 workroom start");
      }
    } catch {
      console.log(" " + c.warning + " Daemon start failed — run: arc402 workroom start");
    }
  } else if (!dockerFound) {
    try {
      const startResult = spawnSync(process.execPath, [process.argv[1], "daemon", "start", "--host"], {
        encoding: "utf-8",
        timeout: 30000,
        env: { ...process.env },
      });
      daemonRunning = startResult.status === 0;
      if (daemonRunning) {
        console.log(" " + c.success + " Daemon online — host mode (port " + relayPort + ")");
      } else {
        console.log(" " + c.warning + " Daemon not started — run: arc402 daemon start --host");
      }
    } catch {
      console.log(" " + c.warning + " Daemon not started — run: arc402 daemon start --host");
    }
  } else {
    console.log(" " + c.warning + " Daemon not started — run: arc402 workroom init first");
  }

  // ── Step 6: Summary ───────────────────────────────────────────────────────
  const trustScore = await (async () => {
    try {
      const trust = new ethers.Contract(config.trustRegistryAddress, TRUST_REGISTRY_ABI, provider);
      const s = await trust.getScore(walletAddress) as bigint;
      return s.toString();
    } catch { return "100"; }
  })();

  const workroomLabel = dockerFound
    ? (workroomInitialized ? (daemonRunning ? c.green("✓ Running") : c.yellow("✓ Initialized")) : c.yellow("⚠ Init needed"))
    : c.yellow("⚠ No Docker");
  const daemonLabel = daemonRunning
    ? c.green("✓ Online (port " + relayPort + ")")
    : c.dim("not started");
  const endpointLabel = agentEndpoint
    ? c.white(agentEndpoint) + c.dim(` → localhost:${relayPort}`)
    : c.dim("—");

  // Clear onboarding progress — ceremony complete
  delete (config as unknown as Record<string, unknown>).onboardingProgress;
  saveConfig(config);

  console.log("\n " + c.success + c.white(" Onboarding complete"));
  renderTree([
    { label: "Wallet",     value: c.white(walletAddress) },
    { label: "Owner",      value: c.white(ownerAddress) },
    { label: "Machine",    value: c.white(machineKeyAddress) + c.dim(" (authorized)") },
    { label: "Passkey",    value: passkeyActive ? c.green("✓ set") : c.yellow("⚠ skipped") },
    { label: "Velocity",   value: c.white(velocityLimitEth + " ETH") },
    { label: "Guardian",   value: guardianAddress ? c.white(guardianAddress) : c.dim("none") },
    { label: "Hire limit", value: c.white(hireLimit + " ETH") },
    { label: "Agent",      value: agentName ? c.white(agentName) : c.dim("not registered") },
    { label: "Service",    value: agentServiceType ? c.white(agentServiceType) : c.dim("—") },
    { label: "Workroom",   value: workroomLabel },
    { label: "Daemon",     value: daemonLabel },
    { label: "Endpoint",   value: endpointLabel },
    { label: "Trust",      value: c.white(`${trustScore}`), last: true },
  ]);
  console.log("\n " + c.dim("Next: fund your wallet with 0.002 ETH on Base"));
}

function printOpenShellHint(): void {
  const r = spawnSync("which", ["openshell"], { encoding: "utf-8" });
  if (r.status === 0 && r.stdout.trim()) {
    console.log("\nOpenShell detected. Run: arc402 openshell init");
  } else {
    console.log("\nOptional: install OpenShell for sandboxed execution: arc402 openshell install");
  }
}

export function registerWalletCommands(program: Command): void {
  const wallet = program.command("wallet").description("Wallet utilities");

  // ─── status ────────────────────────────────────────────────────────────────

  wallet.command("status").description("Show address, balances, contract wallet, guardian, and frozen status").option("--json").action(async (opts) => {
    const config = loadConfig();
    const { provider, address } = await getClient(config);
    if (!address) throw new Error("No wallet configured");
    const usdcAddress = getUsdcAddress(config);
    const usdc = new ethers.Contract(usdcAddress, ["function balanceOf(address owner) external view returns (uint256)"], provider);
    const trust = new TrustClient(config.trustRegistryAddress, provider);
    const [ethBalance, usdcBalance, score] = await Promise.all([
      provider.getBalance(address),
      usdc.balanceOf(address),
      trust.getScore(address),
    ]);

    // Query contract wallet for frozen/guardian state if deployed
    let contractFrozen: boolean | null = null;
    let contractGuardian: string | null = null;
    if (config.walletContractAddress) {
      try {
        const walletContract = new ethers.Contract(config.walletContractAddress, ARC402_WALLET_GUARDIAN_ABI, provider);
        [contractFrozen, contractGuardian] = await Promise.all([
          walletContract.frozen(),
          walletContract.guardian(),
        ]);
      } catch { /* contract may not be deployed yet */ }
    }

    const payload = {
      address,
      network: config.network,
      ethBalance: ethers.formatEther(ethBalance),
      usdcBalance: (Number(usdcBalance) / 1e6).toFixed(2),
      trustScore: score.score,
      trustTier: getTrustTier(score.score),
      walletContractAddress: config.walletContractAddress ?? null,
      frozen: contractFrozen,
      guardian: contractGuardian,
      guardianAddress: config.guardianAddress ?? null,
    };
    if (opts.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      const treeItems: { label: string; value: string; last?: boolean }[] = [
        { label: "Address", value: payload.address },
        { label: "Network", value: payload.network },
        { label: "ETH", value: payload.ethBalance + " ETH" },
        { label: "USDC", value: payload.usdcBalance + " USDC" },
        { label: "Trust", value: `${payload.trustScore} ${payload.trustTier}` },
      ];
      if (payload.walletContractAddress) treeItems.push({ label: "Contract", value: payload.walletContractAddress });
      if (contractFrozen !== null) treeItems.push({ label: "Frozen", value: contractFrozen ? c.red("YES") : c.green("no") });
      if (contractGuardian && contractGuardian !== ethers.ZeroAddress) treeItems.push({ label: "Guardian", value: contractGuardian });
      treeItems[treeItems.length - 1].last = true;
      renderTree(treeItems);
    }
  });

  // ─── wc-reset ──────────────────────────────────────────────────────────────
  //
  // Clears the saved WalletConnect session from config AND wipes the WC SDK
  // storage file (~/.arc402/wc-storage.json). Use when MetaMask killed the
  // session on its end and the CLI is stuck trying to resume a dead connection.
  // Next wallet command will trigger a fresh QR pairing flow.

  wallet.command("wc-reset")
    .description("Clear stale WalletConnect session — forces a fresh QR pairing on next connection")
    .option("--json")
    .action(async (opts) => {
      const config = loadConfig();

      const hadSession = !!config.wcSession;

      // 1. Clear from config
      clearWCSession(config);

      // 2. Wipe WC SDK storage (may be a file or a directory depending on SDK version)
      const wcStoragePath = path.join(os.homedir(), ".arc402", "wc-storage.json");
      let storageWiped = false;
      try {
        if (fs.existsSync(wcStoragePath)) {
          fs.rmSync(wcStoragePath, { recursive: true, force: true });
          storageWiped = true;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (opts.json) {
          console.log(JSON.stringify({ ok: false, error: `Could not delete ${wcStoragePath}: ${msg}` }));
        } else {
          console.warn(" " + c.warning + " " + c.yellow(`Could not delete ${wcStoragePath}: ${msg}`));
          console.warn("  You may need to delete it manually.");
        }
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify({ ok: true, hadSession, storageWiped }));
      } else {
        console.log(" " + c.success + c.white(" WalletConnect session cleared"));
        if (storageWiped) console.log(" " + c.dim("Storage wiped:") + " " + c.white(wcStoragePath));
        else console.log(" " + c.dim("(No storage file found — already clean)"));
        console.log("\n" + c.dim("Next: run any wallet command and scan the fresh QR code."));
      }
    });

  // ─── new ───────────────────────────────────────────────────────────────────

  wallet.command("new")
    .description("Generate a fresh keypair and save to config")
    .option("--network <network>", "Network (base-mainnet or base-sepolia)", "base-sepolia")
    .action(async (opts) => {
      const network = opts.network as "base-mainnet" | "base-sepolia";
      const defaults = NETWORK_DEFAULTS[network];
      if (!defaults) {
        console.error(`Unknown network: ${network}. Use base-mainnet or base-sepolia.`);
        process.exit(1);
      }
      const generated = ethers.Wallet.createRandom();
      const config: Arc402Config = {
        network,
        rpcUrl: defaults.rpcUrl!,
        privateKey: generated.privateKey,
        trustRegistryAddress: defaults.trustRegistryAddress!,
        walletFactoryAddress: defaults.walletFactoryAddress,
      };
      saveConfig(config);
      renderTree([
        { label: "Address", value: generated.address },
        { label: "Config", value: getConfigPath(), last: true },
      ]);
      console.log(c.dim("Next: fund your wallet with ETH, then run: arc402 wallet deploy"));
    });

  // ─── import ────────────────────────────────────────────────────────────────

  wallet.command("import")
    .description("Import an existing private key (use --key-file or stdin prompt)")
    .option("--network <network>", "Network (base-mainnet or base-sepolia)", "base-sepolia")
    .option("--key-file <path>", "Read private key from file instead of prompting")
    .action(async (opts) => {
      const network = opts.network as "base-mainnet" | "base-sepolia";
      const defaults = NETWORK_DEFAULTS[network];
      if (!defaults) {
        console.error(`Unknown network: ${network}. Use base-mainnet or base-sepolia.`);
        process.exit(1);
      }

      let privateKey: string;
      if (opts.keyFile) {
        try {
          privateKey = fs.readFileSync(opts.keyFile, "utf-8").trim();
        } catch (e) {
          console.error(`Cannot read key file: ${e instanceof Error ? e.message : String(e)}`);
          process.exit(1);
        }
      } else {
        // Interactive prompt — hidden input avoids shell history
        const answer = await prompts({
          type: "password",
          name: "key",
          message: "Paste private key (hidden):",
        });
        privateKey = ((answer.key as string | undefined) ?? "").trim();
        if (!privateKey) {
          console.error("No private key entered.");
          process.exit(1);
        }
      }

      let imported: ethers.Wallet;
      try {
        imported = new ethers.Wallet(privateKey);
      } catch {
        console.error("Invalid private key. Must be a 0x-prefixed hex string.");
        process.exit(1);
      }
      const config: Arc402Config = {
        network,
        rpcUrl: defaults.rpcUrl!,
        privateKey: imported.privateKey,
        trustRegistryAddress: defaults.trustRegistryAddress!,
        walletFactoryAddress: defaults.walletFactoryAddress,
      };
      saveConfig(config);
      renderTree([
        { label: "Address", value: imported.address },
        { label: "Config", value: getConfigPath(), last: true },
      ]);
      console.warn(" " + c.warning + " " + c.yellow("Store your private key safely — anyone with it controls your wallet"));
    });

  // ─── fund ──────────────────────────────────────────────────────────────────

  wallet.command("fund")
    .description("Show how to get ETH onto your wallet")
    .action(async () => {
      const config = loadConfig();
      const { provider, address } = await getClient(config);
      if (!address) throw new Error("No wallet configured");
      const ethBalance = await provider.getBalance(address);
      console.log(`\nYour wallet address:\n  ${address}`);
      console.log(`\nCurrent balance: ${ethers.formatEther(ethBalance)} ETH`);
      console.log(`\nFunding options:`);
      console.log(`  Bridge (Base mainnet): https://bridge.base.org`);
      console.log(`  Coinbase: If you use Coinbase, you can withdraw directly to Base mainnet`);
      if (config.network === "base-sepolia") {
        console.log(`  Testnet faucet: https://www.alchemy.com/faucets/base-sepolia`);
      }
    });

  // ─── balance ───────────────────────────────────────────────────────────────

  wallet.command("balance")
    .description("Check ETH balance on Base")
    .option("--json")
    .action(async (opts) => {
      const config = loadConfig();
      const { provider, address } = await getClient(config);
      if (!address) throw new Error("No wallet configured");
      const ethBalance = await provider.getBalance(address);
      const formatted = ethers.formatEther(ethBalance);
      if (opts.json) {
        console.log(JSON.stringify({ address, balance: formatted, balanceWei: ethBalance.toString() }));
      } else {
        renderTree([
          { label: "Address", value: address },
          { label: "Balance", value: `${formatted} ETH`, last: true },
        ]);
      }
    });

  // ─── list ──────────────────────────────────────────────────────────────────

  wallet.command("list")
    .description("List all ARC402Wallet contracts owned by the configured master key")
    .option("--owner <address>", "Master key address to query (defaults to config.ownerAddress)")
    .option("--json")
    .action(async (opts) => {
      const config = loadConfig();
      const factoryAddress = config.walletFactoryAddress ?? NETWORK_DEFAULTS[config.network]?.walletFactoryAddress;
      if (!factoryAddress) {
        console.error("walletFactoryAddress not found in config or NETWORK_DEFAULTS.");
        process.exit(1);
      }
      const ownerAddress: string = opts.owner ?? config.ownerAddress;
      if (!ownerAddress) {
        console.error("No owner address. Pass --owner <address> or set ownerAddress in config (run `arc402 wallet deploy` first).");
        process.exit(1);
      }
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const factory = new ethers.Contract(factoryAddress, WALLET_FACTORY_ABI, provider);
      const wallets: string[] = await factory.getWallets(ownerAddress);

      const results = await Promise.all(
        wallets.map(async (addr) => {
          const walletContract = new ethers.Contract(addr, ARC402_WALLET_GUARDIAN_ABI, provider);
          const trustContract = new ethers.Contract(config.trustRegistryAddress, TRUST_REGISTRY_ABI, provider);
          const [frozen, score] = await Promise.all([
            walletContract.frozen().catch(() => null),
            trustContract.getScore(addr).catch(() => BigInt(0)),
          ]);
          return { address: addr, frozen: frozen as boolean | null, score: Number(score) };
        })
      );

      if (opts.json) {
        console.log(JSON.stringify(results.map((w, i) => ({
          index: i + 1,
          address: w.address,
          active: w.address.toLowerCase() === config.walletContractAddress?.toLowerCase(),
          trustScore: w.score,
          frozen: w.frozen,
        })), null, 2));
      } else {
        const short = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-5)}`;
        console.log(`\nARC-402 Wallets owned by ${short(ownerAddress)}\n`);
        results.forEach((w, i) => {
          const active = w.address.toLowerCase() === config.walletContractAddress?.toLowerCase();
          const activeTag = active ? "  [active]" : "          ";
          console.log(`  #${i + 1}  ${w.address}${activeTag}  Trust: ${w.score}  Frozen: ${w.frozen}`);
        });
        console.log(`\n  ${results.length} wallet${results.length === 1 ? "" : "s"} total`);
      }
    });

  // ─── use ───────────────────────────────────────────────────────────────────

  wallet.command("use <address>")
    .description("Switch the active wallet contract address in config")
    .action(async (address) => {
      let checksumAddress: string;
      try {
        checksumAddress = ethers.getAddress(address);
      } catch {
        console.error(`Invalid address: ${address}`);
        process.exit(1);
      }
      const config = loadConfig();
      const factoryAddress = config.walletFactoryAddress ?? NETWORK_DEFAULTS[config.network]?.walletFactoryAddress;
      if (factoryAddress && config.ownerAddress) {
        try {
          const provider = new ethers.JsonRpcProvider(config.rpcUrl);
          const factory = new ethers.Contract(factoryAddress, WALLET_FACTORY_ABI, provider);
          const wallets: string[] = await factory.getWallets(config.ownerAddress);
          const found = wallets.some((w) => w.toLowerCase() === checksumAddress.toLowerCase());
          if (!found) {
            console.warn(`WARN: ${checksumAddress} was not found in WalletFactory wallets for owner ${config.ownerAddress}`);
            console.warn("  Proceeding anyway — use 'arc402 wallet list' to see known wallets.");
          }
        } catch { /* allow override if factory call fails */ }
      }
      config.walletContractAddress = checksumAddress;
      saveConfig(config);
      console.log(`Active wallet set to ${checksumAddress}`);
    });

  // ─── deploy ────────────────────────────────────────────────────────────────

  wallet.command("deploy")
    .description("Deploy ARC402Wallet contract via WalletFactory (phone wallet signs via WalletConnect)")
    .option("--smart-wallet", "Connect via Base Smart Wallet (Coinbase Wallet SDK) instead of WalletConnect")
    .option("--hardware", "Hardware wallet mode: show raw wc: URI only (for Ledger Live, Trezor Suite, etc.)")
    .option("--sponsored", "Use CDP paymaster for gas sponsorship (requires paymasterUrl + cdpKeyName + CDP_PRIVATE_KEY env)")
    .option("--dry-run", "Simulate the deployment ceremony without sending transactions")
    .action(async (opts) => {
      const config = loadConfig();

      if (opts.dryRun) {
        const factoryAddr = config.walletFactoryAddress ?? NETWORK_DEFAULTS[config.network]?.walletFactoryAddress ?? "(not configured)";
        const chainId = config.network === "base-mainnet" ? 8453 : 84532;
        console.log();
        console.log(" " + c.dim("── Dry run: wallet deploy ──────────────────────────────────────"));
        console.log(" " + c.dim("Network:         ") + c.white(config.network));
        console.log(" " + c.dim("Chain ID:        ") + c.white(String(chainId)));
        console.log(" " + c.dim("RPC:             ") + c.white(config.rpcUrl));
        console.log(" " + c.dim("WalletFactory:   ") + c.white(factoryAddr));
        console.log(" " + c.dim("Signing method:  ") + c.white(opts.smartWallet ? "Base Smart Wallet" : opts.hardware ? "Hardware (WC URI)" : "WalletConnect"));
        console.log(" " + c.dim("Sponsored:       ") + c.white(opts.sponsored ? "yes" : "no"));
        console.log();
        console.log(" " + c.dim("Steps that would run:"));
        console.log("   1. Connect " + (opts.smartWallet ? "Coinbase Smart Wallet" : "WalletConnect") + " session");
        console.log("   2. Call WalletFactory.createWallet() → deploy ARC402Wallet");
        console.log("   3. Save walletContractAddress to config");
        console.log("   4. Run onboarding ceremony (PolicyEngine, machine key, agent registration)");
        console.log();
        console.log(" " + c.dim("No transactions sent (--dry-run mode)."));
        console.log();
        return;
      }
      const factoryAddress = config.walletFactoryAddress ?? NETWORK_DEFAULTS[config.network]?.walletFactoryAddress;
      if (!factoryAddress) {
        console.error("walletFactoryAddress not found in config or NETWORK_DEFAULTS. Add walletFactoryAddress to your config.");
        process.exit(1);
      }
      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const factoryInterface = new ethers.Interface(WALLET_FACTORY_ABI);

      if (opts.sponsored) {
        // ── Sponsored deploy via CDP paymaster + ERC-4337 bundler ─────────────
        // Note: WalletFactoryV3/V4 use msg.sender as wallet owner. In ERC-4337
        // context msg.sender = EntryPoint. A factory upgrade with explicit owner
        // param is needed for fully correct sponsored deployment. Until then,
        // this path is available for testing and future-proofing.
        const paymasterUrl = config.paymasterUrl ?? NETWORK_DEFAULTS[config.network]?.paymasterUrl;
        const cdpKeyName = config.cdpKeyName ?? process.env.CDP_KEY_NAME;
        const cdpPrivateKey = config.cdpPrivateKey ?? process.env.CDP_PRIVATE_KEY;
        if (!paymasterUrl) {
          console.error("paymasterUrl not configured. Add it to config or set NEXT_PUBLIC_PAYMASTER_URL.");
          process.exit(1);
        }
        const { signer, address: ownerAddress } = await requireSigner(config);
        const bundlerUrl = process.env.BUNDLER_URL ?? "https://api.pimlico.io/v2/base/rpc";
        const pm = new PaymasterClient(paymasterUrl, cdpKeyName, cdpPrivateKey);
        const bundler = new BundlerClient(bundlerUrl, DEFAULT_ENTRY_POINT, chainId);

        console.log(`Sponsoring deploy via ${paymasterUrl}...`);
        const factoryIface = new ethers.Interface(WALLET_FACTORY_ABI);
        const factoryData = factoryIface.encodeFunctionData("createWallet", [DEFAULT_ENTRY_POINT]);

        // Predict counterfactual sender address using EntryPoint.getSenderAddress
        const entryPoint = new ethers.Contract(
          DEFAULT_ENTRY_POINT,
          ["function getSenderAddress(bytes calldata initCode) external"],
          provider
        );
        const initCodePacked = ethers.concat([factoryAddress, factoryData]);
        let senderAddress: string;
        try {
          // getSenderAddress always reverts with SenderAddressResult(address)
          await entryPoint.getSenderAddress(initCodePacked);
          throw new Error("getSenderAddress did not revert as expected");
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          const match = msg.match(/0x6ca7b806([0-9a-fA-F]{64})/);
          if (!match) {
            console.error("Could not predict wallet address:", msg);
            process.exit(1);
          }
          senderAddress = ethers.getAddress("0x" + match[1].slice(24));
        }

        console.log(`Predicted wallet address: ${senderAddress}`);
        const userOp = await pm.sponsorUserOperation(
          {
            sender: senderAddress,
            nonce: "0x0",
            callData: "0x",
            factory: factoryAddress,
            factoryData,
            callGasLimit: ethers.toBeHex(300_000),
            verificationGasLimit: ethers.toBeHex(400_000),
            preVerificationGas: ethers.toBeHex(60_000),
            maxFeePerGas: ethers.toBeHex((await provider.getFeeData()).maxFeePerGas ?? BigInt(1_000_000_000)),
            maxPriorityFeePerGas: ethers.toBeHex((await provider.getFeeData()).maxPriorityFeePerGas ?? BigInt(100_000_000)),
            signature: "0x",
          },
          DEFAULT_ENTRY_POINT
        );

        // Sign UserOp with owner key
        const userOpHash = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32"],
            [
              userOp.sender, BigInt(userOp.nonce),
              ethers.keccak256(userOp.factory ? ethers.concat([userOp.factory, userOp.factoryData ?? "0x"]) : "0x"),
              ethers.keccak256(userOp.callData),
              ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256", "uint256", "uint256", "uint256", "uint256", "address", "bytes"],
                [userOp.verificationGasLimit, userOp.callGasLimit, userOp.preVerificationGas, userOp.maxFeePerGas, userOp.maxPriorityFeePerGas, userOp.paymaster ?? ethers.ZeroAddress, userOp.paymasterData ?? "0x"]
              )),
              BigInt(chainId), DEFAULT_ENTRY_POINT, ethers.ZeroHash,
            ]
          )
        );
        userOp.signature = await signer.signMessage(ethers.getBytes(userOpHash));

        const userOpHash2 = await bundler.sendUserOperation(userOp);
        console.log(`UserOp submitted: ${userOpHash2}`);
        console.log("Waiting for confirmation...");
        const receipt = await bundler.getUserOperationReceipt(userOpHash2);
        if (!receipt.success) {
          console.error("UserOperation failed on-chain.");
          process.exit(1);
        }

        config.walletContractAddress = senderAddress;
        config.ownerAddress = ownerAddress;
        saveConfig(config);
        console.log("\n" + c.success + c.white(" ARC402Wallet deployed (sponsored)"));
        renderTree([
          { label: "Wallet", value: senderAddress },
          { label: "Owner", value: ownerAddress },
          { label: "Gas", value: "Sponsorship active — initial setup ops are free", last: true },
        ]);
        console.log(" " + c.warning + " " + c.yellow("IMPORTANT: Onboarding ceremony was not run on this wallet."));
        console.log(c.dim("   Category spend limits have NOT been configured. All executeSpend and"));
        console.log(c.dim(`   executeTokenSpend calls will fail with "PolicyEngine: category not configured"`));
        console.log(c.dim("   until you run governance setup manually via WalletConnect:"));
        console.log("\n" + c.dim("     arc402 wallet governance setup"));
        console.log("\n" + c.dim("   This must be done before making any spend from this wallet."));
        console.log("\n" + c.dim("Next: arc402 wallet set-passkey <x> <y> --sponsored"));
        printOpenShellHint();
      } else if (opts.smartWallet) {
        const { txHash, account } = await requestCoinbaseSmartWalletSignature(
          chainId,
          (ownerAccount) => ({
            to: factoryAddress,
            data: factoryInterface.encodeFunctionData("createWallet", ["0x0000000071727De22E5E9d8BAf0edAc6f37da032"]),
            value: "0x0",
          }),
          "Approve ARC402Wallet deployment — you will be set as owner"
        );
        console.log(`\nTransaction submitted: ${txHash}`);
        console.log("Waiting for confirmation...");
        const receipt = await provider.waitForTransaction(txHash);
        if (!receipt) {
          console.error("Transaction not confirmed. Check on-chain.");
          process.exit(1);
        }
        let walletAddress: string | null = null;
        const factoryContract = new ethers.Contract(factoryAddress, WALLET_FACTORY_ABI, provider);
        for (const log of receipt.logs) {
          try {
            const parsed = factoryContract.interface.parseLog(log);
            if (parsed?.name === "WalletCreated") {
              walletAddress = parsed.args.walletAddress as string;
              break;
            }
          } catch { /* skip unparseable logs */ }
        }
        if (!walletAddress) {
          console.error("Could not find WalletCreated event in receipt. Check the transaction on-chain.");
          process.exit(1);
        }
        config.walletContractAddress = walletAddress;
        config.ownerAddress = account;
        saveConfig(config);
        console.log("\n" + c.success + c.white(" ARC402Wallet deployed"));
        renderTree([
          { label: "Wallet", value: walletAddress },
          { label: "Owner", value: account + c.dim(" (Base Smart Wallet)"), last: true },
        ]);
        console.log(c.dim("Your wallet contract is ready for policy enforcement"));
        console.log(c.dim("\nNext: run 'arc402 wallet set-guardian' to configure the emergency guardian key."));
        printOpenShellHint();
      } else if (config.walletConnectProjectId) {
        const telegramOpts = config.telegramBotToken && config.telegramChatId
          ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
          : undefined;

        // ── Resume check ──────────────────────────────────────────────────────
        const resumeProgress = config.onboardingProgress;
        const isResuming = !!(
          resumeProgress?.walletAddress &&
          resumeProgress.walletAddress === config.walletContractAddress &&
          config.ownerAddress
        );
        if (isResuming) {
          const stepNames: Record<number, string> = {
            2: "machine key", 3: "passkey", 4: "policy setup", 5: "agent registration",
          };
          const nextStep = (resumeProgress!.step ?? 1) + 1;
          console.log(" " + c.dim(`◈ Resuming onboarding from step ${nextStep} (${stepNames[nextStep] ?? "ceremony"})...`));
        }

        // ── Gas estimation ─────────────────────────────────────────────────────
        if (!isResuming) {
          let gasMsg = "~0.003 ETH (6 transactions on Base)";
          try {
            const feeData = await provider.getFeeData();
            const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? BigInt(1_500_000_000);
            const deployGas = await provider.estimateGas({
              to: factoryAddress,
              data: factoryInterface.encodeFunctionData("createWallet", ["0x0000000071727De22E5E9d8BAf0edAc6f37da032"]),
            }).catch(() => BigInt(280_000));
            const ceremonyGas = BigInt(700_000); // ~5 ceremony txs × ~140k each
            const totalGasEth = parseFloat(ethers.formatEther((deployGas + ceremonyGas) * gasPrice));
            gasMsg = `~${totalGasEth.toFixed(4)} ETH (6 transactions on Base)`;
          } catch { /* use default */ }
          console.log(" " + c.dim(`◈ Estimated gas: ${gasMsg}`));
        }

        // ── Step 1: Connect ────────────────────────────────────────────────────
        const connectPrompt = isResuming
          ? "Connect wallet to resume onboarding"
          : "Approve ARC402Wallet deployment — you will be set as owner";
        const { client, session, account } = await connectPhoneWallet(
          config.walletConnectProjectId,
          chainId,
          config,
          { telegramOpts, prompt: connectPrompt, hardware: !!opts.hardware }
        );

        const networkName = chainId === 8453 ? "Base" : "Base Sepolia";
        const shortAddr = `${account.slice(0, 6)}...${account.slice(-5)}`;
        console.log("\n" + c.success + c.white(` Connected: ${shortAddr} on ${networkName}`));

        if (telegramOpts && !isResuming) {
          // Send "connected" message with a deploy confirmation button.
          // TODO: wire up full callback_data round-trip when a persistent bot process is available.
          await sendTelegramMessage({
            botToken: telegramOpts.botToken,
            chatId: telegramOpts.chatId,
            threadId: telegramOpts.threadId,
            text: `✓ Wallet connected: ${shortAddr} — tap to deploy:`,
            buttons: [[{ text: "🚀 Deploy ARC-402 Wallet", callback_data: "arc402_deploy_confirm" }]],
          });
        }

        let walletAddress: string;

        if (isResuming) {
          // Resume: skip deploy, use existing wallet
          walletAddress = config.walletContractAddress!;
          console.log(" " + c.dim(`◈ Using existing wallet: ${walletAddress}`));
        } else {
          // ── Step 2: Confirm & Deploy ─────────────────────────────────────────
          // WalletConnect approval already confirmed intent — sending automatically

          console.log("Deploying...");
          const txHash = await sendTransactionWithSession(client, session, account, chainId, {
            to: factoryAddress,
            data: factoryInterface.encodeFunctionData("createWallet", ["0x0000000071727De22E5E9d8BAf0edAc6f37da032"]),
            value: "0x0",
          });

          console.log(`\nTransaction submitted: ${txHash}`);
          console.log("Waiting for confirmation...");
          const receipt = await provider.waitForTransaction(txHash);
          if (!receipt) {
            console.error("Transaction not confirmed. Check on-chain.");
            process.exit(1);
          }
          let deployedWallet: string | null = null;
          const factoryContract = new ethers.Contract(factoryAddress, WALLET_FACTORY_ABI, provider);
          for (const log of receipt.logs) {
            try {
              const parsed = factoryContract.interface.parseLog(log);
              if (parsed?.name === "WalletCreated") {
                deployedWallet = parsed.args.walletAddress as string;
                break;
              }
            } catch { /* skip unparseable logs */ }
          }
          if (!deployedWallet) {
            console.error("Could not find WalletCreated event in receipt. Check the transaction on-chain.");
            process.exit(1);
          }
          walletAddress = deployedWallet;
          // ── Step 1 complete: save wallet + owner immediately ─────────────────
          config.walletContractAddress = walletAddress;
          config.ownerAddress = account;
          saveConfig(config);
          try { fs.chmodSync(getConfigPath(), 0o600); } catch { /* best-effort */ }
          console.log("\n " + c.success + c.white(" Wallet deployed"));
          renderTree([
            { label: "Wallet", value: walletAddress },
            { label: "Owner", value: account, last: true },
          ]);
        }

        // ── Steps 2–6: Complete onboarding ceremony (same WalletConnect session)
        const sendTxCeremony = async (
          call: { to: string; data: string; value: string },
          description: string,
        ): Promise<string> => {
          console.log(" " + c.dim(`◈ ${description}`));
          const hash = await sendTransactionWithSession(client, session, account, chainId, call);
          console.log(" " + c.dim("  waiting for confirmation..."));
          await provider.waitForTransaction(hash, 1);
          console.log(" " + c.success + " " + c.white(description));
          return hash;
        };
        await runCompleteOnboardingCeremony(walletAddress, account, config, provider, sendTxCeremony);
        printOpenShellHint();
      } else {
        console.warn("⚠ WalletConnect not configured. Using stored private key (insecure).");
        console.warn("  Run `arc402 config set walletConnectProjectId <id>` to enable phone wallet signing.");
        const { signer, address } = await requireSigner(config);
        const factory = new ethers.Contract(factoryAddress, WALLET_FACTORY_ABI, signer);
        const deploySpinner = startSpinner(`Deploying ARC402Wallet via factory at ${factoryAddress}...`);
        const tx = await factory.createWallet("0x0000000071727De22E5E9d8BAf0edAc6f37da032");
        const receipt = await tx.wait();
        let walletAddress: string | null = null;
        for (const log of receipt.logs) {
          try {
            const parsed = factory.interface.parseLog(log);
            if (parsed?.name === "WalletCreated") {
              walletAddress = parsed.args.walletAddress as string;
              break;
            }
          } catch { /* skip unparseable logs */ }
        }
        if (!walletAddress) {
          deploySpinner.fail("Could not find WalletCreated event in receipt. Check the transaction on-chain.");
          process.exit(1);
        }
        deploySpinner.succeed("Wallet deployed");

        // Generate guardian key (separate from hot key) and call setGuardian
        const guardianWallet = ethers.Wallet.createRandom();
        config.walletContractAddress = walletAddress;
        config.ownerAddress = address;
        config.guardianAddress = guardianWallet.address;
        // Save key to restricted file — never store in config.json
        saveGuardianKey(guardianWallet.privateKey);
        if (config.guardianPrivateKey) delete (config as unknown as Record<string, unknown>).guardianPrivateKey;
        saveConfig(config);

        // Call setGuardian on the deployed wallet
        const walletContract = new ethers.Contract(walletAddress, ARC402_WALLET_GUARDIAN_ABI, signer);
        const setGuardianTx = await walletContract.setGuardian(guardianWallet.address);
        await setGuardianTx.wait();

        // ── Mandatory onboarding ceremony (private key path) ──────────────────
        console.log("\nRunning mandatory onboarding ceremony...");
        const provider2 = new ethers.JsonRpcProvider(config.rpcUrl);
        await runWalletOnboardingCeremony(
          walletAddress,
          address,
          config,
          provider2,
          async (call, description) => {
            console.log(" " + c.dim(`Sending: ${description}`));
            const tx2 = await signer.sendTransaction({ to: call.to, data: call.data, value: call.value === "0x0" ? 0n : BigInt(call.value) });
            await tx2.wait(1);
            console.log(" " + c.success + " " + c.dim(description) + " " + c.dim(tx2.hash));
            return tx2.hash;
          },
        );

        console.log(` ${c.success} ARC402Wallet deployed`);
        renderTree([
          { label: "Wallet", value: walletAddress },
          { label: "Guardian", value: guardianWallet.address, last: true },
        ]);
        console.log(`Guardian private key saved to ~/.arc402/guardian.key (chmod 400 — keep it safe, used for emergency freeze only)`);
        console.log(`Your wallet contract is ready for policy enforcement`);
        printOpenShellHint();
      }
    });

  // ─── send ──────────────────────────────────────────────────────────────────

  wallet.command("send <address> <amount>")
    .description("Send ETH from configured wallet (amount: '0.001eth' or wei)")
    .option("--json")
    .action(async (to, amountRaw, opts) => {
      const config = loadConfig();
      const { signer } = await requireSigner(config);
      const value = parseAmount(amountRaw);
      const tx = await signer.sendTransaction({ to, value });
      if (opts.json) {
        console.log(JSON.stringify({ txHash: tx.hash, to, amount: ethers.formatEther(value) }));
      } else {
        console.log(`Tx hash: ${tx.hash}`);
      }
    });

  // ─── policy ────────────────────────────────────────────────────────────────

  const walletPolicy = wallet.command("policy").description("View and set spending policy on ARC402Wallet");

  walletPolicy.command("show")
    .description("Show per-tx and daily spending limits for a category")
    .requiredOption("--category <cat>", "Category name (e.g. code.review)")
    .action(async (opts) => {
      const config = loadConfig();
      const policyAddress = config.policyEngineAddress ?? POLICY_ENGINE_DEFAULT;
      const walletAddr = config.walletContractAddress;
      if (!walletAddr) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const contract = new ethers.Contract(policyAddress, POLICY_ENGINE_LIMITS_ABI, provider);
      const [perTxLimit, dailyLimit]: [bigint, bigint] = await Promise.all([
        contract.categoryLimits(walletAddr, opts.category),
        contract.dailyCategoryLimit(walletAddr, opts.category),
      ]);
      console.log(`Category:  ${opts.category}`);
      console.log(`Per-tx:    ${perTxLimit === 0n ? "(not set)" : ethers.formatEther(perTxLimit) + " ETH"}`);
      console.log(`Daily:     ${dailyLimit === 0n ? "(not set)" : ethers.formatEther(dailyLimit) + " ETH"}`);
      if (dailyLimit > 0n) {
        console.log(`\nNote: Daily limits use two 12-hour buckets (current + previous window).`);
        console.log(`  The effective limit applies across a rolling 12-24 hour period, not a strict calendar day.`);
      }
    });

  walletPolicy.command("set-limit")
    .description("Set a spending limit for a category (phone wallet signs via WalletConnect)")
    .requiredOption("--category <cat>", "Category name (e.g. code.review)")
    .requiredOption("--amount <eth>", "Limit in ETH (e.g. 0.1)")
    .action(async (opts) => {
      const config = loadConfig();
      const policyAddress = config.policyEngineAddress ?? POLICY_ENGINE_DEFAULT;
      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const amount = ethers.parseEther(opts.amount);
      const policyInterface = new ethers.Interface(POLICY_ENGINE_LIMITS_ABI);

      if (config.walletConnectProjectId) {
        const walletAddr = config.walletContractAddress;
        if (!walletAddr) {
          console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
          process.exit(1);
        }
        const provider = new ethers.JsonRpcProvider(config.rpcUrl);
        const { txHash } = await requestPhoneWalletSignature(
          config.walletConnectProjectId,
          chainId,
          (account) => ({
            to: policyAddress,
            data: policyInterface.encodeFunctionData("setCategoryLimitFor", [walletAddr, opts.category, amount]),
            value: "0x0",
          }),
          `Approve spend limit: ${opts.category} → ${opts.amount} ETH`,
          config.telegramBotToken && config.telegramChatId ? {
            botToken: config.telegramBotToken,
            chatId: config.telegramChatId,
            threadId: config.telegramThreadId,
          } : undefined,
          config
        );
        console.log(`\nTransaction submitted: ${txHash}`);
        await provider.waitForTransaction(txHash);
        console.log(`Spend limit for ${opts.category} set to ${opts.amount} ETH`);
      } else {
        console.warn("⚠ WalletConnect not configured. Using stored private key (insecure).");
        console.warn("  Run `arc402 config set walletConnectProjectId <id>` to enable phone wallet signing.");
        const { signer, address } = await requireSigner(config);
        const contract = new ethers.Contract(policyAddress, POLICY_ENGINE_LIMITS_ABI, signer);
        await (await contract.setCategoryLimitFor(address, opts.category, amount)).wait();
        console.log(`Spend limit for ${opts.category} set to ${opts.amount} ETH`);
      }
    });

  // ─── policy set-daily-limit (J8-01) ──────────────────────────────────────
  //
  // Sets the daily (rolling 12/24h window) category limit on PolicyEngine.
  // Note: the limit uses two 12-hour buckets — the effective maximum across
  // any 24h window is up to 2× the configured value at bucket boundaries.

  walletPolicy.command("set-daily-limit")
    .description("Set a daily category spending limit (phone wallet signs via WalletConnect). Note: uses 12-hour rolling buckets — see below.")
    .requiredOption("--category <cat>", "Category name (e.g. compute)")
    .requiredOption("--amount <eth>", "Daily limit in ETH (e.g. 0.5)")
    .action(async (opts) => {
      const config = loadConfig();
      console.log(`\nNote: ARC-402 has two independent velocity limit layers:`);
      console.log(`  1. Wallet-level (arc402 wallet set-velocity-limit): ETH cap per rolling hour, enforced by ARC402Wallet contract. Breach auto-freezes wallet.`);
      console.log(`  2. PolicyEngine-level (arc402 wallet policy set-daily-limit): Per-category daily cap, enforced by PolicyEngine. Breach returns a soft error without freezing.`);
      console.log(`  Both must be configured for full protection.\n`);
      const policyAddress = config.policyEngineAddress ?? POLICY_ENGINE_DEFAULT;
      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const walletAddr = config.walletContractAddress;
      if (!walletAddr) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      const amount = ethers.parseEther(opts.amount);
      console.log(`\nNote: Daily limits use two 12-hour buckets (current + previous window).`);
      console.log(`  The effective limit applies across a rolling 12-24 hour period, not a strict calendar day.`);
      console.log(`  Setting daily limit for category "${opts.category}" to ${opts.amount} ETH.\n`);
      const policyInterface = new ethers.Interface(POLICY_ENGINE_LIMITS_ABI);
      if (config.walletConnectProjectId) {
        const provider = new ethers.JsonRpcProvider(config.rpcUrl);
        const { txHash } = await requestPhoneWalletSignature(
          config.walletConnectProjectId,
          chainId,
          () => ({
            to: policyAddress,
            data: policyInterface.encodeFunctionData("setDailyLimitFor", [walletAddr, opts.category, amount]),
            value: "0x0",
          }),
          `Approve daily limit: ${opts.category} → ${opts.amount} ETH`,
          config.telegramBotToken && config.telegramChatId ? {
            botToken: config.telegramBotToken,
            chatId: config.telegramChatId,
            threadId: config.telegramThreadId,
          } : undefined,
          config
        );
        await provider.waitForTransaction(txHash);
        console.log(`Daily limit for ${opts.category} set to ${opts.amount} ETH (12/24h rolling window)`);
      } else {
        console.warn("⚠ WalletConnect not configured. Using stored private key (insecure).");
        const { signer, address } = await requireSigner(config);
        const contract = new ethers.Contract(policyAddress, POLICY_ENGINE_LIMITS_ABI, signer);
        await (await contract.setDailyLimitFor(address, opts.category, amount)).wait();
        console.log(`Daily limit for ${opts.category} set to ${opts.amount} ETH (12/24h rolling window)`);
      }
    });

  walletPolicy.command("set <policyId>")
    .description("Set the active policy ID on ARC402Wallet (phone wallet signs via WalletConnect)")
    .action(async (policyId) => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId) {
        console.error("walletConnectProjectId not set in config. Run `arc402 config set walletConnectProjectId <id>`.");
        process.exit(1);
      }

      // Normalise policyId to bytes32 hex
      let policyIdHex: string;
      try {
        policyIdHex = ethers.zeroPadValue(ethers.hexlify(policyId.startsWith("0x") ? policyId : ethers.toUtf8Bytes(policyId)), 32);
      } catch {
        console.error("Invalid policyId — must be a hex string (0x…) or UTF-8 label.");
        process.exit(1);
      }

      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const ownerInterface = new ethers.Interface(ARC402_WALLET_OWNER_ABI);

      let currentPolicy = "(unknown)";
      try {
        const walletContract = new ethers.Contract(config.walletContractAddress, ARC402_WALLET_OWNER_ABI, provider);
        currentPolicy = await walletContract.activePolicyId();
      } catch { /* contract may not be deployed yet */ }

      console.log(`\nWallet:         ${config.walletContractAddress}`);
      console.log(`Current policy: ${currentPolicy}`);
      console.log(`New policy:     ${policyIdHex}`);

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const { txHash } = await requestPhoneWalletSignature(
        config.walletConnectProjectId,
        chainId,
        () => ({
          to: config.walletContractAddress!,
          data: ownerInterface.encodeFunctionData("updatePolicy", [policyIdHex]),
          value: "0x0",
        }),
        `Approve: update policy to ${policyIdHex}`,
        telegramOpts,
        config
      );

      await provider.waitForTransaction(txHash);
      console.log("\n" + c.success + c.white(" Active policy updated"));
      console.log(" " + c.dim("Tx:") + " " + c.white(txHash));
      console.log(" " + c.dim("Policy:") + " " + c.white(policyIdHex));
    });

  // ─── freeze (guardian key — emergency wallet freeze) ──────────────────────
  //
  // Uses the guardian private key from config to call ARC402Wallet.freeze() or
  // ARC402Wallet.freezeAndDrain() directly on the wallet contract.
  // No human approval needed — designed for immediate AI-initiated emergency response.

  wallet.command("freeze")
    .description("Emergency freeze via guardian key. Use immediately if suspicious activity is detected. Owner must unfreeze.")
    .option("--drain", "Also drain all ETH to owner address (use when machine compromise is suspected)")
    .option("--json")
    .action(async (opts) => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      const guardianKey = loadGuardianKey(config);
      if (!guardianKey) {
        console.error(`Guardian key not found. Expected at ~/.arc402/guardian.key (or guardianPrivateKey in config for legacy setups).`);
        process.exit(1);
      }
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const guardianSigner = new ethers.Wallet(guardianKey, provider);
      const walletContract = new ethers.Contract(config.walletContractAddress, ARC402_WALLET_GUARDIAN_ABI, guardianSigner);

      let tx;
      if (opts.drain) {
        console.log("Triggering freeze-and-drain via guardian key...");
        tx = await walletContract.freezeAndDrain();
      } else {
        console.log("Triggering emergency freeze via guardian key...");
        tx = await walletContract.freeze();
      }
      const receipt = await tx.wait();

      if (opts.json) {
        console.log(JSON.stringify({ txHash: receipt.hash, walletAddress: config.walletContractAddress, drained: !!opts.drain }));
      } else {
        console.log(`Wallet ${config.walletContractAddress} is now FROZEN`);
        if (opts.drain) console.log("All ETH drained to owner.");
        console.log(`Tx: ${receipt.hash}`);
        console.log(`\nOwner must unfreeze: arc402 wallet unfreeze`);
      }
    });

  // ─── unfreeze (owner key — requires WalletConnect) ────────────────────────
  //
  // Deliberately uses WalletConnect (phone wallet) so unfreezing requires owner
  // approval from the phone. Guardian can freeze fast; only owner can unfreeze.

  wallet.command("unfreeze")
    .description("Unfreeze wallet contract via owner phone wallet (WalletConnect). Only the owner can unfreeze — guardian cannot.")
    .option("--hardware", "Hardware wallet mode: show raw wc: URI only")
    .option("--json")
    .action(async (opts) => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId) {
        console.error("walletConnectProjectId not set in config. Run `arc402 config set walletConnectProjectId <id>`.");
        process.exit(1);
      }

      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const walletInterface = new ethers.Interface(ARC402_WALLET_GUARDIAN_ABI);

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const { client, session, account } = await connectPhoneWallet(
        config.walletConnectProjectId,
        chainId,
        config,
        { telegramOpts, prompt: "Approve: unfreeze ARC402Wallet", hardware: !!opts.hardware }
      );

      const networkName = chainId === 8453 ? "Base" : "Base Sepolia";
      const shortAddr = `${account.slice(0, 6)}...${account.slice(-5)}`;
      console.log("\n" + c.success + c.white(` Connected: ${shortAddr} on ${networkName}`));
      console.log("\n" + c.dim("Wallet to unfreeze:") + " " + c.white(config.walletContractAddress ?? ""));
      // WalletConnect approval already confirmed intent — sending automatically

      console.log(c.dim("Sending transaction..."));
      const txHash = await sendTransactionWithSession(client, session, account, chainId, {
        to: config.walletContractAddress,
        data: walletInterface.encodeFunctionData("unfreeze", []),
        value: "0x0",
      });

      await provider.waitForTransaction(txHash);
      if (opts.json) {
        console.log(JSON.stringify({ txHash, walletAddress: config.walletContractAddress }));
      } else {
        console.log("\n" + c.success + c.white(` Wallet ${config.walletContractAddress} unfrozen`));
        console.log(" " + c.dim("Tx:") + " " + c.white(txHash));
      }
    });

  // ─── set-guardian ──────────────────────────────────────────────────────────
  //
  // Generates a guardian key locally, then registers it on-chain via the owner's
  // phone wallet (WalletConnect). Guardian changes require owner approval.

  wallet.command("set-guardian")
    .description("Generate a new guardian key and register it on the wallet contract (phone wallet signs via WalletConnect)")
    .option("--guardian-key <key>", "Use an existing private key as the guardian (optional)")
    .option("--hardware", "Hardware wallet mode: show raw wc: URI only")
    .action(async (opts) => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId) {
        console.error("walletConnectProjectId not set in config. Run `arc402 config set walletConnectProjectId <id>`.");
        process.exit(1);
      }

      let guardianWallet: ethers.Wallet;
      if (opts.guardianKey) {
        try {
          guardianWallet = new ethers.Wallet(opts.guardianKey);
        } catch {
          console.error("Invalid guardian key. Must be a 0x-prefixed hex string.");
          process.exit(1);
        }
      } else {
        guardianWallet = new ethers.Wallet(ethers.Wallet.createRandom().privateKey);
        console.log("Generated new guardian key.");
      }

      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const walletInterface = new ethers.Interface(ARC402_WALLET_GUARDIAN_ABI);

      console.log(`\nGuardian address: ${guardianWallet.address}`);
      console.log(`Wallet contract:  ${config.walletContractAddress}`);

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const { client, session, account } = await connectPhoneWallet(
        config.walletConnectProjectId,
        chainId,
        config,
        { telegramOpts, prompt: `Approve: set guardian to ${guardianWallet.address}`, hardware: !!opts.hardware }
      );

      const networkName = chainId === 8453 ? "Base" : "Base Sepolia";
      const shortAddr = `${account.slice(0, 6)}...${account.slice(-5)}`;
      console.log("\n" + c.success + c.white(` Connected: ${shortAddr} on ${networkName}`));
      // WalletConnect approval already confirmed intent — sending automatically

      console.log(c.dim("Sending transaction..."));
      const txHash = await sendTransactionWithSession(client, session, account, chainId, {
        to: config.walletContractAddress,
        data: walletInterface.encodeFunctionData("setGuardian", [guardianWallet.address]),
        value: "0x0",
      });

      await provider.waitForTransaction(txHash);
      saveGuardianKey(guardianWallet.privateKey);
      if (config.guardianPrivateKey) delete (config as unknown as Record<string, unknown>).guardianPrivateKey;
      config.guardianAddress = guardianWallet.address;
      saveConfig(config);
      console.log("\n" + c.success + c.white(` Guardian set to: ${guardianWallet.address}`));
      console.log(" " + c.dim("Tx:") + " " + c.white(txHash));
      console.log(" " + c.dim("Guardian private key saved to ~/.arc402/guardian.key (chmod 400)."));
      console.log(" " + c.warning + " " + c.yellow("The guardian key can freeze your wallet. Store it separately from your hot key."));
    });

  // ─── policy-engine freeze / unfreeze (legacy — for PolicyEngine-level freeze) ──

  wallet.command("freeze-policy <walletAddress>")
    .description("Freeze PolicyEngine spend for a wallet address (authorized freeze agents only)")
    .action(async (walletAddress) => {
      const config = loadConfig();
      if (!config.policyEngineAddress) throw new Error("policyEngineAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new PolicyClient(config.policyEngineAddress, signer);
      await client.freezeSpend(walletAddress);
      console.log(`wallet ${walletAddress} spend frozen (PolicyEngine)`);
    });

  wallet.command("unfreeze-policy <walletAddress>")
    .description("Unfreeze PolicyEngine spend for a wallet. Only callable by the wallet or its registered owner.")
    .action(async (walletAddress) => {
      const config = loadConfig();
      if (!config.policyEngineAddress) throw new Error("policyEngineAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new PolicyClient(config.policyEngineAddress, signer);
      await client.unfreeze(walletAddress);
      console.log(`wallet ${walletAddress} spend unfrozen (PolicyEngine)`);
    });

  // ─── upgrade-registry ──────────────────────────────────────────────────────

  wallet.command("upgrade-registry <newRegistryAddress>")
    .description("Propose a registry upgrade on the ARC402Wallet (2-day timelock, phone wallet signs via WalletConnect)")
    .option("--dry-run", "Show calldata without connecting to wallet")
    .option("--hardware", "Hardware wallet mode: show raw wc: URI only")
    .action(async (newRegistryAddress, opts) => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId && !opts.dryRun) {
        console.error("walletConnectProjectId not set in config. Run `arc402 config set walletConnectProjectId <id>`.");
        process.exit(1);
      }

      let checksumAddress: string;
      try {
        checksumAddress = ethers.getAddress(newRegistryAddress);
      } catch {
        console.error(`Invalid address: ${newRegistryAddress}`);
        process.exit(1);
      }

      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const walletInterface = new ethers.Interface(ARC402_WALLET_REGISTRY_ABI);

      let currentRegistry = "(unknown)";
      try {
        const walletContract = new ethers.Contract(config.walletContractAddress, ARC402_WALLET_REGISTRY_ABI, provider);
        currentRegistry = await walletContract.registry();
      } catch { /* contract may not expose registry() */ }

      // Box: 54-char inner width (║ + 54 + ║ = 56 total)
      const fromPad = currentRegistry.padEnd(42);
      console.log(`\n╔══════════════════════════════════════════════════════╗`);
      console.log(`║     ARC402Wallet Registry Upgrade                    ║`);
      console.log(`╟──────────────────────────────────────────────────────╢`);
      console.log(`║  Wallet:   ${config.walletContractAddress}║`);
      console.log(`║  From:     ${fromPad}║`);
      console.log(`║  To:       ${checksumAddress}║`);
      console.log(`║  Timelock: 2 days (cancelable)                       ║`);
      console.log(`║  Action:   proposeRegistryUpdate()                   ║`);
      console.log(`╚══════════════════════════════════════════════════════╝\n`);

      const calldata = walletInterface.encodeFunctionData("proposeRegistryUpdate", [checksumAddress]);

      if (opts.dryRun) {
        console.log("Calldata (dry-run):");
        console.log(`  To:    ${config.walletContractAddress}`);
        console.log(`  Data:  ${calldata}`);
        console.log(`  Value: 0x0`);
        return;
      }

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const { client, session, account } = await connectPhoneWallet(
        config.walletConnectProjectId!,
        chainId,
        config,
        { telegramOpts, prompt: "Approve registry upgrade proposal on ARC402Wallet", hardware: !!opts.hardware }
      );

      const networkName = chainId === 8453 ? "Base" : "Base Sepolia";
      const shortAddr = `${account.slice(0, 6)}...${account.slice(-5)}`;
      console.log("\n" + c.success + c.white(` Connected: ${shortAddr} on ${networkName}`));

      // WalletConnect approval already confirmed intent — sending automatically

      console.log(c.dim("Sending transaction..."));
      const txHash = await sendTransactionWithSession(client, session, account, chainId, {
        to: config.walletContractAddress,
        data: calldata,
        value: "0x0",
      });

      const unlockAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      console.log("\n" + c.success + c.white(" Registry upgrade proposed"));
      console.log(" " + c.dim("Tx:") + " " + c.white(txHash));
      console.log(" " + c.dim("Unlock at:") + " " + c.white(unlockAt.toISOString()) + c.dim(" (approximately)"));
      console.log(`\nNext steps:`);
      console.log(`  Wait 2 days, then run:`);
      console.log(`  arc402 wallet execute-registry-upgrade`);
      console.log(`\nTo cancel before execution:`);
      console.log(`  arc402 wallet cancel-registry-upgrade`);
    });

  // ─── execute-registry-upgrade ──────────────────────────────────────────────

  wallet.command("execute-registry-upgrade")
    .description("Execute a pending registry upgrade after the 2-day timelock (phone wallet signs via WalletConnect)")
    .action(async () => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId) {
        console.error("walletConnectProjectId not set in config. Run `arc402 config set walletConnectProjectId <id>`.");
        process.exit(1);
      }

      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const walletContract = new ethers.Contract(config.walletContractAddress, ARC402_WALLET_REGISTRY_ABI, provider);

      let pendingRegistry: string;
      let unlockAt: bigint;
      try {
        [pendingRegistry, unlockAt] = await Promise.all([
          walletContract.pendingRegistry(),
          walletContract.registryUpdateUnlockAt(),
        ]);
      } catch (e) {
        console.error("Failed to read pending registry from contract:", e);
        process.exit(1);
      }

      if (pendingRegistry === ethers.ZeroAddress) {
        console.log("No pending registry upgrade.");
        return;
      }

      const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
      if (unlockAt > nowSeconds) {
        const remaining = Number(unlockAt - nowSeconds);
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        console.log(`Timelock not yet elapsed.`);
        console.log(`Pending registry: ${pendingRegistry}`);
        console.log(`Unlocks in: ${hours}h ${minutes}m`);
        console.log(`Unlock at: ${new Date(Number(unlockAt) * 1000).toISOString()}`);
        return;
      }

      console.log(`Pending registry: ${pendingRegistry}`);
      console.log("Timelock elapsed — proceeding with executeRegistryUpdate()");

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const walletInterface = new ethers.Interface(ARC402_WALLET_REGISTRY_ABI);
      const { txHash } = await requestPhoneWalletSignature(
        config.walletConnectProjectId,
        chainId,
        () => ({
          to: config.walletContractAddress!,
          data: walletInterface.encodeFunctionData("executeRegistryUpdate", []),
          value: "0x0",
        }),
        "Approve registry upgrade execution on ARC402Wallet",
        telegramOpts,
        config
      );

      // Wait for tx to confirm, then read back the active registry (J6-02)
      await provider.waitForTransaction(txHash);
      let confirmedRegistry = pendingRegistry;
      try {
        confirmedRegistry = await walletContract.registry();
      } catch { /* use pendingRegistry as fallback */ }

      console.log("\n" + c.success + c.white(" Registry upgrade executed"));
      console.log(" " + c.dim("Tx:") + " " + c.white(txHash));
      console.log(" " + c.dim("New registry:") + " " + c.white(confirmedRegistry));
      if (confirmedRegistry.toLowerCase() === pendingRegistry.toLowerCase()) {
        console.log(`  Registry updated successfully — addresses now resolve through new registry.`);
      } else {
        console.warn(`  WARN: Confirmed registry (${confirmedRegistry}) differs from expected (${pendingRegistry}). Check the transaction.`);
      }
      console.log(`\nVerify contracts resolve correctly with \`arc402 wallet status\``);
    });

  // ─── whitelist-contract ────────────────────────────────────────────────────
  //
  // Adds a contract to the per-wallet DeFi whitelist on PolicyEngine so that
  // executeContractCall can target it. Called directly by the owner (MetaMask)
  // on PolicyEngine — does NOT route through the wallet contract.

  wallet.command("whitelist-contract <target>")
    .description("Whitelist a contract address on PolicyEngine so this wallet can call it via executeContractCall (phone wallet signs via WalletConnect)")
    .option("--hardware", "Hardware wallet mode: show raw wc: URI only")
    .option("--json")
    .action(async (target, opts) => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId) {
        console.error("walletConnectProjectId not set in config.");
        process.exit(1);
      }

      let checksumTarget: string;
      try {
        checksumTarget = ethers.getAddress(target);
      } catch {
        console.error(`Invalid address: ${target}`);
        process.exit(1);
      }

      const policyAddress = config.policyEngineAddress ?? POLICY_ENGINE_DEFAULT;
      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);

      // Check if already whitelisted
      const peAbi = [
        "function whitelistContract(address wallet, address target) external",
        "function isContractWhitelisted(address wallet, address target) external view returns (bool)",
      ];
      const pe = new ethers.Contract(policyAddress, peAbi, provider);
      let alreadyWhitelisted = false;
      try {
        alreadyWhitelisted = await pe.isContractWhitelisted(config.walletContractAddress, checksumTarget);
      } catch { /* ignore */ }

      if (alreadyWhitelisted) {
        console.log(" " + c.success + " " + c.white(checksumTarget) + c.dim(` is already whitelisted for ${config.walletContractAddress}`));
        process.exit(0);
      }

      console.log(`\nWallet:       ${config.walletContractAddress}`);
      console.log(`PolicyEngine: ${policyAddress}`);
      console.log(`Whitelisting: ${checksumTarget}`);

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const policyIface = new ethers.Interface(peAbi);

      const { txHash } = await requestPhoneWalletSignature(
        config.walletConnectProjectId,
        chainId,
        () => ({
          to: policyAddress,
          data: policyIface.encodeFunctionData("whitelistContract", [
            config.walletContractAddress!,
            checksumTarget,
          ]),
          value: "0x0",
        }),
        `Approve: whitelist ${checksumTarget} on PolicyEngine for your wallet`,
        telegramOpts,
        config
      );

      await provider.waitForTransaction(txHash);

      if (opts.json) {
        console.log(JSON.stringify({ ok: true, txHash, wallet: config.walletContractAddress, target: checksumTarget }));
      } else {
        console.log("\n" + c.success + c.white(" Contract whitelisted"));
        renderTree([
          { label: "Tx", value: txHash },
          { label: "Wallet", value: config.walletContractAddress ?? "" },
          { label: "Target", value: checksumTarget, last: true },
        ]);
      }
    });

  // ─── set-interceptor ───────────────────────────────────────────────────────

  wallet.command("set-interceptor <address>")
    .description("Set the authorized X402 interceptor address on ARC402Wallet (phone wallet signs via WalletConnect)")
    .action(async (interceptorAddress) => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId) {
        console.error("walletConnectProjectId not set in config. Run `arc402 config set walletConnectProjectId <id>`.");
        process.exit(1);
      }

      let checksumAddress: string;
      try {
        checksumAddress = ethers.getAddress(interceptorAddress);
      } catch {
        console.error(`Invalid address: ${interceptorAddress}`);
        process.exit(1);
      }

      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const ownerInterface = new ethers.Interface(ARC402_WALLET_OWNER_ABI);

      let currentInterceptor = "(unknown)";
      try {
        const walletContract = new ethers.Contract(config.walletContractAddress, ARC402_WALLET_OWNER_ABI, provider);
        currentInterceptor = await walletContract.authorizedInterceptor();
      } catch { /* contract may not be deployed yet */ }

      console.log(`\nWallet:              ${config.walletContractAddress}`);
      console.log(`Current interceptor: ${currentInterceptor}`);
      console.log(`New interceptor:     ${checksumAddress}`);

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const { txHash } = await requestPhoneWalletSignature(
        config.walletConnectProjectId,
        chainId,
        () => ({
          to: config.walletContractAddress!,
          data: ownerInterface.encodeFunctionData("setAuthorizedInterceptor", [checksumAddress]),
          value: "0x0",
        }),
        `Approve: set X402 interceptor to ${checksumAddress}`,
        telegramOpts,
        config
      );

      await provider.waitForTransaction(txHash);
      console.log("\n" + c.success + c.white(" X402 interceptor updated"));
      console.log(" " + c.dim("Tx:") + " " + c.white(txHash));
      console.log(" " + c.dim("Interceptor:") + " " + c.white(checksumAddress));
    });

  // ─── set-velocity-limit ────────────────────────────────────────────────────

  wallet.command("set-velocity-limit <limit>")
    .description("Set the per-rolling-window ETH velocity limit on ARC402Wallet (limit in ETH, phone wallet signs via WalletConnect)")
    .action(async (limitEth) => {
      const config = loadConfig();
      console.log(`\nNote: ARC-402 has two independent velocity limit layers:`);
      console.log(`  1. Wallet-level (arc402 wallet set-velocity-limit): ETH cap per rolling hour, enforced by ARC402Wallet contract. Breach auto-freezes wallet.`);
      console.log(`  2. PolicyEngine-level (arc402 wallet policy set-daily-limit): Per-category daily cap, enforced by PolicyEngine. Breach returns a soft error without freezing.`);
      console.log(`  Both must be configured for full protection.\n`);
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId) {
        console.error("walletConnectProjectId not set in config. Run `arc402 config set walletConnectProjectId <id>`.");
        process.exit(1);
      }

      let limitWei: bigint;
      try {
        limitWei = ethers.parseEther(limitEth);
      } catch {
        console.error(`Invalid limit: ${limitEth}. Provide a value in ETH (e.g. 0.5)`);
        process.exit(1);
      }

      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const ownerInterface = new ethers.Interface(ARC402_WALLET_OWNER_ABI);

      let currentLimit = "(unknown)";
      try {
        const walletContract = new ethers.Contract(config.walletContractAddress, ARC402_WALLET_OWNER_ABI, provider);
        const raw: bigint = await walletContract.velocityLimit();
        currentLimit = raw === 0n ? "disabled" : `${ethers.formatEther(raw)} ETH`;
      } catch { /* contract may not be deployed yet */ }

      console.log(`\nWallet:         ${config.walletContractAddress}`);
      console.log(`Current limit:  ${currentLimit}`);
      console.log(`New limit:      ${limitEth} ETH (max ETH per rolling window)`);

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const { txHash } = await requestPhoneWalletSignature(
        config.walletConnectProjectId,
        chainId,
        () => ({
          to: config.walletContractAddress!,
          data: ownerInterface.encodeFunctionData("setVelocityLimit", [limitWei]),
          value: "0x0",
        }),
        `Approve: set velocity limit to ${limitEth} ETH`,
        telegramOpts,
        config
      );

      await provider.waitForTransaction(txHash);
      console.log("\n" + c.success + c.white(" Velocity limit updated"));
      console.log(" " + c.dim("Tx:") + " " + c.white(txHash));
      console.log(" " + c.dim("New limit:") + " " + c.white(`${limitEth} ETH per rolling window`));
    });

  // ─── register-policy ───────────────────────────────────────────────────────
  //
  // Calls registerWallet(walletAddress, ownerAddress) on PolicyEngine via
  // executeContractCall on the ARC402Wallet. PolicyEngine requires msg.sender == wallet,
  // so this must go through the wallet contract — not called directly by the owner key.

  wallet.command("register-policy")
    .description("Register this wallet on PolicyEngine (required before spend limits can be set)")
    .option("--hardware", "Hardware wallet mode: show raw wc: URI only")
    .action(async (opts) => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId) {
        console.error("walletConnectProjectId not set in config. Run `arc402 config set walletConnectProjectId <id>`.");
        process.exit(1);
      }
      const policyAddress = config.policyEngineAddress ?? POLICY_ENGINE_DEFAULT;
      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);

      let ownerAddress = config.ownerAddress;
      if (!ownerAddress) {
        // Fallback 1: WalletConnect session account
        if (config.wcSession?.account) {
          ownerAddress = config.wcSession.account;
          console.log(c.dim(`Owner resolved from WalletConnect session: ${ownerAddress}`));
        } else {
          // Fallback 2: call owner() on the wallet contract
          try {
            const walletOwnerContract = new ethers.Contract(
              config.walletContractAddress!,
              ["function owner() external view returns (address)"],
              provider,
            );
            ownerAddress = await walletOwnerContract.owner();
            console.log(c.dim(`Owner resolved from contract: ${ownerAddress}`));
          } catch {
            console.error("ownerAddress not set in config and could not be resolved from contract or WalletConnect session.");
            process.exit(1);
          }
        }
      }

      // Encode registerWallet(wallet, owner) calldata — called on PolicyEngine
      const policyInterface = new ethers.Interface([
        "function registerWallet(address wallet, address owner) external",
      ]);
      const registerCalldata = policyInterface.encodeFunctionData("registerWallet", [
        config.walletContractAddress,
        ownerAddress,
      ]);

      const executeInterface = new ethers.Interface(ARC402_WALLET_EXECUTE_ABI);

      console.log(`\nWallet:       ${config.walletContractAddress}`);
      console.log(`PolicyEngine: ${policyAddress}`);
      console.log(`Owner:        ${ownerAddress}`);

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const { txHash } = await requestPhoneWalletSignature(
        config.walletConnectProjectId,
        chainId,
        () => ({
          to: config.walletContractAddress!,
          data: executeInterface.encodeFunctionData("executeContractCall", [{
            target: policyAddress,
            data: registerCalldata,
            value: 0n,
            minReturnValue: 0n,
            maxApprovalAmount: 0n,
            approvalToken: ethers.ZeroAddress,
          }]),
          value: "0x0",
        }),
        `Approve: register wallet on PolicyEngine`,
        telegramOpts,
        config
      );

      await provider.waitForTransaction(txHash);
      console.log("\n" + c.success + c.white(" Wallet registered on PolicyEngine"));
      console.log(" " + c.dim("Tx:") + " " + c.white(txHash));
      console.log(c.dim("\nNext: run 'arc402 wallet policy set-limit' to configure spending limits."));
    });

  // ─── cancel-registry-upgrade ───────────────────────────────────────────────

  wallet.command("cancel-registry-upgrade")
    .description("Cancel a pending registry upgrade before it executes (phone wallet signs via WalletConnect)")
    .action(async () => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId) {
        console.error("walletConnectProjectId not set in config. Run `arc402 config set walletConnectProjectId <id>`.");
        process.exit(1);
      }

      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const walletContract = new ethers.Contract(config.walletContractAddress, ARC402_WALLET_REGISTRY_ABI, provider);

      let pendingRegistry: string;
      let unlockAtCancel: bigint = 0n;
      try {
        [pendingRegistry, unlockAtCancel] = await Promise.all([
          walletContract.pendingRegistry(),
          walletContract.registryUpdateUnlockAt().catch(() => 0n),
        ]);
      } catch (e) {
        console.error("Failed to read pending registry from contract:", e);
        process.exit(1);
      }

      if (pendingRegistry === ethers.ZeroAddress) {
        console.log("No pending registry upgrade to cancel.");
        return;
      }

      const nowSecondsCancel = BigInt(Math.floor(Date.now() / 1000));
      const unlockDateCancel = unlockAtCancel > 0n
        ? new Date(Number(unlockAtCancel) * 1000).toISOString()
        : "(unknown)";
      const timelockStatus = unlockAtCancel > nowSecondsCancel
        ? `ACTIVE — executes at ${unlockDateCancel}`
        : `ELAPSED at ${unlockDateCancel} — execution window open`;

      console.log(`\nPending registry upgrade:`);
      console.log(`  Pending address: ${pendingRegistry}`);
      console.log(`  Timelock:        ${timelockStatus}`);
      console.log(`\nCancelling pending registry upgrade to: ${pendingRegistry}`);

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const walletInterface = new ethers.Interface(ARC402_WALLET_REGISTRY_ABI);
      const { txHash } = await requestPhoneWalletSignature(
        config.walletConnectProjectId,
        chainId,
        () => ({
          to: config.walletContractAddress!,
          data: walletInterface.encodeFunctionData("cancelRegistryUpdate", []),
          value: "0x0",
        }),
        "Approve registry upgrade cancellation on ARC402Wallet",
        telegramOpts,
        config
      );

      console.log("\n" + c.success + c.white(" Registry upgrade cancelled"));
      console.log(" " + c.dim("Tx:") + " " + c.white(txHash));
    });

  // ─── governance setup ──────────────────────────────────────────────────────
  //
  // Interactive wizard that collects velocity limit, guardian key, and category
  // limits in one session, then batches all transactions through a single
  // WalletConnect session (wallet_sendCalls if supported, else sequential).

  const governance = wallet.command("governance").description("Wallet governance management");

  governance.command("setup")
    .description("Interactive governance setup — velocity limit, guardian key, and spending limits in one WalletConnect session")
    .action(async () => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId) {
        console.error("walletConnectProjectId not set in config. Run `arc402 config set walletConnectProjectId <id>`.");
        process.exit(1);
      }

      const policyAddress = config.policyEngineAddress ?? POLICY_ENGINE_DEFAULT;
      const chainId = config.network === "base-mainnet" ? 8453 : 84532;

      // ── Step 1: velocity limit ────────────────────────────────────────────
      const { velocityEth } = await prompts({
        type: "text",
        name: "velocityEth",
        message: "Velocity limit (max ETH per rolling window)",
        initial: "0.05",
        validate: (v: string) => {
          try { ethers.parseEther(v); return true; } catch { return "Enter a valid ETH amount (e.g. 0.05)"; }
        },
      });
      if (velocityEth === undefined) { console.log("Aborted."); return; }

      // ── Step 2: guardian key ──────────────────────────────────────────────
      const { wantGuardian } = await prompts({
        type: "confirm",
        name: "wantGuardian",
        message: "Set guardian key?",
        initial: true,
      });
      if (wantGuardian === undefined) { console.log("Aborted."); return; }

      let guardianWallet: ethers.Wallet | null = null;
      if (wantGuardian) {
        guardianWallet = new ethers.Wallet(ethers.Wallet.createRandom().privateKey);
        console.log(`  Generated guardian address: ${guardianWallet.address}`);
      }

      // ── Step 3: spending categories ───────────────────────────────────────
      type CategoryEntry = { category: string; amountEth: string };
      const categories: CategoryEntry[] = [];

      const defaultCategories = [
        { label: "general", default: "0.02" },
        { label: "research", default: "0.05" },
        { label: "compute", default: "0.10" },
      ];

      console.log("\nSpending categories — press Enter to skip any:");

      for (const { label, default: def } of defaultCategories) {
        const { amountRaw } = await prompts({
          type: "text",
          name: "amountRaw",
          message: `  ${label} limit in ETH`,
          initial: def,
        });
        if (amountRaw === undefined) { console.log("Aborted."); return; }
        if (amountRaw.trim() !== "") {
          categories.push({ category: label, amountEth: amountRaw.trim() });
        }
      }

      // Custom categories loop
      while (true) {
        const { customName } = await prompts({
          type: "text",
          name: "customName",
          message: "  Add custom category? [name or Enter to skip]",
          initial: "",
        });
        if (customName === undefined || customName.trim() === "") break;
        const { customAmount } = await prompts({
          type: "text",
          name: "customAmount",
          message: `  ${customName.trim()} limit in ETH`,
          initial: "0.05",
          validate: (v: string) => {
            try { ethers.parseEther(v); return true; } catch { return "Enter a valid ETH amount"; }
          },
        });
        if (customAmount === undefined) { console.log("Aborted."); return; }
        categories.push({ category: customName.trim(), amountEth: customAmount.trim() });
      }

      // ── Step 4: summary ───────────────────────────────────────────────────
      console.log("\n─────────────────────────────────────────────────────");
      console.log("Changes to be made:");
      console.log(`  Wallet:         ${config.walletContractAddress}`);
      console.log(`  Velocity limit: ${velocityEth} ETH per rolling window`);
      if (guardianWallet) {
        console.log(`  Guardian key:   ${guardianWallet.address} (new — private key will be saved to config)`);
      }
      if (categories.length > 0) {
        console.log("  Spending limits:");
        for (const { category, amountEth } of categories) {
          console.log(`    ${category.padEnd(12)} ${amountEth} ETH`);
        }
      }
      console.log(`  Transactions:   ${1 + (guardianWallet ? 1 : 0) + categories.length} + onboarding (registerWallet, enableDefiAccess) total`);
      console.log("─────────────────────────────────────────────────────");

      // ── Step 5: confirm ───────────────────────────────────────────────────
      const { confirmed } = await prompts({
        type: "confirm",
        name: "confirmed",
        message: "Confirm and sign with your wallet?",
        initial: true,
      });
      if (!confirmed) { console.log("Aborted."); return; }

      // ── Step 6: connect WalletConnect once, send all transactions ─────────
      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      console.log("\nConnecting wallet...");
      const { client, session, account } = await connectPhoneWallet(
        config.walletConnectProjectId,
        chainId,
        config,
        { telegramOpts, prompt: "Approve governance setup transactions on ARC402Wallet" }
      );

      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const ownerInterface = new ethers.Interface(ARC402_WALLET_OWNER_ABI);
      const guardianInterface = new ethers.Interface(ARC402_WALLET_GUARDIAN_ABI);
      const policyInterface = new ethers.Interface(POLICY_ENGINE_LIMITS_ABI);
      const executeInterface = new ethers.Interface(ARC402_WALLET_EXECUTE_ABI);
      const govInterface = new ethers.Interface(POLICY_ENGINE_GOVERNANCE_ABI);
      const policyGovContract = new ethers.Contract(policyAddress, POLICY_ENGINE_GOVERNANCE_ABI, provider);

      // Build the list of calls
      type TxCall = { to: string; data: string; value: string };
      const calls: TxCall[] = [];

      // ── P0: mandatory onboarding calls (registerWallet + enableDefiAccess) ──
      // Check what the constructor already did to avoid double-registration reverts
      let govAlreadyRegistered = false;
      let govAlreadyDefiEnabled = false;
      try {
        const registeredOwner: string = await policyGovContract.walletOwners(config.walletContractAddress!);
        govAlreadyRegistered = registeredOwner !== ethers.ZeroAddress;
      } catch { /* assume not registered */ }
      try {
        govAlreadyDefiEnabled = await policyGovContract.defiAccessEnabled(config.walletContractAddress!);
      } catch { /* assume not enabled */ }

      if (!govAlreadyRegistered) {
        const registerCalldata = govInterface.encodeFunctionData("registerWallet", [config.walletContractAddress!, account]);
        calls.push({
          to: config.walletContractAddress!,
          data: executeInterface.encodeFunctionData("executeContractCall", [{
            target: policyAddress,
            data: registerCalldata,
            value: 0n,
            minReturnValue: 0n,
            maxApprovalAmount: 0n,
            approvalToken: ethers.ZeroAddress,
          }]),
          value: "0x0",
        });
      }

      if (!govAlreadyDefiEnabled) {
        calls.push({
          to: policyAddress,
          data: govInterface.encodeFunctionData("enableDefiAccess", [config.walletContractAddress!]),
          value: "0x0",
        });
      }

      // velocity limit
      calls.push({
        to: config.walletContractAddress!,
        data: ownerInterface.encodeFunctionData("setVelocityLimit", [ethers.parseEther(velocityEth)]),
        value: "0x0",
      });

      // guardian
      if (guardianWallet) {
        calls.push({
          to: config.walletContractAddress!,
          data: guardianInterface.encodeFunctionData("setGuardian", [guardianWallet.address]),
          value: "0x0",
        });
      }

      // category limits — called directly on PolicyEngine by owner key
      for (const { category, amountEth } of categories) {
        calls.push({
          to: policyAddress,
          data: policyInterface.encodeFunctionData("setCategoryLimitFor", [
            config.walletContractAddress!,
            category,
            ethers.parseEther(amountEth),
          ]),
          value: "0x0",
        });
      }

      // Try wallet_sendCalls (EIP-5792) first, fall back to sequential eth_sendTransaction
      let txHashes: string[] = [];
      let usedBatch = false;

      try {
        const batchResult = await client.request<{ id: string }>({
          topic: session.topic,
          chainId: `eip155:${chainId}`,
          request: {
            method: "wallet_sendCalls",
            params: [{
              version: "1.0",
              chainId: `0x${chainId.toString(16)}`,
              from: account,
              calls: calls.map(c => ({ to: c.to, data: c.data, value: c.value })),
            }],
          },
        });
        txHashes = [typeof batchResult === "string" ? batchResult : batchResult.id];
        usedBatch = true;
      } catch {
        // wallet_sendCalls not supported — send sequentially
        console.log("  (wallet_sendCalls not supported — sending sequentially)");
        for (let i = 0; i < calls.length; i++) {
          console.log(`  Sending transaction ${i + 1}/${calls.length}...`);
          const txHash = await sendTransactionWithSession(client, session, account, chainId, calls[i]);
          txHashes.push(txHash);
        }
      }

      // Persist guardian key if generated — save to restricted file, not config.json
      if (guardianWallet) {
        saveGuardianKey(guardianWallet.privateKey);
        if (config.guardianPrivateKey) delete (config as unknown as Record<string, unknown>).guardianPrivateKey;
        config.guardianAddress = guardianWallet.address;
        saveConfig(config);
      }

      console.log("\n" + c.success + c.white(" Governance setup complete"));
      if (usedBatch) {
        console.log(" " + c.dim("Batch tx:") + " " + c.white(txHashes[0]));
      } else {
        txHashes.forEach((h, i) => console.log(" " + c.dim(`Tx ${i + 1}:`) + " " + c.white(h)));
      }
      if (guardianWallet) {
        console.log(" " + c.success + c.dim(` Guardian key saved to ~/.arc402/guardian.key — address: ${guardianWallet.address}`));
        console.log(" " + c.warning + " " + c.yellow("Store the guardian private key separately from your hot key."));
      }
      console.log(c.dim("\nVerify with: arc402 wallet status && arc402 wallet policy show"));
    });

  // ─── authorize-machine-key ─────────────────────────────────────────────────

  wallet.command("authorize-machine-key <key>")
    .description("Authorize a machine key (hot key) on your ARC402Wallet (phone wallet signs via WalletConnect)")
    .action(async (keyAddress: string) => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId) {
        console.error("walletConnectProjectId not set in config.");
        process.exit(1);
      }

      let checksumKey: string;
      try {
        checksumKey = ethers.getAddress(keyAddress);
      } catch {
        console.error(`Invalid address: ${keyAddress}`);
        process.exit(1);
      }

      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const machineKeyAbi = ["function authorizeMachineKey(address key) external", "function authorizedMachineKeys(address) external view returns (bool)"];
      const walletContract = new ethers.Contract(config.walletContractAddress, machineKeyAbi, provider);

      let alreadyAuthorized = false;
      try {
        alreadyAuthorized = await walletContract.authorizedMachineKeys(checksumKey);
      } catch { /* ignore */ }

      if (alreadyAuthorized) {
        console.log("\n" + c.success + " " + c.white(checksumKey) + c.dim(` is already authorized as a machine key on ${config.walletContractAddress}`));
        process.exit(0);
      }

      console.log(`\nWallet:      ${config.walletContractAddress}`);
      console.log(`Machine key: ${checksumKey}`);

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const walletInterface = new ethers.Interface(machineKeyAbi);
      const txData = {
        to: config.walletContractAddress,
        data: walletInterface.encodeFunctionData("authorizeMachineKey", [checksumKey]),
        value: "0x0",
      };

      const { client, session, account } = await connectPhoneWallet(
        config.walletConnectProjectId,
        chainId,
        config,
        {
          telegramOpts,
          prompt: `Authorize machine key ${checksumKey} on ARC402Wallet — allows autonomous protocol ops`,
        }
      );

      console.log("\n" + c.success + c.white(` Connected: ${account}`));
      console.log(c.dim("Sending authorizeMachineKey transaction..."));

      const hash = await sendTransactionWithSession(client, session, account, chainId, txData);
      console.log("\n" + c.dim("Transaction submitted:") + " " + c.white(hash));
      console.log(c.dim("Waiting for confirmation..."));

      const receipt = await provider.waitForTransaction(hash, 1, 60000);
      if (!receipt || receipt.status !== 1) {
        console.error(c.failure + " " + c.red("Transaction failed."));
        process.exit(1);
      }

      const confirmed = await walletContract.authorizedMachineKeys(checksumKey);
      console.log("\n" + c.success + c.white(` Machine key authorized: ${confirmed ? "YES" : "NO"}`));
      renderTree([
        { label: "Wallet", value: config.walletContractAddress ?? "" },
        { label: "Machine key", value: checksumKey },
        { label: "Tx", value: hash, last: true },
      ]);

      await client.disconnect({ topic: session.topic, reason: { code: 6000, message: "done" } });
      process.exit(0);
    });

  // ─── revoke-machine-key (J1-04 / J5-01) ───────────────────────────────────
  //
  // Revokes an authorized machine key via owner WalletConnect approval.
  // Pre-checks that the key IS currently authorized before sending.

  wallet.command("revoke-machine-key <address>")
    .description("Revoke an authorized machine key on ARC402Wallet (phone wallet signs via WalletConnect)")
    .action(async (keyAddress: string) => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId) {
        console.error("walletConnectProjectId not set in config.");
        process.exit(1);
      }

      let checksumKey: string;
      try {
        checksumKey = ethers.getAddress(keyAddress);
      } catch {
        console.error(`Invalid address: ${keyAddress}`);
        process.exit(1);
      }

      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const walletContract = new ethers.Contract(config.walletContractAddress, ARC402_WALLET_MACHINE_KEY_ABI, provider);

      // Pre-check: verify the key IS currently authorized
      let isAuthorized = false;
      try {
        isAuthorized = await walletContract.authorizedMachineKeys(checksumKey);
      } catch { /* ignore — attempt revoke anyway */ }

      if (!isAuthorized) {
        console.error(`Machine key ${checksumKey} is NOT currently authorized on ${config.walletContractAddress}.`);
        console.error(`Run \`arc402 wallet list-machine-keys\` to see authorized keys.`);
        process.exit(1);
      }

      console.log(`\nWallet:      ${config.walletContractAddress}`);
      console.log(`Revoking:    ${checksumKey}`);

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const walletInterface = new ethers.Interface(ARC402_WALLET_MACHINE_KEY_ABI);
      const { client, session, account } = await connectPhoneWallet(
        config.walletConnectProjectId,
        chainId,
        config,
        { telegramOpts, prompt: `Revoke machine key ${checksumKey} on ARC402Wallet` }
      );

      console.log("\n" + c.success + c.white(` Connected: ${account}`));
      console.log(c.dim("Sending revokeMachineKey transaction..."));

      const hash = await sendTransactionWithSession(client, session, account, chainId, {
        to: config.walletContractAddress,
        data: walletInterface.encodeFunctionData("revokeMachineKey", [checksumKey]),
        value: "0x0",
      });

      console.log("\n" + c.dim("Transaction submitted:") + " " + c.white(hash));
      console.log(c.dim("Waiting for confirmation..."));

      const receipt = await provider.waitForTransaction(hash, 1, 60000);
      if (!receipt || receipt.status !== 1) {
        console.error(c.failure + " " + c.red("Transaction failed."));
        process.exit(1);
      }

      const stillAuthorized = await walletContract.authorizedMachineKeys(checksumKey);
      console.log("\n" + c.success + c.white(` Machine key revoked: ${stillAuthorized ? "NO (still authorized — check tx)" : "YES"}`));
      renderTree([
        { label: "Wallet", value: config.walletContractAddress ?? "" },
        { label: "Machine key", value: checksumKey },
        { label: "Tx", value: hash, last: true },
      ]);

      await client.disconnect({ topic: session.topic, reason: { code: 6000, message: "done" } });
      process.exit(0);
    });

  // ─── list-machine-keys (J5-02) ─────────────────────────────────────────────
  //
  // Lists authorized machine keys by scanning MachineKeyAuthorized/MachineKeyRevoked
  // events. Falls back to checking the configured machine key if no events found.

  wallet.command("list-machine-keys")
    .description("List authorized machine keys by scanning contract events")
    .option("--json")
    .action(async (opts) => {
      const config = loadConfig();
      const walletAddr = config.walletContractAddress;
      if (!walletAddr) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }

      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const walletContract = new ethers.Contract(walletAddr, ARC402_WALLET_MACHINE_KEY_ABI, provider);

      // Scan for MachineKeyAuthorized and MachineKeyRevoked events
      const authorizedTopic = ethers.id("MachineKeyAuthorized(address)");
      const revokedTopic = ethers.id("MachineKeyRevoked(address)");

      const authorizedKeys = new Set<string>();
      const revokedKeys = new Set<string>();

      try {
        const [authLogs, revokeLogs] = await Promise.all([
          provider.getLogs({ address: walletAddr, topics: [authorizedTopic], fromBlock: 0 }),
          provider.getLogs({ address: walletAddr, topics: [revokedTopic], fromBlock: 0 }),
        ]);
        for (const log of authLogs) {
          const key = ethers.getAddress("0x" + log.topics[1].slice(26));
          authorizedKeys.add(key);
        }
        for (const log of revokeLogs) {
          const key = ethers.getAddress("0x" + log.topics[1].slice(26));
          revokedKeys.add(key);
        }
      } catch { /* event scan failed — fall back to config key */ }

      // Build active key list: authorized but not revoked
      const activeFromEvents = [...authorizedKeys].filter((k) => !revokedKeys.has(k));

      // Also check configured machine key
      const configMachineKey = config.privateKey ? new ethers.Wallet(config.privateKey).address : null;

      // Verify each candidate against chain
      const candidates = new Set<string>(activeFromEvents);
      if (configMachineKey) candidates.add(configMachineKey);

      const results: Array<{ address: string; authorized: boolean }> = [];
      for (const addr of candidates) {
        let authorized = false;
        try {
          authorized = await walletContract.authorizedMachineKeys(addr);
        } catch { /* ignore */ }
        results.push({ address: addr, authorized });
      }

      if (opts.json) {
        console.log(JSON.stringify({ walletAddress: walletAddr, machineKeys: results }, null, 2));
      } else {
        console.log(`\nMachine keys for wallet: ${walletAddr}\n`);
        if (results.length === 0) {
          console.log("  No machine keys found.");
        } else {
          for (const r of results) {
            const status = r.authorized ? "AUTHORIZED" : "not authorized";
            const tag = r.address === configMachineKey ? "  [configured]" : "";
            console.log(`  ${r.address}  ${status}${tag}`);
          }
        }
        console.log(`\nTo authorize: arc402 wallet authorize-machine-key <address>`);
        console.log(`To revoke:    arc402 wallet revoke-machine-key <address>`);
      }
    });

  // ─── open-context (J1-03) ──────────────────────────────────────────────────
  //
  // Standalone command for opening a spend context via machine key.
  // Note: each context allows only one spend — a new context must be opened per payment.

  wallet.command("open-context")
    .description("Open a spend context on the wallet via machine key (each context allows only one spend)")
    .option("--task-type <type>", "Task type string for the context", "general")
    .option("--json")
    .action(async (opts) => {
      const config = loadConfig();
      warnIfPublicRpc(config);
      const walletAddr = config.walletContractAddress;
      if (!walletAddr) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.privateKey) {
        console.error("privateKey not set in config — machine key required for open-context.");
        process.exit(1);
      }

      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const machineKey = new ethers.Wallet(config.privateKey, provider);
      const walletContract = new ethers.Contract(walletAddr, ARC402_WALLET_PROTOCOL_ABI, machineKey);

      // Check context isn't already open
      const isOpen: boolean = await walletContract.contextOpen();
      if (isOpen) {
        console.error("A context is already open on this wallet.");
        console.error("Close it first: arc402 wallet close-context");
        process.exit(1);
      }

      const contextId = ethers.hexlify(ethers.randomBytes(32));
      console.log(`Opening context (taskType: ${opts.taskType})...`);
      const tx = await walletContract.openContext(contextId, opts.taskType);
      const receipt = await tx.wait(1);

      if (opts.json) {
        console.log(JSON.stringify({ walletAddress: walletAddr, contextId, taskType: opts.taskType, txHash: receipt?.hash }));
      } else {
        console.log(" " + c.success + c.white(" Context opened"));
        renderTree([
          { label: "contextId", value: contextId },
          { label: "taskType", value: opts.taskType },
          { label: "Tx", value: receipt?.hash ?? "", last: true },
        ]);
        console.log(c.dim("\nNote: Each context allows only one spend. Call `arc402 wallet attest` then `arc402 wallet drain` (or executeSpend directly)."));
      }
    });

  // ─── attest (J1-03) ────────────────────────────────────────────────────────
  //
  // Standalone command for creating an attestation via machine key.
  // Returns the attestationId for use in executeSpend / drain.

  wallet.command("attest")
    .description("Create an attestation via machine key directly on wallet, returns attestationId")
    .requiredOption("--recipient <addr>", "Recipient address")
    .requiredOption("--amount <eth>", "Amount in ETH")
    .requiredOption("--category <cat>", "Spend category (used as action)")
    .option("--token <addr>", "Token contract address (default: ETH / zero address)")
    .option("--ttl <seconds>", "Attestation TTL in seconds (default: 600)", "600")
    .option("--json")
    .action(async (opts) => {
      const config = loadConfig();
      warnIfPublicRpc(config);
      const walletAddr = config.walletContractAddress;
      if (!walletAddr) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.privateKey) {
        console.error("privateKey not set in config — machine key required for attest.");
        process.exit(1);
      }

      let checksumRecipient: string;
      try {
        checksumRecipient = ethers.getAddress(opts.recipient);
      } catch {
        console.error(`Invalid recipient address: ${opts.recipient}`);
        process.exit(1);
      }

      const tokenAddress = opts.token ? ethers.getAddress(opts.token) : ethers.ZeroAddress;
      const amount = ethers.parseEther(opts.amount);
      const expiresAt = Math.floor(Date.now() / 1000) + parseInt(opts.ttl, 10);
      const attestationId = ethers.hexlify(ethers.randomBytes(32));

      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const machineKey = new ethers.Wallet(config.privateKey, provider);
      const walletContract = new ethers.Contract(walletAddr, ARC402_WALLET_PROTOCOL_ABI, machineKey);

      console.log(`Creating attestation...`);
      const tx = await walletContract.attest(
        attestationId,
        opts.category,
        `cli attest: ${opts.category} to ${checksumRecipient}`,
        checksumRecipient,
        amount,
        tokenAddress,
        expiresAt,
      );
      const receipt = await tx.wait(1);

      if (opts.json) {
        console.log(JSON.stringify({
          walletAddress: walletAddr,
          attestationId,
          recipient: checksumRecipient,
          amount: opts.amount,
          token: tokenAddress,
          category: opts.category,
          expiresAt,
          txHash: receipt?.hash,
        }));
      } else {
        console.log(" " + c.success + c.white(" Attestation created"));
        renderTree([
          { label: "attestationId", value: attestationId },
          { label: "recipient", value: checksumRecipient },
          { label: "amount", value: opts.amount + " ETH" },
          { label: "token", value: tokenAddress === ethers.ZeroAddress ? "ETH" : tokenAddress },
          { label: "expiresAt", value: new Date(expiresAt * 1000).toISOString() },
          { label: "Tx", value: receipt?.hash ?? "", last: true },
        ]);
        console.log(c.dim("\nUse this attestationId in `arc402 wallet drain` or your spend flow."));
      }
    });

  // ─── velocity-status (J8-03) ───────────────────────────────────────────────
  //
  // Read-only: shows wallet-level velocity limit, window start, cumulative spend, and remaining.

  wallet.command("velocity-status")
    .description("Show wallet-level velocity limit, current window spend, and remaining budget")
    .option("--json")
    .action(async (opts) => {
      const config = loadConfig();
      const walletAddr = config.walletContractAddress;
      if (!walletAddr) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }

      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const walletContract = new ethers.Contract(walletAddr, ARC402_WALLET_OWNER_ABI, provider);

      let velocityLimit = 0n;
      let velocityWindowStart = 0n;
      let cumulativeSpend = 0n;

      try {
        [velocityLimit, velocityWindowStart, cumulativeSpend] = await Promise.all([
          walletContract.velocityLimit(),
          walletContract.velocityWindowStart(),
          walletContract.cumulativeSpend(),
        ]);
      } catch (e) {
        console.error("Failed to read velocity data from wallet:", e instanceof Error ? e.message : String(e));
        process.exit(1);
      }

      const remaining = velocityLimit === 0n ? null : (velocityLimit > cumulativeSpend ? velocityLimit - cumulativeSpend : 0n);
      const windowStartDate = velocityWindowStart === 0n ? null : new Date(Number(velocityWindowStart) * 1000);

      if (opts.json) {
        console.log(JSON.stringify({
          walletAddress: walletAddr,
          velocityLimit: ethers.formatEther(velocityLimit),
          velocityLimitEnabled: velocityLimit > 0n,
          velocityWindowStart: windowStartDate?.toISOString() ?? null,
          cumulativeSpend: ethers.formatEther(cumulativeSpend),
          remaining: remaining !== null ? ethers.formatEther(remaining) : null,
        }, null, 2));
      } else {
        console.log(`\nWallet velocity status: ${walletAddr}\n`);
        if (velocityLimit === 0n) {
          console.log(`  Velocity limit: disabled (set with \`arc402 wallet set-velocity-limit <eth>\`)`);
        } else {
          console.log(`  Limit:          ${ethers.formatEther(velocityLimit)} ETH per rolling window`);
          console.log(`  Window start:   ${windowStartDate?.toISOString() ?? "(no window yet)"}`);
          console.log(`  Spent:          ${ethers.formatEther(cumulativeSpend)} ETH`);
          console.log(`  Remaining:      ${remaining !== null ? ethers.formatEther(remaining) + " ETH" : "N/A"}`);
        }
      }
    });

  // ─── check-context ─────────────────────────────────────────────────────────
  //
  // P1 guardrail: inspect on-chain context state before attempting openContext.

  wallet.command("check-context")
    .description("Check whether the wallet's spend context is currently open (uses Alchemy RPC)")
    .option("--json")
    .action(async (opts) => {
      const config = loadConfig();
      warnIfPublicRpc(config);
      const walletAddr = config.walletContractAddress;
      if (!walletAddr) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const walletContract = new ethers.Contract(walletAddr, ARC402_WALLET_PROTOCOL_ABI, provider);
      const isOpen: boolean = await walletContract.contextOpen();
      if (opts.json) {
        console.log(JSON.stringify({ walletAddress: walletAddr, contextOpen: isOpen }));
      } else {
        console.log(`Wallet:       ${walletAddr}`);
        console.log(`contextOpen:  ${isOpen ? "OPEN — close before opening a new context" : "closed"}`);
      }
    });

  // ─── close-context ─────────────────────────────────────────────────────────
  //
  // P1 guardrail: force-close a stale context that was left open by a failed operation.
  // Uses the machine key (config.privateKey) — onlyOwnerOrMachineKey.

  wallet.command("close-context")
    .description("Force-close a stale open context on the wallet (machine key signs — onlyOwnerOrMachineKey)")
    .option("--json")
    .action(async (opts) => {
      const config = loadConfig();
      warnIfPublicRpc(config);
      const walletAddr = config.walletContractAddress;
      if (!walletAddr) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.privateKey) {
        console.error("privateKey not set in config — machine key required for close-context.");
        process.exit(1);
      }
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const machineKey = new ethers.Wallet(config.privateKey, provider);
      const walletContract = new ethers.Contract(walletAddr, ARC402_WALLET_PROTOCOL_ABI, machineKey);

      const isOpen: boolean = await walletContract.contextOpen();
      if (!isOpen) {
        if (opts.json) {
          console.log(JSON.stringify({ walletAddress: walletAddr, contextOpen: false, action: "nothing — already closed" }));
        } else {
          console.log("Context is already closed — nothing to do.");
        }
        return;
      }

      console.log("Closing stale context...");
      const tx = await walletContract.closeContext();
      const receipt = await tx.wait(2);
      if (opts.json) {
        console.log(JSON.stringify({ walletAddress: walletAddr, txHash: receipt?.hash, contextOpen: false }));
      } else {
        console.log(" " + c.success + c.white(" Context closed"));
        console.log(" " + c.dim("Tx:") + " " + c.white(receipt?.hash ?? ""));
        console.log(" " + c.dim("Wallet:") + " " + c.white(walletAddr));
      }
    });

  // ─── drain ─────────────────────────────────────────────────────────────────
  //
  // P1 + BUG-DRAIN-06: full autonomous drain via machine key.
  // Flow: check context → close if stale → openContext → attest (direct) → executeSpend → closeContext
  // All transactions signed by machine key (onlyOwnerOrMachineKey). No WalletConnect needed.

  wallet.command("drain")
    .description("Drain ETH from wallet contract to recipient via machine key (openContext → attest → executeSpend → closeContext). Note: each context allows exactly one spend — a new context is opened per call.")
    .argument("[recipient]", "Recipient address (defaults to config.ownerAddress)")
    .option("--amount <eth>", "Amount to drain in ETH (default: all minus 0.00005 ETH gas reserve)")
    .option("--category <cat>", "Spend category (default: general)", "general")
    .option("--json")
    .action(async (recipientArg: string | undefined, opts) => {
      const config = loadConfig();
      warnIfPublicRpc(config);

      const walletAddr = config.walletContractAddress;
      if (!walletAddr) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.privateKey) {
        console.error("privateKey not set in config — machine key required for drain.");
        process.exit(1);
      }

      const recipient = recipientArg ?? config.ownerAddress;
      if (!recipient) {
        console.error("No recipient address. Pass a recipient argument or set ownerAddress in config.");
        process.exit(1);
      }

      let checksumRecipient: string;
      try {
        checksumRecipient = ethers.getAddress(recipient);
      } catch {
        console.error(`Invalid recipient address: ${recipient}`);
        process.exit(1);
      }

      const GAS_RESERVE = ethers.parseEther("0.00005");
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const machineKey = new ethers.Wallet(config.privateKey, provider);
      const walletContract = new ethers.Contract(walletAddr, ARC402_WALLET_PROTOCOL_ABI, machineKey);

      // ── Pre-flight checks ──────────────────────────────────────────────────
      const balance = await provider.getBalance(walletAddr);
      console.log(`Wallet balance: ${ethers.formatEther(balance)} ETH`);

      if (balance <= GAS_RESERVE) {
        console.error(`Insufficient balance: ${ethers.formatEther(balance)} ETH — need more than ${ethers.formatEther(GAS_RESERVE)} ETH reserve`);
        process.exit(1);
      }

      // Check category is configured on PolicyEngine
      const policyAddress = config.policyEngineAddress ?? POLICY_ENGINE_DEFAULT;
      const policyContract = new ethers.Contract(policyAddress, POLICY_ENGINE_LIMITS_ABI, provider);
      const categoryLimit: bigint = await policyContract.categoryLimits(walletAddr, opts.category);
      if (categoryLimit === 0n) {
        console.error(`Category "${opts.category}" is not configured on PolicyEngine for this wallet.`);
        console.error(`Fix: arc402 wallet policy set-limit --category ${opts.category} --amount <eth>`);
        process.exit(1);
      }

      // Verify machine key is authorized
      const machineKeyAbi = ["function authorizedMachineKeys(address) external view returns (bool)"];
      const walletCheck = new ethers.Contract(walletAddr, machineKeyAbi, provider);
      let isAuthorized = false;
      try {
        isAuthorized = await walletCheck.authorizedMachineKeys(machineKey.address);
      } catch { /* older wallet — assume authorized */ isAuthorized = true; }
      if (!isAuthorized) {
        console.error(`Machine key ${machineKey.address} is not authorized on wallet ${walletAddr}`);
        console.error(`Fix: arc402 wallet authorize-machine-key ${machineKey.address}`);
        process.exit(1);
      }

      // Compute drain amount
      let drainAmount: bigint;
      if (opts.amount) {
        drainAmount = ethers.parseEther(opts.amount);
      } else {
        drainAmount = balance - GAS_RESERVE;
      }

      if (drainAmount > categoryLimit) {
        console.warn(`WARN: drainAmount (${ethers.formatEther(drainAmount)} ETH) exceeds category limit (${ethers.formatEther(categoryLimit)} ETH)`);
        console.warn(`  Capping at category limit.`);
        drainAmount = categoryLimit;
      }

      console.log(`\nDrain plan:`);
      console.log(`  Wallet:    ${walletAddr}`);
      console.log(`  Recipient: ${checksumRecipient}`);
      console.log(`  Amount:    ${ethers.formatEther(drainAmount)} ETH`);
      console.log(`  Category:  ${opts.category}`);
      console.log(`  MachineKey: ${machineKey.address}`);
      console.log(`\nNote: Each context allows exactly one spend. A new context is opened for each drain call.\n`);

      // ── Step 1: context cleanup ────────────────────────────────────────────
      const isOpen: boolean = await walletContract.contextOpen();
      if (isOpen) {
        console.log(c.dim("Stale context found — closing it first..."));
        const closeTx = await walletContract.closeContext();
        await closeTx.wait(2);
        console.log(" " + c.success + c.dim(` Closed: ${closeTx.hash}`));
      }

      // ── Step 2: openContext ────────────────────────────────────────────────
      const contextId = ethers.keccak256(ethers.toUtf8Bytes(`drain-${Date.now()}`));
      console.log(c.dim("Opening context..."));
      const openTx = await walletContract.openContext(contextId, "drain");
      const openReceipt = await openTx.wait(1);
      console.log(" " + c.success + c.dim(` openContext: ${openReceipt?.hash}`));

      // ── Step 3: attest (direct on wallet — onlyOwnerOrMachineKey, NOT via executeContractCall)
      const attestationId = ethers.hexlify(ethers.randomBytes(32));
      const expiry = Math.floor(Date.now() / 1000) + 600; // 10 min TTL
      console.log(c.dim("Creating attestation (direct on wallet)..."));
      const attestTx = await walletContract.attest(
        attestationId,
        "spend",
        `drain to ${checksumRecipient}`,
        checksumRecipient,
        drainAmount,
        ethers.ZeroAddress,
        expiry,
      );
      const attestReceipt = await attestTx.wait(1);
      console.log(" " + c.success + c.dim(` attest: ${attestReceipt?.hash}`));

      // ── Step 4: executeSpend ───────────────────────────────────────────────
      console.log(c.dim("Executing spend..."));
      let spendReceiptHash: string | undefined;
      try {
        const spendTx = await walletContract.executeSpend(
          checksumRecipient,
          drainAmount,
          opts.category,
          attestationId,
        );
        const spendReceipt = await spendTx.wait(1);
        spendReceiptHash = spendReceipt?.hash;
      } catch (e) {
        handleWalletError(e);
      }
      console.log(" " + c.success + c.dim(` executeSpend: ${spendReceiptHash}`));

      // ── Step 5: closeContext ───────────────────────────────────────────────
      console.log(c.dim("Closing context..."));
      const closeTx2 = await walletContract.closeContext();
      const closeReceipt = await closeTx2.wait(1);
      console.log(" " + c.success + c.dim(` closeContext: ${closeReceipt?.hash}`));

      const newBalance = await provider.getBalance(walletAddr);
      if (opts.json) {
        console.log(JSON.stringify({
          ok: true,
          walletAddress: walletAddr,
          recipient: checksumRecipient,
          amount: ethers.formatEther(drainAmount),
          category: opts.category,
          txHashes: {
            openContext: openReceipt?.hash,
            attest: attestReceipt?.hash,
            executeSpend: spendReceiptHash,
            closeContext: closeReceipt?.hash,
          },
          remainingBalance: ethers.formatEther(newBalance),
        }));
      } else {
        console.log("\n" + c.success + c.white(" Drain complete"));
        renderTree([
          { label: "Sent", value: `${ethers.formatEther(drainAmount)} ETH → ${checksumRecipient}` },
          { label: "Remaining", value: `${ethers.formatEther(newBalance)} ETH`, last: true },
        ]);
      }
    });

  // ─── drain-token ───────────────────────────────────────────────────────────
  //
  // ERC-20 token drain via machine key (J1-07).
  // Flow: check context → close if stale → openContext → attest (with token address)
  //       → executeTokenSpend → closeContext
  // Note: Each context can only be used for one spend. A new context must be opened
  // for each payment.

  wallet.command("drain-token")
    .description("Drain ERC-20 tokens from wallet contract to recipient via machine key (openContext → attest → executeTokenSpend → closeContext). Note: each context allows exactly one spend.")
    .argument("<recipient>", "Recipient address")
    .argument("<amount>", "Token amount in human units (e.g. 1.5 for 1.5 USDC)")
    .requiredOption("--token <address>", "ERC-20 token contract address (or 'usdc' for configured USDC address)")
    .option("--category <cat>", "Spend category (default: general)", "general")
    .option("--decimals <n>", "Token decimals override (default: auto-detect from contract)", "auto")
    .option("--json")
    .action(async (recipientArg: string, amountArg: string, opts) => {
      const config = loadConfig();
      warnIfPublicRpc(config);

      const walletAddr = config.walletContractAddress;
      if (!walletAddr) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.privateKey) {
        console.error("privateKey not set in config — machine key required for drain-token.");
        process.exit(1);
      }

      // Resolve token address
      let tokenAddress: string;
      if (opts.token.toLowerCase() === "usdc") {
        tokenAddress = getUsdcAddress(config);
      } else {
        try {
          tokenAddress = ethers.getAddress(opts.token);
        } catch {
          console.error(`Invalid token address: ${opts.token}`);
          process.exit(1);
        }
      }

      let checksumRecipient: string;
      try {
        checksumRecipient = ethers.getAddress(recipientArg);
      } catch {
        console.error(`Invalid recipient address: ${recipientArg}`);
        process.exit(1);
      }

      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const machineKey = new ethers.Wallet(config.privateKey, provider);

      // Determine token decimals
      const erc20Abi = [
        "function decimals() external view returns (uint8)",
        "function balanceOf(address owner) external view returns (uint256)",
      ];
      const erc20 = new ethers.Contract(tokenAddress, erc20Abi, provider);

      let decimals: number;
      if (opts.decimals !== "auto") {
        decimals = parseInt(opts.decimals, 10);
      } else {
        try {
          decimals = Number(await erc20.decimals());
        } catch {
          decimals = 18;
        }
      }

      let tokenAmount: bigint;
      try {
        tokenAmount = ethers.parseUnits(amountArg, decimals);
      } catch {
        console.error(`Invalid amount: ${amountArg}. Provide a decimal value (e.g. 1.5).`);
        process.exit(1);
      }

      // Check token balance
      const tokenBalance: bigint = await erc20.balanceOf(walletAddr);
      if (tokenBalance < tokenAmount) {
        console.error(`Insufficient token balance: ${ethers.formatUnits(tokenBalance, decimals)} < ${amountArg}`);
        process.exit(1);
      }

      // Check category is configured on PolicyEngine
      const policyAddressT = config.policyEngineAddress ?? POLICY_ENGINE_DEFAULT;
      const policyContractT = new ethers.Contract(policyAddressT, POLICY_ENGINE_LIMITS_ABI, provider);
      const categoryLimitT: bigint = await policyContractT.categoryLimits(walletAddr, opts.category);
      if (categoryLimitT === 0n) {
        console.error(`Category "${opts.category}" is not configured on PolicyEngine for this wallet.`);
        console.error(`Fix: arc402 wallet policy set-limit --category ${opts.category} --amount <eth>`);
        process.exit(1);
      }

      // Verify machine key is authorized
      const mkAbi = ["function authorizedMachineKeys(address) external view returns (bool)"];
      const walletCheckT = new ethers.Contract(walletAddr, mkAbi, provider);
      let isAuthorizedT = false;
      try {
        isAuthorizedT = await walletCheckT.authorizedMachineKeys(machineKey.address);
      } catch { isAuthorizedT = true; }
      if (!isAuthorizedT) {
        console.error(`Machine key ${machineKey.address} is not authorized on wallet ${walletAddr}`);
        console.error(`Fix: arc402 wallet authorize-machine-key ${machineKey.address}`);
        process.exit(1);
      }

      const walletContractT = new ethers.Contract(walletAddr, ARC402_WALLET_PROTOCOL_ABI, machineKey);

      console.log(`\nDrain token plan:`);
      console.log(`  Wallet:     ${walletAddr}`);
      console.log(`  Recipient:  ${checksumRecipient}`);
      console.log(`  Amount:     ${amountArg} (${tokenAmount.toString()} units)`);
      console.log(`  Token:      ${tokenAddress}`);
      console.log(`  Category:   ${opts.category}`);
      console.log(`  MachineKey: ${machineKey.address}`);
      console.log(`\nNote: Each context allows exactly one spend. A new context is opened for each drain-token call.\n`);

      // ── Step 1: context cleanup ──────────────────────────────────────────────
      const isOpenT: boolean = await walletContractT.contextOpen();
      if (isOpenT) {
        console.log(c.dim("Stale context found — closing it first..."));
        const closeTxT = await walletContractT.closeContext();
        await closeTxT.wait(2);
        console.log(" " + c.success + c.dim(` Closed: ${closeTxT.hash}`));
      }

      // ── Step 2: openContext ──────────────────────────────────────────────────
      const contextIdT = ethers.keccak256(ethers.toUtf8Bytes(`drain-token-${Date.now()}`));
      console.log(c.dim("Opening context..."));
      const openTxT = await walletContractT.openContext(contextIdT, "drain");
      const openReceiptT = await openTxT.wait(1);
      console.log(" " + c.success + c.dim(` openContext: ${openReceiptT?.hash}`));

      // ── Step 3: attest with token address ────────────────────────────────────
      const attestationIdT = ethers.hexlify(ethers.randomBytes(32));
      const expiryT = Math.floor(Date.now() / 1000) + 600; // 10 min TTL
      console.log(c.dim("Creating attestation (with token address)..."));
      const attestTxT = await walletContractT.attest(
        attestationIdT,
        "spend",
        `token drain to ${checksumRecipient}`,
        checksumRecipient,
        tokenAmount,
        tokenAddress,
        expiryT,
      );
      const attestReceiptT = await attestTxT.wait(1);
      console.log(" " + c.success + c.dim(` attest: ${attestReceiptT?.hash}`));

      // ── Step 4: executeTokenSpend ────────────────────────────────────────────
      console.log(c.dim("Executing token spend..."));
      const spendTxT = await walletContractT.executeTokenSpend(
        checksumRecipient,
        tokenAmount,
        tokenAddress,
        opts.category,
        attestationIdT,
      );
      const spendReceiptT = await spendTxT.wait(1);
      console.log(" " + c.success + c.dim(` executeTokenSpend: ${spendReceiptT?.hash}`));

      // ── Step 5: closeContext ─────────────────────────────────────────────────
      console.log(c.dim("Closing context..."));
      const closeTxT2 = await walletContractT.closeContext();
      const closeReceiptT = await closeTxT2.wait(1);
      console.log(" " + c.success + c.dim(` closeContext: ${closeReceiptT?.hash}`));

      const newTokenBalance: bigint = await erc20.balanceOf(walletAddr);
      if (opts.json) {
        console.log(JSON.stringify({
          ok: true,
          walletAddress: walletAddr,
          recipient: checksumRecipient,
          amount: amountArg,
          token: tokenAddress,
          category: opts.category,
          txHashes: {
            openContext: openReceiptT?.hash,
            attest: attestReceiptT?.hash,
            executeTokenSpend: spendReceiptT?.hash,
            closeContext: closeReceiptT?.hash,
          },
          remainingTokenBalance: ethers.formatUnits(newTokenBalance, decimals),
        }));
      } else {
        console.log("\n" + c.success + c.white(" Token drain complete"));
        renderTree([
          { label: "Sent", value: `${amountArg} → ${checksumRecipient}` },
          { label: "Token", value: tokenAddress },
          { label: "Remaining", value: ethers.formatUnits(newTokenBalance, decimals), last: true },
        ]);
      }
    });

  // ─── set-passkey ───────────────────────────────────────────────────────────
  //
  // Called after registering a Face ID on app.arc402.xyz/onboard (Step 2).
  // Takes the P256 public key coordinates extracted from the WebAuthn credential
  // and writes them on-chain via ARC402Wallet.setPasskey(bytes32, bytes32).
  // After this call, governance UserOps must carry a P256 signature (Face ID).

  wallet.command("set-passkey <pubKeyX> <pubKeyY>")
    .description("Activate passkey (Face ID) on ARC402Wallet — takes P256 x/y coords from passkey setup (phone wallet signs via WalletConnect)")
    .action(async (pubKeyX: string, pubKeyY: string) => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId) {
        console.error("walletConnectProjectId not set in config.");
        process.exit(1);
      }

      // Validate hex bytes32 format
      const isBytes32Hex = (v: string) => /^0x[0-9a-fA-F]{64}$/.test(v);
      if (!isBytes32Hex(pubKeyX)) {
        console.error(`Invalid pubKeyX: expected 0x-prefixed 32-byte hex, got: ${pubKeyX}`);
        process.exit(1);
      }
      if (!isBytes32Hex(pubKeyY)) {
        console.error(`Invalid pubKeyY: expected 0x-prefixed 32-byte hex, got: ${pubKeyY}`);
        process.exit(1);
      }

      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const walletInterface = new ethers.Interface(ARC402_WALLET_PASSKEY_ABI);

      console.log(`\nWallet:   ${config.walletContractAddress}`);
      console.log(`pubKeyX:  ${pubKeyX}`);
      console.log(`pubKeyY:  ${pubKeyY}`);

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const txData = {
        to: config.walletContractAddress,
        data: walletInterface.encodeFunctionData("setPasskey", [pubKeyX, pubKeyY]),
        value: "0x0",
      };

      const { client, session, account } = await connectPhoneWallet(
        config.walletConnectProjectId,
        chainId,
        config,
        {
          telegramOpts,
          prompt: `Activate passkey (Face ID) on ARC402Wallet — enables P256 governance signing`,
        }
      );

      console.log("\n" + c.success + c.white(` Connected: ${account}`));
      console.log(c.dim("Sending setPasskey transaction..."));

      const hash = await sendTransactionWithSession(client, session, account, chainId, txData);
      console.log("\n" + c.dim("Transaction submitted:") + " " + c.white(hash));
      console.log(c.dim("Waiting for confirmation..."));

      const receipt = await provider.waitForTransaction(hash, 1, 60000);
      if (!receipt || receipt.status !== 1) {
        console.error(c.failure + " " + c.red("Transaction failed."));
        process.exit(1);
      }

      console.log("\n" + c.success + c.white(" Passkey activated on ARC402Wallet"));
      renderTree([
        { label: "Wallet", value: config.walletContractAddress ?? "" },
        { label: "pubKeyX", value: pubKeyX },
        { label: "pubKeyY", value: pubKeyY },
        { label: "Tx", value: hash, last: true },
      ]);
      console.log(c.dim("\nGovernance ops now require Face ID instead of MetaMask."));

      await client.disconnect({ topic: session.topic, reason: { code: 6000, message: "done" } });
      process.exit(0);
    });
}
