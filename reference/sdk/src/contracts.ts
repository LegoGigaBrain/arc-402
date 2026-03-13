import { Contract, ContractRunner } from "ethers";

export const POLICY_ENGINE_ABI = [
  "function setPolicy(bytes32 policyHash, bytes policyData) external",
  "function getPolicy(address wallet) external view returns (bytes32, bytes)",
  "function setCategoryLimit(string category, uint256 limitPerTx) external",
  "function setCategoryLimitFor(address wallet, string category, uint256 limitPerTx) external",
  "function validateSpend(address wallet, string category, uint256 amount, bytes32 contextId) external view returns (bool, string)",
  "function categoryLimits(address wallet, string category) external view returns (uint256)",
  "function registerWallet(address wallet, address owner) external",
] as const;

export const TRUST_REGISTRY_ABI = [
  "function getScore(address wallet) external view returns (uint256)",
  "function getTrustLevel(address wallet) external view returns (string)",
  "function initWallet(address wallet) external",
  "function recordSuccess(address wallet) external",
  "function recordAnomaly(address wallet) external",
] as const;

export const INTENT_ATTESTATION_ABI = [
  "function attest(bytes32 attestationId, string action, string reason, address recipient, uint256 amount) external",
  "function verify(bytes32 attestationId, address wallet) external view returns (bool)",
  "function getAttestation(bytes32 attestationId) external view returns (bytes32, address, string, string, address, uint256, uint256)",
  "event AttestationCreated(bytes32 indexed id, address indexed wallet, string action, string reason, address recipient, uint256 amount, uint256 timestamp)",
] as const;

export const ARC402_WALLET_ABI = [
  "function openContext(bytes32 contextId, string taskType) external",
  "function closeContext() external",
  "function executeSpend(address recipient, uint256 amount, string category, bytes32 attestationId) external",
  "function getTrustScore() external view returns (uint256)",
  "function getActiveContext() external view returns (bytes32, string, uint256, bool)",
  "function updatePolicy(bytes32 newPolicyId) external",
] as const;

export const SETTLEMENT_COORDINATOR_ABI = [
  "function propose(address fromWallet, address toWallet, uint256 amount, bytes32 intentId, uint256 expiresAt) external returns (bytes32)",
  "function accept(bytes32 proposalId) external",
  "function reject(bytes32 proposalId, string reason) external",
  "function execute(bytes32 proposalId) external payable",
  "function checkExpiry(bytes32 proposalId) external",
  "function getProposal(bytes32 proposalId) external view returns (address, address, uint256, bytes32, uint256, uint8, string)",
  "event ProposalCreated(bytes32 indexed proposalId, address indexed from, address indexed to, uint256 amount)",
] as const;

export const WALLET_FACTORY_ABI = [
  "function createWallet() external returns (address)",
  "function getWallets(address owner) external view returns (address[])",
  "event WalletCreated(address indexed owner, address indexed walletAddress)",
] as const;

export const AGENT_REGISTRY_ABI = [
  "function register(string name, string[] capabilities, string serviceType, string endpoint, string metadataURI) external",
  "function update(string name, string[] capabilities, string serviceType, string endpoint, string metadataURI) external",
  "function deactivate() external",
  "function reactivate() external",
  "function submitHeartbeat(uint32 latencyMs) external",
  "function setHeartbeatPolicy(uint64 interval, uint64 gracePeriod) external",
  "function getAgent(address wallet) external view returns (tuple(address wallet, string name, string[] capabilities, string serviceType, string endpoint, string metadataURI, bool active, uint256 registeredAt, uint256 endpointChangedAt, uint256 endpointChangeCount))",
  "function getOperationalMetrics(address wallet) external view returns (tuple(uint64 heartbeatInterval, uint64 heartbeatGracePeriod, uint64 lastHeartbeatAt, uint64 rollingLatency, uint32 heartbeatCount, uint32 missedHeartbeatCount, uint32 uptimeScore, uint32 responseScore))",
  "function isRegistered(address wallet) external view returns (bool)",
  "function isActive(address wallet) external view returns (bool)",
  "function getCapabilities(address wallet) external view returns (string[])",
  "function getTrustScore(address wallet) external view returns (uint256)",
  "function getEndpointStability(address wallet) external view returns (uint256)",
  "function agentCount() external view returns (uint256)",
  "function getAgentAtIndex(uint256 index) external view returns (address)",
] as const;

export const SERVICE_AGREEMENT_ABI = [
  "function propose(address provider, string serviceType, string description, uint256 price, address token, uint256 deadline, bytes32 deliverablesHash) external payable returns (uint256)",
  "function accept(uint256 agreementId) external",
  "function fulfill(uint256 agreementId, bytes32 actualDeliverablesHash) external",
  "function commitDeliverable(uint256 agreementId, bytes32 deliverableHash) external",
  "function verifyDeliverable(uint256 agreementId) external",
  "function autoRelease(uint256 agreementId) external",
  "function dispute(uint256 agreementId, string reason) external",
  "function directDispute(uint256 agreementId, uint8 directReason, string reason) external",
  "function requestRevision(uint256 agreementId, bytes32 feedbackHash, string feedbackURI, bytes32 previousTranscriptHash) external",
  "function respondToRevision(uint256 agreementId, uint8 responseType, uint256 proposedProviderPayout, bytes32 responseHash, string responseURI, bytes32 previousTranscriptHash) external",
  "function escalateToDispute(uint256 agreementId, string reason) external",
  "function canDirectDispute(uint256 agreementId, uint8 directReason) external view returns (bool)",
  "function submitDisputeEvidence(uint256 agreementId, uint8 evidenceType, bytes32 evidenceHash, string evidenceURI) external",
  "function nominateArbitrator(uint256 agreementId, address arbitrator) external",
  "function castArbitrationVote(uint256 agreementId, uint8 vote, uint256 providerAward, uint256 clientAward) external",
  "function requestHumanEscalation(uint256 agreementId, string reason) external",
  "function resolveDisputeDetailed(uint256 agreementId, uint8 outcome, uint256 providerAward, uint256 clientAward) external",
  "function cancel(uint256 agreementId) external",
  "function expiredCancel(uint256 agreementId) external",
  "function resolveDispute(uint256 agreementId, bool favorProvider) external",
  "function getAgreement(uint256 id) external view returns (tuple(uint256 id, address client, address provider, string serviceType, string description, uint256 price, address token, uint256 deadline, bytes32 deliverablesHash, uint8 status, uint256 createdAt, uint256 resolvedAt, uint256 verifyWindowEnd, bytes32 committedHash))",
  "function getRemediationCase(uint256 agreementId) external view returns (tuple(uint8 cycleCount, uint256 openedAt, uint256 deadlineAt, uint256 lastActionAt, bytes32 latestTranscriptHash, bool active))",
  "function getRemediationFeedback(uint256 agreementId, uint256 index) external view returns (tuple(uint8 cycle, address author, bytes32 feedbackHash, string feedbackURI, bytes32 previousTranscriptHash, bytes32 transcriptHash, uint256 timestamp))",
  "function getRemediationResponse(uint256 agreementId, uint256 index) external view returns (tuple(uint8 cycle, address author, uint8 responseType, uint256 proposedProviderPayout, bytes32 responseHash, string responseURI, bytes32 previousTranscriptHash, bytes32 transcriptHash, uint256 timestamp))",
  "function getDisputeCase(uint256 agreementId) external view returns (tuple(uint256 agreementId, uint256 openedAt, uint256 responseDeadlineAt, uint8 outcome, uint256 providerAward, uint256 clientAward, bool humanReviewRequested, uint256 evidenceCount))",
  "function getDisputeEvidence(uint256 agreementId, uint256 index) external view returns (tuple(address submitter, uint8 evidenceType, bytes32 evidenceHash, string evidenceURI, uint256 timestamp))",
  "function getArbitrationCase(uint256 agreementId) external view returns (tuple(uint256 agreementId, address[3] arbitrators, uint8 arbitratorCount, uint8 providerVotes, uint8 clientVotes, uint8 splitVotes, uint8 humanVotes, uint256 selectionDeadlineAt, uint256 decisionDeadlineAt, uint256 splitProviderAward, uint256 splitClientAward, bool finalized, bool humanBackstopUsed))",
  "function getAgreementsByClient(address client) external view returns (uint256[])",
  "function getAgreementsByProvider(address provider) external view returns (uint256[])",
  "function agreementCount() external view returns (uint256)",
  "function openSessionChannel(address provider, address token, uint256 maxAmount, uint256 ratePerCall, uint256 deadline) external payable returns (bytes32 channelId)",
  "function closeChannel(bytes32 channelId, bytes finalState) external",
  "function challengeChannel(bytes32 channelId, bytes latestState) external",
  "function finaliseChallenge(bytes32 channelId) external",
  "function reclaimExpiredChannel(bytes32 channelId) external",
  "function getChannel(bytes32 channelId) external view returns (tuple(address client, address provider, address token, uint256 depositAmount, uint256 settledAmount, uint256 lastSequenceNumber, uint256 deadline, uint256 challengeExpiry, uint8 status))",
  "function getChannelsByClient(address client) external view returns (bytes32[])",
  "function getChannelsByProvider(address provider) external view returns (bytes32[])",
  "function resolveFromArbitration(uint256 agreementId, address recipient, uint256 amount) external",
  "event AgreementProposed(uint256 indexed id, address indexed client, address indexed provider, string serviceType, uint256 price, address token, uint256 deadline)",
] as const;

export const REPUTATION_ORACLE_ABI = [
  "function publishSignal(address subject, uint8 signalType, bytes32 capabilityHash, string reason) external",
  "function getReputation(address subject) external view returns (uint256, uint256, uint256, uint256)",
  "function getCapabilityReputation(address subject, bytes32 capabilityHash) external view returns (uint256)",
  "function getSignalCount(address subject) external view returns (uint256)",
  "function getSignal(address subject, uint256 index) external view returns (tuple(address publisher, address subject, uint8 signalType, bytes32 capabilityHash, string reason, uint256 publisherTrustAtTime, uint256 timestamp, bool autoPublished))",
] as const;

export const SPONSORSHIP_ATTESTATION_ABI = [
  "function publish(address agent, uint256 expiresAt) external returns (bytes32)",
  "function publishWithTier(address agent, uint256 expiresAt, uint8 tier, string evidenceURI) external returns (bytes32)",
  "function revoke(bytes32 attestationId) external",
  "function isActive(bytes32 attestationId) external view returns (bool)",
  "function getActiveAttestation(address sponsor, address agent) external view returns (bytes32)",
  "function getAttestation(bytes32 attestationId) external view returns (tuple(address sponsor, address agent, uint256 issuedAt, uint256 expiresAt, bool revoked, uint8 tier, string evidenceURI))",
  "function getSponsorAttestations(address sponsor) external view returns (bytes32[])",
  "function getAgentAttestations(address agent) external view returns (bytes32[])",
  "function activeSponsorCount(address sponsor) external view returns (uint256)",
  "function getHighestTier(address agent) external view returns (uint8)",
] as const;

export const CAPABILITY_REGISTRY_ABI = [
  "function registerRoot(string root) external returns (bytes32)",
  "function setRootStatus(string root, bool active) external",
  "function claim(string capability) external",
  "function revoke(string capability) external",
  "function isRootActive(string root) external view returns (bool)",
  "function getRoot(string root) external view returns (tuple(bytes32 rootId, string root, bool active))",
  "function rootCount() external view returns (uint256)",
  "function getRootAt(uint256 index) external view returns (tuple(bytes32 rootId, string root, bool active))",
  "function getCapabilities(address agent) external view returns (string[])",
  "function capabilityCount(address agent) external view returns (uint256)",
  "function isCapabilityClaimed(address agent, string capability) external view returns (bool)",
] as const;

export const GOVERNANCE_ABI = [
  "function submitTransaction(address target, uint256 value, bytes data) external returns (uint256)",
  "function confirmTransaction(uint256 txId) external",
  "function revokeConfirmation(uint256 txId) external",
  "function executeTransaction(uint256 txId) external returns (bytes)",
  "function getTransaction(uint256 txId) external view returns (tuple(address target, uint256 value, bytes data, bool executed, uint256 confirmationCount))",
  "function transactionCount() external view returns (uint256)",
] as const;

export const getPolicyEngine = (address: string, runner: ContractRunner) => new Contract(address, POLICY_ENGINE_ABI, runner);
export const getTrustRegistry = (address: string, runner: ContractRunner) => new Contract(address, TRUST_REGISTRY_ABI, runner);
export const getIntentAttestation = (address: string, runner: ContractRunner) => new Contract(address, INTENT_ATTESTATION_ABI, runner);
export const getARC402Wallet = (address: string, runner: ContractRunner) => new Contract(address, ARC402_WALLET_ABI, runner);
export const getSettlementCoordinator = (address: string, runner: ContractRunner) => new Contract(address, SETTLEMENT_COORDINATOR_ABI, runner);
export const getWalletFactory = (address: string, runner: ContractRunner) => new Contract(address, WALLET_FACTORY_ABI, runner);
export const getAgentRegistry = (address: string, runner: ContractRunner) => new Contract(address, AGENT_REGISTRY_ABI, runner);
export const getServiceAgreement = (address: string, runner: ContractRunner) => new Contract(address, SERVICE_AGREEMENT_ABI, runner);
export const getReputationOracle = (address: string, runner: ContractRunner) => new Contract(address, REPUTATION_ORACLE_ABI, runner);
export const getSponsorshipAttestation = (address: string, runner: ContractRunner) => new Contract(address, SPONSORSHIP_ATTESTATION_ABI, runner);
export const getCapabilityRegistry = (address: string, runner: ContractRunner) => new Contract(address, CAPABILITY_REGISTRY_ABI, runner);
export const getGovernance = (address: string, runner: ContractRunner) => new Contract(address, GOVERNANCE_ABI, runner);
