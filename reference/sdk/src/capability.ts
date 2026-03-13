import { ContractRunner, ethers } from "ethers";
import { CAPABILITY_REGISTRY_ABI } from "./contracts";
import { CapabilityRoot } from "./types";

export class CapabilityRegistryClient {
  private contract: ethers.Contract;
  constructor(address: string, runner: ContractRunner) { this.contract = new ethers.Contract(address, CAPABILITY_REGISTRY_ABI, runner); }
  async registerRoot(root: string) { const tx = await this.contract.registerRoot(root); return tx.wait(); }
  async setRootStatus(root: string, active: boolean) { const tx = await this.contract.setRootStatus(root, active); return tx.wait(); }
  async claim(capability: string) { const tx = await this.contract.claim(capability); return tx.wait(); }
  async revoke(capability: string) { const tx = await this.contract.revoke(capability); return tx.wait(); }
  isRootActive(root: string) { return this.contract.isRootActive(root); }
  async getRoot(root: string): Promise<CapabilityRoot> { const raw = await this.contract.getRoot(root); return { root: raw.root, rootId: raw.rootId, active: raw.active }; }
  async listRoots(): Promise<CapabilityRoot[]> { const count = Number(await this.contract.rootCount()); return Promise.all(Array.from({ length: count }, async (_, i) => { const raw = await this.contract.getRootAt(i); return { root: raw.root, rootId: raw.rootId, active: raw.active }; })); }
  getCapabilities(agent: string): Promise<string[]> { return this.contract.getCapabilities(agent); }
  capabilityCount(agent: string) { return this.contract.capabilityCount(agent).then(BigInt); }
  isCapabilityClaimed(agent: string, capability: string) { return this.contract.isCapabilityClaimed(agent, capability); }
}
