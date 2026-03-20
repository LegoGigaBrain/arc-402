import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawnSync, execSync } from "child_process";
import {
  ARC402_DIR,
  runCmd,
} from "../openshell-runtime";
import { DAEMON_LOG, DAEMON_TOML } from "../daemon/config";

// ─── Constants ────────────────────────────────────────────────────────────────

const WORKROOM_IMAGE = "arc402-workroom";
const WORKROOM_CONTAINER = "arc402-workroom";
const POLICY_FILE = path.join(ARC402_DIR, "openshell-policy.yaml");
const WORKROOM_DIR = path.join(__dirname, "..", "..", "..", "workroom"); // relative to cli/dist

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dockerAvailable(): boolean {
  const r = runCmd("docker", ["info", "--format", "{{.ServerVersion}}"]);
  return r.ok;
}

function containerExists(): boolean {
  const r = runCmd("docker", ["inspect", WORKROOM_CONTAINER, "--format", "{{.State.Status}}"]);
  return r.ok;
}

function containerRunning(): boolean {
  const r = runCmd("docker", ["inspect", WORKROOM_CONTAINER, "--format", "{{.State.Running}}"]);
  return r.ok && r.stdout.trim() === "true";
}

function imageExists(): boolean {
  const r = runCmd("docker", ["image", "inspect", WORKROOM_IMAGE, "--format", "{{.Id}}"]);
  return r.ok;
}

function buildImage(): boolean {
  // Find the workroom directory (contains Dockerfile)
  const workroomSrc = path.resolve(__dirname, "..", "..", "..", "workroom");
  if (!fs.existsSync(path.join(workroomSrc, "Dockerfile"))) {
    console.error(`Dockerfile not found at ${workroomSrc}/Dockerfile`);
    return false;
  }
  console.log("Building ARC-402 Workroom image...");
  const result = spawnSync("docker", ["build", "-t", WORKROOM_IMAGE, workroomSrc], {
    stdio: "inherit",
  });
  return result.status === 0;
}

function getPolicyHash(): string {
  if (!fs.existsSync(POLICY_FILE)) return "(no policy file)";
  const content = fs.readFileSync(POLICY_FILE, "utf-8");
  const crypto = require("crypto");
  return "0x" + crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export function registerWorkroomCommands(program: Command): void {
  const workroom = program
    .command("workroom")
    .description("ARC-402 Workroom — governed execution environment for hired work. Your OpenClaw stays on the host; work runs inside the workroom.");

  // ── init ──────────────────────────────────────────────────────────────────
  workroom
    .command("init")
    .description("Create the ARC-402 Workroom: build Docker image, validate policy, prepare runtime bundle.")
    .action(async () => {
      console.log("ARC-402 Workroom Init");
      console.log("─────────────────────");

      // Check Docker
      if (!dockerAvailable()) {
        console.error("Docker is not available. Install Docker Desktop and try again.");
        process.exit(1);
      }
      console.log("✓ Docker available");

      // Check policy file
      if (!fs.existsSync(POLICY_FILE)) {
        console.log("No policy file found. Generating default...");
        // Import and call the existing policy generator
        const { registerOpenShellCommands } = require("./openshell");
        console.log(`Policy file will be generated at: ${POLICY_FILE}`);
        console.log("Run 'arc402 workroom policy preset core-launch' after init to apply defaults.");
      } else {
        console.log(`✓ Policy file: ${POLICY_FILE}`);
      }

      // Check daemon.toml
      if (!fs.existsSync(DAEMON_TOML)) {
        console.error("daemon.toml not found. Run 'arc402 daemon init' first.");
        process.exit(1);
      }
      console.log("✓ daemon.toml found");

      // Build image
      if (!imageExists()) {
        if (!buildImage()) {
          console.error("Failed to build workroom image.");
          process.exit(1);
        }
      }
      console.log(`✓ Image: ${WORKROOM_IMAGE}`);

      // Package CLI runtime for the workroom
      const cliDist = path.resolve(__dirname, "..", "..");
      const cliPackage = path.resolve(__dirname, "..", "..", "..", "package.json");
      if (fs.existsSync(cliDist) && fs.existsSync(cliPackage)) {
        console.log("✓ CLI runtime available for workroom mount");
      } else {
        console.warn("⚠ CLI dist not found — workroom will need runtime bundle");
      }

      console.log("\nWorkroom initialized. Start with: arc402 workroom start");
      console.log(`Policy hash: ${getPolicyHash()}`);
    });

  // ── start ─────────────────────────────────────────────────────────────────
  workroom
    .command("start")
    .description("Start the ARC-402 Workroom (always-on governed container with daemon inside).")
    .action(async () => {
      if (!dockerAvailable()) {
        console.error("Docker is not available.");
        process.exit(1);
      }

      if (containerRunning()) {
        console.log("Workroom is already running.");
        process.exit(0);
      }

      // Remove stopped container if exists
      if (containerExists()) {
        runCmd("docker", ["rm", "-f", WORKROOM_CONTAINER]);
      }

      // Build image if needed
      if (!imageExists()) {
        if (!buildImage()) {
          console.error("Failed to build workroom image.");
          process.exit(1);
        }
      }

      // Resolve secrets from local config
      const machineKey = process.env.ARC402_MACHINE_KEY || "";
      const telegramBot = process.env.TELEGRAM_BOT_TOKEN || "";
      const telegramChat = process.env.TELEGRAM_CHAT_ID || "";

      if (!machineKey) {
        console.error("ARC402_MACHINE_KEY not set in environment.");
        console.error("Export it before starting: export ARC402_MACHINE_KEY=0x...");
        process.exit(1);
      }

      // CLI runtime path
      const cliRoot = path.resolve(__dirname, "..", "..", "..");

      console.log("Starting ARC-402 Workroom...");

      const args = [
        "run", "-d",
        "--name", WORKROOM_CONTAINER,
        "--restart", "unless-stopped",
        "--cap-add", "NET_ADMIN", // Required for iptables
        // Mount config (read-write for daemon state/logs)
        "-v", `${ARC402_DIR}:/workroom/.arc402:rw`,
        // Mount CLI runtime (read-only)
        "-v", `${cliRoot}:/workroom/runtime:ro`,
        // Mount jobs directory
        "-v", `${path.join(ARC402_DIR, "jobs")}:/workroom/jobs:rw`,
        // Inject secrets as env vars
        "-e", `ARC402_MACHINE_KEY=${machineKey}`,
        "-e", `TELEGRAM_BOT_TOKEN=${telegramBot}`,
        "-e", `TELEGRAM_CHAT_ID=${telegramChat}`,
        "-e", `ARC402_DAEMON_PROCESS=1`,
        "-e", `ARC402_DAEMON_FOREGROUND=1`,
        // Expose relay port
        "-p", "4402:4402",
        WORKROOM_IMAGE,
      ];

      const result = spawnSync("docker", args, { stdio: "inherit" });
      if (result.status !== 0) {
        console.error("Failed to start workroom container.");
        process.exit(1);
      }

      // Wait briefly and check health
      spawnSync("sleep", ["2"]);

      if (containerRunning()) {
        console.log("\n✓ ARC-402 Workroom is running");
        console.log(`  Container: ${WORKROOM_CONTAINER}`);
        console.log(`  Policy hash: ${getPolicyHash()}`);
        console.log(`  Relay port: 4402`);
        console.log(`  Logs: arc402 workroom logs`);
      } else {
        console.error("Workroom started but exited immediately. Check logs:");
        console.error("  docker logs arc402-workroom");
        process.exit(1);
      }
    });

  // ── stop ──────────────────────────────────────────────────────────────────
  workroom
    .command("stop")
    .description("Stop the ARC-402 Workroom.")
    .action(async () => {
      if (!containerRunning()) {
        console.log("Workroom is not running.");
        return;
      }
      console.log("Stopping ARC-402 Workroom...");
      runCmd("docker", ["stop", WORKROOM_CONTAINER]);
      console.log("✓ Workroom stopped");
    });

  // ── status ────────────────────────────────────────────────────────────────
  workroom
    .command("status")
    .description("Show ARC-402 Workroom health, policy, and active state.")
    .action(async () => {
      console.log("ARC-402 Workroom Status");
      console.log("───────────────────────");

      // Docker
      if (!dockerAvailable()) {
        console.log("Docker:       ❌ not available");
        return;
      }
      console.log("Docker:       ✓ available");

      // Image
      console.log(`Image:        ${imageExists() ? "✓ " + WORKROOM_IMAGE : "❌ not built (run: arc402 workroom init)"}`);

      // Container
      if (containerRunning()) {
        console.log(`Container:    ✓ running (${WORKROOM_CONTAINER})`);

        // Get container uptime
        const inspect = runCmd("docker", ["inspect", WORKROOM_CONTAINER, "--format", "{{.State.StartedAt}}"]);
        if (inspect.ok) {
          const started = new Date(inspect.stdout.trim());
          const uptime = Math.floor((Date.now() - started.getTime()) / 1000);
          const h = Math.floor(uptime / 3600);
          const m = Math.floor((uptime % 3600) / 60);
          console.log(`Uptime:       ${h}h ${m}m`);
        }

        // Get iptables rule count from inside container
        const rules = runCmd("docker", ["exec", WORKROOM_CONTAINER, "iptables", "-L", "OUTPUT", "-n", "--line-numbers"]);
        if (rules.ok) {
          const ruleCount = rules.stdout.split("\n").filter(l => l.match(/^\d+/)).length;
          console.log(`Network rules: ${ruleCount} iptables rules enforced`);
        }
      } else if (containerExists()) {
        console.log(`Container:    ⚠ stopped (run: arc402 workroom start)`);
      } else {
        console.log(`Container:    ❌ not created (run: arc402 workroom init)`);
      }

      // Policy
      console.log(`Policy file:  ${fs.existsSync(POLICY_FILE) ? "✓ " + POLICY_FILE : "❌ missing"}`);
      console.log(`Policy hash:  ${getPolicyHash()}`);
    });

  // ── logs ──────────────────────────────────────────────────────────────────
  workroom
    .command("logs")
    .description("Tail workroom daemon logs.")
    .option("--follow", "Stream live log output")
    .option("-n, --lines <n>", "Number of lines", "50")
    .action(async (opts) => {
      const args = ["logs"];
      if (opts.follow) args.push("-f");
      args.push("--tail", opts.lines);
      args.push(WORKROOM_CONTAINER);

      spawnSync("docker", args, { stdio: "inherit" });
    });

  // ── shell ─────────────────────────────────────────────────────────────────
  workroom
    .command("shell")
    .description("Open a shell inside the workroom for debugging.")
    .action(async () => {
      if (!containerRunning()) {
        console.error("Workroom is not running.");
        process.exit(1);
      }
      spawnSync("docker", ["exec", "-it", WORKROOM_CONTAINER, "/bin/bash"], {
        stdio: "inherit",
      });
    });

  // ── doctor ────────────────────────────────────────────────────────────────
  workroom
    .command("doctor")
    .description("Diagnose workroom health: Docker, image, container, network, policy, daemon.")
    .action(async () => {
      console.log("ARC-402 Workroom Doctor");
      console.log("───────────────────────");

      const checks: Array<{ label: string; pass: boolean; detail: string }> = [];

      // Docker
      const docker = dockerAvailable();
      checks.push({ label: "Docker", pass: docker, detail: docker ? "available" : "not available — install Docker Desktop" });

      // Image
      const img = imageExists();
      checks.push({ label: "Image", pass: img, detail: img ? WORKROOM_IMAGE : "not built — run: arc402 workroom init" });

      // Container
      const running = containerRunning();
      checks.push({ label: "Container", pass: running, detail: running ? "running" : "not running — run: arc402 workroom start" });

      // Policy
      const policyExists = fs.existsSync(POLICY_FILE);
      checks.push({ label: "Policy file", pass: policyExists, detail: policyExists ? POLICY_FILE : "missing" });

      // daemon.toml
      const daemonCfg = fs.existsSync(DAEMON_TOML);
      checks.push({ label: "daemon.toml", pass: daemonCfg, detail: daemonCfg ? "found" : "missing — run: arc402 daemon init" });

      // Machine key env
      const mk = !!process.env.ARC402_MACHINE_KEY;
      checks.push({ label: "Machine key env", pass: mk, detail: mk ? "set" : "ARC402_MACHINE_KEY not in environment" });

      // Network connectivity (if running)
      if (running) {
        const rpcTest = runCmd("docker", ["exec", WORKROOM_CONTAINER, "curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", "https://mainnet.base.org"]);
        const rpcOk = rpcTest.ok && rpcTest.stdout.trim() !== "000";
        checks.push({ label: "Base RPC from workroom", pass: rpcOk, detail: rpcOk ? `HTTP ${rpcTest.stdout.trim()}` : "FAILED — network policy may be blocking RPC" });
      }

      // Print results
      for (const c of checks) {
        const icon = c.pass ? "✓" : "✗";
        const color = c.pass ? "" : "  ← FIX";
        console.log(`  ${icon} ${c.label}: ${c.detail}${color}`);
      }

      const failures = checks.filter(c => !c.pass);
      if (failures.length === 0) {
        console.log("\n✓ All checks passed. Workroom is healthy.");
      } else {
        console.log(`\n✗ ${failures.length} issue(s) found.`);
      }
    });

  // ── policy (delegate to existing openshell policy commands) ───────────────
  workroom
    .command("policy")
    .description("Manage workroom network policy. Delegates to the existing policy UX.")
    .action(() => {
      console.log("Use the policy subcommands:");
      console.log("  arc402 workroom policy list");
      console.log("  arc402 workroom policy preset <name>");
      console.log("  arc402 workroom policy peer add <host>");
      console.log("  arc402 workroom policy test <host>");
      console.log("  arc402 workroom policy hash");
      console.log("  arc402 workroom policy reload");
      console.log("\nFor now, these delegate to 'arc402 openshell policy' commands.");
      console.log("Full native workroom policy management coming in next release.");
    });

  // ── policy hash ──────────────────────────────────────────────────────────
  const policyCmd = workroom.command("policy-hash")
    .description("Get the SHA-256 hash of the current workroom policy (for AgentRegistry).")
    .action(async () => {
      console.log(getPolicyHash());
    });

  // ── policy test ──────────────────────────────────────────────────────────
  workroom
    .command("policy-test <host>")
    .description("Test if a specific host is reachable from inside the workroom.")
    .action(async (host) => {
      if (!containerRunning()) {
        console.error("Workroom is not running. Start it first: arc402 workroom start");
        process.exit(1);
      }
      console.log(`Testing connectivity to ${host} from inside workroom...`);
      const result = runCmd("docker", [
        "exec", WORKROOM_CONTAINER,
        "curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5",
        `https://${host}`,
      ]);
      if (result.ok && result.stdout.trim() !== "000") {
        console.log(`✓ ${host} is reachable (HTTP ${result.stdout.trim()})`);
      } else {
        console.log(`✗ ${host} is NOT reachable from the workroom`);
        console.log("  This host may not be in the workroom policy.");
        console.log("  Add it with: arc402 openshell policy add <name> <host>");
      }
    });

  // ── policy reload ────────────────────────────────────────────────────────
  workroom
    .command("policy-reload")
    .description("Re-read the policy file and update iptables rules inside the running workroom.")
    .action(async () => {
      if (!containerRunning()) {
        console.error("Workroom is not running.");
        process.exit(1);
      }
      console.log("Reloading workroom policy...");
      // Trigger DNS refresh manually (which re-reads policy and updates iptables)
      const result = runCmd("docker", [
        "exec", WORKROOM_CONTAINER,
        "bash", "-c", "/dns-refresh.sh /workroom/.arc402/openshell-policy.yaml &",
      ]);
      if (result.ok) {
        console.log("✓ Policy reload triggered");
      } else {
        console.error("Failed to reload policy");
      }
    });
}
