import { Command } from "commander";
import { ServiceAgreementClient, uploadEncryptedIPFS } from "@arc402/sdk";
import { ethers } from "ethers";
import { loadConfig } from "../config";
import { getClient, requireSigner } from "../client";
import { hashFile, hashString } from "../utils/hash";
import { printSenderInfo, executeContractWriteViaWallet } from "../wallet-router";
import { SERVICE_AGREEMENT_ABI } from "../abis";
import { readFile } from "fs/promises";
import prompts from "prompts";
import { resolveAgentEndpoint, notifyAgent, DEFAULT_REGISTRY_ADDRESS } from "../endpoint-notify";
import { c } from '../ui/colors';
import { startSpinner } from '../ui/spinner';
import { renderTree } from '../ui/tree';

export function registerDeliverCommand(program: Command): void {
  program
    .command("deliver <id>")
    .description("Provider commits a deliverable for verification; legacy fulfill mode is compatibility-only")
    .option("--output <filepath>")
    .option("--message <text>")
    .option("--fulfill", "Use legacy trusted-only fulfill() instead of commitDeliverable()", false)
    .option("--encrypt", "Encrypt the deliverable before uploading to IPFS (prompts for recipient public key)", false)
    .action(async (id, opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { signer, address: signerAddress } = await requireSigner(config);
      printSenderInfo(config);

      // Pre-flight: check deadline and legacyFulfillEnabled (J3-01, J3-02)
      let clientAddress = "";
      {
        const { provider: prefProvider } = await getClient(config);
        const saAbi = [
          "function getAgreement(uint256 id) external view returns (tuple(uint256 id, address client, address provider, string serviceType, string description, uint256 price, address token, uint256 deadline, bytes32 deliverablesHash, uint8 status, uint256 createdAt, uint256 resolvedAt, uint256 verifyWindowEnd, bytes32 committedHash))",
          "function legacyFulfillEnabled() external view returns (bool)",
          "function legacyFulfillProviders(address) external view returns (bool)",
        ];
        const saContract = new ethers.Contract(config.serviceAgreementAddress!, saAbi, prefProvider);
        try {
          const ag = await saContract.getAgreement(BigInt(id));
          const deadline = Number(ag.deadline);
          const nowSec = Math.floor(Date.now() / 1000);
          if (nowSec > deadline) {
            const deadlineDate = new Date(deadline * 1000).toISOString();
            console.error(`Delivery deadline has passed (${deadlineDate}). This transaction will revert.`);
            console.error(`Contact the client to open a new agreement.`);
            process.exit(1);
          }
          clientAddress = String(ag.client ?? "");
        } catch (e) {
          // If it's a contract read failure, skip the check (let the tx reveal the error)
          if (e instanceof Error && !e.message.includes("CALL_EXCEPTION") && !e.message.includes("could not decode")) throw e;
        }

        if (opts.fulfill) {
          let legacyEnabled = false;
          try {
            legacyEnabled = await saContract.legacyFulfillEnabled();
          } catch { /* assume enabled if read fails */ legacyEnabled = true; }
          if (!legacyEnabled) {
            console.error("Legacy fulfill is disabled on this deployment. Use `arc402 deliver <id>` (without --fulfill) to deliver via the standard flow.");
            process.exit(1);
          }
          let isLegacyProvider = false;
          try {
            isLegacyProvider = await saContract.legacyFulfillProviders(signerAddress);
          } catch { /* assume allowed if read fails */ isLegacyProvider = true; }
          if (!isLegacyProvider) {
            console.error("You are not in the legacy fulfill providers list for this agreement.");
            process.exit(1);
          }
        }
      }

      if (opts.encrypt) {
        if (!opts.output) throw new Error("--encrypt requires --output <filepath>");

        const { recipientPubKeyHex } = await prompts({
          type: "text",
          name: "recipientPubKeyHex",
          message: "Recipient NaCl box public key (32 bytes, hex):",
          validate: (v: string) => /^[0-9a-fA-F]{64}$/.test(v.trim()) || "Must be 64 hex characters (32 bytes)",
        });
        if (!recipientPubKeyHex) throw new Error("Recipient public key is required for encrypted delivery");

        const recipientPublicKey = Uint8Array.from(Buffer.from(recipientPubKeyHex.trim(), "hex"));
        const buffer = await readFile(opts.output);
        const { cid, uri } = await uploadEncryptedIPFS(buffer, recipientPublicKey);
        // Hash plaintext so recipient can verify integrity after decryption
        const { ethers } = await import("ethers");
        const hash = ethers.keccak256(buffer);

        console.log(' ' + c.dim('Encrypted upload:') + ' ' + c.white(uri));

        const encSpinner = startSpinner('Committing deliverable…');
        if (config.walletContractAddress) {
          await executeContractWriteViaWallet(
            config.walletContractAddress, signer, config.serviceAgreementAddress,
            SERVICE_AGREEMENT_ABI, "commitDeliverable", [BigInt(id), hash],
          );
        } else {
          const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
          await client.commitDeliverable(BigInt(id), hash);
        }
        encSpinner.succeed(` Delivered — agreement #${id}`);
        renderTree([
          { label: 'Hash', value: hash },
          { label: 'CID', value: cid },
          { label: 'URI', value: uri, last: true },
        ]);
        return;
      }

      const hash = opts.output ? hashFile(opts.output) : hashString(opts.message ?? `agreement:${id}`);
      const deliverSpinner = startSpinner(`${opts.fulfill ? 'Fulfilling' : 'Committing deliverable for'} agreement #${id}…`);
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
      deliverSpinner.succeed(` ${opts.fulfill ? 'Fulfilled' : 'Delivered'} — agreement #${id}`);
      renderTree([
        { label: 'Hash', value: hash, last: true },
      ]);

      // Notify client's HTTP endpoint (non-blocking)
      if (clientAddress) {
        try {
          const notifyProvider = new ethers.JsonRpcProvider(config.rpcUrl);
          const registryAddress = config.agentRegistryV2Address ?? config.agentRegistryAddress ?? DEFAULT_REGISTRY_ADDRESS;
          const endpoint = await resolveAgentEndpoint(clientAddress, notifyProvider, registryAddress);
          await notifyAgent(endpoint, "/delivery", {
            agreementId: id,
            deliverableHash: hash,
            from: signerAddress,
          });
        } catch (err) {
          console.warn(`Warning: could not notify client endpoint: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    });
}
