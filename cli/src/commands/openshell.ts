import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawnSync } from "child_process";
import * as YAML from "yaml";

// ─── Constants ────────────────────────────────────────────────────────────────

const ARC402_DIR = path.join(os.homedir(), ".arc402");
const POLICY_FILE = path.join(ARC402_DIR, "openshell-policy.yaml");
const OPENSHELL_TOML = path.join(ARC402_DIR, "openshell.toml");
const SANDBOX_NAME = "arc402-daemon";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NetworkEndpoint {
  host: string;
  port: number;
  protocol: string;
  tls: string;
  enforcement: string;
  access: string;
}

interface NetworkPolicy {
  name: string;
  endpoints: NetworkEndpoint[];
  binaries: Array<{ path: string }>;
}

interface PolicyFile {
  version: number;
  filesystem_policy: {
    include_workdir: boolean;
    read_only: string[];
    read_write: string[];
  };
  landlock: { compatibility: string };
  process: { run_as_user: string; run_as_group: string };
  network_policies: Record<string, NetworkPolicy>;
}

// ─── Default policy ───────────────────────────────────────────────────────────

function buildDefaultPolicy(): PolicyFile {
  const nodeBinaries = [
    { path: "/usr/bin/node" },
    { path: "/usr/local/bin/node" },
  ];

  return {
    version: 1,
    filesystem_policy: {
      include_workdir: true,
      read_only: ["/usr", "/lib", "/proc", "/etc", "/var/log"],
      read_write: [path.join(os.homedir(), ".arc402"), "/tmp", "/dev/null"],
    },
    landlock: {
      compatibility: "best_effort",
    },
    process: {
      run_as_user: "sandbox",
      run_as_group: "sandbox",
    },
    network_policies: {
      base_rpc: {
        name: "base-mainnet-rpc",
        endpoints: [
          {
            host: "mainnet.base.org",
            port: 443,
            protocol: "rest",
            tls: "terminate",
            enforcement: "enforce",
            access: "read-write",
          },
        ],
        binaries: nodeBinaries,
      },
      arc402_relay: {
        name: "arc402-relay",
        endpoints: [
          {
            host: "relay.arc402.xyz",
            port: 443,
            protocol: "rest",
            tls: "terminate",
            enforcement: "enforce",
            access: "read-write",
          },
        ],
        binaries: nodeBinaries,
      },
      bundler: {
        name: "pimlico-bundler",
        endpoints: [
          {
            host: "public.pimlico.io",
            port: 443,
            protocol: "rest",
            tls: "terminate",
            enforcement: "enforce",
            access: "read-write",
          },
        ],
        binaries: nodeBinaries,
      },
      telegram: {
        name: "telegram-notifications",
        endpoints: [
          {
            host: "api.telegram.org",
            port: 443,
            protocol: "rest",
            tls: "terminate",
            enforcement: "enforce",
            access: "read-write",
          },
        ],
        binaries: nodeBinaries,
      },
    },
  };
}

// ─── Subprocess helper ────────────────────────────────────────────────────────

function runCmd(
  cmd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; input?: string; timeout?: number } = {}
): { stdout: string; stderr: string; ok: boolean } {
  const result = spawnSync(cmd, args, {
    encoding: "utf-8",
    env: { ...process.env, ...(opts.env ?? {}) },
    input: opts.input,
    timeout: opts.timeout ?? 60000,
  });
  return {
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
    ok: result.status === 0 && !result.error,
  };
}

// ─── Check helpers ────────────────────────────────────────────────────────────

function checkOpenShellInstalled(): string | null {
  const r = runCmd("which", ["openshell"]);
  if (!r.ok) return null;
  return r.stdout;
}

function checkDockerRunning(): boolean {
  const r = runCmd("docker", ["info"]);
  return r.ok;
}

// ─── Policy file helpers ──────────────────────────────────────────────────────

function loadPolicyFile(): PolicyFile | null {
  if (!fs.existsSync(POLICY_FILE)) return null;
  try {
    const raw = fs.readFileSync(POLICY_FILE, "utf-8");
    return YAML.parse(raw) as PolicyFile;
  } catch {
    return null;
  }
}

function writePolicyFile(policy: PolicyFile): void {
  fs.mkdirSync(ARC402_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(POLICY_FILE, YAML.stringify(policy), { mode: 0o600 });
}

function hotReloadPolicy(): void {
  const r = runCmd("openshell", [
    "policy", "set", SANDBOX_NAME,
    "--policy", POLICY_FILE,
    "--wait",
  ]);
  if (!r.ok) {
    console.warn(`  Warning: hot-reload failed: ${r.stderr}`);
  }
}

// ─── Command registration ─────────────────────────────────────────────────────

export function registerOpenShellCommands(program: Command): void {
  const openshell = program
    .command("openshell")
    .description("OpenShell sandbox integration for the ARC-402 daemon (Spec 34)");

  // ── openshell install ──────────────────────────────────────────────────────
  openshell
    .command("install")
    .description("Install OpenShell from the official source (requires Docker).")
    .action(() => {
      console.log("OpenShell Install");
      console.log("─────────────────");

      // Check Docker
      process.stdout.write("Checking Docker... ");
      if (!checkDockerRunning()) {
        console.log("not running");
        console.error("Docker is not running. Start Docker Desktop and try again.");
        process.exit(1);
      }
      console.log("running");

      // Download + install OpenShell
      console.log("\nDownloading OpenShell from github.com/NVIDIA/OpenShell ...");
      const install = runCmd("sh", ["-c",
        "curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | sh"
      ], { timeout: 120000 });

      if (!install.ok) {
        console.error("Install failed:");
        console.error(install.stderr || install.stdout);
        process.exit(1);
      }

      if (install.stdout) console.log(install.stdout);

      // Verify
      process.stdout.write("Verifying... ");
      const verify = runCmd("openshell", ["--version"]);
      if (!verify.ok) {
        console.log("not found in PATH");
        console.error("openshell not found after install. Ensure ~/.local/bin is in your PATH.");
        console.error("  export PATH=\"$HOME/.local/bin:$PATH\"");
        process.exit(1);
      }
      console.log(verify.stdout);

      console.log("\nOpenShell installed successfully.");
      console.log("Run: arc402 openshell init");
    });

  // ── openshell init ─────────────────────────────────────────────────────────
  openshell
    .command("init")
    .description("Create the arc402-daemon sandbox, generate policy, configure credential providers.")
    .action(() => {
      console.log("OpenShell Init");
      console.log("──────────────");

      // Step 1: Check OpenShell installed
      process.stdout.write("OpenShell:  ");
      const shellPath = checkOpenShellInstalled();
      if (!shellPath) {
        console.log("not installed");
        console.error("OpenShell is not installed. Run: arc402 openshell install");
        process.exit(1);
      }
      const vr = runCmd("openshell", ["--version"]);
      console.log(vr.stdout || "installed");

      // Step 2: Check Docker
      process.stdout.write("Docker:     ");
      if (!checkDockerRunning()) {
        console.log("not running");
        console.error("Docker is not running. Start Docker Desktop and try again.");
        process.exit(1);
      }
      console.log("running");

      // Step 3: Generate policy file
      console.log("\nGenerating policy file...");
      const policy = buildDefaultPolicy();
      writePolicyFile(policy);
      console.log(`  Written: ${POLICY_FILE}`);

      // Step 4: Create credential providers
      console.log("\nCreating credential providers...");

      const machineKey = process.env["ARC402_MACHINE_KEY"] ?? "";
      const telegramBotToken = process.env["TELEGRAM_BOT_TOKEN"] ?? "";
      const telegramChatId = process.env["TELEGRAM_CHAT_ID"] ?? "";

      const providerMachineKey = runCmd("openshell", [
        "provider", "create", "arc402-machine-key",
        `--env`, `ARC402_MACHINE_KEY=${machineKey}`,
      ]);
      if (!providerMachineKey.ok) {
        console.warn(`  Warning: arc402-machine-key provider: ${providerMachineKey.stderr}`);
      } else {
        console.log("  Created: arc402-machine-key");
      }

      const providerNotifications = runCmd("openshell", [
        "provider", "create", "arc402-notifications",
        `--env`, `TELEGRAM_BOT_TOKEN=${telegramBotToken}`,
        `--env`, `TELEGRAM_CHAT_ID=${telegramChatId}`,
      ]);
      if (!providerNotifications.ok) {
        console.warn(`  Warning: arc402-notifications provider: ${providerNotifications.stderr}`);
      } else {
        console.log("  Created: arc402-notifications");
      }

      // Step 5: Create sandbox
      console.log("\nCreating sandbox...");
      const createSandbox = runCmd("openshell", [
        "sandbox", "create", SANDBOX_NAME,
        "--policy", POLICY_FILE,
        "--provider", "arc402-machine-key",
        "--provider", "arc402-notifications",
      ]);
      if (!createSandbox.ok) {
        console.error(`Failed to create sandbox: ${createSandbox.stderr}`);
        process.exit(1);
      }
      console.log(`  Created: ${SANDBOX_NAME}`);

      // Step 6: Write openshell.toml
      const tomlContent = `# ARC-402 OpenShell configuration\n# Written by: arc402 openshell init\n\n[sandbox]\nname = "${SANDBOX_NAME}"\npolicy = "${POLICY_FILE}"\nproviders = ["arc402-machine-key", "arc402-notifications"]\n`;
      fs.mkdirSync(ARC402_DIR, { recursive: true, mode: 0o700 });
      fs.writeFileSync(OPENSHELL_TOML, tomlContent, { mode: 0o600 });
      console.log(`  Config:  ${OPENSHELL_TOML}`);

      // Step 7: Verify — test echo inside sandbox
      console.log("\nVerifying sandbox...");
      const testRun = runCmd("openshell", [
        "sandbox", "exec", SANDBOX_NAME, "--", "echo", "arc402-sandbox-ok"
      ]);
      if (!testRun.ok || !testRun.stdout.includes("arc402-sandbox-ok")) {
        console.warn(`  Warning: sandbox verification failed: ${testRun.stderr}`);
      } else {
        console.log("  Sandbox echo test: ok");
      }

      // Step 8: Print confirmation
      console.log(`
OpenShell integration configured.

  Sandbox:   ${SANDBOX_NAME}
  Policy:    ${POLICY_FILE}
  Runtime:   daemon + all worker processes run inside the sandbox

arc402 daemon start will now run inside the ${SANDBOX_NAME} sandbox.
Default policy: Base RPC + relay + bundler + Telegram API. All other network access blocked.

To allow additional endpoints for your harness or worker tools:
  Edit ${POLICY_FILE} → network_policies section
  Or: arc402 openshell policy add <name> <host>
  Then hot-reload: openshell policy set ${SANDBOX_NAME} --policy ${POLICY_FILE} --wait
  No daemon restart needed.`);
    });

  // ── openshell status ───────────────────────────────────────────────────────
  openshell
    .command("status")
    .description("Show OpenShell integration status.")
    .action(() => {
      console.log("OpenShell Integration");
      console.log("─────────────────────");

      const line = (label: string, value: string) =>
        console.log(`${label.padEnd(14)}${value}`);

      // Installed?
      const shellPath = checkOpenShellInstalled();
      if (shellPath) {
        const vr = runCmd("openshell", ["--version"]);
        line("Installed:", `yes (${vr.stdout || "unknown version"})`);
      } else {
        line("Installed:", "no  ← run: arc402 openshell install");
      }

      // Docker
      const dockerOk = checkDockerRunning();
      line("Docker:", dockerOk ? "running" : "not running");

      // Sandbox
      if (shellPath) {
        const listR = runCmd("sh", ["-c",
          `openshell sandbox list 2>/dev/null | grep "${SANDBOX_NAME}"`
        ]);
        if (listR.ok && listR.stdout) {
          line("Sandbox:", `${SANDBOX_NAME} (found)`);
        } else {
          line("Sandbox:", `${SANDBOX_NAME} not found  ← run: arc402 openshell init`);
        }
      }

      // Policy file
      if (fs.existsSync(POLICY_FILE)) {
        line("Policy file:", `${POLICY_FILE} ✓`);
      } else {
        line("Policy file:", `${POLICY_FILE} (not found)`);
      }

      // Daemon mode
      if (fs.existsSync(OPENSHELL_TOML)) {
        line("Daemon mode:", `sandboxed (arc402 daemon start → openshell sandbox exec)`);
      } else {
        line("Daemon mode:", "unsandboxed (arc402 openshell init not run)");
      }

      // Network policies
      const policy = loadPolicyFile();
      if (policy?.network_policies) {
        console.log("\nNetwork policy (allowed outbound):");
        for (const [, np] of Object.entries(policy.network_policies)) {
          for (const ep of np.endpoints) {
            console.log(`  ${ep.host.padEnd(30)} (${np.name})`);
          }
        }
        console.log("  [all others blocked]");
      }

      // Providers
      if (shellPath) {
        console.log("\nCredential providers:");
        const provListR = runCmd("openshell", ["provider", "list"]);
        if (provListR.ok && provListR.stdout) {
          const hasKey = provListR.stdout.includes("arc402-machine-key");
          const hasNotif = provListR.stdout.includes("arc402-notifications");
          console.log(`  arc402-machine-key     ${hasKey ? "✓" : "✗ (not found)"}`);
          console.log(`  arc402-notifications   ${hasNotif ? "✓" : "✗ (not found)"}`);
        } else {
          console.log("  (could not retrieve provider list)");
        }
      }
    });

  // ── openshell policy ───────────────────────────────────────────────────────
  const policyCmd = openshell
    .command("policy")
    .description("Manage the OpenShell network policy for the arc402-daemon sandbox.");

  // ── openshell policy add <name> <host> ────────────────────────────────────
  policyCmd
    .command("add <name> <host>")
    .description("Add a network endpoint to the policy and hot-reload the sandbox.")
    .action((name: string, host: string) => {
      const policy = loadPolicyFile();
      if (!policy) {
        console.error(`Policy file not found: ${POLICY_FILE}`);
        console.error("Run: arc402 openshell init");
        process.exit(1);
      }

      if (policy.network_policies[name]) {
        console.error(`Policy entry '${name}' already exists. Use a different name or remove it first.`);
        process.exit(1);
      }

      policy.network_policies[name] = {
        name,
        endpoints: [
          {
            host,
            port: 443,
            protocol: "rest",
            tls: "terminate",
            enforcement: "enforce",
            access: "read-write",
          },
        ],
        binaries: [
          { path: "/usr/bin/node" },
          { path: "/usr/local/bin/node" },
        ],
      };

      writePolicyFile(policy);
      hotReloadPolicy();
      console.log(`✓ ${host} added to daemon sandbox policy (hot-reloaded)`);
    });

  // ── openshell policy list ─────────────────────────────────────────────────
  policyCmd
    .command("list")
    .description("List all allowed outbound endpoints in the policy.")
    .action(() => {
      const policy = loadPolicyFile();
      if (!policy) {
        console.error(`Policy file not found: ${POLICY_FILE}`);
        console.error("Run: arc402 openshell init");
        process.exit(1);
      }

      const policies = Object.entries(policy.network_policies ?? {});
      if (policies.length === 0) {
        console.log("No network policies defined.");
        return;
      }

      console.log("Network policies (allowed outbound):");
      console.log();
      const col1 = 20;
      const col2 = 32;
      const col3 = 12;
      console.log(
        "Key".padEnd(col1) +
        "Host".padEnd(col2) +
        "Access".padEnd(col3) +
        "Name"
      );
      console.log("─".repeat(col1 + col2 + col3 + 24));

      for (const [key, np] of policies) {
        for (const ep of np.endpoints) {
          console.log(
            key.padEnd(col1) +
            ep.host.padEnd(col2) +
            ep.access.padEnd(col3) +
            np.name
          );
        }
      }
    });

  // ── openshell policy remove <name> ────────────────────────────────────────
  policyCmd
    .command("remove <name>")
    .description("Remove a named network policy entry and hot-reload the sandbox.")
    .action((name: string) => {
      const policy = loadPolicyFile();
      if (!policy) {
        console.error(`Policy file not found: ${POLICY_FILE}`);
        console.error("Run: arc402 openshell init");
        process.exit(1);
      }

      if (!policy.network_policies[name]) {
        console.error(`Policy entry '${name}' not found.`);
        console.error("Run: arc402 openshell policy list");
        process.exit(1);
      }

      const removedHost = policy.network_policies[name]?.endpoints[0]?.host ?? name;
      delete policy.network_policies[name];

      writePolicyFile(policy);
      hotReloadPolicy();
      console.log(`✓ ${removedHost} removed from daemon sandbox policy (hot-reloaded)`);
    });
}
