import { Command } from "commander";
import { DisputeArbitrationClient } from "@arc402/sdk";
import { loadConfig } from "../config";
import { requireSigner } from "../client";
import { c } from '../ui/colors';
import { startSpinner } from '../ui/spinner';
import { formatAddress } from '../ui/format';

export function registerOwnerCommands(program: Command): void {
  const owner = program.command("owner").description("Protocol ownership management (DisputeArbitration two-step transfer)");

  owner.command("propose-transfer <newOwner>")
    .description("Step 1: Propose ownership transfer of DisputeArbitration to a new address. New owner must call accept-transfer to complete.")
    .action(async (newOwner, _opts) => {
      const config = loadConfig();
      if (!config.disputeArbitrationAddress) throw new Error("disputeArbitrationAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new DisputeArbitrationClient(config.disputeArbitrationAddress, signer);
      const spinner = startSpinner('Proposing ownership transfer…');
      await client.proposeOwner(newOwner);
      spinner.succeed(c.success + c.white(' Ownership transfer proposed to ' + formatAddress(newOwner)));
    });

  owner.command("accept-transfer")
    .description("Step 2: Accept pending ownership of DisputeArbitration. Must be called from the pending owner's key.")
    .action(async (_opts) => {
      const config = loadConfig();
      if (!config.disputeArbitrationAddress) throw new Error("disputeArbitrationAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new DisputeArbitrationClient(config.disputeArbitrationAddress, signer);
      const spinner = startSpinner('Accepting ownership…');
      await client.acceptOwnership();
      spinner.succeed(c.success + c.white(' Ownership accepted'));
    });
}
