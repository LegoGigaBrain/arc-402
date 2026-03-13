import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ethers } from "ethers";
import { loadConfig } from "../config";
import { requireSigner } from "../client";
import { SERVICE_AGREEMENT_ABI } from "../abis";

// ─── Constants ────────────────────────────────────────────────────────────────

const CHANNEL_STATES_DIR = path.join(os.homedir(), ".arc402", "channel-states");

// ChannelStatus enum (mirrors ServiceAgreement.ChannelStatus)
const ChannelStatus = { OPEN: 0, CLOSING: 1, CHALLENGED: 2, SETTLED: 3 } as const;

// ─── Local state store ────────────────────────────────────────────────────────

interface LocalChannelState {
  channelId: string;
  sequenceNumber: string | number;
  callCount: string | number;
  cumulativePayment: string;
  token: string;
  timestamp: string | number;
  clientSig: string;
  providerSig: string;
}

function getStatePath(channelId: string): string {
  return path.join(CHANNEL_STATES_DIR, `${channelId}.json`);
}

function loadLocalState(channelId: string): LocalChannelState | null {
  const p = getStatePath(channelId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as LocalChannelState;
  } catch {
    return null;
  }
}

/**
 * ABI-encode a ChannelState for submission to challengeChannel().
 * Mirrors the Solidity struct layout:
 *   struct ChannelState { bytes32 channelId; uint256 sequenceNumber; uint256 callCount;
 *                         uint256 cumulativePayment; address token; uint256 timestamp;
 *                         bytes clientSig; bytes providerSig; }
 */
function encodeChannelState(state: LocalChannelState): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(bytes32,uint256,uint256,uint256,address,uint256,bytes,bytes)"],
    [[
      state.channelId,
      BigInt(state.sequenceNumber),
      BigInt(state.callCount),
      BigInt(state.cumulativePayment),
      state.token,
      BigInt(state.timestamp),
      state.clientSig,
      state.providerSig,
    ]]
  );
}

// ─── Daemon loop ──────────────────────────────────────────────────────────────

async function runChannelWatchLoop(opts: {
  pollInterval: number;
  wallet: string;
  contract: ethers.Contract;
  json: boolean;
}): Promise<void> {
  const { pollInterval, wallet, contract, json } = opts;

  const log = (data: Record<string, unknown> | string) => {
    const out: Record<string, unknown> =
      typeof data === "string"
        ? { msg: data, ts: Date.now() }
        : { ...data, ts: Date.now() };
    if (json) {
      console.log(JSON.stringify(out));
    } else {
      const ts = new Date(out.ts as number).toISOString();
      if ("msg" in out) {
        console.log(`[${ts}] ${out.msg}`);
      } else {
        // Pretty-print key fields for human readability
        const { ts: _ts, ...rest } = out;
        console.log(`[${ts}] ${JSON.stringify(rest)}`);
      }
    }
  };

  log(`channel-watch started for ${wallet}`);
  log(`poll interval: ${pollInterval}ms`);
  log(`state store: ${CHANNEL_STATES_DIR}`);

  const poll = async () => {
    try {
      const clientChannels: string[] = await contract.getChannelsByClient(wallet);
      const providerChannels: string[] = await contract.getChannelsByProvider(wallet);
      const allChannels = [...new Set([...clientChannels, ...providerChannels])];

      for (const channelId of allChannels) {
        try {
          const ch = await contract.getChannel(channelId);
          const status = Number(ch.status);

          // Only act on channels in the CLOSING state (challenge window open)
          if (status !== ChannelStatus.CLOSING) continue;

          const now = Math.floor(Date.now() / 1000);
          const challengeExpiry = Number(ch.challengeExpiry);
          if (now > challengeExpiry) {
            // Challenge window has already expired — nothing to do
            continue;
          }

          const localState = loadLocalState(channelId);
          if (!localState) {
            // No local state stored — cannot challenge
            log({ event: "no_local_state", channelId });
            continue;
          }

          const localSeq = BigInt(localState.sequenceNumber);
          const chainSeq = BigInt(ch.lastSequenceNumber);

          if (localSeq > chainSeq) {
            // Stale close detected — submit challenge
            log({
              event: "stale_close_detected",
              channelId,
              chainSeq: chainSeq.toString(),
              localSeq: localSeq.toString(),
              windowExpiresAt: new Date(challengeExpiry * 1000).toISOString(),
            });

            const encoded = encodeChannelState(localState);
            const tx = await contract.challengeChannel(channelId, encoded);
            const receipt = await tx.wait();
            log({ event: "challenge_submitted", channelId, txHash: receipt.hash });
          }
          // If localSeq <= chainSeq, the close is already at or above our known state — no action needed
        } catch (err) {
          log({ event: "channel_error", channelId, error: String(err) });
        }
      }
    } catch (err) {
      // Transient RPC failure — log and retry next poll
      log({ event: "poll_error", error: String(err) });
    }
  };

  // First poll immediately, then on interval
  await poll();
  const intervalId = setInterval(() => { void poll(); }, pollInterval);

  // Graceful shutdown on Ctrl+C
  process.on("SIGINT", () => {
    clearInterval(intervalId);
    log("channel-watch stopped");
    process.exit(0);
  });

  // Keep process alive between polls
  process.stdin.resume();
}

// ─── Command registration ─────────────────────────────────────────────────────

export function registerDaemonCommands(program: Command): void {
  const daemon = program
    .command("daemon")
    .description("Background watchtower daemons for session channel liveness (Spec 22)");

  daemon
    .command("channel-watch")
    .description(
      "Monitor all open channels for the configured wallet. " +
      "Polls the chain on an interval and auto-challenges any stale close " +
      "using the latest signed state from ~/.arc402/channel-states/. " +
      "Runs until interrupted (Ctrl+C)."
    )
    .option("--poll-interval <ms>", "Polling interval in milliseconds", "30000")
    .option("--json", "Machine-parseable output (one JSON object per line)")
    .action(async (opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) {
        console.error("serviceAgreementAddress missing in config. Run `arc402 config init`.");
        process.exit(1);
      }

      const { signer, address } = await requireSigner(config);
      const contract = new ethers.Contract(
        config.serviceAgreementAddress,
        SERVICE_AGREEMENT_ABI,
        signer
      );

      await runChannelWatchLoop({
        pollInterval: parseInt(opts.pollInterval, 10),
        wallet: address,
        contract,
        json: opts.json || program.opts().json,
      });
    });
}
