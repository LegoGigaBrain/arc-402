import { ContractRunner, ethers } from "ethers";
import { REPUTATION_ORACLE_ABI } from "./contracts";
import { ReputationSignal, ReputationSignalType, ReputationSummary } from "./types";

export class ReputationOracleClient {
  private contract: ethers.Contract;
  constructor(address: string, runner: ContractRunner) { this.contract = new ethers.Contract(address, REPUTATION_ORACLE_ABI, runner); }
  async publishSignal(subject: string, signalType: ReputationSignalType, capabilityHash = ethers.ZeroHash, reason = "") { const tx = await this.contract.publishSignal(subject, signalType, capabilityHash, reason); return tx.wait(); }
  async getReputation(subject: string): Promise<ReputationSummary> {
    const [endorsements, warnings, blocks, weightedScore] = await this.contract.getReputation(subject);
    return { endorsements: BigInt(endorsements), warnings: BigInt(warnings), blocks: BigInt(blocks), weightedScore: BigInt(weightedScore) };
  }
  getCapabilityReputation(subject: string, capabilityHash: string) { return this.contract.getCapabilityReputation(subject, capabilityHash).then(BigInt); }
  getSignalCount(subject: string) { return this.contract.getSignalCount(subject).then(BigInt); }
  async getSignal(subject: string, index: bigint): Promise<ReputationSignal> {
    const raw = await this.contract.getSignal(subject, index);
    return { publisher: raw.publisher, subject: raw.subject, signalType: Number(raw.signalType) as ReputationSignalType, capabilityHash: raw.capabilityHash, reason: raw.reason, publisherTrustAtTime: BigInt(raw.publisherTrustAtTime), timestamp: BigInt(raw.timestamp), autoPublished: raw.autoPublished };
  }
  async listSignals(subject: string): Promise<ReputationSignal[]> { const count = Number(await this.getSignalCount(subject)); return Promise.all(Array.from({ length: count }, (_, i) => this.getSignal(subject, BigInt(i)))); }
}
