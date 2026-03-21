import { Command } from "commander";
import { ServiceAgreementClient } from "@arc402/sdk";
import { ethers } from "ethers";
import { loadConfig } from "../config";
import { getClient, requireSigner } from "../client";
import { printSenderInfo, executeContractWriteViaWallet } from "../wallet-router";
import { SERVICE_AGREEMENT_ABI } from "../abis";
import { c } from '../ui/colors';
import { startSpinner } from '../ui/spinner';

// Agreement status values from the contract
const AGREEMENT_STATUS_NAMES: Record<number, string> = {
  0: "NONE",
  1: "PROPOSED",
  2: "ACCEPTED",
  3: "PENDING_VERIFICATION",
  4: "COMPLETED",
  5: "DISPUTED",
  6: "CANCELLED",
  7: "EXPIRED",
};

export function registerVerifyCommand(program: Command): void {
  program
    .command("verify <id>")
    .description("Client verifies delivered work and releases escrow")
    .option("--auto", "Call autoRelease instead (for when verify window has elapsed and client is silent)")
    .option("--json")
    .action(async (id, opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { signer } = await requireSigner(config);
      printSenderInfo(config);
      const spinner = startSpinner('Submitting…');

      // Pre-flight: check agreement is in PENDING_VERIFICATION status (J2-04)
      if (!opts.auto) {
        const PENDING_VERIFICATION_STATUS = 3;
        const { provider: verifyProvider } = await getClient(config);
        const saCheck = new ethers.Contract(
          config.serviceAgreementAddress,
          ["function getAgreement(uint256 id) external view returns (tuple(uint256 id, address client, address provider, string serviceType, string description, uint256 price, address token, uint256 deadline, bytes32 deliverablesHash, uint8 status, uint256 createdAt, uint256 resolvedAt, uint256 verifyWindowEnd, bytes32 committedHash))"],
          verifyProvider,
        );
        try {
          const ag = await saCheck.getAgreement(BigInt(id));
          const status = Number(ag.status);
          if (status !== PENDING_VERIFICATION_STATUS) {
            const statusName = AGREEMENT_STATUS_NAMES[status] ?? `UNKNOWN(${status})`;
            console.error(`Agreement ${id} is not pending verification (current status: ${statusName}).`);
            console.error(`Only agreements in PENDING_VERIFICATION status can be verified.`);
            if (status === 2) console.error(`The provider must first deliver with: arc402 deliver ${id}`);
            process.exit(1);
          }
        } catch (e) {
          // Skip pre-check on read errors — let the tx itself reveal the issue
          if (!(e instanceof Error && (e.message.includes("CALL_EXCEPTION") || e.message.includes("could not decode")))) throw e;
        }
      }

      if (opts.auto) {
        if (config.walletContractAddress) {
          const tx = await executeContractWriteViaWallet(
            config.walletContractAddress, signer, config.serviceAgreementAddress,
            SERVICE_AGREEMENT_ABI, "autoRelease", [BigInt(id)],
          );
          if (opts.json) return console.log(JSON.stringify({ agreementId: id, action: "autoRelease", txHash: tx.hash }));
          spinner.succeed('Auto-released — agreement #' + id + ' — tx ' + tx.hash.slice(0, 10) + '...');
        } else {
          const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
          const tx = await client.autoRelease(BigInt(id));
          if (opts.json) return console.log(JSON.stringify({ agreementId: id, action: "autoRelease", txHash: tx.hash }));
          spinner.succeed('Auto-released — agreement #' + id + ' — tx ' + tx.hash.slice(0, 10) + '...');
        }
      } else {
        if (config.walletContractAddress) {
          const tx = await executeContractWriteViaWallet(
            config.walletContractAddress, signer, config.serviceAgreementAddress,
            SERVICE_AGREEMENT_ABI, "verifyDeliverable", [BigInt(id)],
          );
          if (opts.json) return console.log(JSON.stringify({ agreementId: id, action: "verifyDeliverable", txHash: tx.hash }));
          spinner.succeed('Verified — agreement #' + id + ' — escrow released');
        } else {
          const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
          const tx = await client.verifyDeliverable(BigInt(id));
          if (opts.json) return console.log(JSON.stringify({ agreementId: id, action: "verifyDeliverable", txHash: tx.hash }));
          spinner.succeed('Verified — agreement #' + id + ' — escrow released');
        }
      }
    });
}
