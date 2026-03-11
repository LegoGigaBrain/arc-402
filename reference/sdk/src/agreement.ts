import { ContractRunner, ethers } from "ethers";
import { SERVICE_AGREEMENT_ABI } from "./contracts";
import {
  Agreement,
  AgreementStatus,
  DisputeCase,
  DisputeEvidence,
  DisputeOutcome,
  DirectDisputeReason,
  EvidenceType,
  ProposeParams,
  ProviderResponseType,
  RemediationCase,
  RemediationFeedback,
  RemediationResponse,
} from "./types";

export class ServiceAgreementClient {
  private contract: ethers.Contract;

  constructor(address: string, runner: ContractRunner) {
    this.contract = new ethers.Contract(address, SERVICE_AGREEMENT_ABI, runner);
  }

  async propose(params: ProposeParams): Promise<{ agreementId: bigint; receipt: ethers.TransactionReceipt }> {
    const isEth = params.token === ethers.ZeroAddress;
    const tx = await this.contract.propose(
      params.provider,
      params.serviceType,
      params.description,
      params.price,
      params.token,
      params.deadline,
      params.deliverablesHash,
      { value: isEth ? params.price : 0n },
    );
    const receipt = await tx.wait();
    const iface = new ethers.Interface(SERVICE_AGREEMENT_ABI);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === "AgreementProposed") return { agreementId: BigInt(parsed.args.id), receipt };
      } catch {}
    }
    throw new Error("Could not parse AgreementProposed event");
  }

  async accept(id: bigint) { const tx = await this.contract.accept(id); return tx.wait(); }
  /** @deprecated Legacy/trusted-only immediate release path. Prefer commitDeliverable() + verifyDeliverable()/autoRelease(). */
  async fulfill(id: bigint, hash: string) { const tx = await this.contract.fulfill(id, hash); return tx.wait(); }
  async fulfillLegacyTrustedOnly(id: bigint, hash: string) { return this.fulfill(id, hash); }
  async commitDeliverable(id: bigint, hash: string) { const tx = await this.contract.commitDeliverable(id, hash); return tx.wait(); }
  async verifyDeliverable(id: bigint) { const tx = await this.contract.verifyDeliverable(id); return tx.wait(); }
  async autoRelease(id: bigint) { const tx = await this.contract.autoRelease(id); return tx.wait(); }
  async dispute(id: bigint, reason: string) { const tx = await this.contract.dispute(id, reason); return tx.wait(); }
  async directDispute(id: bigint, directReason: DirectDisputeReason, reason: string) { const tx = await this.contract.directDispute(id, directReason, reason); return tx.wait(); }
  async escalateToDispute(id: bigint, reason: string) { const tx = await this.contract.escalateToDispute(id, reason); return tx.wait(); }
  async canDirectDispute(id: bigint, directReason: DirectDisputeReason): Promise<boolean> { return this.contract.canDirectDispute(id, directReason); }
  async cancel(id: bigint) { const tx = await this.contract.cancel(id); return tx.wait(); }
  async expiredCancel(id: bigint) { const tx = await this.contract.expiredCancel(id); return tx.wait(); }
  async resolveDisputeDetailed(id: bigint, outcome: DisputeOutcome, providerAward: bigint, clientAward: bigint) {
    const tx = await this.contract.resolveDisputeDetailed(id, outcome, providerAward, clientAward); return tx.wait();
  }

  async requestRevision(agreementId: bigint, feedbackHash: string, feedbackURI = "", previousTranscriptHash = ethers.ZeroHash) {
    const tx = await this.contract.requestRevision(agreementId, feedbackHash, feedbackURI, previousTranscriptHash);
    return tx.wait();
  }

  async respondToRevision(
    agreementId: bigint,
    responseType: ProviderResponseType,
    responseHash: string,
    responseURI = "",
    previousTranscriptHash = ethers.ZeroHash,
    proposedProviderPayout = 0n,
  ) {
    const tx = await this.contract.respondToRevision(
      agreementId,
      responseType,
      proposedProviderPayout,
      responseHash,
      responseURI,
      previousTranscriptHash,
    );
    return tx.wait();
  }

  async submitDisputeEvidence(agreementId: bigint, evidenceType: EvidenceType, evidenceHash: string, evidenceURI = "") {
    const tx = await this.contract.submitDisputeEvidence(agreementId, evidenceType, evidenceHash, evidenceURI);
    return tx.wait();
  }

  async getAgreement(id: bigint): Promise<Agreement> {
    const raw = await this.contract.getAgreement(id);
    return {
      id: BigInt(raw.id), client: raw.client, provider: raw.provider, serviceType: raw.serviceType,
      description: raw.description, price: BigInt(raw.price), token: raw.token, deadline: BigInt(raw.deadline),
      deliverablesHash: raw.deliverablesHash, status: Number(raw.status) as AgreementStatus,
      createdAt: BigInt(raw.createdAt), resolvedAt: BigInt(raw.resolvedAt), verifyWindowEnd: BigInt(raw.verifyWindowEnd), committedHash: raw.committedHash,
    };
  }

  async getRemediationCase(id: bigint): Promise<RemediationCase> {
    const raw = await this.contract.getRemediationCase(id);
    return { cycleCount: Number(raw.cycleCount), openedAt: BigInt(raw.openedAt), deadlineAt: BigInt(raw.deadlineAt), lastActionAt: BigInt(raw.lastActionAt), latestTranscriptHash: raw.latestTranscriptHash, active: raw.active };
  }

  async getRemediationFeedback(id: bigint, index: bigint): Promise<RemediationFeedback> {
    const raw = await this.contract.getRemediationFeedback(id, index);
    return { cycle: Number(raw.cycle), author: raw.author, feedbackHash: raw.feedbackHash, feedbackURI: raw.feedbackURI, previousTranscriptHash: raw.previousTranscriptHash, transcriptHash: raw.transcriptHash, timestamp: BigInt(raw.timestamp) };
  }

  async getRemediationResponse(id: bigint, index: bigint): Promise<RemediationResponse> {
    const raw = await this.contract.getRemediationResponse(id, index);
    return { cycle: Number(raw.cycle), author: raw.author, responseType: Number(raw.responseType) as ProviderResponseType, proposedProviderPayout: BigInt(raw.proposedProviderPayout), responseHash: raw.responseHash, responseURI: raw.responseURI, previousTranscriptHash: raw.previousTranscriptHash, transcriptHash: raw.transcriptHash, timestamp: BigInt(raw.timestamp) };
  }

  async getDisputeCase(id: bigint): Promise<DisputeCase> {
    const raw = await this.contract.getDisputeCase(id);
    return { agreementId: BigInt(raw.agreementId), openedAt: BigInt(raw.openedAt), responseDeadlineAt: BigInt(raw.responseDeadlineAt), outcome: Number(raw.outcome) as DisputeOutcome, providerAward: BigInt(raw.providerAward), clientAward: BigInt(raw.clientAward), humanReviewRequested: raw.humanReviewRequested, evidenceCount: BigInt(raw.evidenceCount) };
  }

  async getDisputeEvidence(id: bigint, index: bigint): Promise<DisputeEvidence> {
    const raw = await this.contract.getDisputeEvidence(id, index);
    return { submitter: raw.submitter, evidenceType: Number(raw.evidenceType) as EvidenceType, evidenceHash: raw.evidenceHash, evidenceURI: raw.evidenceURI, timestamp: BigInt(raw.timestamp) };
  }

  async getDisputeEvidenceAll(id: bigint): Promise<DisputeEvidence[]> {
    const dispute = await this.getDisputeCase(id);
    return Promise.all(Array.from({ length: Number(dispute.evidenceCount) }, (_, i) => this.getDisputeEvidence(id, BigInt(i))));
  }

  async getClientAgreements(client: string): Promise<Agreement[]> {
    const ids = await this.contract.getAgreementsByClient(client) as bigint[];
    return Promise.all(ids.map((id) => this.getAgreement(BigInt(id))));
  }

  async getProviderAgreements(provider: string): Promise<Agreement[]> {
    const ids = await this.contract.getAgreementsByProvider(provider) as bigint[];
    return Promise.all(ids.map((id) => this.getAgreement(BigInt(id))));
  }
}
