import { ContractRunner, ethers } from "ethers";
import { ArbitratorBondState, DisputeClass, DisputeFeeState, DisputeMode } from "./types";

const DISPUTE_ARBITRATION_ABI = [
  // Views
  "function getDisputeFeeState(uint256 agreementId) view returns (tuple(uint8 mode, uint8 disputeClass, address opener, address client, address provider, address token, uint256 agreementPrice, uint256 feeRequired, uint256 openerPaid, uint256 respondentPaid, uint256 openedAt, bool active, bool resolved))",
  "function getArbitratorBondState(address arbitrator, uint256 agreementId) view returns (tuple(uint256 bondAmount, uint256 lockedAt, bool locked, bool slashed, bool returned))",
  "function getFeeQuote(uint256 agreementPrice, address token, uint8 mode, uint8 disputeClass) view returns (uint256 feeInTokens)",
  "function getAcceptedArbitrators(uint256 agreementId) view returns (address[])",
  "function isEligibleArbitrator(address arbitrator) view returns (bool)",
  "function tokenUsdRate18(address token) view returns (uint256)",
  "function feeFloorUsd18() view returns (uint256)",
  "function feeCapUsd18() view returns (uint256)",
  "function minBondFloorUsd18() view returns (uint256)",
  // Transactions
  "function joinMutualDispute(uint256 agreementId) payable",
  "function acceptAssignment(uint256 agreementId) payable",
  "function triggerFallback(uint256 agreementId) returns (bool)",
  "function slashArbitrator(uint256 agreementId, address arbitrator, string reason)",
  "function reclaimExpiredBond(uint256 agreementId)",
  "function transferOwnership(address newOwner)",
  "function acceptOwnership()",
  "function setTokenUsdRate(address token, uint256 usdRate18)",
  "function setFeeFloorUsd(uint256 floorUsd18)",
  "function setFeeCapUsd(uint256 capUsd18)",
  "function setMinBondFloorUsd(uint256 floorUsd18)",
  "function setServiceAgreement(address sa)",
  "function setTrustRegistry(address tr)",
  "function setTreasury(address treasury)",
  // Events
  "event DisputeFeeOpened(uint256 indexed agreementId, uint8 mode, uint8 disputeClass, uint256 feeRequired, address token)",
  "event MutualDisputeFunded(uint256 indexed agreementId, address respondent, uint256 respondentFee)",
  "event DisputeFeeResolved(uint256 indexed agreementId, uint8 outcome, uint256 openerRefund)",
  "event ArbitratorAssigned(uint256 indexed agreementId, address indexed arbitrator, uint256 bondAmount)",
  "event ArbitratorBondReturned(uint256 indexed agreementId, address indexed arbitrator, uint256 amount)",
  "event ArbitratorBondSlashed(uint256 indexed agreementId, address indexed arbitrator, uint256 amount, string reason)",
  "event ArbitratorFeePaid(uint256 indexed agreementId, address indexed arbitrator, uint256 feeShare)",
  "event DisputeFallbackTriggered(uint256 indexed agreementId, string reason)",
  "event TokenRateSet(address indexed token, uint256 usdRate18)",
];

export class DisputeArbitrationClient {
  private contract: ethers.Contract;

  constructor(address: string, runner: ContractRunner) {
    this.contract = new ethers.Contract(address, DISPUTE_ARBITRATION_ABI, runner);
  }

  // ─── Views ────────────────────────────────────────────────────────────────

  async getDisputeFeeState(agreementId: bigint): Promise<DisputeFeeState> {
    const r = await this.contract.getDisputeFeeState(agreementId);
    return {
      mode: Number(r.mode) as DisputeMode,
      disputeClass: Number(r.disputeClass) as DisputeClass,
      opener: r.opener,
      client: r.client,
      provider: r.provider,
      token: r.token,
      agreementPrice: BigInt(r.agreementPrice),
      feeRequired: BigInt(r.feeRequired),
      openerPaid: BigInt(r.openerPaid),
      respondentPaid: BigInt(r.respondentPaid),
      openedAt: BigInt(r.openedAt),
      active: r.active,
      resolved: r.resolved,
    };
  }

  async getArbitratorBondState(arbitrator: string, agreementId: bigint): Promise<ArbitratorBondState> {
    const r = await this.contract.getArbitratorBondState(arbitrator, agreementId);
    return {
      bondAmount: BigInt(r.bondAmount),
      lockedAt: BigInt(r.lockedAt),
      locked: r.locked,
      slashed: r.slashed,
      returned: r.returned,
    };
  }

  async getFeeQuote(
    agreementPrice: bigint,
    token: string,
    mode: DisputeMode,
    disputeClass: DisputeClass
  ): Promise<bigint> {
    return BigInt(await this.contract.getFeeQuote(agreementPrice, token, mode, disputeClass));
  }

  async getAcceptedArbitrators(agreementId: bigint): Promise<string[]> {
    return this.contract.getAcceptedArbitrators(agreementId);
  }

  async isEligibleArbitrator(address: string): Promise<boolean> {
    return this.contract.isEligibleArbitrator(address);
  }

  async getTokenUsdRate(token: string): Promise<bigint> {
    return BigInt(await this.contract.tokenUsdRate18(token));
  }

  // ─── Transactions ─────────────────────────────────────────────────────────

  /** Respondent in MUTUAL dispute funds their half of the fee. */
  async joinMutualDispute(
    agreementId: bigint,
    halfFeeEth: bigint = 0n // 0 for ERC-20 agreements (pre-approve instead)
  ): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.joinMutualDispute(agreementId, { value: halfFeeEth });
    return (await tx.wait())!;
  }

  /** Nominated arbitrator accepts assignment and posts bond. */
  async acceptAssignment(
    agreementId: bigint,
    bondEth: bigint = 0n // 0 for ERC-20 agreements (pre-approve instead)
  ): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.acceptAssignment(agreementId, { value: bondEth });
    return (await tx.wait())!;
  }

  /** Trigger fallback to human backstop queue (mutual unfunded or panel not formed). */
  async triggerFallback(agreementId: bigint): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.triggerFallback(agreementId);
    return (await tx.wait())!;
  }

  /** Owner-only: slash an arbitrator for manual rules violation. */
  async slashArbitrator(
    agreementId: bigint,
    arbitrator: string,
    reason: string
  ): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.slashArbitrator(agreementId, arbitrator, reason);
    return (await tx.wait())!;
  }

  /**
   * Arbitrators can reclaim their bond after 45 days if the dispute was never resolved via resolveDisputeFee.
   * Prevents permanent bond lock on stalled disputes.
   */
  async reclaimExpiredBond(agreementId: bigint): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.reclaimExpiredBond(agreementId);
    return (await tx.wait())!;
  }

  /** Step 1 of two-step ownership transfer. Owner-only. */
  async proposeOwner(newOwner: string): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.transferOwnership(newOwner);
    return (await tx.wait())!;
  }

  /** Step 2 of two-step ownership transfer. Must be called by the pending owner. */
  async acceptOwnership(): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.acceptOwnership();
    return (await tx.wait())!;
  }

  // ─── Admin ────────────────────────────────────────────────────────────────

  /**
   * Set the USD rate for a payment token. Owner only.
   * @param token Token address (address(0) for ETH)
   * @param usdRate18 USD per token with 18 decimals (e.g. 2000e18 for ETH at $2000)
   * IMPORTANT: This is an admin-set rate, not a trustless oracle. Keep it current.
   */
  async setTokenUsdRate(token: string, usdRate18: bigint): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.setTokenUsdRate(token, usdRate18);
    return (await tx.wait())!;
  }

  async setFeeFloorUsd(floorUsd18: bigint): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.setFeeFloorUsd(floorUsd18);
    return (await tx.wait())!;
  }

  async setFeeCapUsd(capUsd18: bigint): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.setFeeCapUsd(capUsd18);
    return (await tx.wait())!;
  }

  async setServiceAgreement(address: string): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.setServiceAgreement(address);
    return (await tx.wait())!;
  }

  async setTrustRegistry(address: string): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.setTrustRegistry(address);
    return (await tx.wait())!;
  }

  async setTreasury(address: string): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.setTreasury(address);
    return (await tx.wait())!;
  }
}
