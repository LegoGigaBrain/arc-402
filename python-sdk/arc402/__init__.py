"""ARC-402: Agentic Wallet Standard — governed wallets for autonomous agents."""

from .agent import AgentInfo, AgentRegistryClient
from .agreement import Agreement, AgreementStatus, ServiceAgreementClient
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
from .intent import IntentAttestation as Intent
from .policy import PolicyClient as Policy
from .settlement import MultiAgentSettlement as Settlement
from .trust import TrustClient as Trust
from .types import AttestationRecord, PolicyConfig, ProposalStatus, TrustScore
from .wallet import ARC402Wallet

__all__ = [
    "ARC402Wallet",
    "Policy",
    "Context",
    "Trust",
    "Intent",
    "Settlement",
    # Agent Registry
    "AgentRegistryClient",
    "AgentInfo",
    # Service Agreement
    "ServiceAgreementClient",
    "Agreement",
    "AgreementStatus",
    # Types
    "TrustScore",
    "AttestationRecord",
    "PolicyConfig",
    "ProposalStatus",
    # Exceptions
    "ARC402Error",
    "PolicyViolation",
    "TrustInsufficient",
    "ContextAlreadyOpen",
    "ContextNotOpen",
    "NetworkNotSupported",
    "TransactionFailed",
    "AttestationNotFound",
]

__version__ = "0.1.0"
