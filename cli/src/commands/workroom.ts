import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as http from "http";
import { spawnSync, execSync } from "child_process";
import {
  ARC402_DIR,
  runCmd,
} from "../openshell-runtime";
import { DAEMON_LOG, DAEMON_TOML } from "../daemon/config";
import { CREDENTIALS_PATH, getEnabledProviders, getDockerEnvFlags } from "../daemon/credentials";
import { c } from "../ui/colors";
import { startSpinner } from "../ui/spinner";
import { renderTree } from "../ui/tree";
import { formatAddress } from "../ui/format";

// ─── Daemon lifecycle notify ──────────────────────────────────────────────────

function notifyDaemonWorkroomStatus(
  event: "entered" | "exited" | "job_started" | "job_completed",
  agentAddress?: string,
  jobId?: string,
  port = 4402
): void {
  try {
    // Try to read port from daemon config
    let daemonPort = port;
    if (fs.existsSync(DAEMON_TOML)) {
      try {
        const { loadDaemonConfig } = require("../daemon/config") as typeof import("../daemon/config");
        const cfg = loadDaemonConfig();
        daemonPort = cfg.relay?.listen_port ?? port;
      } catch { /* use default */ }
    }

    const payload = JSON.stringify({
      event,
      agentAddress: agentAddress ?? "",
      jobId,
      timestamp: Date.now(),
    });

    const req = http.request({
      hostname: "127.0.0.1",
      port: daemonPort,
      path: "/workroom/status",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
    });
    req.on("error", () => { /* non-fatal */ });
    req.write(payload);
    req.end();
  } catch { /* non-fatal */ }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WORKROOM_IMAGE = "arc402-workroom";
const WORKROOM_CONTAINER = "arc402-workroom";
const POLICY_FILE = path.join(ARC402_DIR, "openshell-policy.yaml");
const ARENA_POLICY_FILE = path.join(ARC402_DIR, "arena-policy.yaml");
const ARENA_DATA_DIR = path.join(ARC402_DIR, "arena");
// ── Package root resolution ────────────────────────────────────────────────
// In a dev checkout: __dirname = cli/dist/commands → 3 levels up = cli/
// In a global npm install: __dirname = arc402-cli/dist/commands → 2 levels up = arc402-cli/
// We walk upward from __dirname to find the package.json that belongs to arc402-cli.
function findPackageRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 5; i++) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg)) {
      try {
        const p = JSON.parse(fs.readFileSync(pkg, "utf8"));
        if (p.name === "arc402-cli") return dir;
      } catch { /* keep walking */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: assume 2 levels up (global npm layout)
  return path.resolve(startDir, "..", "..");
}
const CLI_PACKAGE_ROOT = findPackageRoot(__dirname);

const WORKROOM_DIR = path.join(CLI_PACKAGE_ROOT, "workroom");
// Template ships at workroom/credentials.template.toml, resolved from cli/dist/commands/
const CREDENTIALS_TEMPLATE = path.resolve(CLI_PACKAGE_ROOT, "workroom", "credentials.template.toml");

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

function getCliVersion(): string {
  return (JSON.parse(fs.readFileSync(path.join(CLI_PACKAGE_ROOT, "package.json"), "utf8")) as { version: string }).version;
}

function imageVersionMatches(): boolean {
  // Check the arc402.cli.version label on the existing image against the current CLI version.
  // Returns false if image is missing, unlabelled, or was built from a different CLI version.
  const r = runCmd("docker", [
    "image", "inspect", WORKROOM_IMAGE,
    "--format", "{{index .Config.Labels \"arc402.cli.version\"}}",
  ]);
  if (!r.ok) return false;
  return r.stdout.trim() === getCliVersion();
}

function buildImage(useGpu = false): boolean {
  // Find the workroom directory (contains Dockerfile)
  const workroomSrc = path.join(CLI_PACKAGE_ROOT, "workroom");
  const dockerfile = useGpu ? "Dockerfile.gpu" : "Dockerfile";
  if (!fs.existsSync(path.join(workroomSrc, dockerfile))) {
    if (useGpu) {
      console.error(`Dockerfile.gpu not found at ${workroomSrc}/Dockerfile.gpu`);
      return false;
    }
    console.error(`Dockerfile not found at ${workroomSrc}/Dockerfile`);
    return false;
  }
  // Pass current CLI version as build arg — installs matching arc402-cli inside the Linux container.
  // Also stamp the version as a label so imageVersionMatches() can detect stale images on future runs.
  const version = getCliVersion();
  console.log(`Building ARC-402 Workroom image (${dockerfile}, arc402-cli@${version})...`);
  const result = spawnSync("docker", [
    "build",
    "--build-arg", `ARC402_CLI_VERSION=${version}`,
    "--label", `arc402.cli.version=${version}`,
    "-f", path.join(workroomSrc, dockerfile),
    "-t", WORKROOM_IMAGE,
    workroomSrc,
  ], { stdio: "inherit" });
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
      console.log(c.brightCyan("ARC-402 Workroom Init"));
      console.log(c.dim("─────────────────────"));

      // Check Docker
      if (!dockerAvailable()) {
        console.error(c.failure + " " + c.red("Docker is not available. Install Docker Desktop and try again."));
        process.exit(1);
      }
      console.log(" " + c.success + c.white(" Docker available"));

      // Check policy file
      if (!fs.existsSync(POLICY_FILE)) {
        console.log(c.dim("No policy file found. Generating default..."));
        // Import and call the existing policy generator
        const { registerOpenShellCommands } = require("./openshell");
        console.log(c.dim(`Policy file will be generated at: ${POLICY_FILE}`));
        console.log(c.dim("Run 'arc402 workroom policy preset core-launch' after init to apply defaults."));
      } else {
        console.log(" " + c.success + c.dim(" Policy file: ") + c.white(POLICY_FILE));
      }

      // Check daemon.toml
      if (!fs.existsSync(DAEMON_TOML)) {
        console.error(c.failure + " " + c.red("daemon.toml not found. Run 'arc402 daemon init' first."));
        process.exit(1);
      }
      console.log(" " + c.success + c.white(" daemon.toml found"));

      // Set up Arena directories and default policy
      if (!fs.existsSync(ARENA_DATA_DIR)) {
        fs.mkdirSync(ARENA_DATA_DIR, { recursive: true });
        for (const sub of ["feed", "profile", "state", "queue"]) {
          fs.mkdirSync(path.join(ARENA_DATA_DIR, sub), { recursive: true });
        }
        console.log(" " + c.success + c.white(" Arena directories created"));
      } else {
        console.log(" " + c.success + c.white(" Arena directories exist"));
      }

      // Copy default arena policy if not present
      if (!fs.existsSync(ARENA_POLICY_FILE)) {
        const defaultArenaPolicy = path.join(WORKROOM_DIR, "arena-policy.yaml");
        if (fs.existsSync(defaultArenaPolicy)) {
          fs.copyFileSync(defaultArenaPolicy, ARENA_POLICY_FILE);
          console.log(" " + c.success + c.white(" Arena policy: default installed"));
        } else {
          console.log(" " + c.warning + " " + c.yellow("Arena policy template not found — create manually at " + ARENA_POLICY_FILE));
        }
      } else {
        console.log(" " + c.success + c.white(" Arena policy exists"));
      }

      // ── Credentials template ──────────────────────────────────────────────
      const workerDir = path.dirname(CREDENTIALS_PATH);
      if (!fs.existsSync(workerDir)) {
        fs.mkdirSync(workerDir, { recursive: true });
      }
      if (!fs.existsSync(CREDENTIALS_PATH)) {
        if (fs.existsSync(CREDENTIALS_TEMPLATE)) {
          fs.copyFileSync(CREDENTIALS_TEMPLATE, CREDENTIALS_PATH);
          console.log(" " + c.success + c.white(" credentials.toml installed at " + CREDENTIALS_PATH));
          console.log(c.dim("   Edit it to enable providers: set enabled = true and export API keys."));
        } else {
          console.log(" " + c.warning + " " + c.yellow("credentials.template.toml not found — skipping credentials setup"));
        }
      } else {
        console.log(" " + c.success + c.white(" credentials.toml found"));
      }

      // ── Provider check + policy integration ──────────────────────────────
      const providers = await getEnabledProviders();
      if (providers.length > 0) {
        console.log(c.dim("\nEnabled providers:"));
        for (const p of providers) {
          const keyStatus = p.hasKey
            ? c.success + c.white(` key found`)
            : c.warning + " " + c.yellow("key MISSING — export " + (p.env ?? ""));
          console.log(`  ${c.dim("Provider:")} ${c.white(p.name)} ${c.dim("(" + p.hosts.join(", ") + ")")} — ${keyStatus}`);
        }

        // Add provider hosts to policy file if it exists
        if (fs.existsSync(POLICY_FILE)) {
          let policy = fs.readFileSync(POLICY_FILE, "utf-8");
          let changed = false;
          for (const p of providers) {
            for (const host of p.hosts) {
              if (!policy.includes(`host: ${host}`)) {
                // Append a new network_policy entry for this provider
                const entry = [
                  `  provider_${p.name}:`,
                  `    name: provider-${p.name}`,
                  `    endpoints:`,
                  `      - host: ${host}`,
                  `        port: 443`,
                  `        protocol: rest`,
                  `        tls: terminate`,
                  `        enforcement: enforce`,
                  `        access: read-write`,
                  `    binaries: *a1`,
                ].join("\n");
                policy += "\n" + entry + "\n";
                changed = true;
              }
            }
          }
          if (changed) {
            fs.writeFileSync(POLICY_FILE, policy, "utf-8");
            console.log(" " + c.success + c.white(" Policy updated with provider hosts"));
          } else {
            console.log(" " + c.success + c.white(" Provider hosts already in policy"));
          }
        } else {
          console.log(c.dim("   (Policy file not yet created — provider hosts will be added on next init after policy setup)"));
        }
      } else if (fs.existsSync(CREDENTIALS_PATH)) {
        console.log(c.dim("   No providers enabled in credentials.toml — edit to enable providers."));
      }

      // Build image — always rebuild on init so native binaries (e.g. better-sqlite3)
      // are compiled for Linux inside the container, not reused from a stale host-built image.
      if (!buildImage()) {
        console.error(c.failure + " " + c.red("Failed to build workroom image."));
        process.exit(1);
      }
      console.log(" " + c.success + c.dim(" Image: ") + c.white(WORKROOM_IMAGE));

      // Package CLI runtime for the workroom
      const cliDist = path.join(CLI_PACKAGE_ROOT, "dist");
      const cliPackage = path.join(CLI_PACKAGE_ROOT, "package.json");
      if (fs.existsSync(cliDist) && fs.existsSync(cliPackage)) {
        console.log(" " + c.success + c.white(" CLI runtime available for workroom mount"));
      } else {
        console.warn(" " + c.warning + " " + c.yellow("CLI dist not found — workroom will need runtime bundle"));
      }

      console.log("\n" + c.success + c.white(" Workroom initialized. Start with: arc402 workroom start"));
      console.log(c.dim("Policy hash: ") + c.white(getPolicyHash()));
    });

  // ── start ─────────────────────────────────────────────────────────────────
  workroom
    .command("start")
    .description("Start the ARC-402 Workroom (always-on governed container with daemon inside).")
    .option("--compute", "Enable GPU compute mode: uses Dockerfile.gpu and passes --gpus all --runtime nvidia to docker run")
    .action(async (opts: { compute?: boolean }) => {
      const useGpu = !!opts.compute;

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

      // Build image if missing or stale (version label mismatch means CLI was upgraded
      // but image still has old Linux-native binaries e.g. better-sqlite3 from a prior build).
      if (!imageExists() || !imageVersionMatches()) {
        if (imageExists() && !imageVersionMatches()) {
          console.log(c.dim(`Workroom image is stale (arc402-cli@${getCliVersion()} installed, image has different version). Rebuilding...`));
        }
        if (!buildImage(useGpu)) {
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

      // Collect provider env flags from credentials.toml
      const providerEnvFlags = await getDockerEnvFlags();

      // CLI runtime path
      const cliRoot = CLI_PACKAGE_ROOT;

      console.log(c.dim("Starting ARC-402 Workroom..."));

      const args = [
        "run", "-d",
        "--name", WORKROOM_CONTAINER,
        "--restart", "unless-stopped",
        "--cap-add", "NET_ADMIN", // Required for iptables
        // GPU pass-through (only when --compute flag is set)
        ...(useGpu ? ["--gpus", "all", "--runtime", "nvidia"] : []),
        // Mount config (read-write for daemon state/logs)
        "-v", `${ARC402_DIR}:/workroom/.arc402:rw`,
        // Mount CLI dist/ as optional dev override (read-only, JS files only — no node_modules).
        // Mounting only dist/ means the container's Linux-compiled native addons (better-sqlite3, etc.)
        // are always used. The host's macOS/Windows node_modules are never visible inside the container.
        // The entrypoint sets NODE_PATH to the container's global arc402-cli node_modules so that
        // requires from the mounted dist/ resolve against Linux-compiled binaries.
        // In production (global npm install), the image has arc402-cli pre-installed; this mount
        // is a no-op if dist/ doesn't exist on the host.
        "-v", `${path.join(cliRoot, "dist")}:/workroom/runtime/dist:ro`,
        // Mount jobs directory
        "-v", `${path.join(ARC402_DIR, "jobs")}:/workroom/jobs:rw`,
        // Mount worker directory (identity, memory, skills, knowledge)
        "-v", `${path.join(ARC402_DIR, "worker")}:/workroom/worker:rw`,
        // Mount Arena data directory (feed index, profile cache, state, queue)
        "-v", `${ARENA_DATA_DIR}:/workroom/arena:rw`,
        // Inject secrets as env vars
        "-e", `ARC402_MACHINE_KEY=${machineKey}`,
        "-e", `TELEGRAM_BOT_TOKEN=${telegramBot}`,
        "-e", `TELEGRAM_CHAT_ID=${telegramChat}`,
        "-e", `ARC402_DAEMON_PROCESS=1`,
        "-e", `ARC402_DAEMON_FOREGROUND=1`,
        // Inject enabled provider API keys (never written to container disk)
        ...providerEnvFlags,
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
        console.log("\n" + c.success + c.white(" ARC-402 Workroom is running"));
        renderTree([
          { label: "Container", value: WORKROOM_CONTAINER },
          { label: "Policy hash", value: getPolicyHash() },
          { label: "Relay port", value: "4402" },
          { label: "Logs", value: "arc402 workroom logs", last: true },
        ]);
        // Notify local daemon of workroom entry
        notifyDaemonWorkroomStatus("entered");
      } else {
        console.error(c.failure + " " + c.red("Workroom started but exited immediately. Check logs:"));
        console.error(c.dim("  docker logs arc402-workroom"));
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
      console.log(c.dim("Stopping ARC-402 Workroom..."));
      // Notify daemon before stopping (daemon may be inside container)
      notifyDaemonWorkroomStatus("exited");
      runCmd("docker", ["stop", WORKROOM_CONTAINER]);
      console.log(" " + c.success + c.white(" Workroom stopped"));
    });

  // ── status ────────────────────────────────────────────────────────────────
  workroom
    .command("status")
    .description("Show ARC-402 Workroom health, policy, and active state.")
    .action(async () => {
      console.log(c.brightCyan("ARC-402 Workroom Status"));
      console.log(c.dim("───────────────────────"));

      // Docker
      if (!dockerAvailable()) {
        console.log(c.dim("Docker:       ") + c.failure + " " + c.red("not available"));
        return;
      }
      console.log(c.dim("Docker:       ") + c.success + c.white(" available"));

      // Image
      if (imageExists()) {
        console.log(c.dim("Image:        ") + c.success + " " + c.white(WORKROOM_IMAGE));
      } else {
        console.log(c.dim("Image:        ") + c.failure + " " + c.red("not built (run: arc402 workroom init)"));
      }

      // Container
      if (containerRunning()) {
        console.log(c.dim("Container:    ") + c.success + c.white(` running (${WORKROOM_CONTAINER})`));

        // Get container uptime
        const inspect = runCmd("docker", ["inspect", WORKROOM_CONTAINER, "--format", "{{.State.StartedAt}}"]);
        if (inspect.ok) {
          const started = new Date(inspect.stdout.trim());
          const uptime = Math.floor((Date.now() - started.getTime()) / 1000);
          const h = Math.floor(uptime / 3600);
          const m = Math.floor((uptime % 3600) / 60);
          console.log(c.dim("Uptime:       ") + c.white(`${h}h ${m}m`));
        }

        // Get iptables rule count from inside container
        const rules = runCmd("docker", ["exec", WORKROOM_CONTAINER, "iptables", "-L", "OUTPUT", "-n", "--line-numbers"]);
        if (rules.ok) {
          const ruleCount = rules.stdout.split("\n").filter(l => l.match(/^\d+/)).length;
          console.log(c.dim("Network rules: ") + c.white(`${ruleCount} iptables rules enforced`));
        }
      } else if (containerExists()) {
        console.log(c.dim("Container:    ") + c.warning + " " + c.yellow("stopped (run: arc402 workroom start)"));
      } else {
        console.log(c.dim("Container:    ") + c.failure + " " + c.red("not created (run: arc402 workroom init)"));
      }

      // Policy
      if (fs.existsSync(POLICY_FILE)) {
        console.log(c.dim("Policy file:  ") + c.success + " " + c.white(POLICY_FILE));
      } else {
        console.log(c.dim("Policy file:  ") + c.failure + " " + c.red("missing"));
      }
      console.log(c.dim("Policy hash:  ") + c.white(getPolicyHash()));

      // Arena
      const arenaExists = fs.existsSync(ARENA_DATA_DIR);
      const arenaPolicy = fs.existsSync(ARENA_POLICY_FILE);
      if (arenaExists) {
        console.log(c.dim("Arena data:   ") + c.success + " " + c.white(ARENA_DATA_DIR));
      } else {
        console.log(c.dim("Arena data:   ") + c.failure + " " + c.red("missing (run: arc402 workroom init)"));
      }
      console.log(c.dim("Arena policy: ") + (arenaPolicy ? c.success + c.white(" loaded") : c.failure + " " + c.red("missing")));

      // Arena queue (pending approvals)
      if (arenaExists) {
        const queueDir = path.join(ARENA_DATA_DIR, "queue");
        if (fs.existsSync(queueDir)) {
          const pending = fs.readdirSync(queueDir).filter(f => f.endsWith(".json")).length;
          if (pending > 0) {
            console.log(c.dim("Arena queue:  ") + c.warning + " " + c.yellow(`${pending} action(s) awaiting approval`));
          } else {
            console.log(c.dim("Arena queue:  ") + c.success + c.white(" empty"));
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
      console.log(c.brightCyan("ARC-402 Workroom Doctor"));
      console.log(c.dim("───────────────────────"));

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
      for (const chk of checks) {
        if (chk.pass) {
          console.log(" " + c.success + " " + c.dim(chk.label + ":") + " " + c.white(chk.detail));
        } else {
          console.log(" " + c.failure + " " + c.dim(chk.label + ":") + " " + c.red(chk.detail) + c.yellow("  ← FIX"));
        }
      }

      const failures = checks.filter(chk => !chk.pass);
      if (failures.length === 0) {
        console.log("\n" + c.success + c.white(" All checks passed. Workroom is healthy."));
      } else {
        console.log("\n" + c.failure + " " + c.red(`${failures.length} issue(s) found.`));
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
      console.log(c.dim(`Testing connectivity to ${host} from inside workroom...`));
      const result = runCmd("docker", [
        "exec", WORKROOM_CONTAINER,
        "curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5",
        `https://${host}`,
      ]);
      if (result.ok && result.stdout.trim() !== "000") {
        console.log(" " + c.success + " " + c.white(host) + c.dim(` is reachable (HTTP ${result.stdout.trim()})`));
      } else {
        console.log(" " + c.failure + " " + c.red(`${host} is NOT reachable from the workroom`));
        console.log(c.dim("  This host may not be in the workroom policy."));
        console.log(c.dim("  Add it with: arc402 openshell policy add <name> <host>"));
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
      const knowledgeDir = path.join(workerDir, "knowledge");
      const datasetsDir = path.join(workerDir, "datasets");

      fs.mkdirSync(memoryDir, { recursive: true });
      fs.mkdirSync(skillsDir, { recursive: true });
      fs.mkdirSync(knowledgeDir, { recursive: true });
      fs.mkdirSync(datasetsDir, { recursive: true });

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
        console.log(" " + c.success + c.dim(` Worker SOUL.md created: ${soulPath}`));
      } else {
        console.log(" " + c.success + c.dim(` Worker SOUL.md already exists: ${soulPath}`));
      }

      // Generate IDENTITY.md
      const identityPath = path.join(workerDir, "IDENTITY.md");
      if (!fs.existsSync(identityPath)) {
        fs.writeFileSync(identityPath, `# Worker Identity
- **Name:** ${opts.name}
- **Emoji:** 🔧
- **Capabilities:** []
- **Model:** ${opts.model || "default"}
- **Created:** ${new Date().toISOString()}

## Specialisation
Describe what this worker specialises in. This is injected into every job prompt.

## Personality
How should this worker communicate? Professional? Casual? Technical?
`);
        console.log(" " + c.success + c.dim(` Worker IDENTITY.md created: ${identityPath}`));
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
        console.log(" " + c.success + c.dim(` Worker MEMORY.md created: ${memoryPath}`));
      }

      // Generate learnings.md
      const learningsPath = path.join(memoryDir, "learnings.md");
      if (!fs.existsSync(learningsPath)) {
        fs.writeFileSync(learningsPath, `# Accumulated Learnings

*Distilled from completed jobs. Available to the worker on every new task.*

---

No learnings yet. Complete your first hired task to start accumulating expertise.
`);
        console.log(" " + c.success + c.dim(` Learnings file created: ${learningsPath}`));
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
        console.log(" " + c.success + c.dim(` Worker config created: ${configPath}`));
      }

      console.log("\n" + c.success + c.white(` Worker initialized at: ${workerDir}`));
      console.log(c.dim("Next: customize the worker SOUL.md and add skills."));
      console.log(c.dim("  arc402 workroom worker set-soul <file>"));
      console.log(c.dim("  arc402 workroom worker set-skills <dir>"));
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

      console.log(c.brightCyan("ARC-402 Workroom Worker"));
      console.log(c.dim("───────────────────────"));
      renderTree([
        { label: "Name", value: config.name },
        { label: "Model", value: config.model },
        { label: "Created", value: config.created },
        { label: "Jobs done", value: String(config.job_count) },
        { label: "Job memories", value: String(jobFiles) },
        { label: "Learnings", value: learningsSize > 200 ? Math.round(learningsSize / 1024) + " KB" : "empty" },
        { label: "Skills", value: String(skillCount) },
        { label: "Total earned", value: config.total_earned_eth + " ETH", last: true },
      ]);
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
      console.log(" " + c.success + c.white(` Worker SOUL.md updated from: ${file}`));
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
      console.log(" " + c.success + c.white(` ${files.length} items copied to worker skills`));
    });

  worker
    .command("set-knowledge <dir>")
    .description("Mount a knowledge directory into the workroom. Contains reference materials, training data, domain docs — anything the worker needs to deliver its services.")
    .action(async (dir) => {
      if (!fs.existsSync(dir)) {
        console.error(`Directory not found: ${dir}`);
        process.exit(1);
      }
      const dest = path.join(ARC402_DIR, "worker", "knowledge");
      fs.mkdirSync(dest, { recursive: true });
      const files = fs.readdirSync(dir);
      let count = 0;
      for (const f of files) {
        const src = path.join(dir, f);
        const dst = path.join(dest, f);
        if (fs.statSync(src).isFile()) {
          fs.copyFileSync(src, dst);
          count++;
        } else if (fs.statSync(src).isDirectory()) {
          fs.cpSync(src, dst, { recursive: true });
          count++;
        }
      }
      console.log(" " + c.success + c.white(` ${count} items copied to worker knowledge`));
      console.log(" " + c.dim("Path:") + " " + c.white(dest));
      console.log(c.dim("  The worker can reference these files during hired tasks."));
      console.log(c.dim("  To update: run this command again with the updated directory."));
    });

  worker
    .command("knowledge")
    .description("List the worker's knowledge directory contents.")
    .action(async () => {
      const knowledgeDir = path.join(ARC402_DIR, "worker", "knowledge");
      if (!fs.existsSync(knowledgeDir)) {
        console.log("No knowledge directory. Add one with: arc402 workroom worker set-knowledge <dir>");
        return;
      }
      const files = fs.readdirSync(knowledgeDir, { recursive: true, withFileTypes: false }) as string[];
      if (files.length === 0) {
        console.log("Knowledge directory is empty.");
        return;
      }
      console.log(`Worker knowledge (${files.length} items):\n`);
      for (const f of fs.readdirSync(knowledgeDir)) {
        const stat = fs.statSync(path.join(knowledgeDir, f));
        const size = stat.isDirectory() ? "dir" : `${(stat.size / 1024).toFixed(1)} KB`;
        console.log(`  ${f.padEnd(40)} ${size}`);
      }
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
      console.log(" " + c.success + c.white(" Worker memory cleared. Starting fresh."));
    });

  // ── token usage ──────────────────────────────────────────────────────────
  workroom
    .command("token-usage [agreementId]")
    .description("Show token usage for a specific agreement or across all jobs.")
    .action(async (agreementId) => {
      const { readUsageReport, formatUsageReport } = require("../daemon/token-metering");

      if (agreementId) {
        const usage = readUsageReport(agreementId);
        if (!usage) {
          console.log(`No token usage data for agreement: ${agreementId}`);
          return;
        }
        console.log(formatUsageReport(usage));
      } else {
        // Aggregate across all receipts
        const receiptsDir = path.join(ARC402_DIR, "receipts");
        if (!fs.existsSync(receiptsDir)) {
          console.log("No receipts yet.");
          return;
        }
        const files = fs.readdirSync(receiptsDir).filter((f: string) => f.endsWith(".json"));
        let totalInput = 0;
        let totalOutput = 0;
        let totalCost = 0;
        let jobsWithUsage = 0;

        for (const f of files) {
          try {
            const receipt = JSON.parse(fs.readFileSync(path.join(receiptsDir, f), "utf-8"));
            if (receipt.token_usage) {
              totalInput += receipt.token_usage.total_input || 0;
              totalOutput += receipt.token_usage.total_output || 0;
              totalCost += receipt.token_usage.estimated_cost_usd || 0;
              jobsWithUsage++;
            }
          } catch { /* skip */ }
        }

        if (jobsWithUsage === 0) {
          console.log("No token usage data in any receipts yet.");
          return;
        }

        console.log("Aggregate Token Usage");
        console.log("─────────────────────");
        console.log(`Jobs with data:  ${jobsWithUsage}`);
        console.log(`Total tokens:    ${(totalInput + totalOutput).toLocaleString()} (${totalInput.toLocaleString()} in / ${totalOutput.toLocaleString()} out)`);
        console.log(`Est. total cost: $${totalCost.toFixed(4)}`);
        if (jobsWithUsage > 0) {
          console.log(`Avg per job:     $${(totalCost / jobsWithUsage).toFixed(4)}`);
        }
      }
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
      console.log(c.brightCyan("ARC-402 Earnings"));
      console.log(c.dim("────────────────"));
      const earningsItems: { label: string; value: string; last?: boolean }[] = [
        { label: "Total earned", value: config.total_earned_eth + " ETH" },
        { label: "Jobs completed", value: String(config.job_count) },
      ];
      if (config.job_count > 0) {
        const avg = (parseFloat(config.total_earned_eth) / config.job_count).toFixed(6);
        earningsItems.push({ label: "Average/job", value: avg + " ETH" });
      }
      earningsItems[earningsItems.length - 1].last = true;
      renderTree(earningsItems);
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
      console.log(c.dim("Reloading workroom policy..."));
      // Trigger DNS refresh manually (which re-reads policy and updates iptables)
      const result = runCmd("docker", [
        "exec", WORKROOM_CONTAINER,
        "bash", "-c", "/dns-refresh.sh /workroom/.arc402/openshell-policy.yaml &",
      ]);
      if (result.ok) {
        console.log(" " + c.success + c.white(" Policy reload triggered"));
      } else {
        console.error(c.failure + " " + c.red("Failed to reload policy"));
      }
    });
}
