export type Address = string;
export type Hex = string;

export interface CategoryLimit {
  limitPerTx: bigint;
}

export interface Policy {
  walletAddress: Address;
  policyHash?: Hex;
  categories: Record<string, CategoryLimit>;
}

export interface Context {
  contextId: Hex;
  taskType: string;
  openedAt: number;
  isOpen: boolean;
}

export interface TrustScore {
  score: number;
  level: "probationary" | "restricted" | "standard" | "elevated" | "autonomous";
  nextLevelAt: number;
}

export interface Intent {
  attestationId: Hex;
  action: string;
  reason: string;
  recipient: Address;
  amount: bigint;
  wallet: Address;
  timestamp: number;
}

export type SettlementStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "EXECUTED" | "EXPIRED";

export interface SettlementProposal {
  proposalId: Hex;
  from: Address;
  to: Address;
  amount: bigint;
  intentId: Hex;
  expiresAt: number;
  status: SettlementStatus;
  rejectionReason?: string;
}

export interface ContractAddresses {
  policyEngine: Address;
  trustRegistry: Address;
  intentAttestation: Address;
  settlementCoordinator: Address;
  walletFactory?: Address;
  agentRegistry?: Address;
  serviceAgreement?: Address;
  reputationOracle?: Address;
  sponsorshipAttestation?: Address;
  capabilityRegistry?: Address;
  governance?: Address;
}

export interface NetworkConfig {
  chainId: number;
  rpc: string;
  contracts: ContractAddresses;
}

export const NETWORKS: Record<string, NetworkConfig> = {
  "base-sepolia": {
    chainId: 84532,
    rpc: "https://sepolia.base.org",
    contracts: {
      policyEngine: "0x6B89621c94a7105c3D8e0BD8Fb06814931CA2CB2",
      trustRegistry: "0xdA1D377991B2E580991B0DD381CdD635dd71aC39",
      intentAttestation: "0xbB5E1809D4a94D08Bf1143131312858143D018f1",
      settlementCoordinator: "0x7ad8db6C5f394542E8e9658F86C85cC99Cf6D460",
    },
  },
  base: {
    chainId: 8453,
    rpc: "https://mainnet.base.org",
    contracts: {
      policyEngine: "0x0000000000000000000000000000000000000000",
      trustRegistry: "0x0000000000000000000000000000000000000000",
      intentAttestation: "0x0000000000000000000000000000000000000000",
      settlementCoordinator: "0x0000000000000000000000000000000000000000",
    },
  },
};

export interface AgentInfo {
  wallet: Address;
  name: string;
  capabilities: string[];
  serviceType: string;
  endpoint: string;
  metadataURI: string;
  active: boolean;
  registeredAt: bigint;
  endpointChangedAt: bigint;
  endpointChangeCount: bigint;
  trustScore?: bigint;
}

export interface OperationalMetrics {
  heartbeatInterval: bigint;
  heartbeatGracePeriod: bigint;
  lastHeartbeatAt: bigint;
  rollingLatency: bigint;
  heartbeatCount: bigint;
  missedHeartbeatCount: bigint;
  uptimeScore: bigint;
  responseScore: bigint;
}

export enum AgreementStatus {
  PROPOSED = 0,
  ACCEPTED = 1,
  PENDING_VERIFICATION = 2,
  FULFILLED = 3,
  DISPUTED = 4,
  CANCELLED = 5,
  REVISION_REQUESTED = 6,
  REVISED = 7,
  PARTIAL_SETTLEMENT = 8,
  MUTUAL_CANCEL = 9,
  ESCALATED_TO_HUMAN = 10,
  ESCALATED_TO_ARBITRATION = 11,
}

export enum ProviderResponseType {
  NONE = 0,
  REVISE = 1,
  DEFEND = 2,
  COUNTER = 3,
  PARTIAL_SETTLEMENT = 4,
  REQUEST_HUMAN_REVIEW = 5,
  ESCALATE = 6,
}

export enum DisputeOutcome {
  NONE = 0,
  PENDING = 1,
  PROVIDER_WINS = 2,
  CLIENT_REFUND = 3,
  PARTIAL_PROVIDER = 4,
  PARTIAL_CLIENT = 5,
  MUTUAL_CANCEL = 6,
  HUMAN_REVIEW_REQUIRED = 7,
}

export enum EvidenceType {
  NONE = 0,
  TRANSCRIPT = 1,
  DELIVERABLE = 2,
  ACCEPTANCE_CRITERIA = 3,
  COMMUNICATION = 4,
  EXTERNAL_REFERENCE = 5,
  OTHER = 6,
}

export enum DirectDisputeReason {
  NONE = 0,
  NO_DELIVERY = 1,
  HARD_DEADLINE_BREACH = 2,
  INVALID_OR_FRAUDULENT_DELIVERABLE = 3,
  SAFETY_CRITICAL_VIOLATION = 4,
}

export interface Agreement {
  id: bigint;
  client: Address;
  provider: Address;
  serviceType: string;
  description: string;
  price: bigint;
  token: Address;
  deadline: bigint;
  deliverablesHash: Hex;
  status: AgreementStatus;
  createdAt: bigint;
  resolvedAt: bigint;
  verifyWindowEnd: bigint;
  committedHash: Hex;
}

export interface ProposeParams {
  provider: Address;
  serviceType: string;
  description: string;
  price: bigint;
  token: Address;
  deadline: number;
  deliverablesHash: Hex;
}

export interface RemediationCase {
  cycleCount: number;
  openedAt: bigint;
  deadlineAt: bigint;
  lastActionAt: bigint;
  latestTranscriptHash: Hex;
  active: boolean;
}

export interface RemediationFeedback {
  cycle: number;
  author: Address;
  feedbackHash: Hex;
  feedbackURI: string;
  previousTranscriptHash: Hex;
  transcriptHash: Hex;
  timestamp: bigint;
}

export interface RemediationResponse {
  cycle: number;
  author: Address;
  responseType: ProviderResponseType;
  proposedProviderPayout: bigint;
  responseHash: Hex;
  responseURI: string;
  previousTranscriptHash: Hex;
  transcriptHash: Hex;
  timestamp: bigint;
}

export interface DisputeCase {
  agreementId: bigint;
  openedAt: bigint;
  responseDeadlineAt: bigint;
  outcome: DisputeOutcome;
  providerAward: bigint;
  clientAward: bigint;
  humanReviewRequested: boolean;
  evidenceCount: bigint;
}

export interface DisputeEvidence {
  submitter: Address;
  evidenceType: EvidenceType;
  evidenceHash: Hex;
  evidenceURI: string;
  timestamp: bigint;
}

export enum ArbitrationVote {
  NONE = 0,
  PROVIDER_WINS = 1,
  CLIENT_REFUND = 2,
  SPLIT = 3,
  HUMAN_REVIEW_REQUIRED = 4,
}

export interface ArbitrationCase {
  agreementId: bigint;
  arbitrators: Address[];
  arbitratorCount: number;
  providerVotes: number;
  clientVotes: number;
  splitVotes: number;
  humanVotes: number;
  selectionDeadlineAt: bigint;
  decisionDeadlineAt: bigint;
  splitProviderAward: bigint;
  splitClientAward: bigint;
  finalized: boolean;
  humanBackstopUsed: boolean;
}

export enum ReputationSignalType {
  ENDORSE = 0,
  WARN = 1,
  BLOCK = 2,
}

export interface ReputationSignal {
  publisher: Address;
  subject: Address;
  signalType: ReputationSignalType;
  capabilityHash: Hex;
  reason: string;
  publisherTrustAtTime: bigint;
  timestamp: bigint;
  autoPublished: boolean;
}

export interface ReputationSummary {
  endorsements: bigint;
  warnings: bigint;
  blocks: bigint;
  weightedScore: bigint;
}

export enum IdentityTier {
  NONE = 0,
  SPONSORED = 1,
  VERIFIED_PROVIDER = 2,
  ENTERPRISE_PROVIDER = 3,
}

export interface SponsorshipAttestationRecord {
  sponsor: Address;
  agent: Address;
  issuedAt: bigint;
  expiresAt: bigint;
  revoked: boolean;
  tier: IdentityTier;
  evidenceURI: string;
}

export interface CapabilityRoot {
  root: string;
  rootId: Hex;
  active: boolean;
}

export interface GovernanceTransaction {
  target: Address;
  value: bigint;
  data: Hex;
  executed: boolean;
  confirmationCount: bigint;
}

export interface NegotiationMessageBase {
  from: Address;
  to: Address;
}

export interface NegotiationProposal extends NegotiationMessageBase {
  type: "PROPOSE";
  serviceType: string;
  price: string;
  token: Address;
  deadline: string;
  spec: string;
  specHash: Hex;
  nonce: Hex;
}

export interface NegotiationCounter extends NegotiationMessageBase {
  type: "COUNTER";
  price?: string;
  deadline?: string;
  justification: string;
  refNonce: Hex;
}

export interface NegotiationAccept extends NegotiationMessageBase {
  type: "ACCEPT";
  agreedPrice: string;
  agreedDeadline: string;
  refNonce: Hex;
}

export interface NegotiationReject extends NegotiationMessageBase {
  type: "REJECT";
  reason: string;
  refNonce?: Hex;
}

export type NegotiationMessage =
  | NegotiationProposal
  | NegotiationCounter
  | NegotiationAccept
  | NegotiationReject;


// ─── DisputeArbitration types ─────────────────────────────────────────────────

export enum DisputeMode {
  UNILATERAL = 0,
  MUTUAL = 1,
}

export enum DisputeClass {
  HARD_FAILURE = 0,
  AMBIGUITY_QUALITY = 1,
  HIGH_SENSITIVITY = 2,
}

export interface DisputeFeeState {
  mode: DisputeMode;
  disputeClass: DisputeClass;
  opener: string;
  client: string;
  provider: string;
  token: string;
  agreementPrice: bigint;
  feeRequired: bigint;
  openerPaid: bigint;
  respondentPaid: bigint;
  openedAt: bigint;
  active: boolean;
  resolved: boolean;
}

export interface ArbitratorBondState {
  bondAmount: bigint;
  lockedAt: bigint;
  locked: boolean;
  slashed: boolean;
  returned: boolean;
}
