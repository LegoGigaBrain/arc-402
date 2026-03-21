import { Command } from "commander";
import { ethers } from "ethers";
import { loadConfig } from "../config";
import { getClient, requireSigner } from "../client";
import { c } from '../ui/colors';
import { startSpinner } from '../ui/spinner';
import { renderTree } from '../ui/tree';
import { formatAddress } from '../ui/format';

const MIGRATION_REGISTRY_ABI = [
  "function registerMigration(address oldWallet, address newWallet) external",
  "function resolveActiveWallet(address wallet) external view returns (address)",
  "function getLineage(address wallet) external view returns (address[])",
  "function migratedTo(address wallet) external view returns (address)",
  "function migratedFrom(address wallet) external view returns (address)",
  "event MigrationRegistered(address indexed oldWallet, address indexed newWallet, address indexed owner, uint256 migratedAt, uint256 scoreAtMigration, uint256 appliedDecay)",
] as const;

export function registerMigrateCommands(program: Command): void {
  const migrate = program
    .command("migrate")
    .description("Wallet migration — register, query status, or print lineage history")
    .argument("[oldWallet]", "old wallet address (required for registration)")
    .argument("[newWallet]", "new wallet address (required for registration)")
    .option("--json")
    .action(async (oldWallet, newWallet, opts) => {
      if (!oldWallet || !newWallet) {
        console.error("Usage: arc402 migrate <oldWallet> <newWallet>");
        console.error("Both wallets must share the same registered owner address.");
        process.exit(1);
      }

      const config = loadConfig();
      if (!config.migrationRegistryAddress) {
        console.error("migrationRegistryAddress not configured. Run `arc402 config set migrationRegistryAddress <address>`.");
        process.exit(1);
      }

      const { signer } = await requireSigner(config);
      const contract = new ethers.Contract(config.migrationRegistryAddress, MIGRATION_REGISTRY_ABI, signer);

      const migrateSpinner = startSpinner('Registering migration...');
      const tx = await contract.registerMigration(oldWallet, newWallet);
      const receipt = await tx.wait();
      migrateSpinner.succeed('Migration registered');

      const payload = {
        oldWallet,
        newWallet,
        txHash: receipt.hash,
      };
      if (opts.json) return console.log(JSON.stringify(payload, null, 2));
      renderTree([
        { label: 'Old', value: formatAddress(oldWallet) },
        { label: 'New', value: formatAddress(newWallet) },
        { label: 'Note', value: '10% trust score decay applied', last: true },
      ]);
    });

  // ─── migrate status <address> ──────────────────────────────────────────────

  migrate
    .command("status <address>")
    .description("Show whether a wallet is in a migration lineage and its current active wallet")
    .option("--json")
    .action(async (address, opts) => {
      const config = loadConfig();
      if (!config.migrationRegistryAddress) {
        console.error("migrationRegistryAddress not configured. Run `arc402 config set migrationRegistryAddress <address>`.");
        process.exit(1);
      }

      const { provider } = await getClient(config);
      const contract = new ethers.Contract(config.migrationRegistryAddress, MIGRATION_REGISTRY_ABI, provider);

      const [activeWallet, migratedTo, migratedFrom] = await Promise.all([
        contract.resolveActiveWallet(address),
        contract.migratedTo(address),
        contract.migratedFrom(address),
      ]);

      const isCurrent = activeWallet.toLowerCase() === address.toLowerCase();
      const hasMigrated = migratedTo !== ethers.ZeroAddress;
      const wasSource = migratedFrom !== ethers.ZeroAddress;

      const payload = {
        address,
        activeWallet,
        isCurrent,
        migratedTo: hasMigrated ? migratedTo : null,
        migratedFrom: wasSource ? migratedFrom : null,
      };
      if (opts.json) return console.log(JSON.stringify(payload, null, 2));
      console.log(`address=${address}`);
      console.log(`  active wallet: ${activeWallet}`);
      if (isCurrent) {
        console.log(`  status: current (no further migration)`);
      } else {
        console.log(`  status: migrated — score queries resolve to ${activeWallet}`);
      }
      if (hasMigrated) console.log(`  migrated to:   ${migratedTo}`);
      if (wasSource)   console.log(`  migrated from: ${migratedFrom}`);
    });

  // ─── migrate lineage <address> ────────────────────────────────────────────

  migrate
    .command("lineage <address>")
    .description("Print full migration lineage history with timestamps")
    .option("--json")
    .action(async (address, opts) => {
      const config = loadConfig();
      if (!config.migrationRegistryAddress) {
        console.error("migrationRegistryAddress not configured. Run `arc402 config set migrationRegistryAddress <address>`.");
        process.exit(1);
      }

      const { provider } = await getClient(config);
      const contract = new ethers.Contract(config.migrationRegistryAddress, MIGRATION_REGISTRY_ABI, provider);

      const lineage: string[] = await contract.getLineage(address);

      if (lineage.length === 0) {
        const payload = { address, lineage: [], migrations: 0 };
        if (opts.json) return console.log(JSON.stringify(payload, null, 2));
        console.log(`address=${address}`);
        console.log(`  no migration history`);
        return;
      }

      // Fetch MigrationRegistered events for timestamps and decay info
      interface MigrationEntry { step: number; from: string; to: string; timestamp: string | null; scoreAtMigration: string | null; decayBps: string | null }
      const entries: MigrationEntry[] = [];

      for (let i = 0; i < lineage.length - 1; i++) {
        const from = lineage[i];
        const to = lineage[i + 1];
        let timestamp: string | null = null;
        let scoreAtMigration: string | null = null;
        let decayBps: string | null = null;

        try {
          const filter = contract.filters.MigrationRegistered(from, to);
          const events = await contract.queryFilter(filter);
          if (events.length > 0) {
            const ev = events[0] as ethers.EventLog;
            const block = await provider.getBlock(ev.blockNumber);
            timestamp = block ? new Date(block.timestamp * 1000).toISOString() : null;
            scoreAtMigration = ev.args[3]?.toString() ?? null;
            decayBps = ev.args[4]?.toString() ?? null;
          }
        } catch {
          // event query not critical — continue without timestamps
        }

        entries.push({ step: i + 1, from, to, timestamp, scoreAtMigration, decayBps });
      }

      const payload = {
        address,
        lineage,
        migrations: entries.length,
        history: entries,
      };
      if (opts.json) return console.log(JSON.stringify(payload, null, 2));

      console.log(`address=${address}`);
      console.log(`  lineage depth: ${lineage.length} wallet${lineage.length !== 1 ? "s" : ""}`);
      console.log(`  migrations:    ${entries.length}`);
      console.log();
      lineage.forEach((addr, i) => {
        const label = i === 0 ? " (origin)" : i === lineage.length - 1 ? " (current)" : "";
        console.log(`  [${i}] ${addr}${label}`);
        if (i < entries.length) {
          const e = entries[i];
          if (e.timestamp) console.log(`      migrated: ${e.timestamp}`);
          if (e.scoreAtMigration) console.log(`      score at migration: ${e.scoreAtMigration} (decay: ${Number(e.decayBps) / 100}%)`);
        }
      });
    });
}
