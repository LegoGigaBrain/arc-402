import { Command } from "commander";
import { ReputationOracleClient, SponsorshipAttestationClient, TrustClient } from "@arc402/sdk";
import { loadConfig } from "../config";
import { getClient } from "../client";
import { getTrustTier, identityTierLabel } from "../utils/format";
import { c } from '../ui/colors';
import { renderTree } from '../ui/tree';
import { formatAddress } from '../ui/format';

export function registerTrustCommand(program: Command): void {
  program.command("trust <address>").description("Look up trust plus secondary sponsorship/reputation signals for an address").option("--json").action(async (address, opts) => {
    const config = loadConfig(); const { provider } = await getClient(config); const trust = new TrustClient(config.trustRegistryAddress, provider);
    const score = await trust.getScore(address); const sponsorship = config.sponsorshipAttestationAddress ? new SponsorshipAttestationClient(config.sponsorshipAttestationAddress, provider) : null; const reputation = config.reputationOracleAddress ? new ReputationOracleClient(config.reputationOracleAddress, provider) : null;
    const highestTier = sponsorship ? await sponsorship.getHighestTier(address) : undefined; const rep = reputation ? await reputation.getReputation(address) : undefined;
    if (opts.json) return console.log(JSON.stringify({ address, score, highestTier, reputation: rep }, (_k, value) => typeof value === 'bigint' ? value.toString() : value, 2));
    console.log(`score=${score.score} tier=${getTrustTier(score.score)} next=${score.nextLevelAt}${highestTier !== undefined ? ` sponsorship=${identityTierLabel(highestTier)}` : ''}${rep ? ` reputation=${rep.weightedScore}` : ''}`);
  });
}
