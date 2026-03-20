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
const ARENA_POLICY_FILE = path.join(ARC402_DIR, "arena-policy.yaml");
const ARENA_DATA_DIR = path.join(ARC402_DIR, "arena");
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

      // Set up Arena directories and default policy
      if (!fs.existsSync(ARENA_DATA_DIR)) {
        fs.mkdirSync(ARENA_DATA_DIR, { recursive: true });
        for (const sub of ["feed", "profile", "state", "queue"]) {
          fs.mkdirSync(path.join(ARENA_DATA_DIR, sub), { recursive: true });
        }
        console.log("✓ Arena directories created");
      } else {
        console.log("✓ Arena directories exist");
      }

      // Copy default arena policy if not present
      if (!fs.existsSync(ARENA_POLICY_FILE)) {
        const defaultArenaPolicy = path.join(WORKROOM_DIR, "arena-policy.yaml");
        if (fs.existsSync(defaultArenaPolicy)) {
          fs.copyFileSync(defaultArenaPolicy, ARENA_POLICY_FILE);
          console.log("✓ Arena policy: default installed");
        } else {
          console.log("⚠ Arena policy template not found — create manually at " + ARENA_POLICY_FILE);
        }
      } else {
        console.log("✓ Arena policy exists");
      }

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
        // Mount Arena data directory (feed index, profile cache, state, queue)
        "-v", `${ARENA_DATA_DIR}:/workroom/arena:rw`,
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

      // Arena
      const arenaExists = fs.existsSync(ARENA_DATA_DIR);
      const arenaPolicy = fs.existsSync(ARENA_POLICY_FILE);
      console.log(`Arena data:   ${arenaExists ? "✓ " + ARENA_DATA_DIR : "❌ missing (run: arc402 workroom init)"}`);
      console.log(`Arena policy: ${arenaPolicy ? "✓ loaded" : "❌ missing"}`);

      // Arena queue (pending approvals)
      if (arenaExists) {
        const queueDir = path.join(ARENA_DATA_DIR, "queue");
        if (fs.existsSync(queueDir)) {
          const pending = fs.readdirSync(queueDir).filter(f => f.endsWith(".json")).length;
          if (pending > 0) {
            console.log(`Arena queue:  ⚠ ${pending} action(s) awaiting approval`);
          } else {
            console.log(`Arena queue:  ✓ empty`);
          }
        }
      }
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

  // ── worker ─────────────────────────────────────────────────────────────────
  const worker = workroom.command("worker").description("Manage the workroom worker — the agent identity that executes hired tasks.");

  worker
    .command("init")
    .description("Initialize the workroom worker identity and configuration.")
    .option("--name <name>", "Worker display name", "Worker")
    .option("--model <model>", "Preferred LLM model for task execution")
    .action(async (opts) => {
      const workerDir = path.join(ARC402_DIR, "worker");
      const memoryDir = path.join(workerDir, "memory");
      const skillsDir = path.join(workerDir, "skills");

      fs.mkdirSync(memoryDir, { recursive: true });
      fs.mkdirSync(skillsDir, { recursive: true });

      // Generate default worker SOUL.md
      const soulPath = path.join(workerDir, "SOUL.md");
      if (!fs.existsSync(soulPath)) {
        fs.writeFileSync(soulPath, `# Worker Identity — ${opts.name}

You are a professional worker operating under an ARC-402 governed workroom.

## Your role
- Execute hired tasks within governance bounds
- Produce high-quality deliverables on deadline
- Follow the task specification precisely
- Report issues early if the task cannot be completed as specified

## What you have access to
- The task specification from the hiring agreement
- Skills relevant to your registered capabilities
- Accumulated learnings from previous jobs (in memory/learnings.md)
- Network access only to policy-approved hosts

## What you do NOT have access to
- The operator's personal conversations or memory
- The operator's other agents or their state
- Network hosts not in the workroom policy
- Files outside the workroom

## How you learn
After completing each job, reflect on:
- What techniques worked well
- What patterns you noticed in the task
- What domain knowledge you acquired
- What you would do differently next time

Write these learnings concisely. They will be available on your next job.

## Professional standards
- Deliver on time or communicate blockers before the deadline
- Never fabricate data or claim work was done when it wasn't
- If the task is unclear, produce the best interpretation and document assumptions
- Every deliverable must be verifiable against the task spec
`);
        console.log(`✓ Worker SOUL.md created: ${soulPath}`);
      } else {
        console.log(`✓ Worker SOUL.md already exists: ${soulPath}`);
      }

      // Generate default MEMORY.md
      const memoryPath = path.join(workerDir, "MEMORY.md");
      if (!fs.existsSync(memoryPath)) {
        fs.writeFileSync(memoryPath, `# Worker Memory

*Last updated: ${new Date().toISOString().split("T")[0]}*

## Job count: 0
## Total earned: 0 ETH

## Learnings

No jobs completed yet. Learnings will accumulate here as the worker completes hired tasks.
`);
        console.log(`✓ Worker MEMORY.md created: ${memoryPath}`);
      }

      // Generate learnings.md
      const learningsPath = path.join(memoryDir, "learnings.md");
      if (!fs.existsSync(learningsPath)) {
        fs.writeFileSync(learningsPath, `# Accumulated Learnings

*Distilled from completed jobs. Available to the worker on every new task.*

---

No learnings yet. Complete your first hired task to start accumulating expertise.
`);
        console.log(`✓ Learnings file created: ${learningsPath}`);
      }

      // Worker config
      const configPath = path.join(workerDir, "config.json");
      if (!fs.existsSync(configPath)) {
        const config = {
          name: opts.name,
          model: opts.model || "default",
          capabilities: [],
          created: new Date().toISOString(),
          job_count: 0,
          total_earned_eth: "0",
        };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(`✓ Worker config created: ${configPath}`);
      }

      console.log(`\nWorker initialized at: ${workerDir}`);
      console.log("Next: customize the worker SOUL.md and add skills.");
      console.log("  arc402 workroom worker set-soul <file>");
      console.log("  arc402 workroom worker set-skills <dir>");
    });

  worker
    .command("status")
    .description("Show worker identity, job count, learnings, and configuration.")
    .action(async () => {
      const workerDir = path.join(ARC402_DIR, "worker");
      const configPath = path.join(workerDir, "config.json");

      if (!fs.existsSync(configPath)) {
        console.error("Worker not initialized. Run: arc402 workroom worker init");
        process.exit(1);
      }

      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const memoryDir = path.join(workerDir, "memory");
      const jobFiles = fs.existsSync(memoryDir)
        ? fs.readdirSync(memoryDir).filter(f => f.startsWith("job-")).length
        : 0;
      const learningsPath = path.join(memoryDir, "learnings.md");
      const learningsSize = fs.existsSync(learningsPath)
        ? fs.statSync(learningsPath).size
        : 0;
      const skillsDir = path.join(workerDir, "skills");
      const skillCount = fs.existsSync(skillsDir)
        ? fs.readdirSync(skillsDir).length
        : 0;

      console.log("ARC-402 Workroom Worker");
      console.log("───────────────────────");
      console.log(`Name:          ${config.name}`);
      console.log(`Model:         ${config.model}`);
      console.log(`Created:       ${config.created}`);
      console.log(`Jobs done:     ${config.job_count}`);
      console.log(`Job memories:  ${jobFiles}`);
      console.log(`Learnings:     ${learningsSize > 200 ? Math.round(learningsSize / 1024) + " KB" : "empty"}`);
      console.log(`Skills:        ${skillCount}`);
      console.log(`Total earned:  ${config.total_earned_eth} ETH`);
    });

  worker
    .command("set-soul <file>")
    .description("Upload a custom worker SOUL.md.")
    .action(async (file) => {
      if (!fs.existsSync(file)) {
        console.error(`File not found: ${file}`);
        process.exit(1);
      }
      const dest = path.join(ARC402_DIR, "worker", "SOUL.md");
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(file, dest);
      console.log(`✓ Worker SOUL.md updated from: ${file}`);
    });

  worker
    .command("set-skills <dir>")
    .description("Copy skills into the workroom worker.")
    .action(async (dir) => {
      if (!fs.existsSync(dir)) {
        console.error(`Directory not found: ${dir}`);
        process.exit(1);
      }
      const dest = path.join(ARC402_DIR, "worker", "skills");
      fs.mkdirSync(dest, { recursive: true });
      // Copy all files from source to dest
      const files = fs.readdirSync(dir);
      for (const f of files) {
        const src = path.join(dir, f);
        const dst = path.join(dest, f);
        if (fs.statSync(src).isFile()) {
          fs.copyFileSync(src, dst);
        } else if (fs.statSync(src).isDirectory()) {
          // Recursive copy for skill directories
          fs.cpSync(src, dst, { recursive: true });
        }
      }
      console.log(`✓ ${files.length} items copied to worker skills`);
    });

  worker
    .command("memory")
    .description("Show the worker's accumulated learnings.")
    .action(async () => {
      const learningsPath = path.join(ARC402_DIR, "worker", "memory", "learnings.md");
      if (!fs.existsSync(learningsPath)) {
        console.log("No learnings yet. Complete a hired task first.");
        return;
      }
      console.log(fs.readFileSync(learningsPath, "utf-8"));
    });

  worker
    .command("memory-reset")
    .description("Clear the worker's accumulated memory (start fresh).")
    .action(async () => {
      const memoryDir = path.join(ARC402_DIR, "worker", "memory");
      if (fs.existsSync(memoryDir)) {
        const files = fs.readdirSync(memoryDir);
        for (const f of files) fs.unlinkSync(path.join(memoryDir, f));
        fs.writeFileSync(path.join(memoryDir, "learnings.md"), `# Accumulated Learnings\n\n*Reset: ${new Date().toISOString()}*\n\nNo learnings yet.\n`);
      }
      // Reset job count in config
      const configPath = path.join(ARC402_DIR, "worker", "config.json");
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        config.job_count = 0;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      }
      console.log("✓ Worker memory cleared. Starting fresh.");
    });

  // ── receipts + earnings ──────────────────────────────────────────────────
  workroom
    .command("receipts")
    .description("List all execution receipts from completed jobs.")
    .action(async () => {
      const receiptsDir = path.join(ARC402_DIR, "receipts");
      if (!fs.existsSync(receiptsDir)) {
        console.log("No receipts yet.");
        return;
      }
      const files = fs.readdirSync(receiptsDir).filter(f => f.endsWith(".json")).sort();
      if (files.length === 0) {
        console.log("No receipts yet.");
        return;
      }
      console.log(`${files.length} execution receipt(s):\n`);
      for (const f of files) {
        try {
          const receipt = JSON.parse(fs.readFileSync(path.join(receiptsDir, f), "utf-8"));
          const id = receipt.agreement_id || f.replace(".json", "");
          const time = receipt.completed_at || "unknown";
          const hash = receipt.deliverable_hash ? receipt.deliverable_hash.slice(0, 10) + "..." : "—";
          console.log(`  ${id}  ${time}  deliverable: ${hash}`);
        } catch {
          console.log(`  ${f}  (unreadable)`);
        }
      }
    });

  workroom
    .command("receipt <agreementId>")
    .description("Show full execution receipt for a specific job.")
    .action(async (agreementId) => {
      const receiptPath = path.join(ARC402_DIR, "receipts", `${agreementId}.json`);
      if (!fs.existsSync(receiptPath)) {
        console.error(`No receipt found for agreement: ${agreementId}`);
        process.exit(1);
      }
      console.log(fs.readFileSync(receiptPath, "utf-8"));
    });

  workroom
    .command("earnings")
    .description("Show total earnings from completed jobs.")
    .option("--period <period>", "Time period (e.g. 7d, 30d, all)", "all")
    .action(async (opts) => {
      const configPath = path.join(ARC402_DIR, "worker", "config.json");
      if (!fs.existsSync(configPath)) {
        console.log("No worker configured. Run: arc402 workroom worker init");
        return;
      }
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      console.log("ARC-402 Earnings");
      console.log("────────────────");
      console.log(`Total earned:  ${config.total_earned_eth} ETH`);
      console.log(`Jobs completed: ${config.job_count}`);
      if (config.job_count > 0) {
        const avg = (parseFloat(config.total_earned_eth) / config.job_count).toFixed(6);
        console.log(`Average/job:   ${avg} ETH`);
      }
    });

  workroom
    .command("history")
    .description("Show job history with outcomes and earnings.")
    .action(async () => {
      const memoryDir = path.join(ARC402_DIR, "worker", "memory");
      if (!fs.existsSync(memoryDir)) {
        console.log("No job history yet.");
        return;
      }
      const jobFiles = fs.readdirSync(memoryDir).filter(f => f.startsWith("job-")).sort();
      if (jobFiles.length === 0) {
        console.log("No job history yet.");
        return;
      }
      console.log(`${jobFiles.length} completed job(s):\n`);
      for (const f of jobFiles) {
        const content = fs.readFileSync(path.join(memoryDir, f), "utf-8");
        const firstLine = content.split("\n").find(l => l.startsWith("#")) || f;
        console.log(`  ${f.replace(".md", "")}  ${firstLine.replace(/^#+\s*/, "")}`);
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
