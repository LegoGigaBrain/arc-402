import { Command } from "commander";
import { DirectDisputeReason, DisputeOutcome, EvidenceType, ServiceAgreementClient } from "@arc402/sdk";
import { loadConfig } from "../config";
import { getClient, requireSigner } from "../client";
import { hashFile, hashString } from "../utils/hash";

export function registerDisputeCommand(program: Command): void {
  const dispute = program.command("dispute").description("Formal dispute workflow; remediation-first by default, with narrow hard-fail direct-dispute exceptions");
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
    const result = { case: await client.getDisputeCase(BigInt(id)), evidence: await client.getDisputeEvidenceAll(BigInt(id)) };
    console.log(JSON.stringify(result, (_k, value) => typeof value === 'bigint' ? value.toString() : value, opts.json ? 2 : 2));
  });
  dispute.command("resolve <id>").description("Owner-only admin path if you are operating the dispute contract").requiredOption("--outcome <outcome>", "provider|refund|partial-provider|partial-client|mutual-cancel|human-review").option("--provider-award <amount>", "Wei/token units", "0").option("--client-award <amount>", "Wei/token units", "0").action(async (id, opts) => {
    const config = loadConfig(); if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
    const { signer } = await requireSigner(config); const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
    const mapping: Record<string, DisputeOutcome> = { provider: DisputeOutcome.PROVIDER_WINS, refund: DisputeOutcome.CLIENT_REFUND, 'partial-provider': DisputeOutcome.PARTIAL_PROVIDER, 'partial-client': DisputeOutcome.PARTIAL_CLIENT, 'mutual-cancel': DisputeOutcome.MUTUAL_CANCEL, 'human-review': DisputeOutcome.HUMAN_REVIEW_REQUIRED };
    await client.resolveDisputeDetailed(BigInt(id), mapping[String(opts.outcome)], BigInt(opts.providerAward), BigInt(opts.clientAward));
    console.log(`resolved ${id}`);
  });
}
