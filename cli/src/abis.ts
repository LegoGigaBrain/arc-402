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
  // Core functions
  "function propose(address provider, string serviceType, string description, uint256 price, address token, uint256 deadline, bytes32 deliverablesHash) external payable returns (uint256 agreementId)",
  "function accept(uint256 agreementId) external",
  "function fulfill(uint256 agreementId, bytes32 actualDeliverablesHash) external",
  "function dispute(uint256 agreementId, string reason) external",
  "function cancel(uint256 agreementId) external",
  "function expiredCancel(uint256 agreementId) external",
  "function resolveDispute(uint256 agreementId, bool favorProvider) external",
  // Getters
  "function getAgreement(uint256 id) external view returns (tuple(uint256 id, address client, address provider, string serviceType, string description, uint256 price, address token, uint256 deadline, bytes32 deliverablesHash, uint8 status, uint256 createdAt, uint256 resolvedAt))",
  "function getAgreementsByClient(address client) external view returns (uint256[])",
  "function getAgreementsByProvider(address provider) external view returns (uint256[])",
  "function agreementCount() external view returns (uint256)",
  // Events
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
