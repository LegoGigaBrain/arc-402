import { ContractRunner, ethers } from "ethers";
import { SPONSORSHIP_ATTESTATION_ABI } from "./contracts";
import { IdentityTier, SponsorshipAttestationRecord } from "./types";

export class SponsorshipAttestationClient {
  private contract: ethers.Contract;
  constructor(address: string, runner: ContractRunner) { this.contract = new ethers.Contract(address, SPONSORSHIP_ATTESTATION_ABI, runner); }
  async publish(agent: string, expiresAt = 0) { const tx = await this.contract.publish(agent, expiresAt); return tx.wait(); }
  async publishWithTier(agent: string, expiresAt: number, tier: IdentityTier, evidenceURI = "") { const tx = await this.contract.publishWithTier(agent, expiresAt, tier, evidenceURI); return tx.wait(); }
  async revoke(attestationId: string) { const tx = await this.contract.revoke(attestationId); return tx.wait(); }
  isActive(attestationId: string) { return this.contract.isActive(attestationId); }
  getActiveAttestation(sponsor: string, agent: string) { return this.contract.getActiveAttestation(sponsor, agent); }
  async getAttestation(attestationId: string): Promise<SponsorshipAttestationRecord> { const raw = await this.contract.getAttestation(attestationId); return { sponsor: raw.sponsor, agent: raw.agent, issuedAt: BigInt(raw.issuedAt), expiresAt: BigInt(raw.expiresAt), revoked: raw.revoked, tier: Number(raw.tier) as IdentityTier, evidenceURI: raw.evidenceURI }; }
  getSponsorAttestations(sponsor: string) { return this.contract.getSponsorAttestations(sponsor); }
  getAgentAttestations(agent: string) { return this.contract.getAgentAttestations(agent); }
  activeSponsorCount(sponsor: string) { return this.contract.activeSponsorCount(sponsor).then(BigInt); }
  getHighestTier(agent: string) { return this.contract.getHighestTier(agent).then((value: bigint) => Number(value) as IdentityTier); }
}
