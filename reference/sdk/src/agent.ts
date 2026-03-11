import { ethers } from "ethers";

// ─── ABI ────────────────────────────────────────────────────────────────────
// Extracted directly from AgentRegistry.sol + IAgentRegistry.sol

const AGENT_REGISTRY_ABI = [
  // Write
  "function register(string calldata name, string[] calldata capabilities, string calldata serviceType, string calldata endpoint, string calldata metadataURI) external",
  "function update(string calldata name, string[] calldata capabilities, string calldata serviceType, string calldata endpoint, string calldata metadataURI) external",
  "function deactivate() external",
  "function reactivate() external",

  // Read
  "function getAgent(address wallet) external view returns (tuple(address wallet, string name, string[] capabilities, string serviceType, string endpoint, string metadataURI, bool active, uint256 registeredAt) info)",
  "function isRegistered(address wallet) external view returns (bool)",
  "function isActive(address wallet) external view returns (bool)",
  "function getCapabilities(address wallet) external view returns (string[])",
  "function getTrustScore(address wallet) external view returns (uint256)",
  "function agentCount() external view returns (uint256)",
  "function getAgentAtIndex(uint256 index) external view returns (address)",

  // Events
  "event AgentRegistered(address indexed wallet, string name, string serviceType, uint256 timestamp)",
  "event AgentUpdated(address indexed wallet, string name, string serviceType)",
  "event AgentDeactivated(address indexed wallet)",
  "event AgentReactivated(address indexed wallet)",
];

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentInfo {
  wallet: string;
  name: string;
  capabilities: string[];
  serviceType: string;
  endpoint: string;
  metadataURI: string;
  active: boolean;
  registeredAt: bigint;
  /** Fetched from the shared TrustRegistry via AgentRegistry.getTrustScore() */
  trustScore: bigint;
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class AgentRegistryClient {
  private contract: ethers.Contract;

  constructor(address: string, signerOrProvider: ethers.Signer | ethers.Provider) {
    this.contract = new ethers.Contract(address, AGENT_REGISTRY_ABI, signerOrProvider);
  }

  // ── Write (require signer) ────────────────────────────────────────────────

  async register(
    name: string,
    capabilities: string[],
    serviceType: string,
    endpoint: string,
    metadataURI: string
  ): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.register(name, capabilities, serviceType, endpoint, metadataURI);
    return tx.wait();
  }

  async update(
    name: string,
    capabilities: string[],
    serviceType: string,
    endpoint: string,
    metadataURI: string
  ): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.update(name, capabilities, serviceType, endpoint, metadataURI);
    return tx.wait();
  }

  async deactivate(): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.deactivate();
    return tx.wait();
  }

  async reactivate(): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.reactivate();
    return tx.wait();
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  async getAgent(wallet: string): Promise<AgentInfo> {
    const [raw, trustScore] = await Promise.all([
      this.contract.getAgent(wallet),
      this.contract.getTrustScore(wallet),
    ]);
    return this._toAgentInfo(raw, BigInt(trustScore));
  }

  async isRegistered(wallet: string): Promise<boolean> {
    return this.contract.isRegistered(wallet);
  }

  async isActive(wallet: string): Promise<boolean> {
    return this.contract.isActive(wallet);
  }

  async getCapabilities(wallet: string): Promise<string[]> {
    return this.contract.getCapabilities(wallet);
  }

  async getTrustScore(wallet: string): Promise<bigint> {
    return BigInt(await this.contract.getTrustScore(wallet));
  }

  async agentCount(): Promise<bigint> {
    return BigInt(await this.contract.agentCount());
  }

  async getAgentAtIndex(index: number): Promise<AgentInfo> {
    const walletAddr: string = await this.contract.getAgentAtIndex(index);
    return this.getAgent(walletAddr);
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  /**
   * List up to `limit` agents by iterating `getAgentAtIndex`.
   * Defaults to all agents if limit is not provided.
   */
  async listAgents(limit?: number): Promise<AgentInfo[]> {
    const count = Number(await this.agentCount());
    const end = limit !== undefined ? Math.min(limit, count) : count;
    const indices = Array.from({ length: end }, (_, i) => i);
    return Promise.all(indices.map((i) => this.getAgentAtIndex(i)));
  }

  /**
   * Filter agents by capability string (client-side scan).
   * Fetches up to `limit` agents before filtering.
   */
  async findByCapability(capability: string, limit?: number): Promise<AgentInfo[]> {
    const all = await this.listAgents(limit);
    return all.filter((a) => a.capabilities.includes(capability));
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private _toAgentInfo(raw: ethers.Result, trustScore: bigint): AgentInfo {
    return {
      wallet:      raw.wallet as string,
      name:        raw.name as string,
      capabilities: Array.from(raw.capabilities as string[]),
      serviceType: raw.serviceType as string,
      endpoint:    raw.endpoint as string,
      metadataURI: raw.metadataURI as string,
      active:      raw.active as boolean,
      registeredAt: BigInt(raw.registeredAt),
      trustScore,
    };
  }
}
