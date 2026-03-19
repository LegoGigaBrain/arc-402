import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as YAML from "yaml";
import {
  ARC402_DIR,
  DEFAULT_RUNTIME_REMOTE_ROOT,
  OPENSHELL_TOML,
  buildOpenShellSshConfig,
  detectDockerAccess,
  provisionRuntimeToSandbox,
  readOpenShellConfig,
  resolveOpenShellSecrets,
  runCmd,
  writeOpenShellConfig,
} from "../openshell-runtime";

// ─── Constants ────────────────────────────────────────────────────────────────

const POLICY_FILE = path.join(ARC402_DIR, "openshell-policy.yaml");
const SANDBOX_NAME = "arc402-daemon";
const NODE_BINARIES = [
  { path: "/usr/bin/node" },
  { path: "/usr/local/bin/node" },
];
const PYTHON_BINARIES = [
  { path: "/usr/bin/python3" },
  { path: "/usr/local/bin/python3" },
];
const DEFAULT_POLICY_KEYS = ["base_rpc", "arc402_relay", "bundler", "telegram"] as const;
const CORE_LAUNCH_HOSTS = [
  ["mainnet.base.org", "Base RPC"],
  ["relay.arc402.xyz", "ARC-402 relay"],
  ["public.pimlico.io", "Bundler"],
  ["api.telegram.org", "Telegram notifications"],
] as const;

const EXPANSION_PACKS: Record<string, Array<{ key: string; label: string; host: string; binaries?: Array<{ path: string }> }>> = {
  harness: [
    { key: "api_openai", label: "OpenAI", host: "api.openai.com" },
    { key: "api_anthropic", label: "Anthropic", host: "api.anthropic.com" },
    { key: "api_google_generativeai", label: "Google Gemini", host: "generativelanguage.googleapis.com" },
  ],
  search: [
    { key: "api_brave_search", label: "Brave Search", host: "api.search.brave.com" },
    { key: "api_serpapi", label: "SerpAPI", host: "serpapi.com" },
  ],
  all: [],
};
EXPANSION_PACKS.all = [...EXPANSION_PACKS.harness, ...EXPANSION_PACKS.search];

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
      base_rpc: buildPolicyEntry("base-mainnet-rpc", "mainnet.base.org"),
      arc402_relay: buildPolicyEntry("arc402-relay", "relay.arc402.xyz"),
      bundler: buildPolicyEntry("pimlico-bundler", "public.pimlico.io"),
      telegram: buildPolicyEntry("telegram-notifications", "api.telegram.org"),
    },
  };
}

// ─── Check helpers ────────────────────────────────────────────────────────────

function checkOpenShellInstalled(): string | null {
  const r = runCmd("which", ["openshell"]);
  if (!r.ok) return null;
  return r.stdout;
}

function ensureDockerAccessOrExit(prefix = "Docker", docker = detectDockerAccess()): void {
  if (docker.ok) return;
  if (docker.detail.includes("permission")) {
    console.error("Grant this shell access to the Docker daemon, then retry.");
  } else if (docker.detail.includes("not running")) {
    console.error("Start Docker Desktop / the Docker daemon, then retry.");
  } else if (docker.detail.includes("not installed")) {
    console.error("Install Docker first, then retry.");
  }
  process.exit(1);
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

function requirePolicyFile(): PolicyFile {
  const policy = loadPolicyFile();
  if (!policy) {
    console.error(`Policy file not found: ${POLICY_FILE}`);
    console.error("Run: arc402 openshell init");
    process.exit(1);
  }
  return policy;
}

function buildPolicyEntry(name: string, host: string, binaries = NODE_BINARIES): NetworkPolicy {
  return {
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
    binaries,
  };
}

function sanitizeKeySegment(input: string): string {
  return input
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "entry";
}

function peerPolicyKey(host: string): string {
  return `peer_${sanitizeKeySegment(host)}`;
}

function customPolicyKey(name: string): string {
  return `custom_${sanitizeKeySegment(name)}`;
}

function ensurePolicyEntry(policy: PolicyFile, key: string, entry: NetworkPolicy): "added" | "updated" | "unchanged" {
  const existing = policy.network_policies[key];
  const next = JSON.stringify(entry);
  if (!existing) {
    policy.network_policies[key] = entry;
    return "added";
  }
  if (JSON.stringify(existing) === next) {
    return "unchanged";
  }
  policy.network_policies[key] = entry;
  return "updated";
}

function removePolicyEntry(policy: PolicyFile, key: string): boolean {
  if (!policy.network_policies[key]) return false;
  delete policy.network_policies[key];
  return true;
}

function applyAndPersistPolicy(policy: PolicyFile): void {
  writePolicyFile(policy);
  hotReloadPolicy();
}

function summarizeCategory(key: string): string {
  if (DEFAULT_POLICY_KEYS.includes(key as typeof DEFAULT_POLICY_KEYS[number])) return "core-launch";
  if (key.startsWith("peer_")) return "peer-agent";
  if (key.startsWith("api_")) return "harness/api";
  if (key.startsWith("custom_")) return "custom";
  return "other";
}

function printPolicyTable(policy: PolicyFile): void {
  const policies = Object.entries(policy.network_policies ?? {});
  if (policies.length === 0) {
    console.log("No network policies defined.");
    return;
  }

  console.log("Network policies (allowed outbound):");
  console.log();
  const col1 = 24;
  const col2 = 32;
  const col3 = 16;
  console.log(
    "Key".padEnd(col1) +
    "Host".padEnd(col2) +
    "Category".padEnd(col3) +
    "Name"
  );
  console.log("─".repeat(col1 + col2 + col3 + 24));

  for (const [key, np] of policies) {
    for (const ep of np.endpoints) {
      console.log(
        key.padEnd(col1) +
        ep.host.padEnd(col2) +
        summarizeCategory(key).padEnd(col3) +
        np.name,
      );
    }
  }
}

function ensureCoreLaunchPreset(policy: PolicyFile): Array<{ key: string; result: string }> {
  const entries: Array<{ key: string; result: string }> = [];
  entries.push({ key: "base_rpc", result: ensurePolicyEntry(policy, "base_rpc", buildPolicyEntry("base-mainnet-rpc", "mainnet.base.org")) });
  entries.push({ key: "arc402_relay", result: ensurePolicyEntry(policy, "arc402_relay", buildPolicyEntry("arc402-relay", "relay.arc402.xyz")) });
  entries.push({ key: "bundler", result: ensurePolicyEntry(policy, "bundler", buildPolicyEntry("pimlico-bundler", "public.pimlico.io")) });
  entries.push({ key: "telegram", result: ensurePolicyEntry(policy, "telegram", buildPolicyEntry("telegram-notifications", "api.telegram.org")) });
  return entries;
}

function applyExpansionPack(policy: PolicyFile, packName: string): Array<{ key: string; label: string; result: string }> {
  const pack = EXPANSION_PACKS[packName];
  if (!pack) {
    console.error(`Unknown expansion pack '${packName}'. Use: harness, search, all`);
    process.exit(1);
  }
  return pack.map((item) => ({
    key: item.key,
    label: item.label,
    result: ensurePolicyEntry(
      policy,
      item.key,
      buildPolicyEntry(item.label, item.host, [...NODE_BINARIES, ...PYTHON_BINARIES]),
    ),
  }));
}

function removeExpansionPack(policy: PolicyFile, packName: string): Array<{ key: string; label: string; removed: boolean }> {
  const pack = EXPANSION_PACKS[packName];
  if (!pack) {
    console.error(`Unknown expansion pack '${packName}'. Use: harness, search, all`);
    process.exit(1);
  }
  return pack.map((item) => ({ key: item.key, label: item.label, removed: removePolicyEntry(policy, item.key) }));
}

function printPolicyConcepts(): void {
  console.log("Policy concepts");
  console.log("───────────────");
  console.log("core-launch      Default outbound runtime policy for launch: Base RPC, relay, bundler, Telegram.");
  console.log("peer-agent       Explicit HTTPS allowlist for one counterparty host at a time. No *.arc402.xyz wildcard trust.");
  console.log("harness/api      Optional expansion packs for model APIs and search APIs used by your harness/tools.");
  console.log();
  console.log("Important separation:");
  console.log("  • public endpoint / tunnel ingress tells the outside world how to reach you");
  console.log("  • OpenShell policy tells your sandboxed runtime what it may call outbound");
  console.log("  • registering https://agent.arc402.xyz does NOT grant outbound trust to that host");
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

      process.stdout.write("Checking Docker... ");
      const docker = detectDockerAccess();
      if (!docker.ok) {
        console.log(docker.detail);
        ensureDockerAccessOrExit("Docker", docker);
      }
      console.log(docker.detail);

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

      process.stdout.write("Verifying... ");
      const verify = runCmd("openshell", ["--version"]);
      if (!verify.ok) {
        console.log("not found in PATH");
        console.error("openshell not found after install. Ensure ~/.local/bin is in your PATH.");
        console.error("  export PATH=\"$HOME/.local/bin:$PATH\"");
        process.exit(1);
      }
      console.log(verify.stdout);

      const status = runCmd("openshell", ["status"]);
      if (!status.ok) {
        console.log("\nOpenShell installed, but the gateway is not healthy yet.");
        console.log("Run one of:");
        console.log("  openshell gateway start");
        console.log("  openshell doctor");
      }

      console.log("\nOpenShell installed successfully.");
      console.log("Run: arc402 openshell init");
    });

  // ── openshell init ─────────────────────────────────────────────────────────
  openshell
    .command("init")
    .description("Initialize the launch runtime once: create the arc402-daemon sandbox, write the default policy, and hide OpenShell wiring behind ARC-402 commands.")
    .action(() => {
      console.log("OpenShell Init");
      console.log("──────────────");

      process.stdout.write("OpenShell:  ");
      const shellPath = checkOpenShellInstalled();
      if (!shellPath) {
        console.log("not installed");
        console.error("OpenShell is not installed. Run: arc402 openshell install");
        process.exit(1);
      }
      const vr = runCmd("openshell", ["--version"]);
      console.log(vr.stdout || "installed");

      const gatewayStatus = runCmd("openshell", ["status"], { timeout: 30000 });
      process.stdout.write("Docker:     ");
      const docker = detectDockerAccess();
      if (!docker.ok) {
        if (gatewayStatus.ok) {
          console.log(`${docker.detail} (continuing because OpenShell gateway is already connected)`);
        } else {
          console.log(docker.detail);
          ensureDockerAccessOrExit("Docker", docker);
        }
      } else {
        console.log(docker.detail);
      }

      console.log("\nGenerating policy file...");
      const policy = buildDefaultPolicy();
      writePolicyFile(policy);
      console.log(`  Written: ${POLICY_FILE}`);

      console.log("\nCreating credential providers...");
      const secrets = resolveOpenShellSecrets();
      const providerResult = (name: string, credentials: string[], missingMessage: string) => {
        if (credentials.length === 0) {
          console.warn(`  Warning: ${name}: ${missingMessage}`);
          return;
        }

        const createArgs = ["provider", "create", "--name", name, "--type", "generic"];
        for (const credential of credentials) createArgs.push("--credential", credential);
        const created = runCmd("openshell", createArgs);
        if (created.ok) {
          console.log(`  Ready:   ${name}`);
          return;
        }

        if ((created.stderr || created.stdout).includes("already exists")) {
          const updateArgs = ["provider", "update", name];
          for (const credential of credentials) updateArgs.push("--credential", credential);
          const updated = runCmd("openshell", updateArgs);
          if (updated.ok) {
            console.log(`  Updated: ${name}`);
            return;
          }
          console.warn(`  Warning: ${name}: ${updated.stderr || updated.stdout}`);
          return;
        }

        console.warn(`  Warning: ${name}: ${created.stderr || created.stdout}`);
      };

      providerResult(
        "arc402-machine-key",
        secrets.machineKey ? [`ARC402_MACHINE_KEY=${secrets.machineKey}`] : [],
        "machine key not found in env or arc402 config; provider left unchanged",
      );

      providerResult(
        "arc402-notifications",
        [
          secrets.telegramBotToken ? `TELEGRAM_BOT_TOKEN=${secrets.telegramBotToken}` : "",
          secrets.telegramChatId ? `TELEGRAM_CHAT_ID=${secrets.telegramChatId}` : "",
        ].filter(Boolean),
        "Telegram credentials not found in env or arc402 config; provider left unchanged",
      );

      console.log("\nEnsuring sandbox exists...");
      const sandboxLookup = runCmd("openshell", ["sandbox", "get", SANDBOX_NAME], { timeout: 120000 });
      if (!sandboxLookup.ok) {
        const createSandbox = runCmd("openshell", [
          "sandbox", "create",
          "--name", SANDBOX_NAME,
          "--from", "openclaw",
          "--policy", POLICY_FILE,
          "--provider", "arc402-machine-key",
          "--provider", "arc402-notifications",
          "--",
          "true",
        ], { timeout: 180000 });
        if (!createSandbox.ok) {
          console.error(`Failed to create sandbox: ${createSandbox.stderr || createSandbox.stdout}`);
          process.exit(1);
        }
        console.log(`  Created: ${SANDBOX_NAME}`);
      } else {
        console.log(`  Reusing:  ${SANDBOX_NAME}`);
      }

      console.log("\nProvisioning ARC-402 runtime bundle into the sandbox...");
      let tarballPath = "";
      let remoteRoot = DEFAULT_RUNTIME_REMOTE_ROOT;
      try {
        const provisioned = provisionRuntimeToSandbox(SANDBOX_NAME, DEFAULT_RUNTIME_REMOTE_ROOT);
        tarballPath = provisioned.tarballPath;
        remoteRoot = provisioned.remoteRoot;
        console.log(`  Uploaded: ${tarballPath}`);
        console.log(`  Remote:   ${remoteRoot}`);
      } catch (err) {
        console.error(`Failed to provision runtime bundle: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }

      writeOpenShellConfig({
        sandbox: {
          name: SANDBOX_NAME,
          policy: POLICY_FILE,
          providers: ["arc402-machine-key", "arc402-notifications"],
        },
        runtime: {
          local_tarball: tarballPath,
          remote_root: remoteRoot,
          synced_at: new Date().toISOString(),
        },
      });
      console.log(`\nConfig: ${OPENSHELL_TOML}`);

      console.log(`
OpenShell integration configured.

  Sandbox:   ${SANDBOX_NAME}
  Policy:    ${POLICY_FILE}
  Runtime:   daemon + workers run inside the sandbox from a synced ARC-402 CLI bundle
  Remote:    ${remoteRoot}

arc402 daemon start will now use the provisioned ARC-402 runtime inside ${SANDBOX_NAME}.
Default policy: Base RPC + relay + bundler + Telegram API. All other network access blocked.

To allow additional endpoints for your harness or worker tools:
  See the launch-safe presets and toggles: arc402 openshell policy concepts
  Core preset:         arc402 openshell policy preset core-launch
  Peer agent allow:    arc402 openshell policy peer add gigabrain.arc402.xyz
  Harness/API pack:    arc402 openshell policy preset harness
  List current policy: arc402 openshell policy list
  No daemon restart needed.

If you update the local CLI build and want the sandbox to pick it up immediately:
  arc402 openshell sync-runtime`);
    });

  // ── openshell sync-runtime ────────────────────────────────────────────────
  openshell
    .command("sync-runtime")
    .description("Package the local ARC-402 CLI and upload it into the configured OpenShell sandbox so daemon startup is genuinely one-click.")
    .action(() => {
      const cfg = readOpenShellConfig();
      if (!cfg?.sandbox?.name) {
        console.error("OpenShell is not configured yet. Run: arc402 openshell init");
        process.exit(1);
      }

      console.log("Syncing ARC-402 runtime into OpenShell...");
      try {
        const provisioned = provisionRuntimeToSandbox(
          cfg.sandbox.name,
          cfg.runtime?.remote_root ?? DEFAULT_RUNTIME_REMOTE_ROOT,
        );
        writeOpenShellConfig({
          sandbox: cfg.sandbox,
          runtime: {
            local_tarball: provisioned.tarballPath,
            remote_root: provisioned.remoteRoot,
            synced_at: new Date().toISOString(),
          },
        });
        console.log(`✓ Runtime synced to ${provisioned.remoteRoot}`);
      } catch (err) {
        console.error(`Runtime sync failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
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

      const shellPath = checkOpenShellInstalled();
      if (shellPath) {
        const vr = runCmd("openshell", ["--version"]);
        line("Installed:", `yes (${vr.stdout || "unknown version"})`);
      } else {
        line("Installed:", "no  ← run: arc402 openshell install");
      }

      const docker = detectDockerAccess();
      line("Docker:", docker.detail);

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

      if (fs.existsSync(POLICY_FILE)) {
        line("Policy file:", `${POLICY_FILE} ✓`);
      } else {
        line("Policy file:", `${POLICY_FILE} (not found)`);
      }

      const openShellConfig = readOpenShellConfig();
      if (openShellConfig) {
        line("Daemon mode:", "OpenShell-owned governed workroom runtime");
        line("Public mode:", "separate layer — endpoint/tunnel ingress is host-facing, not a sandbox policy toggle");
        line("Runtime root:", openShellConfig.runtime?.remote_root ?? DEFAULT_RUNTIME_REMOTE_ROOT);
        line("Last sync:", openShellConfig.runtime?.synced_at ?? "unknown");

        try {
          const { configPath, host } = buildOpenShellSshConfig(openShellConfig.sandbox.name);
          const remoteDaemonEntry = path.posix.join(
            openShellConfig.runtime?.remote_root ?? DEFAULT_RUNTIME_REMOTE_ROOT,
            "dist/daemon/index.js",
          );
          const runtimeProbe = runCmd("ssh", ["-F", configPath, host, `test -f ${JSON.stringify(remoteDaemonEntry)} && echo present || echo missing`], { timeout: 60000 });
          line("Runtime sync:", runtimeProbe.ok && runtimeProbe.stdout.includes("present") ? "remote daemon bundle present ✓" : "remote daemon bundle missing");

          const secretProbe = runCmd("ssh", [
            "-F", configPath,
            host,
            "printf '%s' \"${ARC402_MACHINE_KEY:-missing}\"",
          ], { timeout: 60000 });
          if (secretProbe.ok && secretProbe.stdout.startsWith("openshell:resolve:env:")) {
            line("Secret mode:", "raw SSH shows OpenShell placeholders; ARC-402 overlays real launch envs from local config ✓");
          } else if (secretProbe.ok && secretProbe.stdout && secretProbe.stdout !== "missing") {
            line("Secret mode:", "sandbox env already materialized ✓");
          } else {
            line("Secret mode:", "could not confirm machine-key materialization");
          }
        } catch {
          line("Runtime sync:", "could not verify remote bundle");
        }
      } else {
        line("Daemon mode:", "not configured for launch (run: arc402 openshell init)");
      }

      const policy = loadPolicyFile();
      if (policy?.network_policies) {
        console.log("\nNetwork policy (allowed outbound):");
        for (const [key, np] of Object.entries(policy.network_policies)) {
          for (const ep of np.endpoints) {
            console.log(`  ${ep.host.padEnd(30)} (${summarizeCategory(key)} · ${np.name})`);
          }
        }
        console.log("  [all others blocked]");
      }

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
    .description("Manage the OpenShell outbound network policy for the arc402-daemon sandbox. This is separate from public endpoint / tunnel ingress.");

  policyCmd
    .command("concepts")
    .description("Explain the launch-safe policy UX: core launch preset, peer-agent HTTPS allowlist, harness/API expansion packs, and ingress wording.")
    .action(() => {
      printPolicyConcepts();
    });

  policyCmd
    .command("preset <name>")
    .description("Apply a launch-safe preset. Supported: core-launch, harness, search, all")
    .action((name: string) => {
      const policy = requirePolicyFile();

      if (name === "core-launch") {
        const changes = ensureCoreLaunchPreset(policy);
        applyAndPersistPolicy(policy);
        console.log("Applied core-launch preset:");
        for (const change of changes) {
          console.log(`  ${change.key}: ${change.result}`);
        }
        console.log();
        console.log("Launch core outbound hosts:");
        for (const [host, label] of CORE_LAUNCH_HOSTS) console.log(`  ${host} — ${label}`);
        console.log("  Peer-agent wildcard trust remains OFF by default.");
        return;
      }

      const changes = applyExpansionPack(policy, name);
      applyAndPersistPolicy(policy);
      console.log(`Applied ${name} expansion pack:`);
      for (const change of changes) {
        console.log(`  ${change.label} (${change.key}): ${change.result}`);
      }
    });

  policyCmd
    .command("preset-remove <name>")
    .description("Remove a previously applied expansion preset. Supported: harness, search, all")
    .action((name: string) => {
      if (name === "core-launch") {
        console.error("core-launch is the launch baseline. Remove individual entries only if you explicitly want to break the default runtime path.");
        process.exit(1);
      }
      const policy = requirePolicyFile();
      const changes = removeExpansionPack(policy, name);
      applyAndPersistPolicy(policy);
      console.log(`Removed ${name} expansion pack entries:`);
      for (const change of changes) {
        console.log(`  ${change.label} (${change.key}): ${change.removed ? "removed" : "not present"}`);
      }
    });

  const peerCmd = policyCmd
    .command("peer")
    .description("Manage explicit peer-agent HTTPS allowlist entries. Public registration does not imply outbound trust.");

  peerCmd
    .command("add <host>")
    .description("Allow outbound HTTPS calls to one peer agent host. No *.arc402.xyz wildcard support.")
    .action((host: string) => {
      if (host.includes("*")) {
        console.error("Wildcard peer trust is not allowed. Add one host at a time.");
        process.exit(1);
      }
      const cleanedHost = host.replace(/^https?:\/\//, "").replace(/\/$/, "");
      const policy = requirePolicyFile();
      const key = peerPolicyKey(cleanedHost);
      const result = ensurePolicyEntry(policy, key, buildPolicyEntry(`peer-agent:${cleanedHost}`, cleanedHost));
      applyAndPersistPolicy(policy);
      console.log(`✓ Peer agent host ${cleanedHost} ${result} under ${key}`);
      console.log("  This only affects sandbox outbound access. It does not claim or expose a public endpoint.");
    });

  peerCmd
    .command("remove <host>")
    .description("Revoke outbound HTTPS access to a peer agent host.")
    .action((host: string) => {
      const cleanedHost = host.replace(/^https?:\/\//, "").replace(/\/$/, "");
      const policy = requirePolicyFile();
      const key = peerPolicyKey(cleanedHost);
      const removed = removePolicyEntry(policy, key);
      if (!removed) {
        console.error(`Peer host ${cleanedHost} is not allowlisted.`);
        process.exit(1);
      }
      applyAndPersistPolicy(policy);
      console.log(`✓ Peer agent host ${cleanedHost} removed (${key})`);
    });

  peerCmd
    .command("list")
    .description("List all explicit peer-agent outbound allowlist entries.")
    .action(() => {
      const policy = requirePolicyFile();
      const peers = Object.entries(policy.network_policies).filter(([key]) => key.startsWith("peer_"));
      if (peers.length === 0) {
        console.log("No peer-agent HTTPS hosts allowlisted.");
        return;
      }
      console.log("Peer-agent HTTPS allowlist:");
      for (const [key, entry] of peers) {
        const host = entry.endpoints[0]?.host ?? "unknown";
        console.log(`  ${host} (${key})`);
      }
    });

  // ── openshell policy add <name> <host> ────────────────────────────────────
  policyCmd
    .command("add <name> <host>")
    .description("Add a custom outbound allowlist endpoint to the sandbox policy and hot-reload it. Prefer preset/peer commands when they fit.")
    .action((name: string, host: string) => {
      const policy = requirePolicyFile();
      const key = customPolicyKey(name);
      const result = ensurePolicyEntry(policy, key, buildPolicyEntry(name, host, [...NODE_BINARIES, ...PYTHON_BINARIES]));
      applyAndPersistPolicy(policy);
      console.log(`✓ ${host} ${result} as ${key}`);
      console.log("  Prefer `arc402 openshell policy peer add <host>` for peer agents or `preset <name>` for launch-safe expansion packs.");
    });

  // ── openshell policy list ─────────────────────────────────────────────────
  policyCmd
    .command("list")
    .description("List all sandbox outbound allowlist endpoints grouped by launch-safe category. These are runtime egress rules, not endpoint/tunnel registrations.")
    .action(() => {
      const policy = requirePolicyFile();
      printPolicyTable(policy);
    });

  // ── openshell policy remove <name> ────────────────────────────────────────
  policyCmd
    .command("remove <name>")
    .description("Remove a named outbound allowlist entry and hot-reload the sandbox. For peers, prefer `peer remove <host>`.")
    .action((name: string) => {
      const policy = requirePolicyFile();
      const key = [name, customPolicyKey(name), peerPolicyKey(name)].find((candidate) => policy.network_policies[candidate]);
      if (!key) {
        console.error(`Policy entry '${name}' not found.`);
        console.error("Run: arc402 openshell policy list");
        process.exit(1);
      }

      const removedHost = policy.network_policies[key]?.endpoints[0]?.host ?? key;
      delete policy.network_policies[key];

      applyAndPersistPolicy(policy);
      console.log(`✓ ${removedHost} removed from daemon sandbox policy (hot-reloaded)`);
    });
}
