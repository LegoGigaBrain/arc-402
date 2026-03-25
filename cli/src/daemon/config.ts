/**
 * Daemon configuration loader.
 * Parses ~/.arc402/daemon.toml, enforces env: prefix for secrets,
 * resolves env: values from the environment.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parse as parseToml } from "smol-toml";

export const DAEMON_DIR = path.join(os.homedir(), ".arc402");
export const DAEMON_TOML = path.join(DAEMON_DIR, "daemon.toml");
export const DAEMON_PID = path.join(DAEMON_DIR, "daemon.pid");
export const DAEMON_LOG = path.join(DAEMON_DIR, "daemon.log");
export const DAEMON_DB = path.join(DAEMON_DIR, "daemon.db");
export const DAEMON_SOCK = path.join(DAEMON_DIR, "daemon.sock");

export interface DaemonConfig {
  wallet: {
    contract_address: string;
    owner_address: string;
    machine_key: string; // must be "env:VAR_NAME"
  };
  network: {
    rpc_url: string;
    chain_id: number;
    entry_point: string;
  };
  bundler: {
    mode: "external" | "arc402" | "self";
    endpoint: string;
    earn_fees: boolean;
    eth_float: string;
    sweep_threshold: string;
    sweep_to: string;
    rpc_url: string;
  };
  relay: {
    enabled: boolean;
    listen_port: number;
    endpoint: string;
    max_concurrent_agreements: number;
    poll_interval_seconds: number;
    relay_url: string;
  };
  watchtower: {
    enabled: boolean;
    poll_interval_seconds: number;
    challenge_confirmation_blocks: number;
    external_watchtower_url: string;
    update_interval_states: number;
  };
  policy: {
    auto_accept: boolean;
    max_price_eth: string;
    allowed_capabilities: string[];
    require_min_trust_score: number;
    min_hire_lead_time_seconds: number;
  };
  notifications: {
    telegram_bot_token: string;
    telegram_chat_id: string;
    notify_on_hire_request: boolean;
    notify_on_hire_accepted: boolean;
    notify_on_hire_rejected: boolean;
    notify_on_delivery: boolean;
    notify_on_dispute: boolean;
    notify_on_channel_challenge: boolean;
    notify_on_low_balance: boolean;
    low_balance_threshold_eth: string;
    discord: { webhook_url: string };
    webhook: { url: string; headers: Record<string, string> };
    email: { smtp_host: string; smtp_port: number; smtp_user: string; smtp_pass: string; to: string };
  };
  work: {
    handler: "exec" | "http" | "noop";
    exec_command: string;
    http_url: string;
    http_auth_token: string;
  };
  compute: {
    enabled: boolean;
    gpu_spec: string;
    rate_per_hour_wei: string;
    max_concurrent_sessions: number;
    metering_interval_seconds: number;
    report_interval_minutes: number;
    auto_accept_compute: boolean;
    min_session_hours: number;
    max_session_hours: number;
    compute_agreement_address: string;
  };
  delivery: {
    max_file_size_mb: number;
    max_job_size_mb: number;
    auto_download: boolean;
    serve_files: boolean;
  };
  worker: {
    agent_type: string;           // openclaw | claude-code | codex | shell
    max_concurrent_jobs: number;
    job_timeout_seconds: number;
    auto_execute: boolean;        // if false: accept on-chain but don't spawn agent (manual exec)
  };
}

function resolveEnvValue(value: string, field: string): string {
  if (!value.startsWith("env:")) return value;
  const varName = value.slice(4);
  const resolved = process.env[varName];
  if (!resolved) {
    throw new Error(`Environment variable ${varName} is not set (required for ${field})`);
  }
  return resolved;
}

function tryResolveEnvValue(value: string): string {
  if (!value.startsWith("env:")) return value;
  const varName = value.slice(4);
  return process.env[varName] ?? "";
}

function str(v: unknown, def = ""): string {
  return typeof v === "string" ? v : def;
}
function num(v: unknown, def: number): number {
  return typeof v === "number" ? v : def;
}
function bool(v: unknown, def: boolean): boolean {
  return typeof v === "boolean" ? v : def;
}
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

function withDefaults(raw: Record<string, unknown>): DaemonConfig {
  const w = (raw.wallet as Record<string, unknown>) ?? {};
  const n = (raw.network as Record<string, unknown>) ?? {};
  const b = (raw.bundler as Record<string, unknown>) ?? {};
  const r = (raw.relay as Record<string, unknown>) ?? {};
  const wt = (raw.watchtower as Record<string, unknown>) ?? {};
  const p = (raw.policy as Record<string, unknown>) ?? {};
  const notif = (raw.notifications as Record<string, unknown>) ?? {};
  const notifDiscord = (notif.discord as Record<string, unknown>) ?? {};
  const notifWebhook = (notif.webhook as Record<string, unknown>) ?? {};
  const notifEmail = (notif.email as Record<string, unknown>) ?? {};
  const work     = (raw.work     as Record<string, unknown>) ?? {};
  const compute  = (raw.compute  as Record<string, unknown>) ?? {};
  const delivery = (raw.delivery as Record<string, unknown>) ?? {};
  const worker   = (raw.worker   as Record<string, unknown>) ?? {};

  return {
    wallet: {
      contract_address: str(w.contract_address),
      owner_address: str(w.owner_address),
      machine_key: str(w.machine_key, "env:ARC402_MACHINE_KEY"),
    },
    network: {
      rpc_url: str(n.rpc_url, "https://mainnet.base.org"),
      chain_id: num(n.chain_id, 8453),
      entry_point: str(n.entry_point, "0x0000000071727De22E5E9d8BAf0edAc6f37da032"),
    },
    bundler: {
      mode: (str(b.mode, "external")) as "external" | "arc402" | "self",
      endpoint: str(b.endpoint),
      earn_fees: bool(b.earn_fees, false),
      eth_float: str(b.eth_float, "0.01"),
      sweep_threshold: str(b.sweep_threshold, "0.005"),
      sweep_to: str(b.sweep_to),
      rpc_url: str(b.rpc_url),
    },
    relay: {
      enabled: bool(r.enabled, true),
      listen_port: num(r.listen_port, 4402),
      endpoint: str(r.endpoint),
      max_concurrent_agreements: num(r.max_concurrent_agreements, 10),
      poll_interval_seconds: num(r.poll_interval_seconds, 2),
      relay_url: str(r.relay_url),
    },
    watchtower: {
      enabled: bool(wt.enabled, true),
      poll_interval_seconds: num(wt.poll_interval_seconds, 60),
      challenge_confirmation_blocks: num(wt.challenge_confirmation_blocks, 2),
      external_watchtower_url: str(wt.external_watchtower_url),
      update_interval_states: num(wt.update_interval_states, 10),
    },
    policy: {
      auto_accept: bool(p.auto_accept, false),
      max_price_eth: str(p.max_price_eth, "0.1"),
      allowed_capabilities: strArr(p.allowed_capabilities),
      require_min_trust_score: num(p.require_min_trust_score, 50),
      min_hire_lead_time_seconds: num(p.min_hire_lead_time_seconds, 300),
    },
    notifications: {
      telegram_bot_token: str(notif.telegram_bot_token, "env:TELEGRAM_BOT_TOKEN"),
      telegram_chat_id: str(notif.telegram_chat_id, "env:TELEGRAM_CHAT_ID"),
      notify_on_hire_request: bool(notif.notify_on_hire_request, true),
      notify_on_hire_accepted: bool(notif.notify_on_hire_accepted, true),
      notify_on_hire_rejected: bool(notif.notify_on_hire_rejected, true),
      notify_on_delivery: bool(notif.notify_on_delivery, true),
      notify_on_dispute: bool(notif.notify_on_dispute, true),
      notify_on_channel_challenge: bool(notif.notify_on_channel_challenge, true),
      notify_on_low_balance: bool(notif.notify_on_low_balance, true),
      low_balance_threshold_eth: str(notif.low_balance_threshold_eth, "0.005"),
      discord: { webhook_url: str(notifDiscord.webhook_url) },
      webhook: {
        url: str(notifWebhook.url),
        headers: (notifWebhook.headers as Record<string, string>) ?? {},
      },
      email: {
        smtp_host: str(notifEmail.smtp_host),
        smtp_port: num(notifEmail.smtp_port, 587),
        smtp_user: str(notifEmail.smtp_user),
        smtp_pass: str(notifEmail.smtp_pass, "env:SMTP_PASS"),
        to: str(notifEmail.to),
      },
    },
    work: {
      handler: (str(work.handler, "noop")) as "exec" | "http" | "noop",
      exec_command: str(work.exec_command),
      http_url: str(work.http_url),
      http_auth_token: str(work.http_auth_token),
    },
    compute: {
      enabled:                    bool(compute.enabled, false),
      gpu_spec:                   str(compute.gpu_spec),
      rate_per_hour_wei:          str(compute.rate_per_hour_wei, "0"),
      max_concurrent_sessions:    num(compute.max_concurrent_sessions, 1),
      metering_interval_seconds:  num(compute.metering_interval_seconds, 30),
      report_interval_minutes:    num(compute.report_interval_minutes, 15),
      auto_accept_compute:        bool(compute.auto_accept_compute, false),
      min_session_hours:          num(compute.min_session_hours, 1),
      max_session_hours:          num(compute.max_session_hours, 24),
      compute_agreement_address:  str(compute.compute_agreement_address),
    },
    delivery: {
      max_file_size_mb: num(delivery.max_file_size_mb, 100),
      max_job_size_mb:  num(delivery.max_job_size_mb, 500),
      auto_download:    bool(delivery.auto_download, true),
      serve_files:      bool(delivery.serve_files, true),
    },
    worker: {
      agent_type:            str(worker.agent_type, "openclaw"),
      max_concurrent_jobs:   num(worker.max_concurrent_jobs, 2),
      job_timeout_seconds:   num(worker.job_timeout_seconds, 3600),
      auto_execute:          bool(worker.auto_execute, true),
    },
  };
}

export function loadDaemonConfig(configPath = DAEMON_TOML): DaemonConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`daemon.toml not found at ${configPath}. Run: arc402 daemon init`);
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Failed to parse daemon.toml: ${err instanceof Error ? err.message : String(err)}`);
  }

  const config = withDefaults(parsed);

  // Required fields
  if (!config.wallet.contract_address) {
    throw new Error("daemon.toml: wallet.contract_address is required");
  }
  if (!config.network.rpc_url) {
    throw new Error("daemon.toml: network.rpc_url is required");
  }
  if (!config.network.chain_id) {
    throw new Error("daemon.toml: network.chain_id is required");
  }

  // Machine key MUST use env: prefix — never hardcoded
  if (!config.wallet.machine_key.startsWith("env:")) {
    throw new Error("ERROR: machine_key must use env: prefix — never hardcode keys");
  }

  // Resolve optional env: values silently (missing = disabled feature)
  config.notifications.telegram_bot_token = tryResolveEnvValue(config.notifications.telegram_bot_token);
  config.notifications.telegram_chat_id = tryResolveEnvValue(config.notifications.telegram_chat_id);
  config.notifications.discord.webhook_url = tryResolveEnvValue(config.notifications.discord.webhook_url);
  config.notifications.webhook.url = tryResolveEnvValue(config.notifications.webhook.url);
  config.notifications.email.smtp_pass = tryResolveEnvValue(config.notifications.email.smtp_pass);
  config.work.http_auth_token = tryResolveEnvValue(config.work.http_auth_token);

  return config;
}

export function loadMachineKey(config: DaemonConfig): { privateKey: string; address: string } {
  const envVarName = config.wallet.machine_key.startsWith("env:")
    ? config.wallet.machine_key.slice(4)
    : "ARC402_MACHINE_KEY";

  const privateKey = process.env[envVarName];
  if (!privateKey) {
    throw new Error(`Machine key not found. Set environment variable: ${envVarName}`);
  }

  const { ethers } = require("ethers") as typeof import("ethers");
  let address: string;
  try {
    const w = new ethers.Wallet(privateKey);
    address = w.address;
  } catch {
    throw new Error(`Invalid machine key format in ${envVarName}`);
  }

  return { privateKey, address };
}

export const TEMPLATE_DAEMON_TOML = `# ~/.arc402/daemon.toml
# ARC-402 Daemon Configuration
# Generated by: arc402 daemon init
#
# SECURITY: Never put private keys here. Use environment variables.

[wallet]
contract_address = ""        # ARC402Wallet contract address (required)
owner_address = ""           # Owner EOA address — for display and verification only
machine_key = "env:ARC402_MACHINE_KEY"  # Machine key loaded from environment. NEVER hardcode here.

[network]
rpc_url = "https://mainnet.base.org"  # Public Base RPC (default)
chain_id = 8453                          # Base mainnet. Use 84532 for Base Sepolia.
entry_point = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"  # ERC-4337 EntryPoint v0.7

[bundler]
mode = "external"                # external | arc402 | self
endpoint = ""                    # Required when mode = external. Pimlico, Alchemy, etc.
earn_fees = false                # self mode only: bundle for other network agents
eth_float = "0.01"               # Minimum ETH to maintain in bundler EOA for gas fronting
sweep_threshold = "0.005"        # Sweep fees to wallet when bundler EOA exceeds this (ETH)
sweep_to = ""                    # Sweep destination. Defaults to wallet.contract_address.
rpc_url = ""                     # self mode: private RPC. Defaults to network.rpc_url if empty.

[relay]
enabled = true
listen_port = 4402               # Port for incoming relay messages
endpoint = ""                    # Your public URL — run: arc402 setup endpoint
                                 # Example: https://gigabrain.arc402.xyz
max_concurrent_agreements = 10   # Refuse new hire requests when this many are in-flight
poll_interval_seconds = 2        # How often to poll relay for incoming messages
relay_url = ""                   # The relay to poll. Defaults to agent metadata relay if empty.

[watchtower]
enabled = true
poll_interval_seconds = 60       # How often to poll chain for stale-close events
challenge_confirmation_blocks = 2  # Wait N block confirmations before accepting close as final
external_watchtower_url = ""     # Register open channels here as backup (Tier 2 watchtower)
update_interval_states = 10      # Forward state to external watchtower every N state changes

[policy]
auto_accept = false              # If true: auto-accept all hire requests within policy bounds
max_price_eth = "0.1"           # Refuse any hire priced above this (ETH)
allowed_capabilities = []        # Empty list = accept any capability. Non-empty = whitelist.
require_min_trust_score = 50    # Refuse hirers whose wallet trust score is below this (0–100)
min_hire_lead_time_seconds = 300  # Refuse hires with delivery deadline < this many seconds away

[notifications]
telegram_bot_token = "env:TELEGRAM_BOT_TOKEN"   # Load from env, not hardcoded
telegram_chat_id = "env:TELEGRAM_CHAT_ID"        # Load from env, not hardcoded
notify_on_hire_request = true    # Notify when a hire request arrives (pending approval)
notify_on_hire_accepted = true   # Notify when daemon accepts a hire
notify_on_hire_rejected = true   # Notify when daemon rejects a hire
notify_on_delivery = true        # Notify when work is delivered and fulfill() submitted
notify_on_dispute = true         # Notify when a dispute is raised (by either party)
notify_on_channel_challenge = true  # Notify when watchtower submits a channel challenge
notify_on_low_balance = false    # Disabled by default — enable if you want balance alerts
low_balance_threshold_eth = "0.005"  # Balance alert threshold

[notifications.discord]
webhook_url = ""                 # Discord channel webhook URL (leave empty to disable)

[notifications.webhook]
url = ""                         # POST JSON {title, body, timestamp} to this URL (leave empty to disable)
# headers = { Authorization = "Bearer ..." }  # Optional headers

[notifications.email]
smtp_host = ""                   # SMTP server hostname (leave empty to disable)
smtp_port = 587
smtp_user = ""                   # SMTP login / from address
smtp_pass = "env:SMTP_PASS"      # Load from env, not hardcoded
to = ""                          # Recipient address

[work]
handler = "noop"               # exec | http | noop
exec_command = ""              # called with agreementId and spec as args (exec mode)
http_url = ""                  # POST {agreementId, specHash, deadline} as JSON (http mode)
http_auth_token = "env:WORKER_AUTH_TOKEN"

[compute]
enabled = false                          # Enable GPU compute rental
gpu_spec = ""                            # GPU model identifier (e.g. nvidia-h100-80gb)
rate_per_hour_wei = "0"                  # Wei per GPU-hour (0 = disabled)
max_concurrent_sessions = 1             # Usually 1 (one GPU per session)
metering_interval_seconds = 30          # nvidia-smi poll interval
report_interval_minutes = 15            # Usage report generation interval
auto_accept_compute = false             # Auto-accept compute proposals
min_session_hours = 1                   # Minimum session duration
max_session_hours = 24                  # Maximum session duration

[delivery]
max_file_size_mb = 100           # Maximum size for a single uploaded file (MB)
max_job_size_mb = 500            # Maximum total size for all files in a job (MB)
auto_download = true             # Auto-download and verify files on delivery notification
serve_files = true               # Serve file endpoints (/job/:id/files, /job/:id/manifest)

[worker]
agent_type = "openclaw"          # Runtime to execute hired work: openclaw (default) | claude-code | codex | shell
                                 # openclaw is preferred — has auth built in, can spawn any ACP (Claude, Codex, etc.)
max_concurrent_jobs = 2          # Maximum jobs running simultaneously
job_timeout_seconds = 3600       # Kill job after this many seconds (default: 1h)
auto_execute = true              # true: spawn agent automatically after accept. false: accept on-chain, await manual trigger.
`;
