import { Command } from "commander";
import { ServiceAgreementClient } from "@arc402/sdk";
import { loadConfig } from "../config";
import { requireSigner } from "../client";
import { printSenderInfo, executeContractWriteViaWallet } from "../wallet-router";
import { SERVICE_AGREEMENT_ABI } from "../abis";

export function registerCancelCommand(program: Command): void {
  program.command("cancel <id>").description("Cancel a proposed agreement; use --expired for post-deadline recovery paths").option("--expired", "Call expiredCancel()", false).action(async (id, opts) => {
    const config = loadConfig();
    if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
    const { signer } = await requireSigner(config);
    printSenderInfo(config);
    if (config.walletContractAddress) {
      const fn = opts.expired ? "expiredCancel" : "cancel";
      await executeContractWriteViaWallet(
        config.walletContractAddress, signer, config.serviceAgreementAddress,
        SERVICE_AGREEMENT_ABI, fn, [BigInt(id)],
      );
    } else {
      const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
      if (opts.expired) await client.expiredCancel(BigInt(id)); else await client.cancel(BigInt(id));
    }
    console.log(`cancelled ${id}`);
  });
}
