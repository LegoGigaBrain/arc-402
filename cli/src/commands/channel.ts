import { Command } from "commander";
import { loadConfig } from "../config";
import { requireSigner, getClient } from "../client";
import { ChannelClient } from "@arc402/sdk";
import type { ChannelState } from "@arc402/sdk";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { c } from '../ui/colors';
import { startSpinner } from '../ui/spinner';
import { renderTree } from '../ui/tree';
import { formatAddress } from '../ui/format';

const CHANNEL_STATES_DIR = path.join(os.homedir(), ".arc402", "channel-states");

function loadStateFile(path: string): ChannelState {
  const raw = fs.readFileSync(path, "utf-8");
  const obj = JSON.parse(raw);
  return {
    ...obj,
    cumulativePayment: BigInt(obj.cumulativePayment),
  } as ChannelState;
}

export function registerChannelCommands(program: Command): void {
  const channel = program.command("channel").description("Session channel management — open, close, challenge, reclaim");

  channel.command("open <provider>")
    .description("Open a session channel with a provider")
    .requiredOption("--token <address>", "Token address (0x0 for ETH)")
    .requiredOption("--max <amount>", "Max deposit amount in wei")
    .requiredOption("--rate <amount>", "Expected rate per call in wei (informational)")
    .requiredOption("--deadline <timestamp>", "Channel expiry unix timestamp")
    .option("--json", "JSON output")
    .action(async (provider, opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new ChannelClient(config.serviceAgreementAddress, signer);
      const spinner = startSpinner('Opening session channel…');
      const result = await client.openSessionChannel(
        provider,
        opts.token,
        BigInt(opts.max),
        BigInt(opts.rate),
        Number(opts.deadline)
      );
      if (opts.json || program.opts().json) {
        spinner.stop();
        console.log(JSON.stringify(result, null, 2));
      } else {
        spinner.succeed(' Opened — channel ' + result.channelId);
        renderTree([
          { label: 'Channel', value: result.channelId },
          { label: 'Tx', value: result.txHash, last: true },
        ]);
      }
    });

  channel.command("status <channelId>")
    .description("Get channel status")
    .option("--json", "JSON output")
    .action(async (channelId, opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { provider } = await getClient(config);
      const client = new ChannelClient(config.serviceAgreementAddress, provider);
      const ch = await client.getChannelStatus(channelId);
      if (opts.json || program.opts().json) {
        console.log(JSON.stringify(ch, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2));
      } else {
        console.log('\n ' + c.mark + c.white(` Channel ${channelId}`));
        renderTree([
          { label: 'Status', value: ch.status },
          { label: 'Client', value: formatAddress(ch.client) },
          { label: 'Provider', value: formatAddress(ch.provider) },
          { label: 'Deposit', value: ch.depositAmount.toString() },
          { label: 'Settled', value: ch.settledAmount.toString() },
          { label: 'Seq', value: ch.lastSequenceNumber.toString(), last: true },
        ]);
      }
    });

  channel.command("list <wallet>")
    .description("List open channels for a wallet (client or provider)")
    .option("--json", "JSON output")
    .action(async (wallet, opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { provider } = await getClient(config);
      const client = new ChannelClient(config.serviceAgreementAddress, provider);
      const channels = await client.getOpenChannels(wallet);
      if (opts.json || program.opts().json) {
        console.log(JSON.stringify(channels, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2));
      } else {
        if (channels.length === 0) {
          console.log("no open channels");
        } else {
          for (const ch of channels) {
            console.log(`  ${ch.status}  deposit=${ch.depositAmount}  seq=${ch.lastSequenceNumber}  deadline=${ch.deadline}`);
          }
        }
      }
    });

  channel.command("close <channelId>")
    .description("Close a channel cooperatively with signed final state")
    .requiredOption("--state <path>", "Path to signed state JSON file")
    .option("--json", "JSON output")
    .action(async (channelId, opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new ChannelClient(config.serviceAgreementAddress, signer);
      const state = loadStateFile(opts.state);
      const result = await client.closeChannel(channelId, state);
      if (opts.json || program.opts().json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(' ' + c.success + c.white(` Close submitted — ${result.txHash}`));
        console.log(' ' + c.dim('Challenge window open (24h)'));
      }
    });

  channel.command("challenge <channelId>")
    .description("Challenge a stale close with a higher sequence state")
    .requiredOption("--state <path>", "Path to signed state JSON file with higher sequenceNumber")
    .option("--json", "JSON output")
    .action(async (channelId, opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new ChannelClient(config.serviceAgreementAddress, signer);
      const state = loadStateFile(opts.state);
      const result = await client.challengeChannel(channelId, state);
      if (opts.json || program.opts().json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(' ' + c.success + c.white(` Challenge submitted — ${result.txHash}`));
      }
    });

  channel.command("finalise <channelId>")
    .description("Finalise a close after the challenge window expires")
    .option("--json", "JSON output")
    .action(async (channelId, opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new ChannelClient(config.serviceAgreementAddress, signer);
      const result = await client.finaliseChallenge(channelId);
      if (opts.json || program.opts().json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(' ' + c.success + c.white(` Finalised — ${result.txHash}`));
      }
    });

  channel.command("reclaim <channelId>")
    .description("Client: reclaim deposit from expired channel")
    .option("--json", "JSON output")
    .action(async (channelId, opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new ChannelClient(config.serviceAgreementAddress, signer);
      const result = await client.reclaimExpiredChannel(channelId);
      if (opts.json || program.opts().json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(' ' + c.success + c.white(` Reclaimed — ${result.txHash}`));
      }
    });

  channel.command("store-state <channelId> <statePath>")
    .description(
      "Save a signed channel state to local storage (~/.arc402/channel-states/<channelId>.json) " +
      "for the `arc402 daemon channel-watch` to use when auto-challenging stale closes."
    )
    .option("--json", "JSON output")
    .action((channelId, statePath, opts) => {
      let raw: string;
      try {
        raw = fs.readFileSync(statePath, "utf-8");
      } catch (err) {
        console.error(`Cannot read state file: ${statePath}\n${err}`);
        process.exit(1);
      }

      let state: Record<string, unknown>;
      try {
        state = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        console.error("State file is not valid JSON.");
        process.exit(1);
      }

      const required = ["sequenceNumber", "cumulativePayment", "callCount", "token", "timestamp", "clientSig", "providerSig"];
      for (const field of required) {
        if (!(field in state)) {
          console.error(`State file missing required field: ${field}`);
          process.exit(1);
        }
      }

      fs.mkdirSync(CHANNEL_STATES_DIR, { recursive: true, mode: 0o700 });
      const dest = path.join(CHANNEL_STATES_DIR, `${channelId}.json`);
      const stored = { ...state, channelId };
      fs.writeFileSync(dest, JSON.stringify(stored, null, 2), { mode: 0o600 });

      if (opts.json || program.opts().json) {
        console.log(JSON.stringify({ stored: true, channelId, path: dest }));
      } else {
        console.log(' ' + c.success + c.white(` State stored — ${dest}`));
        console.log(' ' + c.dim(`seq: ${state.sequenceNumber}`));
      }
    });
}
