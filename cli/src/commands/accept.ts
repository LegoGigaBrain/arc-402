import { Command } from "commander";
import { ServiceAgreementClient } from "@arc402/sdk";
import { loadConfig } from "../config";
import { requireSigner } from "../client";
import { printSenderInfo, executeContractWriteViaWallet } from "../wallet-router";
import { SERVICE_AGREEMENT_ABI } from "../abis";

export function registerAcceptCommand(program: Command): void {
  program.command("accept <id>").description("Provider accepts a proposed agreement").action(async (id) => {
    const config = loadConfig();
    if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
    const { signer } = await requireSigner(config);
    printSenderInfo(config);
    if (config.walletContractAddress) {
      await executeContractWriteViaWallet(
        config.walletContractAddress, signer, config.serviceAgreementAddress,
        SERVICE_AGREEMENT_ABI, "accept", [BigInt(id)],
      );
    } else {
      const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
      await client.accept(BigInt(id));
    }
    console.log(`accepted ${id}`);
  });
}
