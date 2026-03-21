import { Command } from "commander";
import { ReputationOracleClient, ReputationSignalType } from "@arc402/sdk";
import { ethers } from "ethers";
import { loadConfig } from "../config";
import { getClient, requireSigner } from "../client";
import { c } from '../ui/colors';
import { startSpinner } from '../ui/spinner';
import { renderTree } from '../ui/tree';
import { formatAddress } from '../ui/format';

const reputation = new Command("reputation").description("Network-wide reputation signals");

reputation
  .command("warn <address>")
  .description("Publish a WARN signal against an address (trust-weighted)")
  .requiredOption("--reason <text>", "Reason for the warning")
  .option("--json")
  .action(async (address, opts) => {
    const config = loadConfig();
    if (!config.reputationOracleAddress) {
      console.error("reputationOracleAddress not configured. Run `arc402 config set reputationOracleAddress <address>`.");
      process.exit(1);
    }
    const { signer } = await requireSigner(config);
    const oracle = new ReputationOracleClient(config.reputationOracleAddress, signer);
    await oracle.publishSignal(address, ReputationSignalType.WARN, ethers.ZeroHash, opts.reason);
    if (opts.json) return console.log(JSON.stringify({ address, signal: "WARN", reason: opts.reason }, null, 2));
    console.log(`WARN signal published against ${address}: "${opts.reason}"`);
  });

reputation
  .command("block <address>")
  .description("Publish a BLOCK signal against an address (stronger than warn)")
  .requiredOption("--reason <text>", "Reason for the block signal")
  .option("--json")
  .action(async (address, opts) => {
    const config = loadConfig();
    if (!config.reputationOracleAddress) {
      console.error("reputationOracleAddress not configured. Run `arc402 config set reputationOracleAddress <address>`.");
      process.exit(1);
    }
    const { signer } = await requireSigner(config);
    const oracle = new ReputationOracleClient(config.reputationOracleAddress, signer);
    await oracle.publishSignal(address, ReputationSignalType.BLOCK, ethers.ZeroHash, opts.reason);
    if (opts.json) return console.log(JSON.stringify({ address, signal: "BLOCK", reason: opts.reason }, null, 2));
    console.log(`BLOCK signal published against ${address}: "${opts.reason}"`);
  });

reputation
  .command("check <address>")
  .description("Query the ReputationOracle for endorsements, warnings, and blocks against an address")
  .option("--json")
  .action(async (address, opts) => {
    const config = loadConfig();
    if (!config.reputationOracleAddress) {
      console.error("reputationOracleAddress not configured.");
      process.exit(1);
    }
    const { provider } = await getClient(config);
    const oracle = new ReputationOracleClient(config.reputationOracleAddress, provider);
    const rep = await oracle.getReputation(address);
    const payload = {
      address,
      endorsements: rep.endorsements.toString(),
      warnings: rep.warnings.toString(),
      blocks: rep.blocks.toString(),
      weightedScore: rep.weightedScore.toString(),
    };
    if (opts.json) return console.log(JSON.stringify(payload, null, 2));
    console.log(`address=${address}`);
    console.log(`endorsements=${rep.endorsements}  warnings=${rep.warnings}  blocks=${rep.blocks}`);
    console.log(`weightedScore=${rep.weightedScore}`);
  });

export default reputation;
