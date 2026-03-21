import { Command } from "commander";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { c } from "../ui/colors";

const ARC402_DIR = path.join(os.homedir(), ".arc402");

// Files/patterns to exclude from backup
const EXCLUDE_PATTERNS = [
  "daemon.db",
  "daemon.log",
  "daemon.pid",
  "daemon.sock",
  "repl_history",
];

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function registerBackupCommand(program: Command): void {
  // ── backup ─────────────────────────────────────────────────────────────────
  program
    .command("backup")
    .description("Backup ~/.arc402/ config, keys, and wallet storage to a tar.gz archive")
    .option("--output <path>", "Output file path (default: arc402-backup-YYYY-MM-DD.tar.gz)")
    .action((opts: { output?: string }) => {
      if (!fs.existsSync(ARC402_DIR)) {
        console.error(`  ${c.failure} No ~/.arc402/ directory found. Nothing to back up.`);
        process.exit(1);
      }

      const outFile = opts.output ?? `arc402-backup-${todayStr()}.tar.gz`;
      const absOut = path.isAbsolute(outFile) ? outFile : path.join(process.cwd(), outFile);

      // Build --exclude flags
      const excludeFlags = EXCLUDE_PATTERNS.map((p) => `--exclude='.arc402/${p}'`).join(" ");

      try {
        execSync(
          `tar -czf "${absOut}" ${excludeFlags} -C "${os.homedir()}" .arc402`,
          { stdio: "pipe" }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ${c.failure} Backup failed: ${msg}`);
        process.exit(1);
      }

      // Verify the file was created
      if (!fs.existsSync(absOut)) {
        console.error(`  ${c.failure} Archive not found after tar completed.`);
        process.exit(1);
      }

      const sizeBytes = fs.statSync(absOut).size;
      const sizeStr = sizeBytes < 1024
        ? `${sizeBytes} B`
        : sizeBytes < 1024 * 1024
        ? `${(sizeBytes / 1024).toFixed(1)} KB`
        : `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;

      console.log(`  ${c.success} Backup saved to ${c.white(path.basename(absOut))}  ${c.dim(`(${sizeStr})`)}`);
    });

  // ── restore ────────────────────────────────────────────────────────────────
  program
    .command("restore")
    .description("Restore ~/.arc402/ from a backup archive")
    .argument("<archive>", "Path to arc402-backup-*.tar.gz")
    .action((archive: string) => {
      const absArchive = path.isAbsolute(archive) ? archive : path.join(process.cwd(), archive);

      if (!fs.existsSync(absArchive)) {
        console.error(`  ${c.failure} Archive not found: ${absArchive}`);
        process.exit(1);
      }

      // Warn if ~/.arc402/ already exists
      if (fs.existsSync(ARC402_DIR)) {
        const existing = fs.readdirSync(ARC402_DIR);
        if (existing.length > 0) {
          console.warn(`  ${c.warning} Existing ~/.arc402/ has ${existing.length} file(s) — merging (existing files take precedence for conflicts).`);
        }
      }

      try {
        // Extract to home dir — tar archive has .arc402/ as the root entry
        execSync(`tar -xzf "${absArchive}" -C "${os.homedir()}"`, { stdio: "pipe" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ${c.failure} Restore failed: ${msg}`);
        process.exit(1);
      }

      // Verify config.json is present
      const configPath = path.join(ARC402_DIR, "config.json");
      if (!fs.existsSync(configPath)) {
        console.error(`  ${c.failure} config.json not found after restore — archive may be incomplete.`);
        process.exit(1);
      }

      // Fix permissions on restored directory
      try {
        fs.chmodSync(ARC402_DIR, 0o700);
        fs.chmodSync(configPath, 0o600);
      } catch { /* best-effort */ }

      console.log(`  ${c.success} Config restored. Run ${c.white("arc402 doctor")} to verify.`);
    });
}
