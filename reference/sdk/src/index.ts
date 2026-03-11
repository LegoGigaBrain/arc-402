/**
 * ARC-402 TypeScript SDK
 *
 * @packageDocumentation
 */

// Main client
export { ARC402WalletClient, ARC402Wallet, ContextBinding } from "./wallet";

// Sub-clients
export { PolicyClient, PolicyObject, PolicyValidator } from "./policy";
export { TrustClient, TrustPrimitive } from "./trust";
export { IntentAttestationClient, IntentAttestation } from "./intent";
export { SettlementClient, MultiAgentSettlement } from "./settlement";
export { AgentRegistryClient } from "./agent";
export { ServiceAgreementClient, AgreementStatus } from "./agreement";

// Contract helpers
export {
  getPolicyEngine,
  getTrustRegistry,
  getIntentAttestation,
  getARC402Wallet,
  getSettlementCoordinator,
  getWalletFactory,
  getAgentRegistry,
  getServiceAgreement,
  POLICY_ENGINE_ABI,
  TRUST_REGISTRY_ABI,
  INTENT_ATTESTATION_ABI,
  ARC402_WALLET_ABI,
  SETTLEMENT_COORDINATOR_ABI,
  WALLET_FACTORY_ABI,
  AGENT_REGISTRY_ABI,
  SERVICE_AGREEMENT_ABI,
} from "./contracts";

// Types & constants
export { NETWORKS } from "./types";
export type {
  Policy,
  PolicyCategory,
  CategoryLimit,
  EscalationConfig,
  Context,
  TrustScore,
  TrustThreshold,
  Intent,
  Attestation,
  SettlementProposal,
  AcceptanceProof,
  RejectionProof,
  RejectionCode,
  ContractAddresses,
} from "./types";

export type { AgentInfo } from "./agent";
export type { Agreement, ProposeParams } from "./agreement";
