/**
 * ABIs extracted from the ARC-402 contract sources.
 * Source: /products/arc-402/reference/contracts/
 */

export const AGENT_REGISTRY_ABI = [
  // Registration
  "function register(string name, string[] capabilities, string serviceType, string endpoint, string metadataURI) external",
  "function update(string name, string[] capabilities, string serviceType, string endpoint, string metadataURI) external",
  "function deactivate() external",
  "function reactivate() external",
  // Queries
  "function getAgent(address wallet) external view returns (tuple(address wallet, string name, string[] capabilities, string serviceType, string endpoint, string metadataURI, bool active, uint256 registeredAt))",
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
] as const;

export const SERVICE_AGREEMENT_ABI = [
  "function propose(address provider, string serviceType, string description, uint256 price, address token, uint256 deadline, bytes32 deliverablesHash) external payable returns (uint256 agreementId)",
  "function accept(uint256 agreementId) external",
  "function fulfill(uint256 agreementId, bytes32 actualDeliverablesHash) external",
  "function commitDeliverable(uint256 agreementId, bytes32 deliverableHash) external",
  "function verifyDeliverable(uint256 agreementId) external",
  "function autoRelease(uint256 agreementId) external",
  "function dispute(uint256 agreementId, string reason) external",
  "function directDispute(uint256 agreementId, uint8 directReason, string reason) external",
  "function escalateToDispute(uint256 agreementId, string reason) external",
  "function requestRevision(uint256 agreementId, bytes32 feedbackHash, string feedbackURI, bytes32 previousTranscriptHash) external",
  "function respondToRevision(uint256 agreementId, uint8 responseType, uint256 proposedProviderPayout, bytes32 responseHash, string responseURI, bytes32 previousTranscriptHash) external",
  "function submitDisputeEvidence(uint256 agreementId, uint8 evidenceType, bytes32 evidenceHash, string evidenceURI) external",
  "function nominateArbitrator(uint256 agreementId, address arbitrator) external",
  "function castArbitrationVote(uint256 agreementId, uint8 vote, uint256 providerAward, uint256 clientAward) external",
  "function requestHumanEscalation(uint256 agreementId, string reason) external",
  "function cancel(uint256 agreementId) external",
  "function expiredCancel(uint256 agreementId) external",
  "function resolveDispute(uint256 agreementId, bool favorProvider) external",
  "function resolveDisputeDetailed(uint256 agreementId, uint8 outcome, uint256 providerAward, uint256 clientAward) external",
  "function openDisputeWithMode(uint256 agreementId, uint8 mode, uint8 class, string reason) external payable",
  "function ownerResolveDispute(uint256 agreementId, bool favorProvider) external",
  "function canDirectDispute(uint256 agreementId, uint8 directReason) external view returns (bool)",
  "function getAgreement(uint256 id) external view returns (tuple(uint256 id, address client, address provider, string serviceType, string description, uint256 price, address token, uint256 deadline, bytes32 deliverablesHash, uint8 status, uint256 createdAt, uint256 resolvedAt, uint256 verifyWindowEnd, bytes32 committedHash))",
  "function getDisputeCase(uint256 agreementId) external view returns (tuple(uint256 agreementId, uint256 openedAt, uint256 responseDeadlineAt, uint8 outcome, uint256 providerAward, uint256 clientAward, bool humanReviewRequested, uint256 evidenceCount))",
  "function getDisputeEvidence(uint256 agreementId, uint256 index) external view returns (tuple(address submitter, uint8 evidenceType, bytes32 evidenceHash, string evidenceURI, uint256 timestamp))",
  "function getArbitrationCase(uint256 agreementId) external view returns (tuple(uint256 agreementId, address[3] arbitrators, uint8 arbitratorCount, uint8 providerVotes, uint8 clientVotes, uint8 splitVotes, uint8 humanVotes, uint256 selectionDeadlineAt, uint256 decisionDeadlineAt, uint256 splitProviderAward, uint256 splitClientAward, bool finalized, bool humanBackstopUsed))",
  "function getAgreementsByClient(address client) external view returns (uint256[])",
  "function getAgreementsByProvider(address provider) external view returns (uint256[])",
  "function agreementCount() external view returns (uint256)",
  "function openSessionChannel(address provider, address token, uint256 maxAmount, uint256 ratePerCall, uint256 deadline) external payable returns (bytes32)",
  "function closeChannel(bytes32 channelId, bytes finalState) external",
  "function challengeChannel(bytes32 channelId, bytes latestState) external",
  "function finaliseChallenge(bytes32 channelId) external",
  "function reclaimExpiredChannel(bytes32 channelId) external",
  "function getChannel(bytes32 channelId) external view returns (tuple(address client, address provider, address token, uint256 depositAmount, uint256 settledAmount, uint256 lastSequenceNumber, uint256 deadline, uint256 challengeExpiry, uint8 status))",
  "function getChannelsByClient(address client) external view returns (bytes32[])",
  "function getChannelsByProvider(address provider) external view returns (bytes32[])",
  "function resolveFromArbitration(uint256 agreementId, address recipient, uint256 amount) external",
  "event AgreementProposed(uint256 indexed id, address indexed client, address indexed provider, string serviceType, uint256 price, address token, uint256 deadline)",
  "event AgreementAccepted(uint256 indexed id, address indexed provider)",
  "event AgreementFulfilled(uint256 indexed id, address indexed provider, bytes32 deliverablesHash)",
  "event AgreementDisputed(uint256 indexed id, address indexed initiator, string reason)",
  "event AgreementCancelled(uint256 indexed id, address indexed client)",
] as const;

export const TRUST_REGISTRY_ABI = [
  "function getScore(address wallet) external view returns (uint256)",
  "function getTrustLevel(address wallet) external view returns (string)",
  "function initWallet(address wallet) external",
  "function recordSuccess(address wallet) external",
  "function recordAnomaly(address wallet) external",
  "function owner() external view returns (address)",
] as const;

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
] as const;

export const WALLET_FACTORY_ABI = [
  "function createWallet() external returns (address)",
  "function getWallets(address owner) external view returns (address[] memory)",
  "function totalWallets() external view returns (uint256)",
  "event WalletCreated(address indexed owner, address indexed wallet)",
] as const;

export const POLICY_ENGINE_LIMITS_ABI = [
  "function getSpendLimit(address wallet, string category) external view returns (uint256)",
  "function setSpendLimit(address wallet, string category, uint256 amount) external",
  "function getCategories(address wallet) external view returns (string[])",
] as const;

export const ARC402_WALLET_EXECUTE_ABI = [
  "function executeContractCall((address target, bytes data, uint256 value, uint256 minReturnValue, uint256 maxApprovalAmount, address approvalToken) params) external returns (bytes memory)",
] as const;

export const ARC402_WALLET_GUARDIAN_ABI = [
  // Guardian management (owner only)
  "function setGuardian(address _guardian) external",
  // Guardian freeze functions (guardian key only)
  "function freeze() external",
  "function freezeAndDrain() external",
  // Owner freeze (with reason)
  "function freeze(string reason) external",
  // Owner unfreeze
  "function unfreeze() external",
  // State queries
  "function frozen() external view returns (bool)",
  "function frozenBy() external view returns (address)",
  "function frozenAt() external view returns (uint256)",
  "function guardian() external view returns (address)",
  "function owner() external view returns (address)",
  // Events
  "event WalletFrozen(address indexed by, string reason, uint256 timestamp)",
  "event WalletUnfrozen(address indexed by, uint256 timestamp)",
  "event GuardianUpdated(address indexed newGuardian)",
] as const;

export const ARC402_WALLET_REGISTRY_ABI = [
  "function proposeRegistryUpdate(address newRegistry) external",
  "function executeRegistryUpdate() external",
  "function cancelRegistryUpdate() external",
  "function pendingRegistry() external view returns (address)",
  "function registryUpdateUnlockAt() external view returns (uint256)",
  "function registry() external view returns (address)",
] as const;

export const ARC402_WALLET_OWNER_ABI = [
  // Owner-only setters
  "function setAuthorizedInterceptor(address interceptor) external",
  "function setVelocityLimit(uint256 limit) external",
  "function updatePolicy(bytes32 newPolicyId) external",
  // State queries
  "function authorizedInterceptor() external view returns (address)",
  "function velocityLimit() external view returns (uint256)",
  "function activePolicyId() external view returns (bytes32)",
] as const;
