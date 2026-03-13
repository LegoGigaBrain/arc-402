import { Command } from "commander";
import { ServiceAgreementClient } from "@arc402/sdk";
import { loadConfig } from "../config";
import { requireSigner } from "../client";
import { hashFile, hashString } from "../utils/hash";
import { printSenderInfo, executeContractWriteViaWallet } from "../wallet-router";
import { SERVICE_AGREEMENT_ABI } from "../abis";

export function registerDeliverCommand(program: Command): void {
  program.command("deliver <id>").description("Provider commits a deliverable for verification; legacy fulfill mode is compatibility-only").option("--output <filepath>").option("--message <text>").option("--fulfill", "Use legacy trusted-only fulfill() instead of commitDeliverable()", false).action(async (id, opts) => {
    const config = loadConfig();
    if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
    const { signer } = await requireSigner(config);
    const hash = opts.output ? hashFile(opts.output) : hashString(opts.message ?? `agreement:${id}`);
    printSenderInfo(config);
    if (config.walletContractAddress) {
      const fn = opts.fulfill ? "fulfill" : "commitDeliverable";
      await executeContractWriteViaWallet(
        config.walletContractAddress, signer, config.serviceAgreementAddress,
        SERVICE_AGREEMENT_ABI, fn, [BigInt(id), hash],
      );
    } else {
      const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
      if (opts.fulfill) await client.fulfill(BigInt(id), hash); else await client.commitDeliverable(BigInt(id), hash);
    }
    console.log(`${opts.fulfill ? 'fulfilled' : 'committed'} ${id} hash=${hash}`);
  });
}
