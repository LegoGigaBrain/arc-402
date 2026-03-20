import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { parse as parseToml } from "smol-toml";
import { loadConfig } from "./config";

export const ARC402_DIR = path.join(os.homedir(), ".arc402");
export const OPENSHELL_TOML = path.join(ARC402_DIR, "openshell.toml");
export const OPENSHELL_RUNTIME_DIR = path.join(ARC402_DIR, "openshell-runtime");
export const OPENSHELL_RUNTIME_TARBALL = path.join(OPENSHELL_RUNTIME_DIR, "arc402-cli-runtime.tgz");
export const DEFAULT_RUNTIME_REMOTE_ROOT = "/sandbox/.arc402/runtime/arc402-cli";

export interface OpenShellConfig {
  sandbox: { name: string; policy?: string; providers?: string[] };
  runtime?: {
    local_tarball?: string;
    remote_root?: string;
    synced_at?: string;
  };
}

export function runCmd(
  cmd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; input?: string; timeout?: number } = {}
): { stdout: string; stderr: string; ok: boolean; status: number | null } {
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
    status: result.status,
  };
}

export interface DockerAccessStatus {
  ok: boolean;
  detail: string;
}

export function detectDockerAccess(): DockerAccessStatus {
  const result = runCmd("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 20000 });
  if (result.ok) {
    return { ok: true, detail: `running (${result.stdout || "version unknown"})` };
  }

  const detail = result.stderr || result.stdout || "Docker is unavailable";
  if (/permission denied/i.test(detail)) {
    return { ok: false, detail: "installed but this shell cannot access the Docker daemon" };
  }
  if (/Cannot connect to the Docker daemon/i.test(detail) || /Is the docker daemon running/i.test(detail)) {
    return { ok: false, detail: "installed but the Docker daemon is not running" };
  }
  if (/command not found/i.test(detail) || result.status === 127) {
    return { ok: false, detail: "not installed" };
  }
  return { ok: false, detail };
}

export function resolveOpenShellSecrets(): {
  machineKey?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
} {
  let machineKey = process.env["ARC402_MACHINE_KEY"];
  let telegramBotToken = process.env["TELEGRAM_BOT_TOKEN"];
  let telegramChatId = process.env["TELEGRAM_CHAT_ID"];

  try {
    const config = loadConfig();
    if (!machineKey && config.privateKey) machineKey = config.privateKey;
    if (!telegramBotToken && config.telegramBotToken) telegramBotToken = config.telegramBotToken;
    if (!telegramChatId && config.telegramChatId) telegramChatId = config.telegramChatId;
  } catch {
    // CLI config is optional here; env vars still win when present.
  }

  return { machineKey, telegramBotToken, telegramChatId };
}

export function buildOpenShellSecretExports(requireMachineKey = false): string {
  const secrets = resolveOpenShellSecrets();
  const exports: string[] = [];

  if (secrets.machineKey) {
    exports.push(`export ARC402_MACHINE_KEY=${shellEscape(secrets.machineKey)}`);
  } else if (requireMachineKey) {
    throw new Error("ARC402 machine key not found in env or arc402 config");
  }

  if (secrets.telegramBotToken) {
    exports.push(`export TELEGRAM_BOT_TOKEN=${shellEscape(secrets.telegramBotToken)}`);
  }
  if (secrets.telegramChatId) {
    exports.push(`export TELEGRAM_CHAT_ID=${shellEscape(secrets.telegramChatId)}`);
  }

  return exports.join(" && ");
}

export function readOpenShellConfig(): OpenShellConfig | null {
  if (!fs.existsSync(OPENSHELL_TOML)) return null;
  try {
    const raw = fs.readFileSync(OPENSHELL_TOML, "utf-8");
    const parsed = parseToml(raw) as Record<string, unknown>;
    const sb = parsed.sandbox as Record<string, unknown> | undefined;
    if (!sb || typeof sb.name !== "string") return null;
    const runtime = parsed.runtime as Record<string, unknown> | undefined;
    return {
      sandbox: {
        name: sb.name,
        policy: typeof sb.policy === "string" ? sb.policy : undefined,
        providers: Array.isArray(sb.providers) ? (sb.providers as string[]) : undefined,
      },
      runtime: runtime ? {
        local_tarball: typeof runtime.local_tarball === "string" ? runtime.local_tarball : undefined,
        remote_root: typeof runtime.remote_root === "string" ? runtime.remote_root : undefined,
        synced_at: typeof runtime.synced_at === "string" ? runtime.synced_at : undefined,
      } : undefined,
    };
  } catch {
    return null;
  }
}

export function writeOpenShellConfig(config: OpenShellConfig): void {
  fs.mkdirSync(ARC402_DIR, { recursive: true, mode: 0o700 });
  const providers = (config.sandbox.providers ?? []).map((p) => `"${p}"`).join(", ");
  const lines = [
    "# ARC-402 OpenShell configuration",
    "# Written by: arc402 openshell init / sync-runtime",
    "",
    "[sandbox]",
    `name = "${config.sandbox.name}"`,
    config.sandbox.policy ? `policy = "${config.sandbox.policy}"` : "",
    `providers = [${providers}]`,
    "",
    "[runtime]",
    `local_tarball = "${config.runtime?.local_tarball ?? OPENSHELL_RUNTIME_TARBALL}"`,
    `remote_root = "${config.runtime?.remote_root ?? DEFAULT_RUNTIME_REMOTE_ROOT}"`,
    `synced_at = "${config.runtime?.synced_at ?? new Date().toISOString()}"`,
    "",
  ].filter(Boolean);
  fs.writeFileSync(OPENSHELL_TOML, lines.join("\n"), { mode: 0o600 });
}

function findCliRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    const pkg = path.join(current, "package.json");
    const dist = path.join(current, "dist", "index.js");
    if (fs.existsSync(pkg) && fs.existsSync(dist)) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error("Could not locate ARC-402 CLI root from current install path");
    current = parent;
  }
}

export function buildRuntimeTarball(): { cliRoot: string; tarballPath: string } {
  const cliRoot = findCliRoot(__dirname);
  fs.mkdirSync(OPENSHELL_RUNTIME_DIR, { recursive: true, mode: 0o700 });

  const tar = runCmd(
    "tar",
    [
      "-czf",
      OPENSHELL_RUNTIME_TARBALL,
      "package.json",
      "package-lock.json",
      "dist",
      "node_modules",
    ],
    { timeout: 300000, env: process.env }
  );

  if (!tar.ok) {
    // Retry from the cli root via shell so relative paths resolve correctly.
    const shellTar = runCmd(
      "bash",
      [
        "-lc",
        `cd ${shellEscape(cliRoot)} && tar -czf ${shellEscape(OPENSHELL_RUNTIME_TARBALL)} package.json package-lock.json dist node_modules`,
      ],
      { timeout: 300000 }
    );
    if (!shellTar.ok) {
      throw new Error(shellTar.stderr || shellTar.stdout || "Failed to build ARC-402 runtime tarball");
    }
  }

  return { cliRoot, tarballPath: OPENSHELL_RUNTIME_TARBALL };
}

export function buildOpenShellSshConfig(sandboxName: string): { configPath: string; host: string } {
  const sshConfig = runCmd("openshell", ["sandbox", "ssh-config", sandboxName], { timeout: 120000 });
  if (!sshConfig.ok || !sshConfig.stdout.trim()) {
    throw new Error(`Failed to get OpenShell SSH config for sandbox ${sandboxName}: ${sshConfig.stderr || sshConfig.stdout || "unknown error"}`);
  }
  const hostMatch = sshConfig.stdout.match(/^Host\s+(\S+)/m);
  if (!hostMatch) {
    throw new Error(`Could not parse OpenShell SSH host alias for sandbox ${sandboxName}`);
  }
  const configPath = path.join(os.tmpdir(), `arc402-openshell-${sandboxName}.ssh`);
  fs.writeFileSync(configPath, sshConfig.stdout, { mode: 0o600 });
  return { configPath, host: hostMatch[1] };
}

export function provisionFileToSandbox(sandboxName: string, localPath: string, remotePath: string): void {
  if (!fs.existsSync(localPath)) {
    throw new Error(`Local file not found: ${localPath}`);
  }

  const remoteDir = path.posix.dirname(remotePath);
  const uploadDir = `/tmp/arc402-upload-${Date.now()}`;
  const { configPath, host } = buildOpenShellSshConfig(sandboxName);

  const prep = runCmd("ssh", ["-F", configPath, host, `rm -rf ${shellEscape(uploadDir)} && mkdir -p ${shellEscape(uploadDir)} && mkdir -p ${shellEscape(remoteDir)}`], { timeout: 120000 });
  if (!prep.ok) {
    throw new Error(`Failed to prepare remote upload directory: ${prep.stderr || prep.stdout}`);
  }

  const upload = runCmd("openshell", ["sandbox", "upload", sandboxName, localPath, uploadDir], { timeout: 300000 });
  if (!upload.ok) {
    throw new Error(`Failed to upload ${path.basename(localPath)}: ${upload.stderr || upload.stdout}`);
  }

  const remoteUploaded = path.posix.join(uploadDir, path.basename(localPath));
  const move = runCmd("ssh", ["-F", configPath, host, `cp ${shellEscape(remoteUploaded)} ${shellEscape(remotePath)}`], { timeout: 120000 });
  if (!move.ok) {
    throw new Error(`Failed to place ${path.basename(localPath)} at ${remotePath}: ${move.stderr || move.stdout}`);
  }
}

export function provisionRuntimeToSandbox(
  sandboxName: string,
  remoteRoot = DEFAULT_RUNTIME_REMOTE_ROOT,
): { tarballPath: string; remoteRoot: string } {
  const { tarballPath } = buildRuntimeTarball();
  const remoteUploadDir = `/tmp/arc402-runtime-upload-${Date.now()}`;
  const remoteTarball = `${remoteUploadDir}/arc402-cli-runtime.tgz`;
  const { configPath, host } = buildOpenShellSshConfig(sandboxName);

  const prep = runCmd("ssh", ["-F", configPath, host, `rm -rf ${shellEscape(remoteUploadDir)} && mkdir -p ${shellEscape(remoteUploadDir)}`], { timeout: 120000 });
  if (!prep.ok) {
    throw new Error(`Failed to prepare remote upload directory: ${prep.stderr || prep.stdout}`);
  }

  const upload = runCmd("openshell", ["sandbox", "upload", sandboxName, tarballPath, remoteUploadDir], { timeout: 300000 });
  if (!upload.ok) {
    throw new Error(`Failed to upload ARC-402 runtime bundle: ${upload.stderr || upload.stdout}`);
  }

  const extract = runCmd(
    "ssh",
    [
      "-F", configPath,
      host,
      `mkdir -p ${shellEscape(remoteRoot)} && tar -xzf ${shellEscape(remoteTarball)} -C ${shellEscape(remoteRoot)} && test -f ${shellEscape(path.posix.join(remoteRoot, "dist/daemon/index.js"))}`,
    ],
    { timeout: 300000 }
  );
  if (!extract.ok) {
    throw new Error(`Failed to provision ARC-402 runtime inside sandbox: ${extract.stderr || extract.stdout}`);
  }

  return { tarballPath, remoteRoot };
}

export function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
