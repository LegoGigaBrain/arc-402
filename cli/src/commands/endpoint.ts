import { Command } from "commander";
import { ethers } from "ethers";
import { AgentRegistryClient } from "@arc402/sdk";
import {
  buildEndpointConfig,
  DEFAULT_LOCAL_INGRESS_TARGET,
  ENDPOINT_CONFIG_PATH,
  loadEndpointConfig,
  normalizeAgentName,
  saveEndpointConfig,
} from "../endpoint-config";
import { configExists, getSubdomainApi, loadConfig, NETWORK_DEFAULTS } from "../config";
import { DAEMON_PID } from "../daemon/config";
import { detectDockerAccess, readOpenShellConfig, runCmd } from "../openshell-runtime";
import { getClient } from "../client";
import * as dns from "dns/promises";
import * as fs from "fs";
import * as net from "net";
import chalk from "chalk";
import { c } from '../ui/colors';

interface DoctorCheck {
  layer: string;
  label: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

function readWalletAddress(): string | undefined {
  if (!configExists()) return undefined;
  try {
    const config = loadConfig();
    if (config.walletContractAddress) return config.walletContractAddress;
    if (config.privateKey) return new ethers.Wallet(config.privateKey).address;
  } catch {
    return undefined;
  }
  return undefined;
}

function readSubdomainApi(): string {
  if (!configExists()) return "https://api.arc402.xyz";
  try {
    return getSubdomainApi(loadConfig());
  } catch {
    return "https://api.arc402.xyz";
  }
}

function readAgentRegistryAddress(): string | undefined {
  if (!configExists()) return undefined;
  try {
    const config = loadConfig();
    return config.agentRegistryV2Address ?? NETWORK_DEFAULTS[config.network]?.agentRegistryV2Address;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function checkLocalTarget(target: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const url = new URL(target);
    const host = url.hostname;
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    const socket = new net.Socket();
    socket.setTimeout(1500);
    return await new Promise<{ ok: boolean; detail: string }>((resolve) => {
      socket.once("connect", () => {
        socket.destroy();
        resolve({ ok: true, detail: `${host}:${port} accepted TCP connection` });
      });
      socket.once("timeout", () => {
        socket.destroy();
        resolve({ ok: false, detail: `${host}:${port} timed out` });
      });
      socket.once("error", (err) => {
        socket.destroy();
        resolve({ ok: false, detail: `${host}:${port} unreachable (${err.message})` });
      });
      socket.connect(port, host);
    });
  } catch (err) {
    return { ok: false, detail: `invalid URL: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function checkDaemon(): DoctorCheck {
  if (!fs.existsSync(DAEMON_PID)) {
    return {
      layer: "runtime",
      label: "Daemon",
      ok: false,
      detail: "no PID file found",
      fix: "Run `arc402 openshell init` if needed, then `arc402 daemon start`.",
    };
  }

  const rawPid = fs.readFileSync(DAEMON_PID, "utf-8").trim();
  const pid = Number(rawPid);
  if (!Number.isFinite(pid) || pid <= 0) {
    return {
      layer: "runtime",
      label: "Daemon",
      ok: false,
      detail: `invalid PID file contents: ${JSON.stringify(rawPid)}`,
      fix: "Remove the stale PID file and restart the daemon.",
    };
  }

  if (!isProcessAlive(pid)) {
    return {
      layer: "runtime",
      label: "Daemon",
      ok: false,
      detail: `stale PID file (${pid})`,
      fix: "Remove the stale PID file and restart with `arc402 daemon start`.",
    };
  }

  return {
    layer: "runtime",
    label: "Daemon",
    ok: true,
    detail: `running (PID ${pid})`,
  };
}

function checkOpenShell(): DoctorCheck {
  const config = readOpenShellConfig();
  const docker = detectDockerAccess();
  if (!config?.sandbox?.name) {
    return {
      layer: "runtime",
      label: "OpenShell runtime",
      ok: false,
      detail: "not configured for launch",
      fix: "Run `arc402 openshell init` so ARC-402 runtime stays sandboxed.",
    };
  }
  if (!docker.ok) {
    return {
      layer: "runtime",
      label: "OpenShell runtime",
      ok: false,
      detail: `configured, but Docker/OpenShell substrate is unhealthy: ${docker.detail}`,
      fix: "Restore Docker/OpenShell health, then re-run `arc402 openshell status`.",
    };
  }
  return {
    layer: "runtime",
    label: "OpenShell runtime",
    ok: true,
    detail: `${config.sandbox.name} configured; Docker ${docker.detail}`,
  };
}

function checkCloudflared(endpointTunnelTarget?: string): DoctorCheck {
  const which = runCmd("which", ["cloudflared"]);
  if (!which.ok || !which.stdout) {
    return {
      layer: "ingress",
      label: "Tunnel binary",
      ok: false,
      detail: "cloudflared not found in PATH",
      fix: "Install cloudflared on the host machine for the launch-default ingress path.",
    };
  }

  const ps = runCmd("bash", ["-lc", "ps -ef | grep '[c]loudflared tunnel' | head -1"]);
  if (!ps.ok || !ps.stdout) {
    return {
      layer: "ingress",
      label: "Tunnel process",
      ok: false,
      detail: endpointTunnelTarget
        ? `cloudflared is installed, but no tunnel process was detected for ${endpointTunnelTarget}`
        : "cloudflared is installed, but no tunnel process was detected",
      fix: "Start your host-managed tunnel (for example `cloudflared tunnel run ...`).",
    };
  }

  return {
    layer: "ingress",
    label: "Tunnel process",
    ok: true,
    detail: `detected: ${ps.stdout}`,
  };
}

async function checkPublicHostname(endpoint: ReturnType<typeof loadEndpointConfig>): Promise<DoctorCheck> {
  if (!endpoint) {
    return {
      layer: "public",
      label: "Public hostname",
      ok: false,
      detail: "cannot resolve because endpoint config is missing",
      fix: "Run `arc402 endpoint init <agentname>` first.",
    };
  }

  try {
    const results = await dns.lookup(endpoint.hostname, { all: true });
    if (!results.length) {
      return {
        layer: "public",
        label: "Public hostname",
        ok: false,
        detail: `${endpoint.hostname} did not resolve`,
        fix: endpoint.claimedAt
          ? "Verify the claimed hostname is live in DNS / Cloudflare and that propagation is complete."
          : "Claim the hostname first, then wait for DNS to propagate.",
      };
    }

    const addresses = results.map((entry) => entry.address).join(", ");
    return {
      layer: "public",
      label: "Public hostname",
      ok: true,
      detail: `${endpoint.hostname} resolves (${addresses})`,
    };
  } catch (err) {
    return {
      layer: "public",
      label: "Public hostname",
      ok: false,
      detail: `${endpoint.hostname} not resolvable yet (${err instanceof Error ? err.message : String(err)})`,
      fix: endpoint.claimedAt
        ? "If the claim succeeded, verify DNS propagation / Cloudflare routing rather than the local runtime."
        : "Claim the hostname first, then re-run status/doctor.",
    };
  }
}

async function checkAgentRegistryParity(endpoint: ReturnType<typeof loadEndpointConfig>): Promise<DoctorCheck> {
  if (!endpoint) {
    return {
      layer: "registry",
      label: "AgentRegistry parity",
      ok: false,
      detail: "endpoint config missing, so local ↔ registry parity cannot be checked",
      fix: "Run `arc402 endpoint init <agentname>` first.",
    };
  }

  const walletAddress = endpoint.walletAddress ?? readWalletAddress();
  if (!walletAddress) {
    return {
      layer: "registry",
      label: "AgentRegistry parity",
      ok: false,
      detail: "no wallet address resolved from local config, so registry parity proof is partial",
      fix: "Run `arc402 config init` (or set walletContractAddress/privateKey) so ARC-402 can compare local endpoint identity against AgentRegistry.",
    };
  }

  const registryAddress = readAgentRegistryAddress();
  if (!registryAddress) {
    return {
      layer: "registry",
      label: "AgentRegistry parity",
      ok: false,
      detail: "AgentRegistry address missing from config, so on-chain endpoint parity cannot be checked",
      fix: "Set `agentRegistryV2Address` in ARC-402 config or select a known network config.",
    };
  }

  try {
    const config = loadConfig();
    const { provider } = await getClient(config);
    const registry = new AgentRegistryClient(registryAddress, provider);
    const agent = await registry.getAgent(walletAddress);

    if (!agent.active && !agent.endpoint) {
      return {
        layer: "registry",
        label: "AgentRegistry parity",
        ok: false,
        detail: `${walletAddress} is not actively registered with an endpoint in AgentRegistry`,
        fix: `Register or update AgentRegistry with \`${endpoint.publicUrl}\` once local ingress is ready.`,
      };
    }

    if (agent.endpoint === endpoint.publicUrl) {
      return {
        layer: "registry",
        label: "AgentRegistry parity",
        ok: true,
        detail: `on-chain endpoint matches local canonical URL (${agent.endpoint || endpoint.publicUrl})`,
      };
    }

    if (!agent.endpoint) {
      return {
        layer: "registry",
        label: "AgentRegistry parity",
        ok: false,
        detail: `wallet is registered, but no public endpoint is stored on-chain yet (local expects ${endpoint.publicUrl})`,
        fix: `Run \`arc402 agent update --name <name> --service-type <type> --endpoint ${endpoint.publicUrl}\` when you want AgentRegistry parity.`,
      };
    }

    return {
      layer: "registry",
      label: "AgentRegistry parity",
      ok: false,
      detail: `mismatch: local canonical URL is ${endpoint.publicUrl}, but AgentRegistry has ${agent.endpoint}`,
      fix: `Update AgentRegistry or re-init local endpoint config so the public identity matches one source of truth.`,
    };
  } catch (err) {
    return {
      layer: "registry",
      label: "AgentRegistry parity",
      ok: false,
      detail: `could not prove on-chain parity (${err instanceof Error ? err.message : String(err)})`,
      fix: "Check RPC / wallet / registry config. If local runtime is healthy, this is a registry-proof gap rather than an ingress failure.",
    };
  }
}

async function buildDoctorChecks(endpoint = loadEndpointConfig()): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  if (!endpoint) {
    checks.push({
      layer: "config",
      label: "Endpoint config",
      ok: false,
      detail: `missing (${ENDPOINT_CONFIG_PATH})`,
      fix: "Run `arc402 endpoint init <agentname>` first.",
    });
    checks.push(await checkAgentRegistryParity(endpoint));
    checks.push(await checkPublicHostname(endpoint));
    return checks;
  }

  checks.push({
    layer: "config",
    label: "Endpoint config",
    ok: true,
    detail: `${endpoint.publicUrl} → ${endpoint.localIngressTarget}`,
  });

  if (endpoint.walletAddress) {
    checks.push({
      layer: "config",
      label: "Wallet binding",
      ok: true,
      detail: `endpoint config bound to ${endpoint.walletAddress}`,
    });
  } else {
    checks.push({
      layer: "config",
      label: "Wallet binding",
      ok: false,
      detail: "endpoint config exists, but no wallet address is recorded for parity checks",
      fix: "Set walletContractAddress/privateKey in ARC-402 config and re-run `arc402 endpoint init --force <agentname>` or claim again.",
    });
  }

  checks.push(checkOpenShell());
  checks.push(checkDaemon());

  const localTarget = await checkLocalTarget(endpoint.localIngressTarget);
  checks.push({
    layer: "ingress",
    label: "Local ingress target",
    ok: localTarget.ok,
    detail: localTarget.detail,
    fix: localTarget.ok ? undefined : "Ensure your host ingress target is listening and forwards to the ARC-402 surface you intend to expose.",
  });

  checks.push(checkCloudflared(endpoint.tunnelTarget));

  if (endpoint.claimedAt) {
    checks.push({
      layer: "public",
      label: "Subdomain claim",
      ok: true,
      detail: `claimed at ${endpoint.claimedAt}`,
    });
  } else {
    checks.push({
      layer: "public",
      label: "Subdomain claim",
      ok: false,
      detail: "not claimed yet",
      fix: `Run \`arc402 endpoint claim ${endpoint.agentName}${endpoint.tunnelTarget ? "" : " --tunnel-target <https://...>"}\`.`,
    });
  }

  checks.push(await checkPublicHostname(endpoint));
  checks.push(await checkAgentRegistryParity(endpoint));

  return checks;
}

async function claimSubdomain(subdomain: string, walletAddress: string, tunnelTarget: string, apiBase: string): Promise<void> {
  const normalized = normalizeAgentName(subdomain);
  console.log(`\nClaiming canonical endpoint: https://${normalized}.arc402.xyz`);
  console.log(`  Wallet:        ${walletAddress}`);
  console.log(`  Tunnel target: ${tunnelTarget}`);
  console.log(`  API:           ${apiBase}`);

  const tryPaths = [
    { path: "/register-subdomain", body: { subdomain: normalized, walletAddress, tunnelTarget } },
    { path: "/register", body: { subdomain: normalized, walletAddress, tunnelTarget } },
  ];

  let lastError = "unknown error";
  for (const candidate of tryPaths) {
    try {
      const res = await fetch(`${apiBase}${candidate.path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(candidate.body),
      });
      const body = await res.json() as Record<string, unknown>;
      if (res.ok) {
        console.log(chalk.green(`✓ Subdomain claimed: ${body["subdomain"] ?? `${normalized}.arc402.xyz`}`));
        return;
      }
      lastError = `${candidate.path}: ${String(body["error"] ?? res.statusText)}`;
    } catch (err) {
      lastError = `${candidate.path}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  throw new Error(lastError);
}

export function registerEndpointCommands(program: Command): void {
  const endpoint = program
    .command("endpoint")
    .description("Canonical public endpoint scaffold for ARC-402 launch: public ingress identity outside the sandbox, runtime still sandboxed inside OpenShell.");

  endpoint
    .command("init [agentName]")
    .description("Scaffold the canonical endpoint config for <agentname>.arc402.xyz and the host-managed ingress target. This does not claim DNS or open outbound sandbox policy.")
    .option("--local-ingress-target <url>", "Host ingress target the tunnel/proxy should forward into", DEFAULT_LOCAL_INGRESS_TARGET)
    .option("--tunnel-target <url>", "Public tunnel target / route metadata if already known (must be https://... for claim flows)")
    .option("--force", "Overwrite the existing endpoint scaffold")
    .action((agentName: string | undefined, opts) => {
      const existing = loadEndpointConfig();
      if (existing && !opts.force && !agentName) {
        console.log(`Endpoint config already exists at ${ENDPOINT_CONFIG_PATH}`);
        console.log(`  Public URL: ${existing.publicUrl}`);
        console.log(`  Local target: ${existing.localIngressTarget}`);
        console.log("Use --force to replace it, or pass a new agent name explicitly.");
        return;
      }

      const chosenName = agentName ?? existing?.agentName;
      if (!chosenName) {
        console.error("Agent name is required the first time. Example: arc402 endpoint init gigabrain");
        process.exit(1);
      }

      const walletAddress = readWalletAddress();
      const cfg = buildEndpointConfig({
        agentName: chosenName,
        localIngressTarget: opts.localIngressTarget,
        tunnelTarget: opts.tunnelTarget,
        walletAddress,
        subdomainApi: readSubdomainApi(),
        existing,
        notes: "Launch default: host-managed Cloudflare Tunnel outside the sandbox. Public ingress identity is separate from OpenShell outbound policy.",
      });
      saveEndpointConfig(cfg);

      console.log(c.success + c.white(' Endpoint scaffold written: ' + ENDPOINT_CONFIG_PATH));
      console.log(`  Agent name:    ${cfg.agentName}`);
      console.log(`  Hostname:      ${cfg.hostname}`);
      console.log(`  Public URL:    ${cfg.publicUrl}`);
      console.log(`  Tunnel mode:   ${cfg.tunnelMode}`);
      console.log(`  Local target:  ${cfg.localIngressTarget}`);
      if (cfg.tunnelTarget) console.log(`  Tunnel target: ${cfg.tunnelTarget}`);
      console.log(`  Wallet:        ${cfg.walletAddress ?? "not yet resolved"}`);
      console.log("\nArchitecture truth:");
      console.log("  • ARC-402 runtime stays inside the OpenShell sandbox.");
      console.log("  • This command only locks the public-ingress identity + host target.");
      console.log("  • Sandbox outbound policy remains separate: use `arc402 openshell policy ...` for peer/API allowlists.");
      console.log("\nNext:");
      console.log(`  1. Start your host-managed tunnel toward ${cfg.localIngressTarget}`);
      console.log(`  2. Claim the canonical hostname: arc402 endpoint claim ${cfg.agentName}${cfg.tunnelTarget ? "" : " --tunnel-target <https://your-tunnel.example.com>"}`);
      console.log("  3. Verify the whole chain: arc402 endpoint status");
    });

  endpoint
    .command("status")
    .description("Show the current endpoint scaffold and whether local runtime/ingress pieces line up. Useful now even before DNS automation is complete.")
    .action(async () => {
      const cfg = loadEndpointConfig();
      if (!cfg) {
        console.error(`No endpoint config found at ${ENDPOINT_CONFIG_PATH}`);
        console.error("Run: arc402 endpoint init <agentname>");
        process.exit(1);
      }

      const checks = await buildDoctorChecks(cfg);
      const allGood = checks.every((check) => check.ok);
      const brokenLayers = Array.from(new Set(checks.filter((check) => !check.ok).map((check) => check.layer)));

      console.log('\n ' + c.mark + c.white(' ARC-402 Endpoint Status'));
      console.log("─────────────────────");
      console.log(`Agent name:      ${cfg.agentName}`);
      console.log(`Hostname:        ${cfg.hostname}`);
      console.log(`Public URL:      ${cfg.publicUrl}`);
      console.log(`Tunnel mode:     ${cfg.tunnelMode}`);
      console.log(`Local target:    ${cfg.localIngressTarget}`);
      console.log(`Tunnel target:   ${cfg.tunnelTarget ?? "not set"}`);
      console.log(`Claimed at:      ${cfg.claimedAt ?? "not yet claimed"}`);
      console.log(`Config file:     ${ENDPOINT_CONFIG_PATH}`);
      console.log(`\nReadiness: ${allGood ? chalk.green("fully proven for current launch scope") : chalk.yellow("partial proof / needs attention")}`);
      if (brokenLayers.length) {
        console.log(`Broken layers:   ${brokenLayers.join(", ")}`);
      }
      console.log();

      for (const check of checks) {
        console.log(`${check.ok ? chalk.green("✓") : chalk.yellow("!")} [${check.layer}] ${check.label.padEnd(20)} ${check.detail}`);
      }

      console.log("\nWhat this proves now:");
      console.log("  • canonical endpoint identity is locked locally");
      console.log("  • runtime sandboxing is checked separately from ingress");
      console.log("  • local ingress target + daemon/tunnel wiring can be diagnosed without pretending every external layer is automated");
      console.log("  • AgentRegistry/public-hostname parity is checked when config + RPC + wallet context make proof possible");
    });

  endpoint
    .command("claim <agentName>")
    .description("Claim the canonical <agentname>.arc402.xyz hostname and lock the local endpoint config to it. Uses the launch-default host-managed ingress model.")
    .requiredOption("--tunnel-target <url>", "Public tunnel target registered behind the canonical hostname (must start with https://)")
    .action(async (agentName: string, opts) => {
      if (!opts.tunnelTarget.startsWith("https://")) {
        console.error("--tunnel-target must start with https://");
        process.exit(1);
      }

      const walletAddress = readWalletAddress();
      if (!walletAddress) {
        console.error("No wallet address could be resolved from ARC-402 config.");
        console.error("Run `arc402 config init` (or set walletContractAddress/privateKey) first.");
        process.exit(1);
      }

      const existing = loadEndpointConfig();
      const normalized = normalizeAgentName(agentName);
      const apiBase = readSubdomainApi();
      await claimSubdomain(normalized, walletAddress, opts.tunnelTarget, apiBase);

      const cfg = buildEndpointConfig({
        agentName: normalized,
        localIngressTarget: existing?.localIngressTarget ?? DEFAULT_LOCAL_INGRESS_TARGET,
        tunnelTarget: opts.tunnelTarget,
        walletAddress,
        subdomainApi: apiBase,
        existing,
        claimedAt: new Date().toISOString(),
        notes: existing?.notes,
      });
      saveEndpointConfig(cfg);

      console.log(c.success + c.white(' Endpoint config locked to ' + cfg.publicUrl));
      console.log(`  Hostname:      ${cfg.hostname}`);
      console.log(`  Tunnel target: ${cfg.tunnelTarget}`);
      console.log(`  Wallet:        ${cfg.walletAddress}`);
      console.log("\nOptional next step if you have not updated AgentRegistry yet:");
      console.log(`  arc402 agent update --name <name> --service-type <type> --endpoint ${cfg.publicUrl}`);
    });

  endpoint
    .command("doctor")
    .description("Diagnose the broken layer without blurring ingress, runtime sandbox, or public identity.")
    .action(async () => {
      const checks = await buildDoctorChecks();
      console.log("ARC-402 Endpoint Doctor");
      console.log("─────────────────────");

      const failuresByLayer = new Map<string, number>();
      let failures = 0;
      for (const check of checks) {
        if (check.ok) {
          console.log(`${chalk.green("✓")} [${check.layer}] ${check.label}: ${check.detail}`);
          continue;
        }
        failures += 1;
        failuresByLayer.set(check.layer, (failuresByLayer.get(check.layer) ?? 0) + 1);
        console.log(`${chalk.red("✗")} [${check.layer}] ${check.label}: ${check.detail}`);
        if (check.fix) console.log(`    Fix: ${check.fix}`);
      }

      if (failures === 0) {
        console.log(chalk.green("\nNo obvious scaffold-layer breakage detected."));
      } else {
        console.log(chalk.yellow(`\n${failures} check(s) failed across ${failuresByLayer.size} layer(s): ${Array.from(failuresByLayer.keys()).join(", ")}.`));
      }

      console.log("\nLayer model:");
      console.log("  1. config / local source of truth");
      console.log("  2. public identity (`agentname.arc402.xyz`)");
      console.log("  3. host-managed ingress / tunnel");
      console.log("  4. local ingress target");
      console.log("  5. ARC-402 runtime inside OpenShell");
      console.log("  6. AgentRegistry/public-endpoint parity");
      console.log("  7. sandbox outbound policy (separate; not implied by public ingress)");
      console.log("\nIf only the registry/public checks fail while local runtime is healthy, the proof is partial rather than the stack being fully down.");
    });
}
