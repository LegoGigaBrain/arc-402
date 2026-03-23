import { Command } from "commander";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync, spawn, spawnSync } from "child_process";
import chalk from "chalk";
import prompts from "prompts";
import { ethers } from "ethers";
import { configExists, loadConfig, saveConfig, getSubdomainApi, NETWORK_DEFAULTS } from "../config";
import { startSpinner } from "../ui/spinner";
import { c } from "../ui/colors";
import { AGENT_REGISTRY_ABI } from "../abis";
import { getClient, requireSigner } from "../client";
import { executeContractWriteViaWallet } from "../wallet-router";
import { runCmd, ARC402_DIR } from "../openshell-runtime";
import { getDockerEnvFlags } from "../daemon/credentials";

const DAEMON_PORT = 4402;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
    socket.on("error", () => resolve(false));
    socket.connect(port, "127.0.0.1");
  });
}

function isNgrokInstalled(): boolean {
  try {
    execSync("which ngrok", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Step handlers ────────────────────────────────────────────────────────────

async function stepDaemon(): Promise<boolean> {
  process.stdout.write("Checking relay daemon on port 4402… ");
  const running = await checkPort(DAEMON_PORT);

  if (running) {
    console.log(chalk.green("✓ Daemon running on port 4402"));
    return true;
  }

  console.log(chalk.yellow("not detected"));

  const { start } = await prompts({
    type: "confirm",
    name: "start",
    message: "Start the arc402 relay daemon now?",
    initial: true,
  });

  if (!start) {
    console.log(chalk.dim("  Skipping — continuing without a local daemon."));
    return false;
  }

  // Attempt to start the daemon. Requires a configured wallet address; fall back
  // gracefully if config is missing or the daemon does not answer quickly.
  let address = "0x0000000000000000000000000000000000000000";
  try {
    if (configExists()) {
      const cfg = loadConfig();
      // Prefer the wallet address stored in config (Coinbase / EOA) if available.
      address = (cfg as unknown as Record<string, unknown>).address as string ?? address;
    }
  } catch { /* ignore — best-effort */ }

  console.log(chalk.dim("  Spawning arc402 relay daemon…"));
  const child = spawn(
    "arc402",
    [
      "relay", "daemon", "start",
      "--relay",         `http://localhost:${DAEMON_PORT}`,
      "--address",       address,
      "--poll-interval", "2000",
      "--on-message",    "echo",
    ],
    { detached: true, stdio: "ignore" }
  );
  child.unref();

  await sleep(1500);

  const nowRunning = await checkPort(DAEMON_PORT);
  if (nowRunning) {
    console.log(chalk.green("✓ Daemon running on port 4402"));
    return true;
  }

  console.log(chalk.yellow("  Daemon did not respond on port 4402 yet."));
  console.log(chalk.dim("  If you haven't configured a wallet, run `arc402 config init` first."));
  console.log(chalk.dim("  Then re-run this wizard.\n"));
  return false;
}

async function stepNgrok(): Promise<void> {
  if (!isNgrokInstalled()) {
    console.log(chalk.yellow("\nngrok is not installed. Install it first:\n"));
    console.log(chalk.bold("  macOS (Homebrew)"));
    console.log("    brew install ngrok/ngrok/ngrok\n");
    console.log(chalk.bold("  Linux (apt)"));
    console.log(
      "    curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc \\\n" +
      "      | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null\n" +
      "    echo 'deb https://ngrok-agent.s3.amazonaws.com buster main' \\\n" +
      "      | sudo tee /etc/apt/sources.list.d/ngrok.list\n" +
      "    sudo apt update && sudo apt install ngrok\n"
    );
    console.log(chalk.bold("  Direct download"));
    console.log("    https://ngrok.com/download\n");
    console.log(chalk.dim("After installing, authenticate once:"));
    console.log("    ngrok config add-authtoken <YOUR_TOKEN>\n");
    console.log(chalk.dim("Then expose your relay:"));
    console.log(`    ngrok http ${DAEMON_PORT}\n`);
    console.log(chalk.dim("Re-run this wizard and choose 'I have a public URL already'."));
    return;
  }

  console.log(chalk.cyan(`\nStarting ngrok tunnel → port ${DAEMON_PORT}…`));
  console.log(chalk.dim("  Copy the Forwarding URL shown below and register it with the agent registry."));
  console.log(chalk.dim("  Press Ctrl+C to stop.\n"));

  const ngrok = spawn("ngrok", ["http", String(DAEMON_PORT)], { stdio: "inherit" });
  await new Promise<void>((resolve) => { ngrok.on("exit", () => resolve()); });
}

async function stepSubdomainService(apiBase: string): Promise<void> {
  let subdomain: string | undefined;

  // Keep prompting until the user picks an available name or cancels
  while (true) {
    const result = await prompts({
      type: "text",
      name: "subdomain",
      message: "Choose a subdomain name (e.g. my-agent → my-agent.arc402.xyz):",
      hint: "lowercase letters, numbers, and hyphens only",
      validate: (v: string) =>
        /^[a-z0-9-]+$/.test(v) ? true : "Use lowercase letters, numbers, and hyphens only",
    });

    if (!result.subdomain) return; // user cancelled

    process.stdout.write(chalk.dim(`  Checking availability of ${result.subdomain}.arc402.xyz… `));

    try {
      const checkRes = await fetch(`${apiBase}/check/${result.subdomain}`);
      const checkData = await checkRes.json() as { available?: boolean };

      if (checkData.available) {
        console.log(chalk.green("available"));
        subdomain = result.subdomain;
        break;
      } else {
        console.log(chalk.red("taken"));
        console.log(chalk.dim("  That name is already registered. Try another.\n"));
        // loop and prompt again
      }
    } catch {
      console.log(chalk.yellow("could not check — continuing anyway"));
      subdomain = result.subdomain;
      break;
    }
  }

  if (!subdomain) return;

  console.log(chalk.dim(`\n  Using subdomain API: ${apiBase}`));
  console.log(chalk.dim(`  Registering ${subdomain} …`));

  try {
    const res = await fetch(`${apiBase}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subdomain }),
    });
    const data = await res.json() as { url?: string; error?: string };

    if (!res.ok) {
      console.log(chalk.red(`\n✗ Registration failed: ${data.error ?? res.statusText}`));
      return;
    }

    const endpoint = data.url ?? `https://${subdomain}.arc402.xyz`;
    console.log(chalk.green(`\n✓ Subdomain registered: ${endpoint}`));
    console.log(chalk.dim("\nRegister it with the agent registry:"));
    console.log(`    arc402 agent update --endpoint ${endpoint}`);
  } catch (err) {
    console.log(chalk.red(`\n✗ Request failed: ${err instanceof Error ? err.message : String(err)}`));
  }
}

async function stepManualUrl(): Promise<void> {
  const { url } = await prompts({
    type: "text",
    name: "url",
    message: "Your public endpoint URL:",
    hint: "e.g. https://my-node.example.com",
    validate: (v: string) =>
      v.startsWith("http://") || v.startsWith("https://")
        ? true
        : "Must start with http:// or https://",
  });

  if (!url) return;

  console.log(chalk.green(`\n✓ Public endpoint: ${url}`));
  console.log(chalk.dim("\nRegister it with the agent registry:"));
  console.log(`    arc402 agent update --endpoint ${url}`);
}

async function stepCloudflare(): Promise<void> {
  console.log(chalk.cyan("\nCloudflare Tunnel — quick-start:\n"));
  console.log(chalk.bold("  1. Install cloudflared"));
  console.log("       brew install cloudflare/cloudflare/cloudflared   # macOS");
  console.log("       # Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/\n");
  console.log(chalk.bold("  2. Authenticate"));
  console.log("       cloudflared tunnel login\n");
  console.log(chalk.bold("  3. Create and run a tunnel"));
  console.log("       cloudflared tunnel create arc402-node");
  console.log("       cloudflared tunnel route dns arc402-node <your-subdomain.example.com>");
  console.log(`       cloudflared tunnel run --url http://localhost:${DAEMON_PORT} arc402-node\n`);
  console.log(chalk.dim("Then re-run this wizard and choose 'I have a public URL already'."));
}

// ─── Command registration ─────────────────────────────────────────────────────

export function registerSetupCommands(program: Command): void {
  const setup = program
    .command("setup")
    .description("Onboarding wizards for first-time node operators");

  setup
    .command("transfer-subdomain <subdomain>")
    .description("Transfer a subdomain to your current wallet (verified by shared owner())")
    .action(async (subdomain: string) => {
      let config;
      try {
        config = loadConfig();
      } catch {
        console.log(chalk.red("No config found. Run `arc402 config init` first."));
        process.exit(1);
      }

      const newWalletAddress = config.walletContractAddress;
      if (!newWalletAddress) {
        console.log(chalk.red("No walletContractAddress in config. Run `arc402 config init` first."));
        process.exit(1);
      }

      const apiBase = getSubdomainApi(config);
      const short = newWalletAddress.slice(0, 8) + "…" + newWalletAddress.slice(-4);
      console.log(chalk.bold(`\nTransferring ${subdomain}.arc402.xyz → ${short}\n`));

      let res: Response;
      try {
        res = await fetch(`${apiBase}/transfer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subdomain, newWalletAddress }),
        });
      } catch (e) {
        console.log(chalk.red(`\n✗ Request failed: ${e instanceof Error ? e.message : String(e)}`));
        process.exit(1);
      }

      const data = await res.json() as { status?: string; newWalletAddress?: string; error?: string };

      if (!res.ok) {
        console.log(chalk.red(`\n✗ Transfer failed: ${data.error ?? res.statusText}`));
        process.exit(1);
      }

      console.log(chalk.green(`✅ ${subdomain}.arc402.xyz now points to ${short}`));
    });

  // ── arc402 setup full ─────────────────────────────────────────────────────
  setup
    .command("full")
    .description("Full agent onboarding: prerequisites → wallet → registration → tunnel → workroom")
    .requiredOption("--subdomain <name>", "Subdomain for your agent (e.g. megabrain → megabrain.arc402.xyz)")
    .option("--name <name>", "Agent name for registry", "MyAgent")
    .option("--service-type <type>", "Service type for registry", "ai.assistant")
    .action(async (opts: { subdomain: string; name: string; serviceType: string }) => {
      const subdomain = opts.subdomain.toLowerCase();
      const SETUP_API_BASE = "https://api.arc402.xyz";
      const TUNNEL_TOKEN_PATH = path.join(ARC402_DIR, "tunnel-token");
      const TUNNEL_PID_PATH = path.join(ARC402_DIR, "tunnel.pid");
      const WORKROOM_IMAGE = "arc402-workroom";
      const WORKROOM_CONTAINER = "arc402-workroom";

      console.log(c.brightCyan("\n◈ arc402 setup full\n"));
      console.log(c.dim(`Subdomain: ${subdomain}.arc402.xyz\n`));

      // ── Phase 1: Prerequisites ──────────────────────────────────────────────

      console.log(c.white("Phase 1: Prerequisites"));

      // Node.js >= 18
      const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
      if (nodeMajor < 18) {
        console.error(c.failure + " " + c.red(`Node.js >= 18 required (found ${process.versions.node})`));
        process.exit(1);
      }
      console.log(" " + c.success + c.white(` Node.js ${process.versions.node}`));

      // Docker
      const dockerSpin = startSpinner("Checking Docker…");
      try {
        execSync("docker info", { stdio: "pipe" });
        dockerSpin.succeed("Docker running");
      } catch {
        dockerSpin.fail("Docker not running — start Docker Desktop and try again");
        process.exit(1);
      }

      // cloudflared
      const cfSpin = startSpinner("Checking cloudflared…");
      try {
        execSync("which cloudflared", { stdio: "pipe" });
        cfSpin.succeed("cloudflared installed");
      } catch {
        cfSpin.fail("cloudflared not installed");
        const platform = os.platform();
        if (platform === "darwin") {
          console.log(c.dim("  brew install cloudflare/cloudflare/cloudflared"));
        } else if (platform === "linux") {
          console.log(c.dim("  curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb"));
          console.log(c.dim("  sudo dpkg -i cloudflared.deb"));
        } else {
          console.log(c.dim("  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"));
        }
        process.exit(1);
      }

      // Config + private key
      const cfgSpin = startSpinner("Loading config…");
      if (!configExists()) {
        cfgSpin.fail("No config found — run 'arc402 config init' first");
        process.exit(1);
      }
      const config = loadConfig();
      if (!config.privateKey) {
        cfgSpin.fail("No private key in config — run 'arc402 config init' first");
        process.exit(1);
      }
      cfgSpin.succeed("Config loaded");

      // ── Phase 2: Wallet ─────────────────────────────────────────────────────

      console.log(c.white("\nPhase 2: Wallet"));

      if (!config.walletContractAddress) {
        console.error(" " + c.failure + " " + c.red("No walletContractAddress in config."));
        console.error(c.dim("  Run 'arc402 wallet deploy' first (requires MetaMask/WalletConnect for the owner wallet)."));
        process.exit(1);
      }
      console.log(" " + c.success + c.dim(" Wallet: ") + c.white(config.walletContractAddress));

      const balSpin = startSpinner("Checking wallet balance…");
      let walletBalance: bigint;
      try {
        const { provider: balProvider } = await getClient(config);
        walletBalance = await balProvider.getBalance(config.walletContractAddress);
      } catch (e) {
        balSpin.fail(`Balance check failed: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
      if (walletBalance < ethers.parseEther("0.0005")) {
        balSpin.fail(`Wallet balance too low: ${ethers.formatEther(walletBalance)} ETH (need >= 0.0005)`);
        console.error(c.dim(`  Fund ${config.walletContractAddress} with at least 0.0005 ETH on Base.`));
        process.exit(1);
      }
      balSpin.succeed(`Wallet balance: ${ethers.formatEther(walletBalance)} ETH`);

      // ── Phase 3: Agent Registration ─────────────────────────────────────────

      console.log(c.white("\nPhase 3: Agent Registration"));

      const registryAddress =
        config.agentRegistryV2Address ??
        (NETWORK_DEFAULTS[config.network] as unknown as Record<string, string | undefined>)?.agentRegistryV2Address;
      if (!registryAddress) {
        console.error(" " + c.failure + " " + c.red("agentRegistryV2Address missing in config."));
        console.error(c.dim("  Run: arc402 config set agentRegistryV2Address <address>"));
        process.exit(1);
      }

      const { provider: regProvider, signer } = await requireSigner(config);
      const registry = new ethers.Contract(registryAddress, AGENT_REGISTRY_ABI, regProvider);

      const regCheckSpin = startSpinner("Checking agent registration…");
      let isRegistered = false;
      try {
        isRegistered = await registry.isRegistered(config.walletContractAddress);
      } catch (e) {
        regCheckSpin.fail(`Registry read failed: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }

      if (isRegistered) {
        regCheckSpin.succeed("Already registered in AgentRegistry");
      } else {
        regCheckSpin.update("Registering agent in AgentRegistry…");
        try {
          const tx = await executeContractWriteViaWallet(
            config.walletContractAddress!,
            signer,
            registryAddress,
            AGENT_REGISTRY_ABI,
            "register",
            [opts.name, [], opts.serviceType, `https://${subdomain}.arc402.xyz`, ""],
          );
          await tx.wait();
          regCheckSpin.succeed("Agent registered in AgentRegistry");
        } catch (e) {
          regCheckSpin.fail(`Registration failed: ${e instanceof Error ? e.message : String(e)}`);
          console.error(c.dim("  Try manually: arc402 agent register --name <name> --service-type <type>"));
          process.exit(1);
        }
      }

      // Claim subdomain
      const apiBase = getSubdomainApi(config);
      const subSpin = startSpinner(`Claiming ${subdomain}.arc402.xyz…`);
      try {
        const checkRes = await fetch(`${apiBase}/check/${subdomain}`);
        const checkData = await checkRes.json() as { available?: boolean };
        if (!checkData.available) {
          subSpin.succeed(`${subdomain}.arc402.xyz already claimed`);
        } else {
          const regRes = await fetch(`${apiBase}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subdomain, walletAddress: config.walletContractAddress }),
          });
          const regData = await regRes.json() as { url?: string; error?: string };
          if (!regRes.ok) {
            subSpin.fail(`Subdomain registration failed: ${regData.error ?? regRes.statusText}`);
            process.exit(1);
          }
          subSpin.succeed(`Subdomain registered: ${regData.url ?? `https://${subdomain}.arc402.xyz`}`);
        }
      } catch (e) {
        subSpin.fail(`Failed to claim subdomain: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }

      // ── Phase 4: Tunnel ─────────────────────────────────────────────────────

      console.log(c.white("\nPhase 4: Tunnel"));

      if (!fs.existsSync(TUNNEL_TOKEN_PATH)) {
        const provSpin = startSpinner("Provisioning Cloudflare Tunnel…");
        const wallet = new ethers.Wallet(config.privateKey);
        const walletAddress = config.walletContractAddress || wallet.address;
        const timestamp = Math.floor(Date.now() / 1000);
        const message = `arc402-provision:${subdomain}:${timestamp}`;
        const signature = await wallet.signMessage(message);

        let provRes: Response;
        try {
          provRes = await fetch(`${SETUP_API_BASE}/tunnel/provision`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subdomain, walletAddress, signature, timestamp }),
          });
        } catch {
          provSpin.fail("Failed to reach provisioner API");
          process.exit(1);
        }

        const provData = await provRes.json() as {
          success?: boolean; error?: string; tunnelId?: string; token?: string;
        };

        if (!provData.success || !provData.token) {
          provSpin.fail(`Provisioning failed: ${provData.error || "unknown error"}`);
          process.exit(1);
        }
        provSpin.succeed(`Tunnel created: ${provData.tunnelId}`);

        fs.mkdirSync(ARC402_DIR, { recursive: true });
        fs.writeFileSync(TUNNEL_TOKEN_PATH, provData.token, { mode: 0o600 });
        console.log(" " + c.success + c.white(" Tunnel token saved to ~/.arc402/tunnel-token"));
      } else {
        console.log(" " + c.success + c.white(" Tunnel token already exists"));
      }

      // Save endpoint in config
      const fqdn = `https://${subdomain}.arc402.xyz`;
      saveConfig({ ...config, endpoint: fqdn });

      // Start cloudflared if not already running
      let tunnelAlreadyRunning = false;
      if (fs.existsSync(TUNNEL_PID_PATH)) {
        const existingPid = parseInt(fs.readFileSync(TUNNEL_PID_PATH, "utf-8").trim(), 10);
        try {
          process.kill(existingPid, 0);
          tunnelAlreadyRunning = true;
          console.log(" " + c.success + c.white(` Tunnel already running (PID ${existingPid})`));
        } catch { /* not running */ }
      }

      if (!tunnelAlreadyRunning) {
        const token = fs.readFileSync(TUNNEL_TOKEN_PATH, "utf-8").trim();
        const cfStartSpin = startSpinner("Installing tunnel as a persistent service…");

        // Install as system service so it survives gateway restarts and reboots
        const platform = os.platform();
        let serviceInstalled = false;

        if (platform === "linux") {
          try {
            const cloudflaredPath = execSync("which cloudflared", { stdio: "pipe" }).toString().trim();
            const serviceDir = path.join(os.homedir(), ".config", "systemd", "user");
            const servicePath = path.join(serviceDir, "arc402-tunnel.service");
            fs.mkdirSync(serviceDir, { recursive: true });
            fs.writeFileSync(servicePath, [
              "[Unit]",
              "Description=ARC-402 Cloudflare Tunnel",
              "After=network-online.target",
              "Wants=network-online.target",
              "",
              "[Service]",
              "Type=simple",
              `ExecStart=${cloudflaredPath} tunnel run --token ${token}`,
              "Restart=on-failure",
              "RestartSec=5s",
              "",
              "[Install]",
              "WantedBy=default.target",
            ].join("\n"));
            execSync("systemctl --user daemon-reload", { stdio: "pipe" });
            execSync("systemctl --user enable arc402-tunnel.service", { stdio: "pipe" });
            execSync("systemctl --user start arc402-tunnel.service", { stdio: "pipe" });
            serviceInstalled = true;
          } catch { /* fall through to background */ }
        } else if (platform === "darwin") {
          try {
            const cloudflaredPath = execSync("which cloudflared", { stdio: "pipe" }).toString().trim();
            const plistDir = path.join(os.homedir(), "Library", "LaunchAgents");
            const plistPath = path.join(plistDir, "xyz.arc402.tunnel.plist");
            fs.mkdirSync(plistDir, { recursive: true });
            fs.writeFileSync(plistPath, [
              '<?xml version="1.0" encoding="UTF-8"?>',
              '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
              '<plist version="1.0"><dict>',
              "  <key>Label</key><string>xyz.arc402.tunnel</string>",
              "  <key>ProgramArguments</key>",
              "  <array>",
              `    <string>${cloudflaredPath}</string>`,
              "    <string>tunnel</string><string>run</string><string>--token</string>",
              `    <string>${token}</string>`,
              "  </array>",
              "  <key>RunAtLoad</key><true/>",
              "  <key>KeepAlive</key><true/>",
              "</dict></plist>",
            ].join("\n"));
            execSync(`launchctl load -w "${plistPath}"`, { stdio: "pipe" });
            serviceInstalled = true;
          } catch { /* fall through to background */ }
        }

        if (serviceInstalled) {
          await sleep(3000);
          cfStartSpin.succeed("Tunnel installed as a persistent service — survives reboots and gateway restarts");
        } else {
          // Fallback: plain background process
          cfStartSpin.update("Starting cloudflared in background (service install failed)…");
          const cfChild = spawn("cloudflared", ["tunnel", "run", "--token", token], {
            detached: true,
            stdio: "ignore",
          });
          cfChild.unref();
          fs.writeFileSync(TUNNEL_PID_PATH, String(cfChild.pid));
          await sleep(5000);
          try {
            process.kill(cfChild.pid!, 0);
            cfStartSpin.succeed(`Tunnel running (PID ${cfChild.pid}) — run 'arc402 tunnel start --service' to make it persistent`);
          } catch {
            cfStartSpin.fail("Tunnel process died — run 'arc402 tunnel start --foreground' to see logs");
            process.exit(1);
          }
        }
      }

      // Quick tunnel health check (best-effort — workroom may not be up yet)
      const tunnelHealthSpin = startSpinner(`Checking ${subdomain}.arc402.xyz/health…`);
      try {
        const healthRes = await fetch(`${fqdn}/health`, { signal: AbortSignal.timeout(8000) });
        if (healthRes.ok) {
          tunnelHealthSpin.succeed(`Tunnel reachable: ${subdomain}.arc402.xyz`);
        } else {
          tunnelHealthSpin.stop();
          console.log(" " + c.warning + " " + c.yellow(`Health check returned ${healthRes.status} — workroom not up yet, continuing…`));
        }
      } catch {
        tunnelHealthSpin.stop();
        console.log(" " + c.warning + " " + c.yellow("Tunnel health check timed out — may still be propagating, continuing…"));
      }

      // ── Phase 5: Workroom ───────────────────────────────────────────────────

      console.log(c.white("\nPhase 5: Workroom"));

      // Build image if needed
      const imageRes = runCmd("docker", ["image", "inspect", WORKROOM_IMAGE, "--format", "{{.Id}}"]);
      if (!imageRes.ok) {
        const workroomSrc = path.resolve(__dirname, "..", "..", "..", "workroom");
        if (!fs.existsSync(path.join(workroomSrc, "Dockerfile"))) {
          console.error(" " + c.failure + " " + c.red(`Workroom Dockerfile not found at ${workroomSrc}/Dockerfile`));
          console.error(c.dim("  Run 'arc402 workroom init' manually after this command."));
          process.exit(1);
        }
        const buildSpin = startSpinner("Building workroom Docker image…");
        const buildResult = spawnSync(
          "docker",
          ["build", "-f", path.join(workroomSrc, "Dockerfile"), "-t", WORKROOM_IMAGE, workroomSrc],
          { stdio: "inherit" },
        );
        if (buildResult.status !== 0) {
          buildSpin.fail("Failed to build workroom image");
          process.exit(1);
        }
        buildSpin.succeed("Workroom image built");
      } else {
        console.log(" " + c.success + c.white(" Workroom image exists"));
      }

      // Start container if not running
      const runningRes = runCmd("docker", ["inspect", WORKROOM_CONTAINER, "--format", "{{.State.Running}}"]);
      if (runningRes.ok && runningRes.stdout.trim() === "true") {
        console.log(" " + c.success + c.white(" Workroom already running"));
      } else {
        // Remove stopped container if exists
        const existsRes = runCmd("docker", ["inspect", WORKROOM_CONTAINER, "--format", "{{.State.Status}}"]);
        if (existsRes.ok) {
          runCmd("docker", ["rm", "-f", WORKROOM_CONTAINER]);
        }

        const providerEnvFlags = await getDockerEnvFlags();
        const cliRoot = path.resolve(__dirname, "..", "..", "..");
        const jobsDir = path.join(ARC402_DIR, "jobs");
        const workerDir = path.join(ARC402_DIR, "worker");
        const arenaDir = path.join(ARC402_DIR, "arena");
        for (const d of [jobsDir, workerDir, arenaDir]) {
          fs.mkdirSync(d, { recursive: true });
        }

        const workroomSpin = startSpinner("Starting workroom container…");
        const dockerArgs = [
          "run", "-d",
          "--name", WORKROOM_CONTAINER,
          "--restart", "unless-stopped",
          "--cap-add", "NET_ADMIN",
          "-v", `${ARC402_DIR}:/workroom/.arc402:rw`,
          "-v", `${cliRoot}:/workroom/runtime:ro`,
          "-v", `${jobsDir}:/workroom/jobs:rw`,
          "-v", `${workerDir}:/workroom/worker:rw`,
          "-v", `${arenaDir}:/workroom/arena:rw`,
          "-e", `ARC402_MACHINE_KEY=${config.privateKey}`,
          "-e", `TELEGRAM_BOT_TOKEN=${process.env.TELEGRAM_BOT_TOKEN ?? ""}`,
          "-e", `TELEGRAM_CHAT_ID=${process.env.TELEGRAM_CHAT_ID ?? ""}`,
          "-e", `ARC402_DAEMON_PROCESS=1`,
          "-e", `ARC402_DAEMON_FOREGROUND=1`,
          ...providerEnvFlags,
          "-p", "4402:4402",
          WORKROOM_IMAGE,
        ];

        const startResult = spawnSync("docker", dockerArgs, { stdio: "inherit" });
        if (startResult.status !== 0) {
          workroomSpin.fail("Failed to start workroom container");
          console.error(c.dim("  Check logs: docker logs arc402-workroom"));
          process.exit(1);
        }

        // Wait for daemon health (up to 30s)
        workroomSpin.update("Waiting for daemon to become healthy on :4402…");
        let healthy = false;
        for (let i = 0; i < 15; i++) {
          await sleep(2000);
          try {
            const hr = await fetch("http://localhost:4402/health", { signal: AbortSignal.timeout(2000) });
            if (hr.ok) { healthy = true; break; }
          } catch { /* not ready yet */ }
        }

        if (healthy) {
          workroomSpin.succeed("Workroom daemon healthy on port 4402");
        } else {
          workroomSpin.fail("Daemon did not become healthy in time");
          console.error(c.dim("  Check logs: docker logs arc402-workroom"));
          process.exit(1);
        }
      }

      // ── Phase 6: Final Verify ───────────────────────────────────────────────

      console.log(c.white("\nPhase 6: Verify"));

      const finalSpin = startSpinner(`Verifying ${fqdn}/health…`);
      try {
        const finalRes = await fetch(`${fqdn}/health`, { signal: AbortSignal.timeout(15000) });
        if (finalRes.ok) {
          finalSpin.succeed(`Agent live at ${fqdn}`);
        } else {
          finalSpin.stop();
          console.log(" " + c.warning + " " + c.yellow(`Health check returned ${finalRes.status} — agent may need a moment`));
        }
      } catch {
        finalSpin.stop();
        console.log(" " + c.warning + " " + c.yellow("Final health check timed out — tunnel may still be propagating"));
      }

      // ── Success summary ─────────────────────────────────────────────────────

      console.log("\n" + c.brightCyan("◈ Agent Online") + "\n" + c.dim("─────────────────────────────────────────────"));
      console.log(" " + c.success + c.dim("  Endpoint  ") + c.white(fqdn));
      console.log(" " + c.success + c.dim("  Wallet    ") + c.white(config.walletContractAddress!));
      console.log(" " + c.success + c.dim("  Workroom  ") + c.white("arc402 workroom status"));
      console.log(" " + c.success + c.dim("  Tunnel    ") + c.white("arc402 tunnel status"));
      console.log();
    });

  setup
    .command("endpoint")
    .description(
      "Interactive wizard: start the relay daemon → create a public tunnel → " +
      "get a live, hirable endpoint in under 2 minutes"
    )
    .action(async () => {
      console.log(chalk.bold("\narc402 endpoint setup\n"));

      // ── Step 1: Daemon ───────────────────────────────────────────────────────
      await stepDaemon();

      // Resolve subdomain API base from config (falls back to https://api.arc402.xyz)
      let apiBase = "https://api.arc402.xyz";
      try {
        if (configExists()) {
          apiBase = getSubdomainApi(loadConfig());
        }
      } catch { /* ignore — use default */ }

      // ── Step 2: Exposure method ──────────────────────────────────────────────
      const { method } = await prompts({
        type: "select",
        name: "method",
        message: "How do you want to expose your node to the network?",
        choices: [
          { title: "arc402.xyz subdomain (easiest — free, instant)",  value: "subdomain" },
          { title: "ngrok (free, runs locally)",                       value: "ngrok" },
          { title: "I have a public URL already",                      value: "manual" },
          { title: "Cloudflare Tunnel (advanced)",                     value: "cloudflare" },
          { title: "Skip for now (client-only mode)",                  value: "skip" },
        ],
        initial: 0,
      });

      if (!method) {
        // User hit Ctrl+C
        console.log(chalk.dim("\nSetup cancelled."));
        return;
      }

      // ── Step 3: Handle selection ─────────────────────────────────────────────
      switch (method) {
        case "subdomain":
          await stepSubdomainService(apiBase);
          break;
        case "ngrok":
          await stepNgrok();
          break;
        case "manual":
          await stepManualUrl();
          break;
        case "cloudflare":
          await stepCloudflare();
          break;
        case "skip":
          console.log(chalk.dim(
            "\nRunning in client-only mode — your node won't be discoverable by others."
          ));
          console.log(chalk.dim("Re-run `arc402 setup endpoint` whenever you're ready to go public."));
          break;
      }
    });
}
