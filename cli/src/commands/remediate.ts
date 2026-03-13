import { Command } from "commander";
import { ProviderResponseType, ServiceAgreementClient } from "@arc402/sdk";
import { loadConfig } from "../config";
import { getClient, requireSigner } from "../client";
import { hashFile, hashString } from "../utils/hash";

export function registerRemediateCommands(program: Command): void {
  const remediate = program.command("remediate").description("Negotiated remediation before formal dispute");
  remediate.command("request <id>").requiredOption("--text <feedback>").option("--uri <uri>", "Structured feedback URI", "").option("--file <path>").option("--previous <hash>", "Previous transcript hash", "0x0000000000000000000000000000000000000000000000000000000000000000").action(async (id, opts) => {
    const config = loadConfig(); if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config"); const { signer } = await requireSigner(config); const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
    const hash = opts.file ? hashFile(opts.file) : hashString(opts.text); await client.requestRevision(BigInt(id), hash, opts.uri, opts.previous); console.log(`revision requested for ${id} transcriptSeed=${hash}`);
  });
  remediate.command("respond <id>").requiredOption("--type <type>", "revise|defend|counter|partial-settlement|human-review|escalate").requiredOption("--text <response>").option("--uri <uri>", "Structured response URI", "").option("--file <path>").option("--previous <hash>", "Previous transcript hash", "0x0000000000000000000000000000000000000000000000000000000000000000").option("--provider-payout <amount>", "Wei/token units for partial settlement", "0").action(async (id, opts) => {
    const config = loadConfig(); if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config"); const { signer } = await requireSigner(config); const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);
    const map: Record<string, ProviderResponseType> = { revise: ProviderResponseType.REVISE, defend: ProviderResponseType.DEFEND, counter: ProviderResponseType.COUNTER, 'partial-settlement': ProviderResponseType.PARTIAL_SETTLEMENT, 'human-review': ProviderResponseType.REQUEST_HUMAN_REVIEW, escalate: ProviderResponseType.ESCALATE };
    const hash = opts.file ? hashFile(opts.file) : hashString(opts.text); await client.respondToRevision(BigInt(id), map[String(opts.type)], hash, opts.uri, opts.previous, BigInt(opts.providerPayout)); console.log(`revision response recorded for ${id}`);
  });
  remediate.command("status <id>").option("--json").action(async (id, opts) => {
    const config = loadConfig(); if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config"); const { provider } = await getClient(config); const client = new ServiceAgreementClient(config.serviceAgreementAddress, provider);
    const remediation = await client.getRemediationCase(BigInt(id)); const out = { remediation }; console.log(JSON.stringify(out, (_k, value) => typeof value === 'bigint' ? value.toString() : value, opts.json ? 2 : 2));
  });
}
