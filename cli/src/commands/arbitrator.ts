import { Command } from "commander";
import { DisputeArbitrationClient } from "@arc402/sdk";
import { loadConfig } from "../config";
import { getClient, requireSigner } from "../client";

export function registerArbitratorCommand(program: Command): void {
  const arbitrator = program
    .command("arbitrator")
    .description("Arbitrator panel operations: bonds, eligibility, status");

  // Bond status
  arbitrator
    .command("bond status <arbitratorAddress> [agreementId]")
    .description("Check arbitrator bond status for an agreement (or general eligibility)")
    .action(async (arbitratorAddress, agreementId, _opts) => {
      const config = loadConfig();
      if (!config.disputeArbitrationAddress) throw new Error("disputeArbitrationAddress missing in config");
      const { provider } = await getClient(config);
      const client = new DisputeArbitrationClient(config.disputeArbitrationAddress, provider);

      // Check eligibility
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

  // Accept assignment (post bond)
  arbitrator
    .command("bond accept <agreementId>")
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

  // Trigger fallback
  arbitrator
    .command("bond fallback <agreementId>")
    .description("Trigger fallback to human backstop (mutual unfunded or panel incomplete)")
    .action(async (agreementId, _opts) => {
      const config = loadConfig();
      if (!config.disputeArbitrationAddress) throw new Error("disputeArbitrationAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new DisputeArbitrationClient(config.disputeArbitrationAddress, signer);
      await client.triggerFallback(BigInt(agreementId));
      console.log(`fallback triggered for ${agreementId}`);
    });

  // Admin: set token rate
  arbitrator
    .command("rate set <tokenAddress> <usdPerToken>")
    .description("Set USD rate for a token. Owner only. Rate in USD with 18 decimals. e.g. 2000e18 for $2000")
    .action(async (tokenAddress, usdPerToken, _opts) => {
      const config = loadConfig();
      if (!config.disputeArbitrationAddress) throw new Error("disputeArbitrationAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new DisputeArbitrationClient(config.disputeArbitrationAddress, signer);

      const rate = BigInt(usdPerToken);
      await client.setTokenUsdRate(tokenAddress, rate);
      console.log(`token rate set: ${tokenAddress} = ${rate.toString()} USD/token`);
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
}
