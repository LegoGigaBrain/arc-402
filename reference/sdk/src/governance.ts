import { ContractRunner, ethers } from "ethers";
import { GOVERNANCE_ABI } from "./contracts";
import { GovernanceTransaction } from "./types";

export class GovernanceClient {
  private contract: ethers.Contract;
  constructor(address: string, runner: ContractRunner) { this.contract = new ethers.Contract(address, GOVERNANCE_ABI, runner); }
  async submitTransaction(target: string, value: bigint, data: string) { const tx = await this.contract.submitTransaction(target, value, data); return tx.wait(); }
  async confirmTransaction(txId: bigint) { const tx = await this.contract.confirmTransaction(txId); return tx.wait(); }
  async revokeConfirmation(txId: bigint) { const tx = await this.contract.revokeConfirmation(txId); return tx.wait(); }
  async executeTransaction(txId: bigint) { const tx = await this.contract.executeTransaction(txId); return tx.wait(); }
  async getTransaction(txId: bigint): Promise<GovernanceTransaction> { const raw = await this.contract.getTransaction(txId); return { target: raw.target, value: BigInt(raw.value), data: raw.data, executed: raw.executed, confirmationCount: BigInt(raw.confirmationCount) }; }
  transactionCount() { return this.contract.transactionCount().then(BigInt); }
}
