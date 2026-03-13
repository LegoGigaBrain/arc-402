import { ContractRunner } from "ethers";
import { AGENT_REGISTRY_ABI } from "./contracts";
import { ethers } from "ethers";
import { AgentInfo, OperationalMetrics } from "./types";

export interface AgentRegistrationInput {
  name: string;
  capabilities: string[];
  serviceType: string;
  endpoint: string;
  metadataURI?: string;
}

export class AgentRegistryClient {
  private contract: ethers.Contract;

  constructor(address: string, runner: ContractRunner) {
    this.contract = new ethers.Contract(address, AGENT_REGISTRY_ABI, runner);
  }

  async register(input: AgentRegistrationInput) {
    const tx = await this.contract.register(input.name, input.capabilities, input.serviceType, input.endpoint, input.metadataURI ?? "");
    return tx.wait();
  }

  async update(input: AgentRegistrationInput) {
    const tx = await this.contract.update(input.name, input.capabilities, input.serviceType, input.endpoint, input.metadataURI ?? "");
    return tx.wait();
  }

  async deactivate() { const tx = await this.contract.deactivate(); return tx.wait(); }
  async reactivate() { const tx = await this.contract.reactivate(); return tx.wait(); }
  async submitHeartbeat(latencyMs: number) { const tx = await this.contract.submitHeartbeat(latencyMs); return tx.wait(); }
  async setHeartbeatPolicy(intervalSeconds: number, gracePeriodSeconds: number) {
    const tx = await this.contract.setHeartbeatPolicy(intervalSeconds, gracePeriodSeconds);
    return tx.wait();
  }

  async getAgent(wallet: string): Promise<AgentInfo> {
    const [raw, trustScore] = await Promise.all([this.contract.getAgent(wallet), this.contract.getTrustScore(wallet)]);
    return {
      wallet: raw.wallet,
      name: raw.name,
      capabilities: [...raw.capabilities],
      serviceType: raw.serviceType,
      endpoint: raw.endpoint,
      metadataURI: raw.metadataURI,
      active: raw.active,
      registeredAt: BigInt(raw.registeredAt),
      endpointChangedAt: BigInt(raw.endpointChangedAt),
      endpointChangeCount: BigInt(raw.endpointChangeCount),
      trustScore: BigInt(trustScore),
    };
  }

  async getOperationalMetrics(wallet: string): Promise<OperationalMetrics> {
    const raw = await this.contract.getOperationalMetrics(wallet);
    return {
      heartbeatInterval: BigInt(raw.heartbeatInterval),
      heartbeatGracePeriod: BigInt(raw.heartbeatGracePeriod),
      lastHeartbeatAt: BigInt(raw.lastHeartbeatAt),
      rollingLatency: BigInt(raw.rollingLatency),
      heartbeatCount: BigInt(raw.heartbeatCount),
      missedHeartbeatCount: BigInt(raw.missedHeartbeatCount),
      uptimeScore: BigInt(raw.uptimeScore),
      responseScore: BigInt(raw.responseScore),
    };
  }

  async listAgents(limit?: number): Promise<AgentInfo[]> {
    const count = Number(await this.contract.agentCount());
    const end = limit ? Math.min(limit, count) : count;
    const addresses = await Promise.all(Array.from({ length: end }, (_, i) => this.contract.getAgentAtIndex(i)));
    return Promise.all(addresses.map((address: string) => this.getAgent(address)));
  }

  async findByCapability(capability: string, limit?: number): Promise<AgentInfo[]> {
    const agents = await this.listAgents(limit);
    return agents.filter((agent) => agent.capabilities.includes(capability));
  }
}
