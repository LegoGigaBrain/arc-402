import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ethers } from "ethers";
import type { NegotiationMessage, NegotiationSession } from "./types";

const SESSIONS_DIR = path.join(os.homedir(), ".arc402", "sessions");

export class SessionManager {
  constructor(private sessionsDir = SESSIONS_DIR) {
    fs.mkdirSync(this.sessionsDir, { recursive: true });
  }

  createSession(initiator: string, responder: string): NegotiationSession {
    const nonce = ethers.hexlify(ethers.randomBytes(16));
    const sessionId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256", "bytes16"],
        [initiator, responder, Math.floor(Date.now() / 1000), nonce]
      )
    ) as `0x${string}`;
    const session: NegotiationSession = {
      sessionId,
      initiator: initiator as `0x${string}`,
      responder: responder as `0x${string}`,
      createdAt: Math.floor(Date.now() / 1000),
      messages: [],
      state: "OPEN",
    };
    this.save(session);
    return session;
  }

  addMessage(sessionId: string, message: NegotiationMessage): void {
    const session = this.load(sessionId);
    session.messages.push(message);
    if (message.type === "ACCEPT") {
      session.state = "ACCEPTED";
      session.agreedPrice = message.agreedPrice;
      session.agreedDeadline = message.agreedDeadline;
      session.transcriptHash = this.computeTranscriptHash(session.messages);
    }
    if (message.type === "REJECT") {
      session.state = "REJECTED";
      session.transcriptHash = this.computeTranscriptHash(session.messages);
    }
    this.save(session);
  }

  computeTranscriptHash(messages: NegotiationMessage[]): `0x${string}` {
    const transcript = JSON.stringify(messages);
    return ethers.keccak256(ethers.toUtf8Bytes(transcript)) as `0x${string}`;
  }

  load(sessionId: string): NegotiationSession {
    const file = path.join(this.sessionsDir, `${sessionId}.json`);
    if (!fs.existsSync(file)) throw new Error(`Session not found: ${sessionId}`);
    return JSON.parse(fs.readFileSync(file, "utf8")) as NegotiationSession;
  }

  save(session: NegotiationSession): void {
    fs.writeFileSync(
      path.join(this.sessionsDir, `${session.sessionId}.json`),
      JSON.stringify(session, null, 2)
    );
  }

  list(): NegotiationSession[] {
    if (!fs.existsSync(this.sessionsDir)) return [];
    return fs.readdirSync(this.sessionsDir)
      .filter(f => f.endsWith(".json"))
      .map(f => JSON.parse(fs.readFileSync(path.join(this.sessionsDir, f), "utf8")) as NegotiationSession);
  }

  setOnChainId(sessionId: string, agreementId: string): void {
    const session = this.load(sessionId);
    session.onChainAgreementId = agreementId;
    this.save(session);
  }
}
