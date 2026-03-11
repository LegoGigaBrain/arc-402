import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { ethers } from "ethers";
import { loadConfig, getUsdcAddress } from "../config";
import { requireSigner } from "../client";
import { SERVICE_AGREEMENT_ABI, ERC20_ABI } from "../abis";
import { hashFile } from "../utils/hash";
import { parseDuration } from "../utils/time";

export function registerHireCommand(program: Command): void {
  program
    .command("hire")
    .description("Propose a service agreement (locks escrow)")
    .requiredOption("--agent <address>", "Provider agent address")
    .requiredOption("--task <description>", "Task description")
    .requiredOption("--service-type <type>", "Service type")
    .requiredOption("--max <amount>", "Payment amount (in ETH or USDC units)")
    .option("--token <token>", "Payment token: usdc or eth", "eth")
    .requiredOption(
      "--deadline <duration>",
      "Deadline duration from now e.g. 2h, 24h, 7d"
    )
    .option(
      "--deliverable-spec <filepath>",
      "Path to deliverables spec file (will be keccak256 hashed)"
    )
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const config = loadConfig();
      const { signer, address } = await requireSigner(config);

      // Resolve token
      const useUsdc = opts.token.toLowerCase() === "usdc";
      const tokenAddress = useUsdc
        ? getUsdcAddress(config)
        : "0x0000000000000000000000000000000000000000";

      // Parse price
      let price: bigint;
      if (useUsdc) {
        price = BigInt(Math.round(parseFloat(opts.max) * 1_000_000));
      } else {
        price = ethers.parseEther(opts.max);
      }

      // Parse deadline
      let deadline: number;
      try {
        deadline = parseDuration(opts.deadline);
      } catch (err: unknown) {
        console.error(
          chalk.red(err instanceof Error ? err.message : String(err))
        );
        process.exit(1);
      }

      // Hash deliverables spec
      let deliverablesHash: string =
        "0x0000000000000000000000000000000000000000000000000000000000000000";
      if (opts.deliverableSpec) {
        try {
          deliverablesHash = hashFile(opts.deliverableSpec);
          console.log(chalk.gray(`  Deliverables hash: ${deliverablesHash}`));
        } catch (err: unknown) {
          console.error(
            chalk.red(
              `Could not hash deliverable spec: ${err instanceof Error ? err.message : String(err)}`
            )
          );
          process.exit(1);
        }
      }

      const contract = new ethers.Contract(
        config.serviceAgreementAddress,
        SERVICE_AGREEMENT_ABI,
        signer
      );

      const spinner = ora("Proposing agreement…").start();

      try {
        // If ERC-20, check and handle approval
        if (useUsdc) {
          const usdc = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
          const allowance = await usdc.allowance(address, config.serviceAgreementAddress);
          if (allowance < price) {
            spinner.text = "Approving USDC spend…";
            const approveTx = await usdc.approve(config.serviceAgreementAddress, price);
            await approveTx.wait();
            spinner.text = "Proposing agreement…";
          }
        }

        const txOpts: { value?: bigint } = {};
        if (!useUsdc) {
          txOpts.value = price;
        }

        const tx = await contract.propose(
          opts.agent,
          opts.serviceType,
          opts.task,
          price,
          tokenAddress,
          deadline,
          deliverablesHash,
          txOpts
        );

        spinner.text = `Waiting for tx confirmation…`;
        const receipt = await tx.wait();

        // Parse the AgreementProposed event to get the ID
        const iface = new ethers.Interface(SERVICE_AGREEMENT_ABI);
        let agreementId: number | null = null;
        for (const log of receipt.logs) {
          try {
            const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
            if (parsed && parsed.name === "AgreementProposed") {
              agreementId = Number(parsed.args.id);
              break;
            }
          } catch {
            // not this log
          }
        }

        spinner.succeed(chalk.green("✓ Agreement proposed"));

        if (opts.json) {
          console.log(
            JSON.stringify(
              {
                agreementId,
                txHash: tx.hash,
                agent: opts.agent,
                price: price.toString(),
                token: tokenAddress,
                deadline,
                deliverablesHash,
              },
              null,
              2
            )
          );
        } else {
          console.log(`  Agreement ID: ${chalk.bold(String(agreementId))}`);
          console.log(`  Provider:     ${opts.agent}`);
          console.log(
            `  Price:        ${opts.max} ${opts.token.toUpperCase()}`
          );
          console.log(`  tx:           ${tx.hash}`);
        }
      } catch (err: unknown) {
        spinner.fail(chalk.red("Hire failed"));
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
