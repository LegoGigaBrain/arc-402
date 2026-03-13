"""ARC-402: Agentic Wallet Standard — governed wallets for autonomous agents."""

from .agent import AgentInfo, AgentRegistryClient
from .agreement import ServiceAgreementClient
from .dispute_arbitration import DisputeArbitrationClient
from .capability import CapabilityRegistryClient
from .context import ContextBinding as Context
from .exceptions import (
    ARC402Error,
    AttestationNotFound,
    ContextAlreadyOpen,
    ContextNotOpen,
    NetworkNotSupported,
    PolicyViolation,
    TransactionFailed,
    TrustInsufficient,
)
from .governance import ARC402GovernanceClient
from .intent import IntentAttestation as Intent
from .policy import PolicyClient as Policy
from .reputation import ReputationOracleClient
from .settlement import MultiAgentSettlement as Settlement
from .sponsorship import SponsorshipAttestationClient
from .trust import TrustClient as Trust
from .types import (
    Agreement,
    AgreementStatus,
    ArbitratorBondState,
    ArbitrationCase,
    ArbitrationVote,
    DisputeClass,
    DisputeFeeState,
    DisputeMode,
    AttestationRecord,
    CapabilitySlot,
    DisputeCase,
    DisputeEvidence,
    DisputeOutcome,
    EvidenceType,
    GovernanceTransaction,
    IdentityTier,
    OperationalMetrics,
    PolicyConfig,
    ProviderResponseType,
    RemediationCase,
    RemediationFeedback,
    RemediationResponse,
    ReputationSignal,
    ReputationSummary,
    RootConfig,
    SettlementProposal,
    SignalType,
    SponsorshipAttestationRecord,
    TrustProfile,
    TrustScore,
)
from .wallet import ARC402Wallet

__all__ = [
    "ARC402Wallet",
    "Policy",
    "Context",
    "Trust",
    "Intent",
    "Settlement",
    "AgentRegistryClient",
    "AgentInfo",
    "ServiceAgreementClient",
    "DisputeArbitrationClient",
    "DisputeMode",
    "DisputeClass",
    "DisputeFeeState",
    "ArbitratorBondState",
    "CapabilityRegistryClient",
    "ARC402GovernanceClient",
    "ReputationOracleClient",
    "SponsorshipAttestationClient",
    "TrustScore",
    "TrustProfile",
    "CapabilitySlot",
    "AttestationRecord",
    "PolicyConfig",
    "SettlementProposal",
    "Agreement",
    "AgreementStatus",
    "ArbitrationCase",
    "ArbitrationVote",
    "ProviderResponseType",
    "DisputeOutcome",
    "EvidenceType",
    "RemediationCase",
    "RemediationFeedback",
    "RemediationResponse",
    "DisputeCase",
    "DisputeEvidence",
    "ReputationSignal",
    "ReputationSummary",
    "SignalType",
    "SponsorshipAttestationRecord",
    "IdentityTier",
    "RootConfig",
    "GovernanceTransaction",
    "OperationalMetrics",
    "ARC402Error",
    "PolicyViolation",
    "TrustInsufficient",
    "ContextAlreadyOpen",
    "ContextNotOpen",
    "NetworkNotSupported",
    "TransactionFailed",
    "AttestationNotFound",
]

__version__ = "0.2.0"
