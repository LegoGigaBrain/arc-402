import { ContractRunner, ethers } from "ethers";
import { TRUST_REGISTRY_ABI } from "./contracts";
import { TrustScore } from "./types";

function getTrustLevel(score: number): TrustScore["level"] {
  if (score < 100) return "probationary";
  if (score < 300) return "restricted";
  if (score < 600) return "standard";
  if (score < 800) return "elevated";
  return "autonomous";
}

function getNextLevelAt(score: number): number {
  if (score < 100) return 100;
  if (score < 300) return 300;
  if (score < 600) return 600;
  if (score < 800) return 800;
  return 0;
}

export class TrustClient {
  private contract: ethers.Contract;
  constructor(address: string, runner: ContractRunner) { this.contract = new ethers.Contract(address, TRUST_REGISTRY_ABI, runner); }
  async getScore(walletAddress: string): Promise<TrustScore> {
    const score = Number(await this.contract.getScore(walletAddress));
    return { score, level: getTrustLevel(score), nextLevelAt: getNextLevelAt(score) };
  }

  /**
   * Returns the effective trust score for a wallet, accounting for any decay or bonus adjustments
   * applied by the TrustRegistry (e.g. velocity bonuses, anomaly penalties).
   * Prefer this over getScore for policy decisions.
   */
  async getEffectiveScore(walletAddress: string): Promise<TrustScore> {
    const score = Number(await this.contract.getEffectiveScore(walletAddress));
    return { score, level: getTrustLevel(score), nextLevelAt: getNextLevelAt(score) };
  }

  async init(walletAddress: string) { const tx = await this.contract.initWallet(walletAddress); return tx.wait(); }
  getTrustLevel = getTrustLevel;
  getNextLevelAt = getNextLevelAt;
}
export class TrustPrimitive extends TrustClient {}
