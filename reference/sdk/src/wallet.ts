import { ContractRunner, ethers } from "ethers";
import { ARC402_WALLET_ABI, INTENT_ATTESTATION_ABI, WALLET_FACTORY_ABI } from "./contracts";
import { Context, ContractAddresses, Intent, NETWORKS, TrustScore } from "./types";
import { PolicyClient } from "./policy";
import { TrustClient } from "./trust";
import { IntentAttestationClient } from "./intent";

function resolveContracts(network: string): ContractAddresses {
  const config = NETWORKS[network];
  if (!config) throw new Error(`Unknown network: ${network}`);
  return config.contracts;
}

export class ARC402WalletClient {
  private walletContract: ethers.Contract;
  private intentContract: ethers.Contract;
  public policy: PolicyClient;
  public trust: TrustClient;
  public intent: IntentAttestationClient;

  constructor(public walletAddress: string, private signer: ContractRunner, network = "base-sepolia") {
    const contracts = resolveContracts(network);
    this.walletContract = new ethers.Contract(walletAddress, ARC402_WALLET_ABI, signer);
    this.intentContract = new ethers.Contract(contracts.intentAttestation, INTENT_ATTESTATION_ABI, signer);
    this.policy = new PolicyClient(contracts.policyEngine, signer);
    this.trust = new TrustClient(contracts.trustRegistry, signer);
    this.intent = new IntentAttestationClient(contracts.intentAttestation, signer, walletAddress);
  }

  static async deploy(signer: ContractRunner, network = "base-sepolia") {
    const contracts = resolveContracts(network);
    if (!contracts.walletFactory) throw new Error(`WalletFactory not deployed on ${network}`);
    const factory = new ethers.Contract(contracts.walletFactory, WALLET_FACTORY_ABI, signer);
    const tx = await factory.createWallet();
    const receipt = await tx.wait();
    const iface = new ethers.Interface(WALLET_FACTORY_ABI);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === "WalletCreated") return new ARC402WalletClient(parsed.args.walletAddress, signer, network);
      } catch {}
    }
    throw new Error("Could not parse wallet address from WalletCreated event");
  }

  setPolicy(categories: Record<string, bigint>) { return this.policy.set(this.walletAddress, categories); }
  getPolicy() { return this.policy.get(this.walletAddress); }

  async openContext(taskType: string): Promise<{ contextId: string; close: () => Promise<void> }> {
    const contextId = ethers.keccak256(ethers.toUtf8Bytes(`${taskType}:${Date.now()}:${this.walletAddress}`));
    const tx = await this.walletContract.openContext(contextId, taskType);
    await tx.wait();
    return { contextId, close: () => this.closeContext() };
  }

  async closeContext() { const tx = await this.walletContract.closeContext(); return tx.wait(); }

  async getActiveContext(): Promise<Context | null> {
    const [contextId, taskType, openedAt, isOpen] = await this.walletContract.getActiveContext();
    if (!isOpen) return null;
    return { contextId, taskType, openedAt: Number(openedAt), isOpen };
  }

  async spend(recipient: string, amount: bigint, category: string, action: string, reason: string): Promise<string> {
    const attestationId = await this.intent.create(action, reason, recipient, amount);
    const tx = await this.walletContract.executeSpend(recipient, amount, category, attestationId);
    await tx.wait();
    return attestationId;
  }

  getTrustScore(): Promise<TrustScore> { return this.trust.getScore(this.walletAddress); }

  async getAttestations(limit = 50): Promise<Intent[]> {
    const provider = (this.signer as ethers.Signer).provider;
    if (!provider) return [];
    const iface = new ethers.Interface(INTENT_ATTESTATION_ABI);
    const event = iface.getEvent("AttestationCreated");
    const logs = await provider.getLogs({ address: this.intentContract.target as string, topics: [event.topicHash, null, ethers.zeroPadValue(this.walletAddress, 32)], fromBlock: 0 });
    return logs.slice(-limit).reverse().map((log) => {
      const parsed = iface.parseLog(log);
      return { attestationId: parsed.args.id, wallet: parsed.args.wallet, action: parsed.args.action, reason: parsed.args.reason, recipient: parsed.args.recipient, amount: BigInt(parsed.args.amount), timestamp: Number(parsed.args.timestamp) };
    });
  }
}
export class ARC402Wallet extends ARC402WalletClient {}
export type ContextBinding = Awaited<ReturnType<ARC402WalletClient["openContext"]>>;
