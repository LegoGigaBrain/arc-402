import { Command } from "commander";
import chalk from "chalk";
import * as readline from "readline";
import { ethers } from "ethers";
import {
  buildNewsletterAccessMessage,
  fetchNewsletterIssue,
  inspectCommerceEndpoint,
} from "../commerce-client";
import { isTuiRenderMode } from "../tui/render-inline";
import { printSubscribeCard } from "../tui/command-renderers";
import { loadConfig } from "../config";
import { requireSigner } from "../client";
import { executeContractWriteViaWallet } from "../wallet-router";

const SUBSCRIPTION_AGREEMENT_ABI = [
  "function subscribe(address provider, string planId, uint256 months, address token) payable returns (bytes32)",
  "function cancel(bytes32 subscriptionId) external",
  "function topup(bytes32 subscriptionId, uint256 months) payable external",
  "function getSubscription(bytes32 id) external view returns (tuple(address subscriber, address provider, string planId, uint256 ratePerMonth, address token, uint256 startTime, uint256 endTime, bool active))",
  "function getSubscriptions(address subscriber) external view returns (bytes32[])",
  "function getPlan(address provider, string planId) external view returns (tuple(string planId, uint256 ratePerMonth, address token, bool active))",
] as const;

interface JsonCapableOptions {
  json?: boolean;
}

function outputScaffold(
  action: string,
  payload: Record<string, unknown>,
  opts: JsonCapableOptions
): void {
  const response = {
    action,
    ...payload,
  };

  if (opts.json) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  console.log(chalk.bold(`◈ ${action}`));
  console.log("");
  for (const [key, value] of Object.entries(response)) {
    console.log(`  ${key.padEnd(16)} ${String(value)}`);
  }
}

function noContract(): void {
  console.log(
    chalk.yellow(
      "  Subscription contract not configured. Add subscriptionAgreementAddress to ~/.arc402/config.json"
    )
  );
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

function getContract(address: string, provider: ethers.Provider): ethers.Contract {
  return new ethers.Contract(address, SUBSCRIPTION_AGREEMENT_ABI, provider);
}

export function registerSubscriptionCommands(program: Command): void {
  program
    .command("subscribe")
    .description("Inspect a commerce endpoint and create a SubscriptionAgreement on-chain")
    .argument("<endpoint>", "Endpoint that may expose x402/subscription headers")
    .option("--plan <id>", "Desired plan identifier")
    .option("--months <n>", "Requested subscription duration", "1")
    .option("--json", "Output as JSON")
    .action(async (endpoint, opts) => {
      const config = loadConfig();
      const inspection = await inspectCommerceEndpoint(endpoint);
      const planId = opts.plan ?? inspection.subscription?.plan ?? "unspecified";
      const months = Number.parseInt(opts.months as string, 10);
      const rateLabel = inspection.subscription?.rate ?? inspection.x402?.amount ?? "n/a";

      if (!opts.json && isTuiRenderMode()) {
        await printSubscribeCard({
          provider: endpoint,
          planId,
          rateLabel,
          months,
          paymentOptions: inspection.paymentOptions,
          accessSummary: [
            inspection.subscription?.endpoint ?? endpoint,
            inspection.x402?.description ?? "read-only scaffold",
          ],
          status: {
            label: inspection.paymentRequired ? "payment required" : "inspect",
            tone: inspection.paymentRequired ? "warning" : "info",
          },
        });
      } else {
        outputScaffold(
          "Subscribe",
          {
            endpoint,
            requestedPlan: planId,
            months,
            paymentOptions: inspection.paymentOptions.join(", ") || "none advertised",
            x402Amount: inspection.x402?.amount ?? "n/a",
            subscriptionRate: rateLabel,
          },
          opts as JsonCapableOptions
        );
      }

      // On-chain subscribe if plan given and contract configured
      if (!opts.plan) return;
      if (!config.subscriptionAgreementAddress) {
        noContract();
        return;
      }

      // Parse rate to ETH value for confirmation
      const rateEth = rateLabel.replace(/[^0-9.]/g, "");
      const totalEth = rateEth ? (parseFloat(rateEth) * months).toFixed(6) : "?";

      if (!opts.json) {
        const ok = await confirm(
          `\n  Subscribe to plan "${planId}" for ${totalEth} ETH (${months} month${months > 1 ? "s" : ""})? (y/n) `
        );
        if (!ok) {
          console.log(chalk.gray("  Cancelled."));
          return;
        }
      }

      try {
        const { signer, address } = await requireSigner(config);
        const value = rateEth ? ethers.parseEther((parseFloat(rateEth) * months).toFixed(18)) : 0n;
        const tx = await executeContractWriteViaWallet(
          config.walletContractAddress ?? address,
          signer,
          config.subscriptionAgreementAddress,
          SUBSCRIPTION_AGREEMENT_ABI,
          "subscribe",
          [endpoint, planId, BigInt(months), ethers.ZeroAddress],
          value
        );
        const receipt = await tx.wait();
        if (opts.json) {
          console.log(JSON.stringify({ txHash: tx.hash, blockNumber: receipt?.blockNumber }, null, 2));
        } else {
          console.log(chalk.green(`\n  ✓ Subscribed — tx: ${tx.hash}`));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (opts.json) {
          console.log(JSON.stringify({ error: msg }, null, 2));
        } else {
          console.log(chalk.red(`  ✗ Error: ${msg}`));
        }
      }
    });

  const subscription = program
    .command("subscription")
    .description("SubscriptionAgreement lifecycle (Spec 46 §7)");

  subscription
    .command("status")
    .argument("<id>", "Subscription id")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      const config = loadConfig();
      if (!config.subscriptionAgreementAddress) {
        noContract();
        return;
      }

      try {
        const { signer, address } = await requireSigner(config);
        const contract = getContract(config.subscriptionAgreementAddress, signer.provider!);
        const sub = await contract.getSubscription(id);
        const data = {
          id,
          subscriber: sub.subscriber,
          provider: sub.provider,
          planId: sub.planId,
          ratePerMonth: ethers.formatEther(sub.ratePerMonth) + " ETH",
          token: sub.token,
          startTime: new Date(Number(sub.startTime) * 1000).toISOString(),
          endTime: new Date(Number(sub.endTime) * 1000).toISOString(),
          active: sub.active,
        };

        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        if (isTuiRenderMode()) {
          await printSubscribeCard({
            provider: sub.provider,
            planId: sub.planId,
            rateLabel: ethers.formatEther(sub.ratePerMonth) + " ETH/mo",
            accessSummary: [
              `subscriber: ${sub.subscriber}`,
              `expires: ${new Date(Number(sub.endTime) * 1000).toISOString()}`,
            ],
            status: { label: sub.active ? "active" : "inactive", tone: sub.active ? "success" : "warning" },
          });
        } else {
          outputScaffold("Subscription Status", data, opts as JsonCapableOptions);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (opts.json) {
          console.log(JSON.stringify({ error: msg }, null, 2));
        } else {
          console.log(chalk.red(`  ✗ Error: ${msg}`));
        }
      }
    });

  subscription
    .command("list")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const config = loadConfig();
      if (!config.subscriptionAgreementAddress) {
        noContract();
        return;
      }

      try {
        const { signer, address } = await requireSigner(config);
        const contract = getContract(config.subscriptionAgreementAddress, signer.provider!);
        const ids: string[] = await contract.getSubscriptions(address);

        const subs = await Promise.all(
          ids.map(async (id) => {
            const sub = await contract.getSubscription(id);
            return {
              id,
              provider: sub.provider,
              planId: sub.planId,
              ratePerMonth: ethers.formatEther(sub.ratePerMonth) + " ETH",
              endTime: new Date(Number(sub.endTime) * 1000).toISOString(),
              active: sub.active,
            };
          })
        );

        if (opts.json) {
          console.log(JSON.stringify(subs, null, 2));
          return;
        }

        console.log(chalk.bold("◈ Subscriptions"));
        console.log("");
        if (subs.length === 0) {
          console.log("  No active subscriptions.");
          return;
        }
        for (const s of subs) {
          console.log(
            `  ${chalk.cyan(s.id.slice(0, 12))}…  plan=${s.planId}  rate=${s.ratePerMonth}  expires=${s.endTime}  ${s.active ? chalk.green("active") : chalk.gray("inactive")}`
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (opts.json) {
          console.log(JSON.stringify({ error: msg }, null, 2));
        } else {
          console.log(chalk.red(`  ✗ Error: ${msg}`));
        }
      }
    });

  subscription
    .command("cancel")
    .argument("<id>", "Subscription id")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      const config = loadConfig();
      if (!config.subscriptionAgreementAddress) {
        noContract();
        return;
      }

      if (!opts.json) {
        const ok = await confirm(`  Cancel subscription ${id}? (y/n) `);
        if (!ok) {
          console.log(chalk.gray("  Cancelled."));
          return;
        }
      }

      try {
        const { signer, address } = await requireSigner(config);
        const tx = await executeContractWriteViaWallet(
          config.walletContractAddress ?? address,
          signer,
          config.subscriptionAgreementAddress,
          SUBSCRIPTION_AGREEMENT_ABI,
          "cancel",
          [id]
        );
        const receipt = await tx.wait();
        if (opts.json) {
          console.log(JSON.stringify({ txHash: tx.hash, blockNumber: receipt?.blockNumber }, null, 2));
        } else {
          console.log(chalk.green(`  ✓ Cancelled — tx: ${tx.hash}`));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (opts.json) {
          console.log(JSON.stringify({ error: msg }, null, 2));
        } else {
          console.log(chalk.red(`  ✗ Error: ${msg}`));
        }
      }
    });

  subscription
    .command("topup")
    .argument("<id>", "Subscription id")
    .requiredOption("--months <n>", "Additional months to purchase")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      const config = loadConfig();
      if (!config.subscriptionAgreementAddress) {
        noContract();
        return;
      }

      const months = Number.parseInt(opts.months as string, 10);

      if (!opts.json) {
        // Fetch current rate for confirmation message
        let rateLabel = "?";
        try {
          const { signer, address } = await requireSigner(config);
          const contract = getContract(config.subscriptionAgreementAddress, signer.provider!);
          const sub = await contract.getSubscription(id);
          const totalEth = parseFloat(ethers.formatEther(sub.ratePerMonth)) * months;
          rateLabel = totalEth.toFixed(6) + " ETH";
        } catch {
          // ignore, proceed without rate
        }

        const ok = await confirm(`  Top up ${months} month${months > 1 ? "s" : ""} for ~${rateLabel}? (y/n) `);
        if (!ok) {
          console.log(chalk.gray("  Cancelled."));
          return;
        }
      }

      try {
        const { signer, address } = await requireSigner(config);

        // Determine value from current subscription rate
        let value = 0n;
        try {
          const contract = getContract(config.subscriptionAgreementAddress, signer.provider!);
          const sub = await contract.getSubscription(id);
          value = BigInt(sub.ratePerMonth) * BigInt(months);
        } catch {
          // if we can't fetch rate, send 0 and let contract revert if needed
        }

        const tx = await executeContractWriteViaWallet(
          config.walletContractAddress ?? address,
          signer,
          config.subscriptionAgreementAddress,
          SUBSCRIPTION_AGREEMENT_ABI,
          "topup",
          [id, BigInt(months)],
          value
        );
        const receipt = await tx.wait();
        if (opts.json) {
          console.log(JSON.stringify({ txHash: tx.hash, blockNumber: receipt?.blockNumber }, null, 2));
        } else {
          console.log(chalk.green(`  ✓ Topped up ${months} month${months > 1 ? "s" : ""} — tx: ${tx.hash}`));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (opts.json) {
          console.log(JSON.stringify({ error: msg }, null, 2));
        } else {
          console.log(chalk.red(`  ✗ Error: ${msg}`));
        }
      }
    });

  const plan = program
    .command("plan")
    .description("Provider-side subscription plan scaffolding (Spec 46 §7)");

  plan
    .command("create")
    .requiredOption("--plan-id <id>", "Plan identifier")
    .requiredOption("--rate <ethPerMonth>", "Monthly rate in ETH")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      outputScaffold(
        "Plan Create",
        {
          planId: opts.planId,
          rate: opts.rate,
          note: "Create command is staged for a future SubscriptionAgreement write adapter.",
        },
        opts as JsonCapableOptions
      );
    });

  plan
    .command("list")
    .argument("[endpoint]", "Optional endpoint to inspect for advertised plan headers")
    .option("--json", "Output as JSON")
    .action(async (endpoint, opts) => {
      if (endpoint) {
        const inspection = await inspectCommerceEndpoint(endpoint);
        outputScaffold(
          "Plan List",
          {
            endpoint,
            advertisedPlan: inspection.subscription?.plan ?? "n/a",
            advertisedRate: inspection.subscription?.rate ?? "n/a",
            paymentOptions: inspection.paymentOptions.join(", ") || "none advertised",
          },
          opts as JsonCapableOptions
        );
        return;
      }

      outputScaffold("Plan List", { note: "Provider plan listing requires a concrete storage/query source." }, opts as JsonCapableOptions);
    });

  const x402 = program
    .command("x402")
    .description("x402 bridge inspection helpers (Spec 46 §7)");

  x402
    .command("inspect")
    .argument("<url>", "HTTP endpoint expected to emit 402 payment headers")
    .option("--json", "Output as JSON")
    .action(async (url, opts) => {
      const inspection = await inspectCommerceEndpoint(url);

      if (opts.json) {
        console.log(JSON.stringify(inspection, null, 2));
        return;
      }

      console.log(chalk.bold("◈ x402 Inspect"));
      console.log("");
      console.log(`  ${"url".padEnd(16)} ${inspection.url}`);
      console.log(`  ${"status".padEnd(16)} ${inspection.status}`);
      console.log(`  ${"paymentRequired".padEnd(16)} ${inspection.paymentRequired}`);
      console.log(`  ${"options".padEnd(16)} ${inspection.paymentOptions.join(", ") || "none"}`);
      console.log(`  ${"receiver".padEnd(16)} ${inspection.x402?.receiver ?? "n/a"}`);
      console.log(`  ${"amount".padEnd(16)} ${inspection.x402?.amount ?? "n/a"}`);
      console.log(`  ${"subscription".padEnd(16)} ${inspection.subscription?.plan ?? "n/a"}`);
    });

  x402
    .command("issue")
    .description("Fetch a newsletter issue and surface typed x402/subscription responses")
    .requiredOption("--base-url <url>", "Daemon base URL")
    .requiredOption("--newsletter <id>", "Newsletter id")
    .requiredOption("--issue <hash>", "Issue content hash")
    .option("--signer <address>", "Subscriber wallet")
    .option("--signature <sig>", "EIP-191 signature for the issue access message")
    .option("--api-token <token>", "Daemon bearer token for local automation")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const result = await fetchNewsletterIssue(
        opts.baseUrl as string,
        opts.newsletter as string,
        opts.issue as string,
        {
          signer: opts.signer as string | undefined,
          signature: opts.signature as string | undefined,
          apiToken: opts.apiToken as string | undefined,
        }
      );

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              ...result,
              accessMessage: buildNewsletterAccessMessage(opts.newsletter as string, opts.issue as string),
            },
            null,
            2
          )
        );
        return;
      }

      console.log(chalk.bold("◈ x402 Issue Fetch"));
      console.log("");
      console.log(`  ${"status".padEnd(16)} ${result.status}`);
      console.log(`  ${"contentType".padEnd(16)} ${result.contentType ?? "n/a"}`);
      console.log(`  ${"paymentRequired".padEnd(16)} ${result.paymentRequired}`);
      console.log(`  ${"plan".padEnd(16)} ${result.subscription?.plan ?? "n/a"}`);
      console.log(`  ${"amount".padEnd(16)} ${result.x402?.amount ?? "n/a"}`);
      console.log(
        `  ${"signMessage".padEnd(16)} ${buildNewsletterAccessMessage(opts.newsletter as string, opts.issue as string)}`
      );
      if (result.body) {
        console.log("");
        console.log(result.body);
      }
    });
}
