import { ContractRunner, ethers } from "ethers";
import { SETTLEMENT_COORDINATOR_ABI } from "./contracts";
import { SettlementProposal, SettlementStatus } from "./types";

const STATUS_MAP: SettlementStatus[] = ["PENDING", "ACCEPTED", "REJECTED", "EXECUTED", "EXPIRED"];

export class SettlementClient {
  private contract: ethers.Contract;
  constructor(address: string, runner: ContractRunner) { this.contract = new ethers.Contract(address, SETTLEMENT_COORDINATOR_ABI, runner); }
  async propose(fromWallet: string, toWallet: string, amount: bigint, intentId: string, ttlSeconds = 3600) {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const tx = await this.contract.propose(fromWallet, toWallet, amount, intentId, expiresAt);
    const receipt = await tx.wait();
    const iface = new ethers.Interface(SETTLEMENT_COORDINATOR_ABI);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === "ProposalCreated") return parsed.args.proposalId as string;
      } catch {}
    }
    throw new Error("Could not parse proposalId from receipt");
  }
  async accept(id: string) { const tx = await this.contract.accept(id); return tx.wait(); }
  async reject(id: string, reason: string) { const tx = await this.contract.reject(id, reason); return tx.wait(); }
  async execute(id: string) { const proposal = await this.getProposal(id); const tx = await this.contract.execute(id, { value: proposal.amount }); return tx.wait(); }
  async getProposal(id: string): Promise<SettlementProposal> {
    const [from, to, amount, intentId, expiresAt, statusNum, rejectionReason] = await this.contract.getProposal(id);
    return { proposalId: id, from, to, amount: BigInt(amount), intentId, expiresAt: Number(expiresAt), status: STATUS_MAP[Number(statusNum)] ?? "PENDING", rejectionReason };
  }
}
export class MultiAgentSettlement extends SettlementClient {}
