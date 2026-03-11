import { Contract, ContractRunner } from "ethers"

const POLICY_ENGINE_ABI = [
  "function registerWallet(address wallet, address owner) external",
  "function setCategoryLimit(string calldata category, uint256 limitPerTx) external",
  "function setCategoryLimitFor(address wallet, string calldata category, uint256 limitPerTx) external",
  "function validateSpend(address wallet, string calldata category, uint256 amount, bytes32 contextId) external view returns (bool valid, string memory reason)",
  "function categoryLimits(address wallet, string category) external view returns (uint256)",
]

const TRUST_REGISTRY_ABI = [
  "function initWallet(address wallet) external",
  "function getScore(address wallet) external view returns (uint256)",
  "function getTrustLevel(address wallet) external view returns (string)",
  "function recordSuccess(address wallet) external",
  "function recordAnomaly(address wallet) external",
  "function addUpdater(address updater) external",
]

const INTENT_ATTESTATION_ABI = [
  "function attest(bytes32 attestationId, string calldata action, string calldata reason, address recipient, uint256 amount) external",
  "function verify(bytes32 attestationId, address wallet) external view returns (bool)",
  "function getAttestation(bytes32 attestationId) external view returns (bytes32 id, address wallet, string memory action, string memory reason, address recipient, uint256 amount, uint256 timestamp)",
]

const ARC402_WALLET_ABI = [
  "function openContext(bytes32 contextId, string calldata taskType) external",
  "function closeContext() external",
  "function executeSpend(address payable recipient, uint256 amount, string calldata category, bytes32 attestationId) external",
  "function updatePolicy(bytes32 newPolicyId) external",
  "function getTrustScore() external view returns (uint256)",
  "function getActiveContext() external view returns (bytes32, string memory, uint256, bool)",
  "function owner() external view returns (address)",
  "event SpendExecuted(address indexed recipient, uint256 amount, string category, bytes32 attestationId)",
  "event ContextOpened(bytes32 indexed contextId, string taskType, uint256 timestamp)",
  "event ContextClosed(bytes32 indexed contextId, uint256 timestamp)",
  "receive() external payable",
]

const SETTLEMENT_COORDINATOR_ABI = [
  "function propose(address fromWallet, address toWallet, uint256 amount, bytes32 intentId, uint256 expiresAt) external returns (bytes32 proposalId)",
  "function accept(bytes32 proposalId) external",
  "function reject(bytes32 proposalId, string calldata reason) external",
  "function execute(bytes32 proposalId) external payable",
  "function getProposal(bytes32 proposalId) external view returns (address fromWallet, address toWallet, uint256 amount, bytes32 intentId, uint256 expiresAt, uint8 status, string memory rejectionReason)",
]

const WALLET_FACTORY_ABI = [
  "function createWallet() external returns (address)",
  "function getWallets(address owner) external view returns (address[])",
  "function allWallets(uint256 index) external view returns (address)",
  "function ownerWallets(address owner, uint256 index) external view returns (address)",
  "function totalWallets() external view returns (uint256)",
  "function policyEngine() external view returns (address)",
  "function trustRegistry() external view returns (address)",
  "function intentAttestation() external view returns (address)",
  "function settlementCoordinator() external view returns (address)",
  "event WalletCreated(address indexed owner, address indexed walletAddress)",
]

export function getPolicyEngine(address: string, runner: ContractRunner) {
  return new Contract(address, POLICY_ENGINE_ABI, runner)
}

export function getTrustRegistry(address: string, runner: ContractRunner) {
  return new Contract(address, TRUST_REGISTRY_ABI, runner)
}

export function getIntentAttestation(address: string, runner: ContractRunner) {
  return new Contract(address, INTENT_ATTESTATION_ABI, runner)
}

export function getARC402Wallet(address: string, runner: ContractRunner) {
  return new Contract(address, ARC402_WALLET_ABI, runner)
}

export function getSettlementCoordinator(address: string, runner: ContractRunner) {
  return new Contract(address, SETTLEMENT_COORDINATOR_ABI, runner)
}

export function getWalletFactory(address: string, runner: ContractRunner) {
  return new Contract(address, WALLET_FACTORY_ABI, runner)
}

// ─── AgentRegistry ───────────────────────────────────────────────────────────
// ABI extracted from AgentRegistry.sol + IAgentRegistry.sol

const AGENT_REGISTRY_ABI = [
  "function register(string calldata name, string[] calldata capabilities, string calldata serviceType, string calldata endpoint, string calldata metadataURI) external",
  "function update(string calldata name, string[] calldata capabilities, string calldata serviceType, string calldata endpoint, string calldata metadataURI) external",
  "function deactivate() external",
  "function reactivate() external",
  "function getAgent(address wallet) external view returns (tuple(address wallet, string name, string[] capabilities, string serviceType, string endpoint, string metadataURI, bool active, uint256 registeredAt) info)",
  "function isRegistered(address wallet) external view returns (bool)",
  "function isActive(address wallet) external view returns (bool)",
  "function getCapabilities(address wallet) external view returns (string[])",
  "function getTrustScore(address wallet) external view returns (uint256)",
  "function agentCount() external view returns (uint256)",
  "function getAgentAtIndex(uint256 index) external view returns (address)",
  "event AgentRegistered(address indexed wallet, string name, string serviceType, uint256 timestamp)",
  "event AgentUpdated(address indexed wallet, string name, string serviceType)",
  "event AgentDeactivated(address indexed wallet)",
  "event AgentReactivated(address indexed wallet)",
]

// ─── ServiceAgreement ────────────────────────────────────────────────────────
// ABI extracted from ServiceAgreement.sol + IServiceAgreement.sol

const SERVICE_AGREEMENT_ABI = [
  "function propose(address provider, string calldata serviceType, string calldata description, uint256 price, address token, uint256 deadline, bytes32 deliverablesHash) external payable returns (uint256 agreementId)",
  "function accept(uint256 agreementId) external",
  "function fulfill(uint256 agreementId, bytes32 actualDeliverablesHash) external",
  "function dispute(uint256 agreementId, string calldata reason) external",
  "function cancel(uint256 agreementId) external",
  "function expiredCancel(uint256 agreementId) external",
  "function getAgreement(uint256 id) external view returns (tuple(uint256 id, address client, address provider, string serviceType, string description, uint256 price, address token, uint256 deadline, bytes32 deliverablesHash, uint8 status, uint256 createdAt, uint256 resolvedAt) agreement)",
  "function getAgreementsByClient(address client) external view returns (uint256[])",
  "function getAgreementsByProvider(address provider) external view returns (uint256[])",
  "function agreementCount() external view returns (uint256)",
  "event AgreementProposed(uint256 indexed id, address indexed client, address indexed provider, string serviceType, uint256 price, address token, uint256 deadline)",
  "event AgreementAccepted(uint256 indexed id, address indexed provider)",
  "event AgreementFulfilled(uint256 indexed id, address indexed provider, bytes32 deliverablesHash)",
  "event AgreementDisputed(uint256 indexed id, address indexed initiator, string reason)",
  "event AgreementCancelled(uint256 indexed id, address indexed client)",
  "event DisputeResolved(uint256 indexed id, bool favorProvider)",
]

export function getAgentRegistry(address: string, runner: ContractRunner) {
  return new Contract(address, AGENT_REGISTRY_ABI, runner)
}

export function getServiceAgreement(address: string, runner: ContractRunner) {
  return new Contract(address, SERVICE_AGREEMENT_ABI, runner)
}

export {
  POLICY_ENGINE_ABI,
  TRUST_REGISTRY_ABI,
  INTENT_ATTESTATION_ABI,
  ARC402_WALLET_ABI,
  SETTLEMENT_COORDINATOR_ABI,
  WALLET_FACTORY_ABI,
  AGENT_REGISTRY_ABI,
  SERVICE_AGREEMENT_ABI,
}
