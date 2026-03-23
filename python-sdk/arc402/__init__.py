"""ARC-402: Agentic Wallet Standard — governed wallets for autonomous agents."""

from .agent import AgentInfo, AgentRegistryClient
from .agreement import ServiceAgreementClient
from .bundler import BundlerClient, UserOperation, build_user_op, DEFAULT_ENTRY_POINT, DEFAULT_BUNDLER_URL
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
from .endpoint import (
    resolve_endpoint,
    notify_endpoint,
    notify_hire,
    notify_handshake,
    notify_hire_accepted,
    notify_delivery,
    notify_delivery_accepted,
    notify_dispute,
    notify_message,
    DEFAULT_REGISTRY_ADDRESS,
)
from .delivery import DeliveryClient, DeliveryFile, DeliveryManifest, DEFAULT_DAEMON_URL
from .compute import ComputeAgreementClient, ComputeSession, ComputeUsageReport

ARC402Operator = ARC402Wallet

# Base Mainnet contract addresses
COMPUTE_AGREEMENT_ADDRESS = "0xf898A8A2cF9900A588B174d9f96349BBA95e57F3"
SUBSCRIPTION_AGREEMENT_ADDRESS = "0x809c1D997Eab3531Eb2d01FCD5120Ac786D850D6"
ARC402_REGISTRY_V2_ADDRESS = "0xcc0D8731ccCf6CFfF4e66F6d68cA86330Ea8B622"
ARC402_REGISTRY_V3_ADDRESS = "0x6EafeD4FA103D2De04DDee157e35A8e8df91B6A6"

__all__ = [
    "ARC402Wallet",
    "ARC402Operator",
    "Policy",
    "Context",
    "Trust",
    "Intent",
    "Settlement",
    "AgentRegistryClient",
    "AgentInfo",
    "BundlerClient",
    "UserOperation",
    "build_user_op",
    "DEFAULT_ENTRY_POINT",
    "DEFAULT_BUNDLER_URL",
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
    "resolve_endpoint",
    "notify_endpoint",
    "notify_hire",
    "notify_handshake",
    "notify_hire_accepted",
    "notify_delivery",
    "notify_delivery_accepted",
    "notify_dispute",
    "notify_message",
    "DEFAULT_REGISTRY_ADDRESS",
    "DeliveryClient",
    "DeliveryFile",
    "DeliveryManifest",
    "DEFAULT_DAEMON_URL",
    "ComputeAgreementClient",
    "ComputeSession",
    "ComputeUsageReport",
    "COMPUTE_AGREEMENT_ADDRESS",
    "SUBSCRIPTION_AGREEMENT_ADDRESS",
    "ARC402_REGISTRY_V2_ADDRESS",
    "ARC402_REGISTRY_V3_ADDRESS",
]

__version__ = "0.5.1"
