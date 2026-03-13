import { ContractRunner, ethers } from "ethers";
import { POLICY_ENGINE_ABI } from "./contracts";
import { Policy } from "./types";

export class PolicyClient {
  private contract: ethers.Contract;
  constructor(address: string, runner: ContractRunner) { this.contract = new ethers.Contract(address, POLICY_ENGINE_ABI, runner); }
  async set(walletAddress: string, categories: Record<string, bigint>) {
    const policyData = JSON.stringify(Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, v.toString()])));
    const tx = await this.contract.setPolicy(ethers.keccak256(ethers.toUtf8Bytes(policyData)), ethers.toUtf8Bytes(policyData));
    await tx.wait();
    for (const [category, limit] of Object.entries(categories)) {
      const updateTx = await this.contract.setCategoryLimitFor(walletAddress, category, limit);
      await updateTx.wait();
    }
  }
  async get(walletAddress: string): Promise<Policy> {
    const [policyHash, policyDataBytes] = await this.contract.getPolicy(walletAddress);
    const categories: Policy["categories"] = {};
    if (policyDataBytes && policyDataBytes !== "0x") {
      const parsed = JSON.parse(ethers.toUtf8String(policyDataBytes));
      for (const [key, value] of Object.entries(parsed)) categories[key] = { limitPerTx: BigInt(value as string) };
    }
    return { walletAddress, policyHash, categories };
  }
  async validate(walletAddress: string, category: string, amount: bigint) {
    const [valid, reason] = await this.contract.validateSpend(walletAddress, category, amount, ethers.ZeroHash);
    return { valid, reason: valid ? undefined : reason };
  }

  /** Freeze spend for a wallet. Callable by the wallet, its owner, or an authorized freeze agent. */
  async freezeSpend(wallet: string): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.freezeSpend(wallet);
    return (await tx.wait())!;
  }

  /** Unfreeze spend for a wallet. Only callable by the wallet or its registered owner. */
  async unfreeze(wallet: string): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.unfreeze(wallet);
    return (await tx.wait())!;
  }

  /** Authorize a watchtower agent to freeze this wallet's spending. Caller must be the wallet. */
  async authorizeFreezeAgent(agent: string): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.authorizeFreezeAgent(agent);
    return (await tx.wait())!;
  }

  /** Revoke a watchtower agent's freeze authorization. */
  async revokeFreezeAgent(agent: string): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.revokeFreezeAgent(agent);
    return (await tx.wait())!;
  }

  /**
   * Queue a daily-limit reduction for wallet+category. Only reductions (newCap < current) are allowed.
   * A 24-hour timelock applies before the new cap can be applied.
   */
  async queueCapReduction(wallet: string, category: string, newCap: bigint): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.queueCapReduction(wallet, category, newCap);
    return (await tx.wait())!;
  }

  /** Apply a queued cap reduction after the 24-hour timelock has elapsed. */
  async applyCapReduction(wallet: string, category: string): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.applyCapReduction(wallet, category);
    return (await tx.wait())!;
  }
}
export class PolicyObject extends PolicyClient {}
export class PolicyValidator { static validate(policy: Policy, category: string, amount: bigint) { return !!policy.categories[category] && amount <= policy.categories[category].limitPerTx; } }
