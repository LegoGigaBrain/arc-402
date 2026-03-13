import { Command } from "commander";
import { DisputeArbitrationClient } from "@arc402/sdk";
import { loadConfig } from "../config";
import { getClient, requireSigner } from "../client";

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
      console.log(`Arbitrator ${arbitratorAddress} eligible: ${eligible}`);

      if (agreementId) {
        const bondState = await client.getArbitratorBondState(arbitratorAddress, BigInt(agreementId));
        console.log(`Bond state for agreement ${agreementId}:`);
        console.log(`  Amount: ${bondState.bondAmount.toString()} tokens`);
        console.log(`  Locked: ${bondState.locked}`);
        console.log(`  Slashed: ${bondState.slashed}`);
        console.log(`  Returned: ${bondState.returned}`);
        console.log(`  Locked at: ${new Date(Number(bondState.lockedAt) * 1000).toISOString()}`);
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
        console.warn("Warning: bond amount is 0. For ERC-20 agreements, pre-approve the DisputeArbitration contract.");
      }

      await client.acceptAssignment(BigInt(agreementId), bondAmount);
      console.log(`accepted assignment for agreement ${agreementId}`);
    });

  bond
    .command("fallback <agreementId>")
    .description("Trigger fallback to human backstop (mutual unfunded or panel incomplete)")
    .action(async (agreementId, _opts) => {
      const config = loadConfig();
      if (!config.disputeArbitrationAddress) throw new Error("disputeArbitrationAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new DisputeArbitrationClient(config.disputeArbitrationAddress, signer);
      await client.triggerFallback(BigInt(agreementId));
      console.log(`fallback triggered for ${agreementId}`);
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
      await client.setTokenUsdRate(tokenAddress, rateVal);
      console.log(`token rate set: ${tokenAddress} = ${rateVal.toString()} USD/token`);
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
      await client.slashArbitrator(BigInt(agreementId), arbitratorAddress, reason);
      console.log(`slashed arbitrator ${arbitratorAddress} for ${reason}`);
    });

  arbitrator
    .command("reclaim-bond <agreementId>")
    .description("Reclaim an arbitrator bond after 45 days if dispute was never resolved via resolveDisputeFee")
    .action(async (agreementId, _opts) => {
      const config = loadConfig();
      if (!config.disputeArbitrationAddress) throw new Error("disputeArbitrationAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new DisputeArbitrationClient(config.disputeArbitrationAddress, signer);
      await client.reclaimExpiredBond(BigInt(agreementId));
      console.log(`bond reclaimed for agreement ${agreementId}`);
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
      await client.resolveFromArbitration(BigInt(agreementId), opts.recipient, BigInt(opts.providerAmount), BigInt(opts.clientAmount));
      console.log(`resolved from arbitration: agreement ${agreementId}, recipient ${opts.recipient}`);
    });
}
