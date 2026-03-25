"""Pydantic models for ARC-402 primitives."""

from __future__ import annotations

from datetime import datetime
from enum import IntEnum
from typing import Any, ClassVar

from pydantic import BaseModel, Field


NETWORKS: dict[str, dict[str, Any]] = {
    "base-sepolia": {
        "chain_id": 84532,
        "rpc_url": "https://sepolia.base.org",
        "policy_engine": "0x6B89621c94a7105c3D8e0BD8Fb06814931CA2CB2",
        "trust_registry": "0xdA1D377991B2E580991B0DD381CdD635dd71aC39",
        "intent_attestation": "0xbB5E1809D4a94D08Bf1143131312858143D018f1",
        "settlement_coordinator": "0x7ad8db6C5f394542E8e9658F86C85cC99Cf6D460",
        "wallet_factory": "0x0000000000000000000000000000000000000000",
        "agent_registry": None,
        "service_agreement": None,
        "reputation_oracle": None,
        "sponsorship_attestation": None,
        "capability_registry": None,
        "governance": None,
    },
    "base": {
        "chain_id": 8453,
        "rpc_url": "https://mainnet.base.org",
        "policy_engine": "0x9449B15268bE7042C0b473F3f711a41A29220866",
        "trust_registry": "0x22366D6dabb03062Bc0a5E893EfDff15D8E329b1",   # TrustRegistryV3 — v2
        "intent_attestation": "0x66585C2F96cAe05EA360F6dBF76bA092A7B87669",
        "settlement_coordinator": "0x6653F385F98752575db3180b9306e2d9644f9Eb1",
        "wallet_factory": "0x801f0553585f511D9953419A9668edA078196997",   # WalletFactoryV6 — final 2026-03-24
        "agent_registry": "0x6EafeD4FA103D2De04DDee157e35A8e8df91B6A6",   # ARC402RegistryV3 (new default; V2: 0xcc0D8731ccCf6CFfF4e66F6d68cA86330Ea8B622)
        "service_agreement": "0xC98B402CAB9156da68A87a69E3B4bf167A3CCcF6",
        "reputation_oracle": "0x359F76a54F9A345546E430e4d6665A7dC9DaECd4",
        "sponsorship_attestation": "0xD6c2edE89Ea71aE19Db2Be848e172b444Ed38f22",
        "capability_registry": "0x7becb642668B80502dD957A594E1dD0aC414c1a3",
        "governance": "0xE931DD2EEb9Af9353Dd5E2c1250492A0135E0EC4",
        "vouching_registry": "0x94519194Bf17865770faD59eF581feC512Ae99c9",
        "migration_registry": "0x4821D8A590eD4DbEf114fCA3C2d9311e81D576DF",
    },
}

TRUST_LEVELS = {
    "restricted": (0, 299),
    "standard": (300, 699),
    "trusted": (700, 999),
    "verified": (1000, None),
}


def _hex(value: bytes | str) -> str:
    return value.hex() if isinstance(value, bytes) else value


def _trust_level_from_score(score: int) -> str:
    for level, (low, high) in TRUST_LEVELS.items():
        if high is None and score >= low:
            return level
        if high is not None and low <= score <= high:
            return level
    return "restricted"


def _next_level_at(score: int) -> int | None:
    level = _trust_level_from_score(score)
    levels = list(TRUST_LEVELS.keys())
    idx = levels.index(level)
    if idx + 1 >= len(levels):
        return None
    next_level = levels[idx + 1]
    return TRUST_LEVELS[next_level][0]


class TrustScore(BaseModel):
    score: int
    level: str
    next_level_at: int | None = None

    @classmethod
    def from_raw(cls, raw_score: int) -> "TrustScore":
        return cls(
            score=raw_score,
            level=_trust_level_from_score(raw_score),
            next_level_at=_next_level_at(raw_score),
        )


class TrustProfile(BaseModel):
    global_score: int
    last_updated: datetime | None = None
    capability_profile_hash: str

    @classmethod
    def from_raw(cls, raw: tuple[int, int, bytes | str]) -> "TrustProfile":
        global_score, last_updated, capability_profile_hash = raw
        return cls(
            global_score=global_score,
            last_updated=(datetime.fromtimestamp(last_updated) if last_updated else None),
            capability_profile_hash=_hex(capability_profile_hash),
        )


class CapabilitySlot(BaseModel):
    capability_hash: str
    score: int

    @classmethod
    def from_raw(cls, raw: tuple[bytes | str, int]) -> "CapabilitySlot":
        capability_hash, score = raw
        return cls(capability_hash=_hex(capability_hash), score=score)


class AttestationRecord(BaseModel):
    id: str
    wallet: str
    action: str
    reason: str
    recipient: str
    amount: int
    timestamp: datetime

    @classmethod
    def from_raw(cls, raw: tuple) -> "AttestationRecord":
        id_, wallet, action, reason, recipient, amount, timestamp = raw
        return cls(
            id=_hex(id_),
            wallet=wallet,
            action=action,
            reason=reason,
            recipient=recipient,
            amount=amount,
            timestamp=datetime.fromtimestamp(timestamp),
        )


class PolicyConfig(BaseModel):
    categories: dict[str, int] = Field(default_factory=dict)

    @classmethod
    def from_dict(cls, config: dict[str, str | int]) -> "PolicyConfig":
        from web3 import Web3

        parsed: dict[str, int] = {}
        for category, limit in config.items():
            if isinstance(limit, str) and "ether" in limit:
                amount_str = limit.replace("ether", "").strip()
                parsed[category] = Web3.to_wei(amount_str, "ether")
            elif isinstance(limit, str) and "gwei" in limit:
                amount_str = limit.replace("gwei", "").strip()
                parsed[category] = Web3.to_wei(amount_str, "gwei")
            else:
                parsed[category] = int(limit)
        return cls(categories=parsed)


class SettlementProposal(BaseModel):
    proposal_id: str
    from_wallet: str
    to_wallet: str
    amount: int
    intent_id: str
    expires_at: datetime
    status: int
    rejection_reason: str

    STATUS_NAMES: ClassVar[dict[int, str]] = {
        0: "pending",
        1: "accepted",
        2: "rejected",
        3: "executed",
        4: "expired",
    }

    @property
    def status_name(self) -> str:
        return self.STATUS_NAMES.get(self.status, "unknown")


class AgreementStatus(IntEnum):
    PROPOSED = 0
    ACCEPTED = 1
    PENDING_VERIFICATION = 2
    FULFILLED = 3
    DISPUTED = 4
    CANCELLED = 5
    REVISION_REQUESTED = 6
    REVISED = 7
    PARTIAL_SETTLEMENT = 8
    MUTUAL_CANCEL = 9
    ESCALATED_TO_HUMAN = 10
    ESCALATED_TO_ARBITRATION = 11


class ProviderResponseType(IntEnum):
    NONE = 0
    REVISE = 1
    DEFEND = 2
    COUNTER = 3
    PARTIAL_SETTLEMENT = 4
    REQUEST_HUMAN_REVIEW = 5
    ESCALATE = 6


class DisputeOutcome(IntEnum):
    NONE = 0
    PENDING = 1
    PROVIDER_WINS = 2
    CLIENT_REFUND = 3
    PARTIAL_PROVIDER = 4
    PARTIAL_CLIENT = 5
    MUTUAL_CANCEL = 6
    HUMAN_REVIEW_REQUIRED = 7


class EvidenceType(IntEnum):
    NONE = 0
    TRANSCRIPT = 1
    DELIVERABLE = 2
    ACCEPTANCE_CRITERIA = 3
    COMMUNICATION = 4
    EXTERNAL_REFERENCE = 5
    OTHER = 6


class DirectDisputeReason(IntEnum):
    NONE = 0
    NO_DELIVERY = 1
    HARD_DEADLINE_BREACH = 2
    INVALID_OR_FRAUDULENT_DELIVERABLE = 3
    SAFETY_CRITICAL_VIOLATION = 4


class Agreement(BaseModel):
    id: int
    client: str
    provider: str
    service_type: str
    description: str
    price: int
    token: str
    deadline: int
    deliverables_hash: str
    status: AgreementStatus
    created_at: int
    resolved_at: int
    verify_window_end: int = 0
    committed_hash: str = ""

    @classmethod
    def from_raw(cls, raw: tuple) -> "Agreement":
        return cls(
            id=raw[0],
            client=raw[1],
            provider=raw[2],
            service_type=raw[3],
            description=raw[4],
            price=raw[5],
            token=raw[6],
            deadline=raw[7],
            deliverables_hash=_hex(raw[8]),
            status=AgreementStatus(raw[9]),
            created_at=raw[10],
            resolved_at=raw[11],
            verify_window_end=raw[12] if len(raw) > 12 else 0,
            committed_hash=_hex(raw[13]) if len(raw) > 13 else "",
        )


class RemediationCase(BaseModel):
    cycle_count: int
    opened_at: int
    deadline_at: int
    last_action_at: int
    latest_transcript_hash: str
    active: bool

    @classmethod
    def from_raw(cls, raw: tuple) -> "RemediationCase":
        return cls(
            cycle_count=raw[0],
            opened_at=raw[1],
            deadline_at=raw[2],
            last_action_at=raw[3],
            latest_transcript_hash=_hex(raw[4]),
            active=raw[5],
        )


class RemediationFeedback(BaseModel):
    cycle: int
    author: str
    feedback_hash: str
    feedback_uri: str
    previous_transcript_hash: str
    transcript_hash: str
    timestamp: int

    @classmethod
    def from_raw(cls, raw: tuple) -> "RemediationFeedback":
        return cls(
            cycle=raw[0],
            author=raw[1],
            feedback_hash=_hex(raw[2]),
            feedback_uri=raw[3],
            previous_transcript_hash=_hex(raw[4]),
            transcript_hash=_hex(raw[5]),
            timestamp=raw[6],
        )


class RemediationResponse(BaseModel):
    cycle: int
    author: str
    response_type: ProviderResponseType
    proposed_provider_payout: int
    response_hash: str
    response_uri: str
    previous_transcript_hash: str
    transcript_hash: str
    timestamp: int

    @classmethod
    def from_raw(cls, raw: tuple) -> "RemediationResponse":
        return cls(
            cycle=raw[0],
            author=raw[1],
            response_type=ProviderResponseType(raw[2]),
            proposed_provider_payout=raw[3],
            response_hash=_hex(raw[4]),
            response_uri=raw[5],
            previous_transcript_hash=_hex(raw[6]),
            transcript_hash=_hex(raw[7]),
            timestamp=raw[8],
        )


class DisputeEvidence(BaseModel):
    submitter: str
    evidence_type: EvidenceType
    evidence_hash: str
    evidence_uri: str
    timestamp: int

    @classmethod
    def from_raw(cls, raw: tuple) -> "DisputeEvidence":
        return cls(
            submitter=raw[0],
            evidence_type=EvidenceType(raw[1]),
            evidence_hash=_hex(raw[2]),
            evidence_uri=raw[3],
            timestamp=raw[4],
        )


class DisputeCase(BaseModel):
    agreement_id: int
    opened_at: int
    response_deadline_at: int
    outcome: DisputeOutcome
    provider_award: int
    client_award: int
    human_review_requested: bool
    evidence_count: int

    @classmethod
    def from_raw(cls, raw: tuple) -> "DisputeCase":
        return cls(
            agreement_id=raw[0],
            opened_at=raw[1],
            response_deadline_at=raw[2],
            outcome=DisputeOutcome(raw[3]),
            provider_award=raw[4],
            client_award=raw[5],
            human_review_requested=raw[6],
            evidence_count=raw[7],
        )


class ArbitrationVote(IntEnum):
    NONE = 0
    PROVIDER_WINS = 1
    CLIENT_REFUND = 2
    SPLIT = 3
    HUMAN_REVIEW_REQUIRED = 4


class ArbitrationCase(BaseModel):
    agreement_id: int
    arbitrators: list[str]
    arbitrator_count: int
    provider_votes: int
    client_votes: int
    split_votes: int
    human_votes: int
    selection_deadline_at: int
    decision_deadline_at: int
    split_provider_award: int
    split_client_award: int
    finalized: bool
    human_backstop_used: bool

    @classmethod
    def from_raw(cls, raw: tuple) -> "ArbitrationCase":
        return cls(
            agreement_id=raw[0],
            arbitrators=list(raw[1]),
            arbitrator_count=raw[2],
            provider_votes=raw[3],
            client_votes=raw[4],
            split_votes=raw[5],
            human_votes=raw[6],
            selection_deadline_at=raw[7],
            decision_deadline_at=raw[8],
            split_provider_award=raw[9],
            split_client_award=raw[10],
            finalized=raw[11],
            human_backstop_used=raw[12],
        )


class SignalType(IntEnum):
    ENDORSE = 0
    WARN = 1
    BLOCK = 2


class ReputationSignal(BaseModel):
    publisher: str
    subject: str
    signal_type: SignalType
    capability_hash: str
    reason: str
    publisher_trust_at_time: int
    timestamp: int
    auto_published: bool

    @classmethod
    def from_raw(cls, raw: tuple) -> "ReputationSignal":
        return cls(
            publisher=raw[0],
            subject=raw[1],
            signal_type=SignalType(raw[2]),
            capability_hash=_hex(raw[3]),
            reason=raw[4],
            publisher_trust_at_time=raw[5],
            timestamp=raw[6],
            auto_published=raw[7],
        )


class ReputationSummary(BaseModel):
    endorsements: int
    warnings: int
    blocks: int
    weighted_score: int

    @classmethod
    def from_raw(cls, raw: tuple) -> "ReputationSummary":
        return cls(
            endorsements=raw[0],
            warnings=raw[1],
            blocks=raw[2],
            weighted_score=raw[3],
        )


class IdentityTier(IntEnum):
    NONE = 0
    SPONSORED = 1
    VERIFIED_PROVIDER = 2
    ENTERPRISE_PROVIDER = 3


class SponsorshipAttestationRecord(BaseModel):
    sponsor: str
    agent: str
    issued_at: int
    expires_at: int
    revoked: bool
    tier: IdentityTier
    evidence_uri: str

    @classmethod
    def from_raw(cls, raw: tuple) -> "SponsorshipAttestationRecord":
        return cls(
            sponsor=raw[0],
            agent=raw[1],
            issued_at=raw[2],
            expires_at=raw[3],
            revoked=raw[4],
            tier=IdentityTier(raw[5]),
            evidence_uri=raw[6],
        )


class RootConfig(BaseModel):
    name: str
    active: bool
    created_at: int
    disabled_at: int

    @classmethod
    def from_raw(cls, raw: tuple) -> "RootConfig":
        return cls(name=raw[0], active=raw[1], created_at=raw[2], disabled_at=raw[3])


class GovernanceTransaction(BaseModel):
    target: str
    value: int
    data: str
    executed: bool
    confirmation_count: int

    @classmethod
    def from_raw(cls, raw: tuple) -> "GovernanceTransaction":
        return cls(
            target=raw[0],
            value=raw[1],
            data=_hex(raw[2]),
            executed=raw[3],
            confirmation_count=raw[4],
        )


class OperationalMetrics(BaseModel):
    heartbeat_interval: int
    heartbeat_grace_period: int
    last_heartbeat_at: int
    rolling_latency: int
    heartbeat_count: int
    missed_heartbeat_count: int
    uptime_score: int
    response_score: int

    @classmethod
    def from_raw(cls, raw: tuple) -> "OperationalMetrics":
        return cls(
            heartbeat_interval=raw[0],
            heartbeat_grace_period=raw[1],
            last_heartbeat_at=raw[2],
            rolling_latency=raw[3],
            heartbeat_count=raw[4],
            missed_heartbeat_count=raw[5],
            uptime_score=raw[6],
            response_score=raw[7],
        )


# ─── DisputeArbitration types ────────────────────────────────────────────────

class DisputeMode(IntEnum):
    UNILATERAL = 0  # opener pays full fee; win = 50% refund, lose = consumed
    MUTUAL = 1      # each party pays 50%; no winner reimbursement


class DisputeClass(IntEnum):
    HARD_FAILURE = 0      # 1.0x fee multiplier
    AMBIGUITY_QUALITY = 1 # 1.25x fee multiplier
    HIGH_SENSITIVITY = 2  # 1.5x fee multiplier


class DisputeFeeState(BaseModel):
    mode: DisputeMode
    dispute_class: DisputeClass
    opener: str
    client: str
    provider: str
    token: str
    agreement_price: int
    fee_required: int
    opener_paid: int
    respondent_paid: int
    opened_at: int
    active: bool
    resolved: bool

    @classmethod
    def from_raw(cls, raw: tuple) -> "DisputeFeeState":
        return cls(
            mode=DisputeMode(raw[0]),
            dispute_class=DisputeClass(raw[1]),
            opener=raw[2],
            client=raw[3],
            provider=raw[4],
            token=raw[5],
            agreement_price=raw[6],
            fee_required=raw[7],
            opener_paid=raw[8],
            respondent_paid=raw[9],
            opened_at=raw[10],
            active=raw[11],
            resolved=raw[12],
        )


class ArbitratorBondState(BaseModel):
    bond_amount: int
    locked_at: int
    locked: bool
    slashed: bool
    returned: bool

    @classmethod
    def from_raw(cls, raw: tuple) -> "ArbitratorBondState":
        return cls(
            bond_amount=raw[0],
            locked_at=raw[1],
            locked=raw[2],
            slashed=raw[3],
            returned=raw[4],
        )
