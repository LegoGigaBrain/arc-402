import { ContractRunner, ethers } from "ethers";
import { INTENT_ATTESTATION_ABI } from "./contracts";
import { Intent } from "./types";

export class IntentAttestationClient {
  private contract: ethers.Contract;
  constructor(address: string, runner: ContractRunner, private walletAddress: string) {
    this.contract = new ethers.Contract(address, INTENT_ATTESTATION_ABI, runner);
  }
  async create(action: string, reason: string, recipient: string, amount: bigint): Promise<string> {
    const attestationId = ethers.keccak256(ethers.toUtf8Bytes(`${this.walletAddress}:${action}:${reason}:${recipient}:${amount}:${Date.now()}`));
    const tx = await this.contract.attest(attestationId, action, reason, recipient, amount);
    await tx.wait();
    return attestationId;
  }
  verify(attestationId: string, walletAddress: string) { return this.contract.verify(attestationId, walletAddress); }
  async get(attestationId: string): Promise<Intent> {
    const [id, wallet, action, reason, recipient, amount, timestamp] = await this.contract.getAttestation(attestationId);
    return { attestationId: id, wallet, action, reason, recipient, amount: BigInt(amount), timestamp: Number(timestamp) };
  }
}
export class IntentAttestation extends IntentAttestationClient {}
