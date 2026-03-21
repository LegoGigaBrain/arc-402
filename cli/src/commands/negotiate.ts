import { Command } from "commander";
import { ethers } from "ethers";
import {
  createSignedProposal,
  createSignedCounter,
  createSignedAccept,
  createSignedReject,
  NegotiationGuard,
  SessionManager,
} from "@arc402/sdk";
import { loadConfig } from "../config";
import { requireSigner, getClient } from "../client";
import { hashFile, hashString } from "../utils/hash";
import { c } from '../ui/colors';

const sessionManager = new SessionManager();

export function registerNegotiateCommands(program: Command): void {
  const negotiate = program
    .command("negotiate")
    .description(
      "Signed agent-to-agent negotiation. Every message is authenticated, " +
      "sessions are tracked locally, transcripts are hashed and committed on-chain. " +
      "This is the secure communication layer — not just payload generation."
    );

  // Session management — nest list/show under a single 'session' subcommand
  const session = negotiate
    .command("session")
    .description("Manage local negotiation sessions");

  session
    .command("list")
    .description("List all negotiation sessions")
    .option("--json", "Machine-parseable output")
    .action((opts) => {
      const sessions = sessionManager.list();
      if (opts.json) {
        console.log(JSON.stringify(sessions));
      } else {
        sessions.forEach(s => {
          console.log(`${s.sessionId.slice(0, 10)}...  ${s.state.padEnd(10)} ${s.initiator} ↔ ${s.responder}  msgs:${s.messages.length}`);
        });
      }
    });

  session
    .command("show <sessionId>")
    .description("Show full session including message history and transcript hash")
    .option("--json", "Machine-parseable output")
    .action((sessionId, opts) => {
      const sess = sessionManager.load(sessionId);
      if (opts.json) {
        console.log(JSON.stringify(sess));
      } else {
        console.log(`Session: ${sess.sessionId}`);
        console.log(`State: ${sess.state}`);
        console.log(`Parties: ${sess.initiator} ↔ ${sess.responder}`);
        console.log(`Messages: ${sess.messages.length}`);
        if (sess.transcriptHash) console.log(`Transcript hash: ${sess.transcriptHash}`);
        if (sess.onChainAgreementId) console.log(`On-chain agreement: ${sess.onChainAgreementId}`);
        sess.messages.forEach((m, i) => console.log(`  ${i + 1}. ${m.type} from ${m.from.slice(0, 8)}...`));
      }
    });

  // Signed propose (starts a new session)
  negotiate
    .command("propose")
    .description("Send a signed PROPOSE. Creates a new negotiation session.")
    .requiredOption("--to <address>")
    .requiredOption("--service-type <type>")
    .requiredOption("--price <amountWei>")
    .option("--token <token>", "Token address", ethers.ZeroAddress)
    .requiredOption("--deadline <iso>")
    .requiredOption("--spec <text>")
    .option("--spec-file <path>")
    .option("--expires-in <seconds>", "Proposal TTL in seconds", "3600")
    .option("--json", "Machine-parseable output")
    .action(async (opts) => {
      const config = loadConfig();
      const { signer } = await requireSigner(config);
      const myAddress = await signer.getAddress();
      const specHash = opts.specFile ? hashFile(opts.specFile) : hashString(opts.spec);
      const now = Math.floor(Date.now() / 1000);

      const session = sessionManager.createSession(myAddress, opts.to);

      const proposal = await createSignedProposal({
        from: myAddress,
        to: opts.to,
        serviceType: opts.serviceType,
        price: opts.price,
        token: opts.token,
        deadline: opts.deadline,
        spec: opts.spec,
        specHash,
        expiresAt: now + parseInt(opts.expiresIn),
        protocolVersion: "1.0.0",
      } as Parameters<typeof createSignedProposal>[0], signer);

      sessionManager.addMessage(session.sessionId, proposal);

      if (opts.json) {
        console.log(JSON.stringify({ sessionId: session.sessionId, message: proposal }));
      } else {
        console.log(' ' + c.success + c.white(' Session started: ' + session.sessionId.slice(0, 12) + '...'));
        console.log(`Signed PROPOSE:`);
        console.log(JSON.stringify(proposal, null, 2));
      }
    });

  // Counter
  negotiate
    .command("counter <sessionId>")
    .description("Send a signed COUNTER within an existing session.")
    .requiredOption("--justification <text>")
    .option("--price <amountWei>")
    .option("--deadline <iso>")
    .option("--json", "Machine-parseable output")
    .action(async (sessionId, opts) => {
      const config = loadConfig();
      const { signer } = await requireSigner(config);
      const myAddress = await signer.getAddress();
      const session = sessionManager.load(sessionId);
      const lastMessage = session.messages[session.messages.length - 1];
      const refNonce = "nonce" in lastMessage ? lastMessage.nonce : (lastMessage as any).refNonce;

      const counter = await createSignedCounter({
        from: myAddress,
        to: lastMessage.from === myAddress ? lastMessage.to : lastMessage.from,
        refNonce,
        justification: opts.justification,
        price: opts.price,
        deadline: opts.deadline,
      }, signer);

      sessionManager.addMessage(sessionId, counter);

      if (opts.json) {
        console.log(JSON.stringify(counter));
      } else {
        console.log(' ' + c.success + c.white(' Counter added to session'));
        console.log(JSON.stringify(counter, null, 2));
      }
    });

  // Accept — closes session, computes transcript hash
  negotiate
    .command("accept <sessionId>")
    .description("Accept terms. Closes the session and computes transcript hash.")
    .requiredOption("--price <amountWei>")
    .requiredOption("--deadline <iso>")
    .option("--record", "Commit transcript hash on-chain alongside propose()")
    .option("--json", "Machine-parseable output")
    .action(async (sessionId, opts) => {
      const config = loadConfig();
      const { signer } = await requireSigner(config);
      const myAddress = await signer.getAddress();
      const session = sessionManager.load(sessionId);
      const lastMessage = session.messages[session.messages.length - 1];
      const refNonce = "nonce" in lastMessage ? lastMessage.nonce : (lastMessage as any).refNonce;

      const accept = await createSignedAccept({
        from: myAddress,
        to: lastMessage.from === myAddress ? lastMessage.to : lastMessage.from,
        refNonce,
        agreedPrice: opts.price,
        agreedDeadline: opts.deadline,
      }, signer);

      sessionManager.addMessage(sessionId, accept);
      const updatedSession = sessionManager.load(sessionId);

      if (opts.json) {
        console.log(JSON.stringify({
          sessionId,
          transcriptHash: updatedSession.transcriptHash,
          message: accept,
        }));
      } else {
        console.log(' ' + c.success + c.white(' Session ACCEPTED — transcript locked'));
        console.log(' ' + c.dim('  Transcript:') + ' ' + c.white(updatedSession.transcriptHash ?? ''));
        if (opts.record) {
          console.log(`\nTranscript hash is ready to commit on-chain.`);
          console.log(`Run: arc402 hire --session ${sessionId} to propose() and record the transcript hash.`);
        }
      }
    });

  // Reject
  negotiate
    .command("reject <sessionId>")
    .description("Reject and close session.")
    .requiredOption("--reason <text>")
    .option("--json", "Machine-parseable output")
    .action(async (sessionId, opts) => {
      const config = loadConfig();
      const { signer } = await requireSigner(config);
      const myAddress = await signer.getAddress();
      const session = sessionManager.load(sessionId);
      const lastMessage = session.messages[session.messages.length - 1];
      const refNonce = "nonce" in lastMessage ? lastMessage.nonce : (lastMessage as any).refNonce;

      const reject = await createSignedReject({
        from: myAddress,
        to: lastMessage.from === myAddress ? lastMessage.to : lastMessage.from,
        reason: opts.reason,
        refNonce,
      }, signer);

      sessionManager.addMessage(sessionId, reject);

      if (opts.json) {
        console.log(JSON.stringify(reject));
      } else {
        console.log(' ' + c.failure + c.white(' Session REJECTED'));
        console.log(`Reason: ${opts.reason}`);
      }
    });

  // Verify an incoming message
  negotiate
    .command("verify")
    .description("Verify an incoming signed negotiation message against AgentRegistry.")
    .requiredOption("--message <json>", "Raw JSON string or @file.json")
    .option("--json", "Machine-parseable output")
    .action(async (opts) => {
      const config = loadConfig();
      if (!config.agentRegistryAddress) throw new Error("agentRegistryAddress not in config");
      const { provider } = await getClient(config);

      const guard = new NegotiationGuard({ agentRegistryAddress: config.agentRegistryAddress, runner: provider });

      const rawJson = opts.message.startsWith("@")
        ? require("fs").readFileSync(opts.message.slice(1), "utf8")
        : opts.message;

      const result = await guard.verify(rawJson);

      if (opts.json) {
        console.log(JSON.stringify(result));
      } else if (result.valid) {
        console.log(' ' + c.success + c.white(' Valid — signer: ' + result.recoveredSigner));
      } else {
        console.error(' ' + c.failure + c.white(' Invalid — ' + result.error));
        process.exit(1);
      }
    });

  // Transcript subcommand
  const transcript = negotiate.command("transcript").description("Transcript management for closed negotiation sessions");

  transcript
    .command("show <sessionId>")
    .description("Show the transcript hash for a completed session")
    .option("--json", "Machine-parseable output")
    .action((sessionId, opts) => {
      const session = sessionManager.load(sessionId);
      if (!session.transcriptHash) {
        console.error("Session not yet closed — no transcript hash");
        process.exit(1);
      }
      if (opts.json) {
        console.log(JSON.stringify({ sessionId, transcriptHash: session.transcriptHash, messageCount: session.messages.length }));
      } else {
        console.log(`Transcript hash: ${session.transcriptHash}`);
        console.log(`Messages: ${session.messages.length}`);
        console.log(`State: ${session.state}`);
      }
    });
}
