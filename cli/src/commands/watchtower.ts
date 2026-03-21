import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { loadConfig } from "../config";
import { requireSigner, getClient } from "../client";
import { WatchtowerClient, ChannelClient } from "@arc402/sdk";
import { c } from '../ui/colors';
import { startSpinner } from '../ui/spinner';
import { renderTree } from '../ui/tree';
import { formatAddress } from '../ui/format';

const CHANNEL_STATES_DIR = path.join(os.homedir(), ".arc402", "channel-states");

function loadStateFile(filePath: string): { [key: string]: unknown; cumulativePayment: bigint; sequenceNumber: number } {
  const raw = fs.readFileSync(filePath, "utf-8");
  const obj = JSON.parse(raw) as Record<string, unknown>;
  return {
    ...obj,
    cumulativePayment: BigInt(obj.cumulativePayment as string),
    sequenceNumber: Number(obj.sequenceNumber),
  };
}

export function registerWatchtowerCommands(program: Command): void {
  const wt = program
    .command("watchtower")
    .description("Watchtower management — register, status, and monitor channels for bad-faith closes");

  // ─── register ──────────────────────────────────────────────────────────────

  wt.command("register")
    .description("Register this node as a watchtower in the on-chain WatchtowerRegistry")
    .requiredOption("--name <name>", "Watchtower display name")
    .option("--description <desc>", "Short description", "ARC-402 watchtower node")
    .option("--capabilities <caps>", "Comma-separated capability tags", "challenge")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const config = loadConfig();
      if (!config.watchtowerRegistryAddress) throw new Error("watchtowerRegistryAddress missing in config");
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new WatchtowerClient(
        config.watchtowerRegistryAddress,
        config.serviceAgreementAddress,
        signer
      );
      const capabilities = opts.capabilities
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      const regSpinner = startSpinner('Registering watchtower…');
      const result = await client.registerWatchtower({
        name: opts.name,
        description: opts.description,
        capabilities,
      });
      if (opts.json || program.opts().json) {
        regSpinner.stop();
        console.log(JSON.stringify(result));
      } else {
        regSpinner.succeed(c.success + c.white(' Registered as watchtower'));
        renderTree([
          { label: 'Name', value: opts.name },
          { label: 'Tx', value: result.txHash, last: true },
        ]);
      }
    });

  // ─── status ────────────────────────────────────────────────────────────────

  wt.command("status [address]")
    .description("Check watchtower registration status (defaults to your own address)")
    .option("--json", "JSON output")
    .action(async (address, opts) => {
      const config = loadConfig();
      if (!config.watchtowerRegistryAddress) throw new Error("watchtowerRegistryAddress missing in config");
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { provider, address: myAddress } = await getClient(config);
      const client = new WatchtowerClient(
        config.watchtowerRegistryAddress,
        config.serviceAgreementAddress,
        provider
      );
      const target = address ?? myAddress;
      if (!target) {
        console.error("No address provided and no private key configured");
        process.exit(1);
      }
      const status = await client.getWatchtowerStatus(target);
      if (opts.json || program.opts().json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log('\n ' + c.mark + c.white(' Watchtower — ' + formatAddress(status.addr)));
        const statusItems: { label: string; value: string; last?: boolean }[] = [
          { label: 'Name', value: status.name },
          { label: 'Description', value: status.description },
          { label: 'Capabilities', value: status.capabilities.join(', ') || '(none)' },
          { label: 'Active', value: String(status.active) },
        ];
        if (status.registeredAt) {
          statusItems.push({ label: 'Registered', value: new Date(status.registeredAt * 1000).toISOString(), last: true });
        } else {
          statusItems[statusItems.length - 1].last = true;
        }
        renderTree(statusItems);
      }
    });

  // ─── watch ─────────────────────────────────────────────────────────────────

  wt.command("watch <channelId>")
    .description("Monitor a session channel for bad-faith closes and auto-submit a challenge")
    .option(
      "--state <path>",
      "Path to latest signed state JSON (defaults to ~/.arc402/channel-states/<channelId>.json)"
    )
    .option("--interval <ms>", "Polling interval in milliseconds", "12000")
    .option("--json", "JSON output")
    .action(async (channelId, opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      if (!config.watchtowerRegistryAddress) throw new Error("watchtowerRegistryAddress missing in config");
      const { signer, address } = await requireSigner(config);

      const watchtowerClient = new WatchtowerClient(
        config.watchtowerRegistryAddress,
        config.serviceAgreementAddress,
        signer
      );
      const channelClient = new ChannelClient(config.serviceAgreementAddress, signer);

      const statePath = opts.state ?? path.join(CHANNEL_STATES_DIR, `${channelId}.json`);
      if (!fs.existsSync(statePath)) {
        console.error(`No state file at ${statePath}`);
        console.error(`Store state first: arc402 channel store-state ${channelId} <state.json>`);
        process.exit(1);
      }
      const state = loadStateFile(statePath);
      const interval = Math.max(1000, Number(opts.interval));

      if (!opts.json) {
        console.log(`watching: ${channelId}`);
        console.log(`  stored seq:    ${state.sequenceNumber}`);
        console.log(`  poll interval: ${interval}ms`);
        console.log(`  press Ctrl+C to stop`);
      }

      let challenged = false;

      const poll = async () => {
        if (challenged) return;
        try {
          const ch = await channelClient.getChannelStatus(channelId);

          if (ch.status === "SETTLED") {
            if (!opts.json) {
              console.log(`[${new Date().toISOString()}] channel settled — stopping watch`);
            }
            return;
          }

          if (ch.status === "CLOSING" || ch.status === "CHALLENGED") {
            if (ch.lastSequenceNumber < (state.sequenceNumber as number)) {
              if (!opts.json) {
                console.log(
                  `[${new Date().toISOString()}] stale close detected ` +
                  `(on-chain seq=${ch.lastSequenceNumber}, stored seq=${state.sequenceNumber}) — challenging...`
                );
              }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const result = await watchtowerClient.submitChallenge(channelId, state as any, address);
              challenged = true;
              if (opts.json) {
                console.log(JSON.stringify({ event: "challenge_submitted", channelId, txHash: result.txHash }));
              } else {
                console.log(' ' + c.success + c.white(' Challenge submitted — tx ' + result.txHash.slice(0, 12) + '...'));
              }
              return;
            } else {
              if (!opts.json) {
                console.log(
                  `[${new Date().toISOString()}] channel closing with seq=${ch.lastSequenceNumber} — no challenge needed`
                );
              }
            }
          }
        } catch (err) {
          if (!opts.json) {
            console.error(`[${new Date().toISOString()}] poll error: ${err}`);
          }
        }
        setTimeout(poll, interval);
      };

      poll();
    });

  // ─── authorize ─────────────────────────────────────────────────────────────

  wt.command("authorize <channelId> <watchtower>")
    .description("Authorize a watchtower address to challenge on your behalf for a channel")
    .option("--json", "JSON output")
    .action(async (channelId, watchtower, opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      if (!config.watchtowerRegistryAddress) throw new Error("watchtowerRegistryAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new WatchtowerClient(
        config.watchtowerRegistryAddress,
        config.serviceAgreementAddress,
        signer
      );
      const authSpinner = startSpinner('Authorizing watchtower…');
      const result = await client.authorizeWatchtower(channelId, watchtower);
      if (opts.json || program.opts().json) {
        authSpinner.stop();
        console.log(JSON.stringify(result));
      } else {
        authSpinner.succeed(c.success + c.white(' Authorized: ' + formatAddress(watchtower)));
      }
    });

  // ─── revoke ────────────────────────────────────────────────────────────────

  wt.command("revoke <channelId> <watchtower>")
    .description("Revoke a watchtower's authorization for a channel")
    .option("--json", "JSON output")
    .action(async (channelId, watchtower, opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      if (!config.watchtowerRegistryAddress) throw new Error("watchtowerRegistryAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new WatchtowerClient(
        config.watchtowerRegistryAddress,
        config.serviceAgreementAddress,
        signer
      );
      const revokeSpinner = startSpinner('Revoking watchtower…');
      const result = await client.revokeWatchtower(channelId, watchtower);
      if (opts.json || program.opts().json) {
        revokeSpinner.stop();
        console.log(JSON.stringify(result));
      } else {
        revokeSpinner.succeed(c.success + c.white(' Revoked: ' + formatAddress(watchtower)));
      }
    });
}
