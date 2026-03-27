/**
 * arc402 job — party-gated file delivery commands.
 *
 * Subcommands:
 *   files    <agreementId>              List delivered files
 *   fetch    <agreementId>              Download one or all files
 *   manifest <agreementId>              Show manifest metadata
 */

import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ethers } from "ethers";
import chalk from "chalk";
import { loadConfig, Arc402Config } from "../config";
import { getClient } from "../client";
import { SERVICE_AGREEMENT_ABI } from "../abis";
import { resolveAgentEndpoint, validateEndpointUrl } from "../endpoint-notify";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function truncHash(hash: string): string {
  if (!hash || hash.length < 16) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

type AuthHeaders = Record<string, string>;

async function buildAuthHeaders(privateKey: string, agreementId: string, walletContractAddress?: string): Promise<AuthHeaders> {
  const wallet = new ethers.Wallet(privateKey);
  const message = `arc402:download:${agreementId}`;
  const sig = await wallet.signMessage(message);
  const headers: AuthHeaders = {
    "X-ARC402-Signature": sig,
    "X-ARC402-Signer": wallet.address, // the EOA that actually signed
  };
  // If operator has a smart wallet, include it so the daemon can verify party membership.
  // V6 wallets sign via machine key EOA — the wallet contract is the on-chain party.
  if (walletContractAddress) {
    headers["X-ARC402-Wallet"] = walletContractAddress;
  }
  return headers;
}

async function resolveProviderEndpoint(
  config: Arc402Config,
  agreementId: string
): Promise<{ endpoint: string; provider: string }> {
  if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
  const { provider: ethProvider } = await getClient(config);

  const sa = new ethers.Contract(config.serviceAgreementAddress, SERVICE_AGREEMENT_ABI, ethProvider);
  const ag = await sa.getAgreement(BigInt(agreementId));
  const providerAddress: string = ag.provider;

  const registryAddress =
    config.agentRegistryAddress ?? config.agentRegistryV2Address ?? config.arc402RegistryV3Address;
  const endpoint = await resolveAgentEndpoint(providerAddress, ethProvider, registryAddress);
  if (!endpoint) throw new Error(`Provider ${providerAddress} has no registered endpoint`);

  return { endpoint, provider: providerAddress };
}

function handleHttpError(status: number, agreementId: string): never {
  if (status === 401 || status === 403) {
    console.error(`Not authorized — machine key not a party to this agreement (${agreementId})`);
    process.exit(1);
  }
  if (status === 404) {
    console.error(`No files delivered yet for this agreement (${agreementId})`);
    process.exit(1);
  }
  throw new Error(`Unexpected HTTP ${status}`);
}

// ─── Manifest types ───────────────────────────────────────────────────────────

interface ManifestFile {
  name: string;
  size: number;
  hash: string;
}

interface Manifest {
  agreement_id?: string;
  root_hash?: string;
  files: ManifestFile[];
  created_at?: string;
}

// ─── Register ─────────────────────────────────────────────────────────────────

export function registerJobCommands(program: Command): void {
  const job = program
    .command("job")
    .description("Party-gated file delivery: list, download, and inspect job manifests");

  // ── arc402 job files <agreementId> ─────────────────────────────────────────
  job
    .command("files <agreementId>")
    .description("List files delivered for an agreement")
    .option("--json", "Output raw JSON")
    .action(async (agreementId: string, opts: { json?: boolean }) => {
      const config = loadConfig();
      if (!config.privateKey) throw new Error("privateKey missing in config — needed to sign download request");

      const { endpoint } = await resolveProviderEndpoint(config, agreementId);
      await validateEndpointUrl(endpoint);
      const headers = await buildAuthHeaders(config.privateKey, agreementId, config.walletContractAddress ?? undefined);

      const res = await fetch(`${endpoint}/job/${agreementId}/files`, { headers });
      if (!res.ok) handleHttpError(res.status, agreementId);

      const data = (await res.json()) as { files: ManifestFile[] } | ManifestFile[];
      const files: ManifestFile[] = Array.isArray(data) ? data : (data as { files: ManifestFile[] }).files;

      if (opts.json) {
        console.log(JSON.stringify(files, null, 2));
        return;
      }

      if (!files || files.length === 0) {
        console.log("No files found.");
        return;
      }

      const col1 = Math.max(8, ...files.map((f) => f.name.length));
      const col2 = 10;
      const col3 = 18;
      const header = `${"Filename".padEnd(col1)}  ${"Size".padStart(col2)}  ${"Hash".padEnd(col3)}`;
      console.log(chalk.bold(header));
      console.log("─".repeat(header.length));
      for (const f of files) {
        console.log(`${f.name.padEnd(col1)}  ${humanSize(f.size).padStart(col2)}  ${truncHash(f.hash)}`);
      }
    });

  // ── arc402 job fetch <agreementId> ─────────────────────────────────────────
  job
    .command("fetch <agreementId>")
    .description("Download delivered files for an agreement")
    .option("--file <name>", "Fetch a single file by name")
    .option("--all", "Fetch all files listed in the manifest")
    .option("--out <dir>", "Output directory (default: ~/.arc402/downloads/<agreementId>/)")
    .action(async (agreementId: string, opts: { file?: string; all?: boolean; out?: string }) => {
      const config = loadConfig();
      if (!config.privateKey) throw new Error("privateKey missing in config — needed to sign download request");
      if (!opts.file && !opts.all) {
        console.error("Specify --file <name> to download a single file, or --all to download everything.");
        process.exit(1);
      }

      const outDir = opts.out ?? path.join(os.homedir(), ".arc402", "downloads", agreementId);
      fs.mkdirSync(outDir, { recursive: true });

      const { endpoint } = await resolveProviderEndpoint(config, agreementId);
      await validateEndpointUrl(endpoint);
      const headers = await buildAuthHeaders(config.privateKey, agreementId, config.walletContractAddress ?? undefined);

      if (opts.file) {
        const name = opts.file;
        const res = await fetch(`${endpoint}/job/${agreementId}/files/${encodeURIComponent(name)}`, { headers });
        if (!res.ok) handleHttpError(res.status, agreementId);

        const buf = Buffer.from(await res.arrayBuffer());
        const outPath = path.join(outDir, name);
        fs.writeFileSync(outPath, buf);
        console.log(`Saved to ${outPath}`);
        return;
      }

      // --all: fetch manifest first, then download each file
      const manifestRes = await fetch(`${endpoint}/job/${agreementId}/manifest`, { headers });
      if (!manifestRes.ok) handleHttpError(manifestRes.status, agreementId);
      const manifest = (await manifestRes.json()) as Manifest;
      const files: ManifestFile[] = manifest.files ?? [];

      if (files.length === 0) {
        console.log("Manifest contains no files.");
        return;
      }

      let allOk = true;
      for (const f of files) {
        const fileRes = await fetch(
          `${endpoint}/job/${agreementId}/files/${encodeURIComponent(f.name)}`,
          { headers }
        );
        if (!fileRes.ok) {
          console.log(`✗ ${f.name} — HTTP ${fileRes.status}`);
          allOk = false;
          continue;
        }
        const buf = Buffer.from(await fileRes.arrayBuffer());

        // Verify keccak256 hash
        const computed = ethers.keccak256(new Uint8Array(buf));
        const expectedHash = f.hash.startsWith("0x") ? f.hash : `0x${f.hash}`;
        const outPath = path.join(outDir, f.name);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, buf);

        if (computed.toLowerCase() === expectedHash.toLowerCase()) {
          console.log(`✓ ${f.name} (${humanSize(f.size)}) — hash verified`);
        } else {
          console.log(
            `✗ ${f.name} — hash mismatch (got ${truncHash(computed)}, expected ${truncHash(f.hash)})`
          );
          allOk = false;
        }
      }

      console.log(`\nSaved to ${outDir}`);
      if (!allOk) process.exit(1);
    });

  // ── arc402 job manifest <agreementId> ──────────────────────────────────────
  job
    .command("manifest <agreementId>")
    .description("Show the delivery manifest for an agreement")
    .option("--json", "Output raw JSON")
    .action(async (agreementId: string, opts: { json?: boolean }) => {
      const config = loadConfig();
      if (!config.privateKey) throw new Error("privateKey missing in config — needed to sign download request");

      const { endpoint } = await resolveProviderEndpoint(config, agreementId);
      await validateEndpointUrl(endpoint);
      const headers = await buildAuthHeaders(config.privateKey, agreementId, config.walletContractAddress ?? undefined);

      const res = await fetch(`${endpoint}/job/${agreementId}/manifest`, { headers });
      if (!res.ok) handleHttpError(res.status, agreementId);

      const manifest = (await res.json()) as Manifest;

      if (opts.json) {
        console.log(JSON.stringify(manifest, null, 2));
        return;
      }

      const files: ManifestFile[] = manifest.files ?? [];
      const totalSize = files.reduce((acc, f) => acc + (f.size ?? 0), 0);

      console.log(chalk.bold("Manifest"));
      console.log(`  agreement_id : ${manifest.agreement_id ?? agreementId}`);
      if (manifest.root_hash) console.log(`  root_hash    : ${manifest.root_hash}`);
      console.log(`  files        : ${files.length}`);
      console.log(`  total size   : ${humanSize(totalSize)}`);
      if (manifest.created_at) console.log(`  created_at   : ${manifest.created_at}`);

      if (files.length > 0) {
        console.log();
        const col1 = Math.max(8, ...files.map((f) => f.name.length));
        const col2 = 10;
        const col3 = 18;
        const header = `${"Name".padEnd(col1)}  ${"Size".padStart(col2)}  ${"Hash".padEnd(col3)}`;
        console.log(chalk.bold(header));
        console.log("─".repeat(header.length));
        for (const f of files) {
          console.log(`${f.name.padEnd(col1)}  ${humanSize(f.size).padStart(col2)}  ${truncHash(f.hash)}`);
        }
      }
    });
}
