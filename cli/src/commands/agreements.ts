import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { ethers } from "ethers";
import { loadConfig } from "../config";
import { getClient } from "../client";
import { SERVICE_AGREEMENT_ABI } from "../abis";
import {
  AgreementRow,
  printAgreementTable,
  colourStatus,
  statusFromNumber,
  truncateAddress,
  formatDate,
  getTrustTier,
} from "../utils/format";
import { formatDeadline } from "../utils/time";

function getAgreementContract(
  address: string,
  signerOrProvider: ethers.Signer | ethers.Provider
) {
  return new ethers.Contract(address, SERVICE_AGREEMENT_ABI, signerOrProvider);
}

export function registerAgreementsCommands(program: Command): void {
  // ─── agreements (list) ───────────────────────────────────────────────────

  program
    .command("agreements")
    .description("List your agreements")
    .option("--as <role>", "Role: client or provider", "client")
    .option("--status <status>", "Filter by status (proposed|accepted|fulfilled|disputed|cancelled)")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const config = loadConfig();
      const { provider, address } = await getClient(config);
      if (!address) {
        console.error(chalk.red("No private key configured."));
        process.exit(1);
      }

      const contract = getAgreementContract(config.serviceAgreementAddress, provider);
      const spinner = ora("Fetching agreements…").start();

      try {
        let ids: number[];
        if (opts.as === "provider") {
          ids = (await contract.getAgreementsByProvider(address)).map(Number);
        } else {
          ids = (await contract.getAgreementsByClient(address)).map(Number);
        }

        if (ids.length === 0) {
          spinner.succeed("No agreements found.");
          return;
        }

        const agreements = await Promise.all(
          ids.map((id) => contract.getAgreement(id))
        );

        let rows: AgreementRow[] = agreements.map((ag) => ({
          id: Number(ag.id),
          counterparty:
            opts.as === "provider" ? String(ag.client) : String(ag.provider),
          serviceType: String(ag.serviceType),
          price: BigInt(ag.price),
          token: String(ag.token),
          deadline: Number(ag.deadline),
          status: Number(ag.status),
        }));

        // Filter by status if requested
        if (opts.status) {
          const statusNum = ["proposed", "accepted", "fulfilled", "disputed", "cancelled"].indexOf(
            opts.status.toLowerCase()
          );
          if (statusNum >= 0) {
            rows = rows.filter((r) => r.status === statusNum);
          }
        }

        spinner.succeed(`Found ${rows.length} agreement(s)`);

        if (opts.json) {
          console.log(JSON.stringify(rows, null, 2));
          return;
        }

        printAgreementTable(rows);
      } catch (err: unknown) {
        spinner.fail(chalk.red("Failed to fetch agreements"));
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ─── agreement <id> ──────────────────────────────────────────────────────

  program
    .command("agreement <id>")
    .description("Show full detail for an agreement")
    .option("--json", "Output raw JSON")
    .action(async (idStr: string, opts) => {
      const id = parseInt(idStr, 10);
      const config = loadConfig();
      const { provider } = await getClient(config);
      const contract = getAgreementContract(config.serviceAgreementAddress, provider);

      try {
        const ag = await contract.getAgreement(id);

        if (opts.json) {
          console.log(
            JSON.stringify(
              {
                id: Number(ag.id),
                client: ag.client,
                provider: ag.provider,
                serviceType: ag.serviceType,
                description: ag.description,
                price: ag.price.toString(),
                token: ag.token,
                deadline: Number(ag.deadline),
                deliverablesHash: ag.deliverablesHash,
                status: statusFromNumber(Number(ag.status)),
                createdAt: Number(ag.createdAt),
                resolvedAt: Number(ag.resolvedAt),
              },
              null,
              2
            )
          );
          return;
        }

        const statusLabel = statusFromNumber(Number(ag.status));
        const isEth = ag.token === "0x0000000000000000000000000000000000000000";
        const priceStr = isEth
          ? `${ethers.formatEther(ag.price)} ETH`
          : `${(Number(ag.price) / 1e6).toFixed(2)} USDC`;

        console.log(chalk.cyan(`\n─── Agreement #${id} ─────────────────────────`));
        console.log(`  Status:      ${colourStatus(statusLabel)}`);
        console.log(`  Client:      ${ag.client}`);
        console.log(`  Provider:    ${ag.provider}`);
        console.log(`  Service:     ${ag.serviceType}`);
        console.log(`  Description: ${ag.description || "(none)"}`);
        console.log(`  Price:       ${priceStr}`);
        console.log(`  Token:       ${isEth ? "ETH" : truncateAddress(ag.token)}`);
        console.log(`  Deadline:    ${formatDate(Number(ag.deadline))} — ${formatDeadline(Number(ag.deadline))}`);
        console.log(`  Deliverables Hash: ${ag.deliverablesHash}`);
        console.log(`  Created:     ${formatDate(Number(ag.createdAt))}`);
        if (Number(ag.resolvedAt) > 0) {
          console.log(`  Resolved:    ${formatDate(Number(ag.resolvedAt))}`);
        }
        console.log();
      } catch (err: unknown) {
        console.error(
          chalk.red("Failed to fetch agreement:"),
          err instanceof Error ? err.message : String(err)
        );
        process.exit(1);
      }
    });
}
