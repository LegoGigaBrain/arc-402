import { Command } from "commander";
import { ArbitrationVote, DirectDisputeReason, DisputeClass, DisputeMode, DisputeOutcome, EvidenceType, ServiceAgreementClient, DisputeArbitrationClient } from "@arc402/sdk";
import { loadConfig } from "../config";
import { getClient, requireSigner } from "../client";
import { hashFile, hashString } from "../utils/hash";

export function registerDisputeCommand(program: Command): void {
  const dispute = program.command("dispute").description("Formal dispute workflow; remediation-first by default, with narrow hard-fail direct-dispute exceptions");

  // Fee quote (requires DisputeArbitration configured)
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
      const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
      const modeMap: Record<string, DisputeMode> = { unilateral: DisputeMode.UNILATERAL, mutual: DisputeMode.MUTUAL };
      const classMap: Record<string, DisputeClass> = {
        'hard-failure': DisputeClass.HARD_FAILURE,
        'ambiguity': DisputeClass.AMBIGUITY_QUALITY,
        'high-sensitivity': DisputeClass.HIGH_SENSITIVITY,
      };
      const mode = modeMap[String(opts.mode).toLowerCase()];
      const disputeClass = classMap[String(opts.class).toLowerCase()];
      if (!mode || !disputeClass) throw new Error("Invalid --mode or --class");
      await client.openDisputeWithMode(BigInt(agreementId), mode, disputeClass, opts.reason, BigInt(opts.fee));
      console.log(`dispute opened for ${agreementId} (${opts.mode} / ${opts.class})`);
    });

  // Join mutual dispute (respondent pays their half)
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
      const config = loadConfig(); if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { signer } = await requireSigner(config); const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
      const directMap: Record<string, DirectDisputeReason> = {
        'no-delivery': DirectDisputeReason.NO_DELIVERY,
        'deadline-breach': DirectDisputeReason.HARD_DEADLINE_BREACH,
        'invalid-deliverable': DirectDisputeReason.INVALID_OR_FRAUDULENT_DELIVERABLE,
        'safety-critical': DirectDisputeReason.SAFETY_CRITICAL_VIOLATION,
      };
      if (opts.escalated && opts.direct) throw new Error('Choose either --escalated or --direct, not both');
      if (opts.direct) {
        const directReason = directMap[String(opts.direct).toLowerCase()];
        if (directReason === undefined) throw new Error('Unsupported --direct reason');
        await client.directDispute(BigInt(id), directReason, opts.reason);
      } else if (opts.escalated) {
        await client.escalateToDispute(BigInt(id), opts.reason);
      } else {
        await client.dispute(BigInt(id), opts.reason);
      }
      console.log(`dispute opened for ${id}`);
    });
  dispute.command("evidence <id>").requiredOption("--type <type>", "transcript|deliverable|acceptance|communication|external|other").option("--file <path>").option("--text <text>").option("--uri <uri>", "External evidence URI", "").action(async (id, opts) => {
    const config = loadConfig(); if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
    const { signer } = await requireSigner(config); const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
    const mapping: Record<string, EvidenceType> = { transcript: EvidenceType.TRANSCRIPT, deliverable: EvidenceType.DELIVERABLE, acceptance: EvidenceType.ACCEPTANCE_CRITERIA, communication: EvidenceType.COMMUNICATION, external: EvidenceType.EXTERNAL_REFERENCE, other: EvidenceType.OTHER };
    const hash = opts.file ? hashFile(opts.file) : hashString(opts.text ?? opts.uri ?? `evidence:${id}`);
    await client.submitDisputeEvidence(BigInt(id), mapping[String(opts.type).toLowerCase()] ?? EvidenceType.OTHER, hash, opts.uri);
    console.log(`evidence submitted for ${id} hash=${hash}`);
  });
  dispute.command("status <id>").option("--json").action(async (id, opts) => {
    const config = loadConfig(); if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
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
      const config = loadConfig(); if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { signer } = await requireSigner(config); const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
      await client.nominateArbitrator(BigInt(id), opts.arbitrator);
      console.log(`arbitrator nominated for ${id}: ${opts.arbitrator}`);
    });
  dispute.command("vote <id>")
    .description("Cast an arbitration vote on-chain")
    .requiredOption("--vote <vote>", "provider|refund|split|human-review")
    .option("--provider-award <amount>", "Wei/token units", "0")
    .option("--client-award <amount>", "Wei/token units", "0")
    .action(async (id, opts) => {
      const config = loadConfig(); if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { signer } = await requireSigner(config); const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
      const mapping: Record<string, ArbitrationVote> = {
        provider: ArbitrationVote.PROVIDER_WINS,
        refund: ArbitrationVote.CLIENT_REFUND,
        split: ArbitrationVote.SPLIT,
        'human-review': ArbitrationVote.HUMAN_REVIEW_REQUIRED,
      };
      const vote = mapping[String(opts.vote).toLowerCase()];
      if (vote === undefined) throw new Error('Unsupported --vote value');
      await client.castArbitrationVote(BigInt(id), vote, BigInt(opts.providerAward), BigInt(opts.clientAward));
      console.log(`arbitration vote recorded for ${id}`);
    });
  dispute.command("human <id>")
    .description("Request human escalation when arbitration stalls or requires human backstop")
    .requiredOption("--reason <reason>")
    .action(async (id, opts) => {
      const config = loadConfig(); if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { signer } = await requireSigner(config); const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
      await client.requestHumanEscalation(BigInt(id), opts.reason);
      console.log(`human escalation requested for ${id}`);
    });
  dispute.command("resolve <id>").description("Owner-only admin path if you are operating the dispute contract").requiredOption("--outcome <outcome>", "provider|refund|partial-provider|partial-client|mutual-cancel|human-review").option("--provider-award <amount>", "Wei/token units", "0").option("--client-award <amount>", "Wei/token units", "0").action(async (id, opts) => {
    const config = loadConfig(); if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
    const { signer } = await requireSigner(config); const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
    const mapping: Record<string, DisputeOutcome> = { provider: DisputeOutcome.PROVIDER_WINS, refund: DisputeOutcome.CLIENT_REFUND, 'partial-provider': DisputeOutcome.PARTIAL_PROVIDER, 'partial-client': DisputeOutcome.PARTIAL_CLIENT, 'mutual-cancel': DisputeOutcome.MUTUAL_CANCEL, 'human-review': DisputeOutcome.HUMAN_REVIEW_REQUIRED };
    await client.resolveDisputeDetailed(BigInt(id), mapping[String(opts.outcome)], BigInt(opts.providerAward), BigInt(opts.clientAward));
    console.log(`resolved ${id}`);
  });

  dispute.command("owner-resolve <agreementId>")
    .description("Owner-only: resolve a dispute directly in favor of provider or client. Requires DISPUTED or ESCALATED_TO_HUMAN status.")
    .option("--favor-provider", "Resolve in favor of the provider (default: false = favor client)", false)
    .action(async (agreementId, opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
      await client.ownerResolveDispute(BigInt(agreementId), !!opts.favorProvider);
      console.log(`owner resolved agreement ${agreementId} — favor provider: ${!!opts.favorProvider}`);
    });
}
