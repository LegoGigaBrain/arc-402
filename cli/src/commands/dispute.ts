import { Command } from "commander";
import { ethers } from "ethers";
import prompts from "prompts";
import { ArbitrationVote, DirectDisputeReason, DisputeClass, DisputeMode, DisputeOutcome, EvidenceType, ServiceAgreementClient, DisputeArbitrationClient } from "@arc402/sdk";
import { loadConfig } from "../config";
import { getClient, requireSigner } from "../client";
import { hashFile, hashString } from "../utils/hash";
import { printSenderInfo, executeContractWriteViaWallet } from "../wallet-router";
import { SERVICE_AGREEMENT_ABI } from "../abis";

export function registerDisputeCommand(program: Command): void {
  const dispute = program.command("dispute").description("Formal dispute workflow; remediation-first by default, with narrow hard-fail direct-dispute exceptions");

  // Fee quote (requires DisputeArbitration configured) — read-only, no wallet routing needed
  dispute.command("fee-quote <agreementId>")
    .description("Get dispute fee quote for an agreement")
    .requiredOption("--price <price>", "Agreement price in wei/token units")
    .requiredOption("--token <token>", "Token address (0x0 for ETH)")
    .requiredOption("--mode <mode>", "unilateral|mutual")
    .requiredOption("--class <class>", "hard-failure|ambiguity|high-sensitivity")
    .action(async (agreementId, opts) => {
      const config = loadConfig();
      if (!config.disputeArbitrationAddress) throw new Error("disputeArbitrationAddress missing in config");
      const { provider } = await getClient(config);
      const client = new DisputeArbitrationClient(config.disputeArbitrationAddress, provider);
      const modeMap: Record<string, DisputeMode> = { unilateral: DisputeMode.UNILATERAL, mutual: DisputeMode.MUTUAL };
      const classMap: Record<string, DisputeClass> = {
        'hard-failure': DisputeClass.HARD_FAILURE,
        'ambiguity': DisputeClass.AMBIGUITY_QUALITY,
        'high-sensitivity': DisputeClass.HIGH_SENSITIVITY,
      };
      const mode = modeMap[String(opts.mode).toLowerCase()];
      const disputeClass = classMap[String(opts.class).toLowerCase()];
      if (!mode || !disputeClass) throw new Error("Invalid --mode or --class");
      const feeInTokens = await client.getFeeQuote(BigInt(opts.price), opts.token, mode, disputeClass);
      console.log(`Fee quote for agreement ${agreementId}: ${feeInTokens.toString()} tokens`);
    });

  // Open with explicit mode/class
  dispute.command("open-with-mode <agreementId>")
    .description("Open dispute with specific mode and class (requires fee in msg.value for ETH)")
    .requiredOption("--mode <mode>", "unilateral|mutual")
    .requiredOption("--class <class>", "hard-failure|ambiguity|high-sensitivity")
    .requiredOption("--reason <reason>")
    .option("--fee <fee>", "Fee in wei (for ETH agreements)", "0")
    .action(async (agreementId, opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { signer } = await requireSigner(config);
      const modeMap: Record<string, DisputeMode> = { unilateral: DisputeMode.UNILATERAL, mutual: DisputeMode.MUTUAL };
      const classMap: Record<string, DisputeClass> = {
        'hard-failure': DisputeClass.HARD_FAILURE,
        'ambiguity': DisputeClass.AMBIGUITY_QUALITY,
        'high-sensitivity': DisputeClass.HIGH_SENSITIVITY,
      };
      const mode = modeMap[String(opts.mode).toLowerCase()];
      const disputeClass = classMap[String(opts.class).toLowerCase()];
      if (!mode || !disputeClass) throw new Error("Invalid --mode or --class");
      printSenderInfo(config);
      if (config.walletContractAddress) {
        await executeContractWriteViaWallet(
          config.walletContractAddress, signer, config.serviceAgreementAddress,
          SERVICE_AGREEMENT_ABI, "openDisputeWithMode",
          [BigInt(agreementId), mode, disputeClass, opts.reason],
          BigInt(opts.fee),
        );
      } else {
        const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
        await client.openDisputeWithMode(BigInt(agreementId), mode, disputeClass, opts.reason, BigInt(opts.fee));
      }
      console.log(`dispute opened for ${agreementId} (${opts.mode} / ${opts.class})`);
    });

  // Join mutual dispute (respondent pays their half) — DisputeArbitration contract, no wallet routing
  dispute.command("join <agreementId>")
    .description("Join a mutual dispute as respondent (pays half the fee)")
    .option("--fee <fee>", "Half-fee in wei (for ETH agreements)", "0")
    .action(async (agreementId, opts) => {
      const config = loadConfig();
      if (!config.disputeArbitrationAddress) throw new Error("disputeArbitrationAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new DisputeArbitrationClient(config.disputeArbitrationAddress, signer);
      await client.joinMutualDispute(BigInt(agreementId), BigInt(opts.fee));
      console.log(`joined mutual dispute ${agreementId}`);
    });

  dispute.command("open <id>")
    .requiredOption("--reason <reason>")
    .option("--escalated", "Use escalateToDispute after remediation", false)
    .option("--direct <type>", "Direct-dispute hard-fail reason: no-delivery|deadline-breach|invalid-deliverable|safety-critical")
    .action(async (id, opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");

      // Pre-flight: check disputeModule is configured (J4-01)
      {
        const { provider: dpProvider } = await getClient(config);
        const saCheck = new ethers.Contract(
          config.serviceAgreementAddress,
          ["function disputeModule() external view returns (address)"],
          dpProvider,
        );
        let disputeModuleAddr: string = ethers.ZeroAddress;
        try {
          disputeModuleAddr = await saCheck.disputeModule();
        } catch { /* assume not configured */ }
        if (disputeModuleAddr === ethers.ZeroAddress) {
          console.error(`No dispute module configured on this ServiceAgreement.`);
          console.error(`Disputes require a DisputeModule to be set by the SA owner.`);
          console.error(`This protocol deployment may not support formal disputes.`);
          process.exit(1);
        }
      }

      // Pre-flight: read dispute fee and prompt user (J4-02)
      if (config.disputeArbitrationAddress) {
        const { provider: feeProvider } = await getClient(config);
        const daCheck = new ethers.Contract(
          config.disputeArbitrationAddress,
          ["function getDisputeFee() external view returns (uint256)"],
          feeProvider,
        );
        let feeWei = 0n;
        try {
          feeWei = await daCheck.getDisputeFee();
        } catch { /* fee getter may not exist — assume 0 */ }
        if (feeWei > 0n) {
          const feeEth = ethers.formatEther(feeWei);
          console.log(`\nDispute fee: ${feeEth} ETH. This will be deducted from your wallet.`);
          const { proceed } = await prompts({
            type: "confirm",
            name: "proceed",
            message: "Continue?",
            initial: true,
          });
          if (!proceed) { console.log("Aborted."); process.exit(0); }
        }
      }

      const { signer } = await requireSigner(config);
      const directMap: Record<string, DirectDisputeReason> = {
        'no-delivery': DirectDisputeReason.NO_DELIVERY,
        'deadline-breach': DirectDisputeReason.HARD_DEADLINE_BREACH,
        'invalid-deliverable': DirectDisputeReason.INVALID_OR_FRAUDULENT_DELIVERABLE,
        'safety-critical': DirectDisputeReason.SAFETY_CRITICAL_VIOLATION,
      };
      if (opts.escalated && opts.direct) throw new Error('Choose either --escalated or --direct, not both');
      printSenderInfo(config);
      if (config.walletContractAddress) {
        if (opts.direct) {
          const directReason = directMap[String(opts.direct).toLowerCase()];
          if (directReason === undefined) throw new Error('Unsupported --direct reason');
          await executeContractWriteViaWallet(
            config.walletContractAddress, signer, config.serviceAgreementAddress,
            SERVICE_AGREEMENT_ABI, "directDispute", [BigInt(id), directReason, opts.reason],
          );
        } else if (opts.escalated) {
          await executeContractWriteViaWallet(
            config.walletContractAddress, signer, config.serviceAgreementAddress,
            SERVICE_AGREEMENT_ABI, "escalateToDispute", [BigInt(id), opts.reason],
          );
        } else {
          await executeContractWriteViaWallet(
            config.walletContractAddress, signer, config.serviceAgreementAddress,
            SERVICE_AGREEMENT_ABI, "dispute", [BigInt(id), opts.reason],
          );
        }
      } else {
        const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
        if (opts.direct) {
          const directReason = directMap[String(opts.direct).toLowerCase()];
          if (directReason === undefined) throw new Error('Unsupported --direct reason');
          await client.directDispute(BigInt(id), directReason, opts.reason);
        } else if (opts.escalated) {
          await client.escalateToDispute(BigInt(id), opts.reason);
        } else {
          await client.dispute(BigInt(id), opts.reason);
        }
      }
      console.log(`dispute opened for ${id}`);

      // J4-04: Display arbitration selection window deadline
      try {
        const { provider: dpAW } = await getClient(config);
        const saAW = new ethers.Contract(
          config.serviceAgreementAddress,
          ["function ARBITRATION_SELECTION_WINDOW() external view returns (uint256)"],
          dpAW,
        );
        const selectionWindow: bigint = await saAW.ARBITRATION_SELECTION_WINDOW();
        const deadlineDate = new Date(Date.now() + Number(selectionWindow) * 1000);
        console.log(`Arbitration selection window closes: ${deadlineDate.toLocaleString()}. An arbitrator must be assigned before then.`);
      } catch { /* not available on this deployment */ }
    });

  dispute.command("evidence <id>").requiredOption("--type <type>", "transcript|deliverable|acceptance|communication|external|other").option("--file <path>").option("--text <text>").option("--uri <uri>", "External evidence URI", "").action(async (id, opts) => {
    const config = loadConfig();
    if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
    const { signer } = await requireSigner(config);
    const mapping: Record<string, EvidenceType> = { transcript: EvidenceType.TRANSCRIPT, deliverable: EvidenceType.DELIVERABLE, acceptance: EvidenceType.ACCEPTANCE_CRITERIA, communication: EvidenceType.COMMUNICATION, external: EvidenceType.EXTERNAL_REFERENCE, other: EvidenceType.OTHER };
    const hash = opts.file ? hashFile(opts.file) : hashString(opts.text ?? opts.uri ?? `evidence:${id}`);
    const evidenceType = mapping[String(opts.type).toLowerCase()] ?? EvidenceType.OTHER;
    printSenderInfo(config);
    if (config.walletContractAddress) {
      await executeContractWriteViaWallet(
        config.walletContractAddress, signer, config.serviceAgreementAddress,
        SERVICE_AGREEMENT_ABI, "submitDisputeEvidence", [BigInt(id), evidenceType, hash, opts.uri],
      );
    } else {
      const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
      await client.submitDisputeEvidence(BigInt(id), evidenceType, hash, opts.uri);
    }
    console.log(`evidence submitted for ${id} hash=${hash}`);
  });

  // status — read-only, no wallet routing needed
  dispute.command("status <id>").option("--json").action(async (id, opts) => {
    const config = loadConfig();
    if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
    const { provider } = await getClient(config); const client = new ServiceAgreementClient(config.serviceAgreementAddress, provider);
    const result = {
      case: await client.getDisputeCase(BigInt(id)),
      arbitration: await client.getArbitrationCase(BigInt(id)),
      evidence: await client.getDisputeEvidenceAll(BigInt(id)),
    };
    console.log(JSON.stringify(result, (_k, value) => typeof value === 'bigint' ? value.toString() : value, opts.json ? 2 : 2));
  });

  dispute.command("nominate <id>")
    .description("Nominate an arbitrator during the on-chain arbitration phase")
    .requiredOption("--arbitrator <address>")
    .action(async (id, opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");

      // Pre-flight: check arbitrator is approved (J4-03)
      if (config.disputeArbitrationAddress) {
        const { provider: arbProvider } = await getClient(config);
        const daCheck = new ethers.Contract(
          config.disputeArbitrationAddress,
          ["function isApprovedArbitrator(address arbitrator) external view returns (bool)"],
          arbProvider,
        );
        let isApproved = true;
        try {
          isApproved = await daCheck.isApprovedArbitrator(opts.arbitrator);
        } catch { /* assume approved if read fails */ }
        if (!isApproved) {
          console.error(`Arbitrator ${opts.arbitrator} is not approved.`);
          console.error(`Use \`arc402 dispute list-arbitrators\` to see approved arbitrators.`);
          process.exit(1);
        }
      }

      const { signer } = await requireSigner(config);
      printSenderInfo(config);
      if (config.walletContractAddress) {
        await executeContractWriteViaWallet(
          config.walletContractAddress, signer, config.serviceAgreementAddress,
          SERVICE_AGREEMENT_ABI, "nominateArbitrator", [BigInt(id), opts.arbitrator],
        );
      } else {
        const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
        await client.nominateArbitrator(BigInt(id), opts.arbitrator);
      }
      console.log(`arbitrator nominated for ${id}: ${opts.arbitrator}`);
    });

  dispute.command("vote <id>")
    .description("Cast an arbitration vote on-chain")
    .requiredOption("--vote <vote>", "provider|refund|split|human-review")
    .option("--provider-award <amount>", "Wei/token units", "0")
    .option("--client-award <amount>", "Wei/token units", "0")
    .action(async (id, opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { signer, address: voterAddress, provider: voteProvider } = await requireSigner(config);

      // J4-05: Pre-flight — verify caller is on the arbitration panel
      try {
        const saClient = new ServiceAgreementClient(config.serviceAgreementAddress, voteProvider);
        const arbCase = await saClient.getArbitrationCase(BigInt(id));
        const onPanel = arbCase.arbitrators.map((a: string) => a.toLowerCase()).includes(voterAddress.toLowerCase());
        if (!onPanel) {
          console.error(`You are not on the arbitration panel for agreement ${id}. Only assigned arbitrators can vote.`);
          process.exit(1);
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code === 'ERR_USE_AFTER_CLOSE' || String(e).includes('process.exit')) throw e;
        // If read fails, skip the check and let the transaction reveal the error
      }

      const mapping: Record<string, ArbitrationVote> = {
        provider: ArbitrationVote.PROVIDER_WINS,
        refund: ArbitrationVote.CLIENT_REFUND,
        split: ArbitrationVote.SPLIT,
        'human-review': ArbitrationVote.HUMAN_REVIEW_REQUIRED,
      };
      const vote = mapping[String(opts.vote).toLowerCase()];
      if (vote === undefined) throw new Error('Unsupported --vote value');
      printSenderInfo(config);
      if (config.walletContractAddress) {
        await executeContractWriteViaWallet(
          config.walletContractAddress, signer, config.serviceAgreementAddress,
          SERVICE_AGREEMENT_ABI, "castArbitrationVote",
          [BigInt(id), vote, BigInt(opts.providerAward), BigInt(opts.clientAward)],
        );
      } else {
        const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
        await client.castArbitrationVote(BigInt(id), vote, BigInt(opts.providerAward), BigInt(opts.clientAward));
      }
      console.log(`arbitration vote recorded for ${id}`);
    });

  dispute.command("human <id>")
    .description("Request human escalation when arbitration stalls or requires human backstop")
    .requiredOption("--reason <reason>")
    .action(async (id, opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { signer } = await requireSigner(config);
      printSenderInfo(config);
      if (config.walletContractAddress) {
        await executeContractWriteViaWallet(
          config.walletContractAddress, signer, config.serviceAgreementAddress,
          SERVICE_AGREEMENT_ABI, "requestHumanEscalation", [BigInt(id), opts.reason],
        );
      } else {
        const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
        await client.requestHumanEscalation(BigInt(id), opts.reason);
      }
      console.log(`human escalation requested for ${id}`);
    });

  dispute.command("resolve <id>").description("Owner-only admin path if you are operating the dispute contract").requiredOption("--outcome <outcome>", "provider|refund|partial-provider|partial-client|mutual-cancel|human-review").option("--provider-award <amount>", "Wei/token units", "0").option("--client-award <amount>", "Wei/token units", "0").action(async (id, opts) => {
    const config = loadConfig();
    if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
    const { signer } = await requireSigner(config);
    const mapping: Record<string, DisputeOutcome> = { provider: DisputeOutcome.PROVIDER_WINS, refund: DisputeOutcome.CLIENT_REFUND, 'partial-provider': DisputeOutcome.PARTIAL_PROVIDER, 'partial-client': DisputeOutcome.PARTIAL_CLIENT, 'mutual-cancel': DisputeOutcome.MUTUAL_CANCEL, 'human-review': DisputeOutcome.HUMAN_REVIEW_REQUIRED };
    printSenderInfo(config);
    if (config.walletContractAddress) {
      await executeContractWriteViaWallet(
        config.walletContractAddress, signer, config.serviceAgreementAddress,
        SERVICE_AGREEMENT_ABI, "resolveDisputeDetailed",
        [BigInt(id), mapping[String(opts.outcome)], BigInt(opts.providerAward), BigInt(opts.clientAward)],
      );
    } else {
      const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
      await client.resolveDisputeDetailed(BigInt(id), mapping[String(opts.outcome)], BigInt(opts.providerAward), BigInt(opts.clientAward));
    }
    console.log(`resolved ${id}`);
  });

  dispute.command("owner-resolve <agreementId>")
    .description("Owner-only: resolve a dispute directly in favor of provider or client. Requires DISPUTED or ESCALATED_TO_HUMAN status.")
    .option("--favor-provider", "Resolve in favor of the provider (default: false = favor client)", false)
    .action(async (agreementId, opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { signer } = await requireSigner(config);
      printSenderInfo(config);
      if (config.walletContractAddress) {
        await executeContractWriteViaWallet(
          config.walletContractAddress, signer, config.serviceAgreementAddress,
          SERVICE_AGREEMENT_ABI, "ownerResolveDispute", [BigInt(agreementId), !!opts.favorProvider],
        );
      } else {
        const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
        await client.ownerResolveDispute(BigInt(agreementId), !!opts.favorProvider);
      }
      console.log(`owner resolved agreement ${agreementId} — favor provider: ${!!opts.favorProvider}`);
    });
}
