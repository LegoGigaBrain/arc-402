import { Command } from "commander";
import { DisputeArbitrationClient } from "@arc402/sdk";
import { loadConfig } from "../config";
import { getClient, requireSigner } from "../client";
import { c } from "../ui/colors";
import { startSpinner } from "../ui/spinner";
import { renderTree } from "../ui/tree";

export function registerArbitratorCommand(program: Command): void {
  const arbitrator = program
    .command("arbitrator")
    .description("Arbitrator panel operations: bonds, eligibility, status");

  // Bond subcommands — nest under 'bond' to avoid duplicate registration
  const bond = arbitrator
    .command("bond")
    .description("Arbitrator bond operations: status, accept, fallback");

  bond
    .command("status <arbitratorAddress> [agreementId]")
    .description("Check arbitrator bond status for an agreement (or general eligibility)")
    .action(async (arbitratorAddress, agreementId, _opts) => {
      const config = loadConfig();
      if (!config.disputeArbitrationAddress) throw new Error("disputeArbitrationAddress missing in config");
      const { provider } = await getClient(config);
      const client = new DisputeArbitrationClient(config.disputeArbitrationAddress, provider);

      const eligible = await client.isEligibleArbitrator(arbitratorAddress);
      console.log('\n ' + c.mark + c.white(' Arbitrator status'));
      renderTree([
        { label: 'Address', value: arbitratorAddress },
        { label: 'Eligible', value: eligible ? 'yes' : 'no', last: !agreementId },
      ]);

      if (agreementId) {
        const bondState = await client.getArbitratorBondState(arbitratorAddress, BigInt(agreementId));
        console.log('\n ' + c.mark + c.white(` Bond state — agreement #${agreementId}`));
        renderTree([
          { label: 'Amount', value: `${bondState.bondAmount.toString()} tokens` },
          { label: 'Locked', value: String(bondState.locked) },
          { label: 'Slashed', value: String(bondState.slashed) },
          { label: 'Returned', value: String(bondState.returned) },
          { label: 'Locked at', value: new Date(Number(bondState.lockedAt) * 1000).toISOString(), last: true },
        ]);
      }
    });

  bond
    .command("accept <agreementId>")
    .description("Accept panel assignment and post bond")
    .option("--bond <bond>", "Bond amount in wei (for ETH agreements)", "0")
    .action(async (agreementId, opts) => {
      const config = loadConfig();
      if (!config.disputeArbitrationAddress) throw new Error("disputeArbitrationAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new DisputeArbitrationClient(config.disputeArbitrationAddress, signer);

      const bondAmount = BigInt(opts.bond);
      if (bondAmount === 0n) {
        console.warn(' ' + c.warning + c.white(' Bond amount is 0. For ERC-20 agreements, pre-approve the DisputeArbitration contract.'));
      }

      const spinner = startSpinner("Submitting transaction...");
      try {
        await client.acceptAssignment(BigInt(agreementId), bondAmount);
        spinner.succeed();
      } catch (err) {
        spinner.fail();
        throw err;
      }
      console.log(' ' + c.success + c.white(` Assignment accepted — agreement #${agreementId}`));
    });

  bond
    .command("fallback <agreementId>")
    .description("Trigger fallback to human backstop (mutual unfunded or panel incomplete)")
    .action(async (agreementId, _opts) => {
      const config = loadConfig();
      if (!config.disputeArbitrationAddress) throw new Error("disputeArbitrationAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new DisputeArbitrationClient(config.disputeArbitrationAddress, signer);
      const spinner = startSpinner("Submitting transaction...");
      try {
        await client.triggerFallback(BigInt(agreementId));
        spinner.succeed();
      } catch (err) {
        spinner.fail();
        throw err;
      }
      console.log(' ' + c.success + c.white(` Fallback triggered — agreement #${agreementId}`));
    });

  // Rate subcommands — nest under 'rate'
  const rate = arbitrator
    .command("rate")
    .description("Token USD rate management (owner only)");

  rate
    .command("set <tokenAddress> <usdPerToken>")
    .description("Set USD rate for a token. Rate in USD with 18 decimals. e.g. 2000e18 for $2000")
    .action(async (tokenAddress, usdPerToken, _opts) => {
      const config = loadConfig();
      if (!config.disputeArbitrationAddress) throw new Error("disputeArbitrationAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new DisputeArbitrationClient(config.disputeArbitrationAddress, signer);

      const rateVal = BigInt(usdPerToken);
      const spinner = startSpinner("Submitting transaction...");
      try {
        await client.setTokenUsdRate(tokenAddress, rateVal);
        spinner.succeed();
      } catch (err) {
        spinner.fail();
        throw err;
      }
      console.log(' ' + c.success + c.white(` Token rate set: ${tokenAddress} = ${rateVal.toString()} USD/token`));
    });

  // Admin: slash arbitrator (manual rules violation)
  arbitrator
    .command("slash <agreementId> <arbitratorAddress> <reason>")
    .description("Owner only: manually slash an arbitrator for rules violation")
    .action(async (agreementId, arbitratorAddress, reason, _opts) => {
      const config = loadConfig();
      if (!config.disputeArbitrationAddress) throw new Error("disputeArbitrationAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new DisputeArbitrationClient(config.disputeArbitrationAddress, signer);
      const spinner = startSpinner("Submitting transaction...");
      try {
        await client.slashArbitrator(BigInt(agreementId), arbitratorAddress, reason);
        spinner.succeed();
      } catch (err) {
        spinner.fail();
        throw err;
      }
      console.log(' ' + c.success + c.white(` Slashed ${arbitratorAddress}`));
    });

  arbitrator
    .command("reclaim-bond <agreementId>")
    .description("Reclaim an arbitrator bond after 45 days if dispute was never resolved via resolveDisputeFee")
    .action(async (agreementId, _opts) => {
      const config = loadConfig();
      if (!config.disputeArbitrationAddress) throw new Error("disputeArbitrationAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new DisputeArbitrationClient(config.disputeArbitrationAddress, signer);
      const spinner = startSpinner("Submitting transaction...");
      try {
        await client.reclaimExpiredBond(BigInt(agreementId));
        spinner.succeed();
      } catch (err) {
        spinner.fail();
        throw err;
      }
      console.log(' ' + c.success + c.white(` Bond reclaimed — agreement #${agreementId}`));
    });

  arbitrator
    .command("resolve-from <agreementId>")
    .description("Resolve a dispute from arbitration with split amounts (calls ServiceAgreement.resolveFromArbitration)")
    .requiredOption("--recipient <address>", "Winning recipient address")
    .requiredOption("--provider-amount <amount>", "Provider payout in wei/tokens")
    .requiredOption("--client-amount <amount>", "Client refund in wei/tokens")
    .action(async (agreementId, opts) => {
      const { ServiceAgreementClient } = await import("@arc402/sdk");
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
      const spinner = startSpinner("Submitting transaction...");
      try {
        await client.resolveFromArbitration(BigInt(agreementId), opts.recipient, BigInt(opts.providerAmount), BigInt(opts.clientAmount));
        spinner.succeed();
      } catch (err) {
        spinner.fail();
        throw err;
      }
      console.log(' ' + c.success + c.white(` Resolved from arbitration — agreement #${agreementId}`));
    });
}
