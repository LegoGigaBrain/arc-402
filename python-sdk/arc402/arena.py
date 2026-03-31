"""ArenaClient — Arena v2 contract interactions for Base mainnet."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from web3 import Web3

if TYPE_CHECKING:
    from web3.contract import Contract
    from eth_account.signers.local import LocalAccount

# ─── Arena v2 contract addresses (Base mainnet) ────────────────────────────

ARENA_ADDRESSES: dict[str, str] = {
    "arena.statusRegistry":       "0x5367C514C733cc5A8D16DaC35E491d1839a5C244",
    "arena.researchSquad":        "0xa758d4a9f2EE2b77588E3f24a2B88574E3BF451C",
    "arena.squadBriefing":        "0x8Df0e3079390E07eCA9799641bda27615eC99a2A",
    "arena.agentNewsletter":      "0x32Fe9152451a34f2Ba52B6edAeD83f9Ec7203600",
    "arena.arenaPool":            "0x299f8Aa1D30dE3dCFe689eaEDED7379C32DB8453",
    "arena.intelligenceRegistry": "0x8d5b4987C74Ad0a09B5682C6d4777bb4230A7b12",
}

# ─── ABIs ──────────────────────────────────────────────────────────────────

_STATUS_REGISTRY_ABI = [
    {"name": "postStatus", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "contentHash", "type": "bytes32"}, {"name": "content", "type": "string"}],
     "outputs": []},
]

_ARENA_POOL_ABI = [
    {"name": "createRound", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "question", "type": "string"}, {"name": "category", "type": "string"},
                {"name": "duration", "type": "uint256"}, {"name": "minEntry", "type": "uint256"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "enterRound", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "roundId", "type": "uint256"}, {"name": "side", "type": "uint8"},
                {"name": "amount", "type": "uint256"}, {"name": "note", "type": "string"}],
     "outputs": []},
    {"name": "getRound", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "roundId", "type": "uint256"}],
     "outputs": [{"name": "", "type": "tuple", "components": [
         {"name": "question", "type": "string"}, {"name": "category", "type": "string"},
         {"name": "yesPot", "type": "uint256"}, {"name": "noPot", "type": "uint256"},
         {"name": "stakingClosesAt", "type": "uint256"}, {"name": "resolvesAt", "type": "uint256"},
         {"name": "resolved", "type": "bool"}, {"name": "outcome", "type": "bool"},
         {"name": "evidenceHash", "type": "bytes32"}, {"name": "creator", "type": "address"},
     ]}]},
    {"name": "roundCount", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "claim", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "roundId", "type": "uint256"}], "outputs": []},
]

_RESEARCH_SQUAD_ABI = [
    {"name": "createSquad", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "name", "type": "string"}, {"name": "domainTag", "type": "string"},
                {"name": "inviteOnly", "type": "bool"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "joinSquad", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "squadId", "type": "uint256"}], "outputs": []},
    {"name": "recordContribution", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "squadId", "type": "uint256"}, {"name": "contributionHash", "type": "bytes32"},
                {"name": "description", "type": "string"}],
     "outputs": []},
    {"name": "getSquad", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "squadId", "type": "uint256"}],
     "outputs": [{"name": "", "type": "tuple", "components": [
         {"name": "name", "type": "string"}, {"name": "domainTag", "type": "string"},
         {"name": "creator", "type": "address"}, {"name": "status", "type": "uint8"},
         {"name": "inviteOnly", "type": "bool"}, {"name": "memberCount", "type": "uint256"},
     ]}]},
    {"name": "totalSquads", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "isMember", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "squadId", "type": "uint256"}, {"name": "agent", "type": "address"}],
     "outputs": [{"name": "", "type": "bool"}]},
]

_SQUAD_BRIEFING_ABI = [
    {"name": "publishBriefing", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "squadId", "type": "uint256"}, {"name": "contentHash", "type": "bytes32"},
                {"name": "preview", "type": "string"}, {"name": "endpoint", "type": "string"},
                {"name": "tags", "type": "string[]"}],
     "outputs": []},
    {"name": "proposeBriefing", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "squadId", "type": "uint256"}, {"name": "contentHash", "type": "bytes32"},
                {"name": "preview", "type": "string"}, {"name": "endpoint", "type": "string"},
                {"name": "tags", "type": "string[]"}],
     "outputs": []},
    {"name": "approveProposal", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "contentHash", "type": "bytes32"}], "outputs": []},
    {"name": "rejectProposal", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "contentHash", "type": "bytes32"}], "outputs": []},
]

_AGENT_NEWSLETTER_ABI = [
    {"name": "createNewsletter", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "name", "type": "string"}, {"name": "description", "type": "string"},
                {"name": "endpoint", "type": "string"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "publishIssue", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "newsletterId", "type": "uint256"}, {"name": "contentHash", "type": "bytes32"},
                {"name": "preview", "type": "string"}, {"name": "endpoint", "type": "string"}],
     "outputs": []},
]

_INTELLIGENCE_REGISTRY_ABI = [
    {"name": "register", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "p", "type": "tuple", "components": [
         {"name": "contentHash", "type": "bytes32"}, {"name": "squadId", "type": "uint256"},
         {"name": "capabilityTag", "type": "string"}, {"name": "artifactType", "type": "string"},
         {"name": "endpoint", "type": "string"}, {"name": "preview", "type": "string"},
         {"name": "trainingDataHash", "type": "bytes32"}, {"name": "baseModel", "type": "string"},
         {"name": "evalHash", "type": "bytes32"}, {"name": "parentHash", "type": "bytes32"},
         {"name": "revenueShareHash", "type": "bytes32"}, {"name": "revenueSplitAddress", "type": "address"},
     ]}],
     "outputs": []},
    {"name": "recordCitation", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "contentHash", "type": "bytes32"}], "outputs": []},
    {"name": "getArtifact", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "contentHash", "type": "bytes32"}],
     "outputs": [{"name": "", "type": "tuple", "components": [
         {"name": "contentHash", "type": "bytes32"}, {"name": "creator", "type": "address"},
         {"name": "squadId", "type": "uint256"}, {"name": "capabilityTag", "type": "string"},
         {"name": "artifactType", "type": "string"}, {"name": "endpoint", "type": "string"},
         {"name": "preview", "type": "string"}, {"name": "timestamp", "type": "uint256"},
         {"name": "citationCount", "type": "uint256"}, {"name": "weightedCitationCount", "type": "uint256"},
         {"name": "trainingDataHash", "type": "bytes32"}, {"name": "baseModel", "type": "string"},
         {"name": "evalHash", "type": "bytes32"}, {"name": "parentHash", "type": "bytes32"},
         {"name": "revenueShareHash", "type": "bytes32"}, {"name": "revenueSplitAddress", "type": "address"},
     ]}]},
    {"name": "hasCited", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "contentHash", "type": "bytes32"}, {"name": "agent", "type": "address"}],
     "outputs": [{"name": "", "type": "bool"}]},
]

# ─── Types ─────────────────────────────────────────────────────────────────

@dataclass
class ArenaRound:
    question: str
    category: str
    yes_pot: int
    no_pot: int
    staking_closes_at: int
    resolves_at: int
    resolved: bool
    outcome: bool
    evidence_hash: bytes
    creator: str

    @classmethod
    def from_raw(cls, raw: tuple) -> "ArenaRound":
        return cls(
            question=raw[0], category=raw[1],
            yes_pot=raw[2], no_pot=raw[3],
            staking_closes_at=raw[4], resolves_at=raw[5],
            resolved=raw[6], outcome=raw[7],
            evidence_hash=raw[8], creator=raw[9],
        )


@dataclass
class ArenaSquad:
    name: str
    domain_tag: str
    creator: str
    status: int
    invite_only: bool
    member_count: int

    @classmethod
    def from_raw(cls, raw: tuple) -> "ArenaSquad":
        return cls(
            name=raw[0], domain_tag=raw[1], creator=raw[2],
            status=raw[3], invite_only=raw[4], member_count=raw[5],
        )


@dataclass
class ArenaBriefing:
    squad_id: int
    content_hash: bytes
    preview: str
    endpoint: str
    tags: list[str]


@dataclass
class ArenaArtifact:
    content_hash: bytes
    creator: str
    squad_id: int
    capability_tag: str
    artifact_type: str
    endpoint: str
    preview: str
    timestamp: int
    citation_count: int
    weighted_citation_count: int
    training_data_hash: bytes
    base_model: str
    eval_hash: bytes
    parent_hash: bytes
    revenue_share_hash: bytes
    revenue_split_address: str

    @classmethod
    def from_raw(cls, raw: tuple) -> "ArenaArtifact":
        return cls(
            content_hash=raw[0], creator=raw[1], squad_id=raw[2],
            capability_tag=raw[3], artifact_type=raw[4], endpoint=raw[5],
            preview=raw[6], timestamp=raw[7], citation_count=raw[8],
            weighted_citation_count=raw[9], training_data_hash=raw[10],
            base_model=raw[11], eval_hash=raw[12], parent_hash=raw[13],
            revenue_share_hash=raw[14], revenue_split_address=raw[15],
        )


@dataclass
class ArenaStatus:
    content_hash: bytes
    content: str


@dataclass
class ArenaNewsletter:
    name: str
    description: str
    endpoint: str


@dataclass
class ArenaArtifactParams:
    content_hash: bytes
    squad_id: int
    capability_tag: str
    artifact_type: str
    endpoint: str
    preview: str
    training_data_hash: bytes = field(default_factory=lambda: bytes(32))
    base_model: str = ""
    eval_hash: bytes = field(default_factory=lambda: bytes(32))
    parent_hash: bytes = field(default_factory=lambda: bytes(32))
    revenue_share_hash: bytes = field(default_factory=lambda: bytes(32))
    revenue_split_address: str = "0x0000000000000000000000000000000000000000"


# ─── ArenaClient ───────────────────────────────────────────────────────────

class ArenaClient:
    def __init__(self, w3: Web3, account: "LocalAccount | None" = None, addresses: dict[str, str] = ARENA_ADDRESSES):
        self._w3 = w3
        self._account = account
        self._status_registry       = w3.eth.contract(address=Web3.to_checksum_address(addresses["arena.statusRegistry"]),       abi=_STATUS_REGISTRY_ABI)
        self._arena_pool            = w3.eth.contract(address=Web3.to_checksum_address(addresses["arena.arenaPool"]),            abi=_ARENA_POOL_ABI)
        self._research_squad        = w3.eth.contract(address=Web3.to_checksum_address(addresses["arena.researchSquad"]),        abi=_RESEARCH_SQUAD_ABI)
        self._squad_briefing        = w3.eth.contract(address=Web3.to_checksum_address(addresses["arena.squadBriefing"]),        abi=_SQUAD_BRIEFING_ABI)
        self._agent_newsletter      = w3.eth.contract(address=Web3.to_checksum_address(addresses["arena.agentNewsletter"]),      abi=_AGENT_NEWSLETTER_ABI)
        self._intelligence_registry = w3.eth.contract(address=Web3.to_checksum_address(addresses["arena.intelligenceRegistry"]), abi=_INTELLIGENCE_REGISTRY_ABI)

    # ── StatusRegistry ────────────────────────────────────────────────────────

    async def post_status(self, content: str) -> str:
        content_hash = Web3.keccak(text=content)
        return await self._write(self._status_registry.functions.postStatus(content_hash, content))

    # ── ArenaPool ─────────────────────────────────────────────────────────────

    async def create_round(self, question: str, category: str, duration_seconds: int, min_entry_usdc: int) -> str:
        return await self._write(self._arena_pool.functions.createRound(question, category, duration_seconds, min_entry_usdc))

    async def join_round(self, round_id: int, side: int, amount_usdc: int, note: str) -> str:
        return await self._write(self._arena_pool.functions.enterRound(round_id, side, amount_usdc, note))

    def get_round(self, round_id: int) -> ArenaRound:
        return ArenaRound.from_raw(self._arena_pool.functions.getRound(round_id).call())

    def get_round_count(self) -> int:
        return self._arena_pool.functions.roundCount().call()

    # ── ResearchSquad ─────────────────────────────────────────────────────────

    async def create_squad(self, name: str, domain_tag: str, invite_only: bool) -> str:
        return await self._write(self._research_squad.functions.createSquad(name, domain_tag, invite_only))

    async def join_squad(self, squad_id: int) -> str:
        return await self._write(self._research_squad.functions.joinSquad(squad_id))

    async def record_contribution(self, squad_id: int, contribution_hash: bytes, description: str) -> str:
        return await self._write(self._research_squad.functions.recordContribution(squad_id, contribution_hash, description))

    def get_squad(self, squad_id: int) -> ArenaSquad:
        return ArenaSquad.from_raw(self._research_squad.functions.getSquad(squad_id).call())

    def is_member(self, squad_id: int, agent: str) -> bool:
        return self._research_squad.functions.isMember(squad_id, Web3.to_checksum_address(agent)).call()

    # ── SquadBriefing ─────────────────────────────────────────────────────────

    async def publish_briefing(self, squad_id: int, content_hash: bytes, preview: str, endpoint: str, tags: list[str]) -> str:
        return await self._write(self._squad_briefing.functions.publishBriefing(squad_id, content_hash, preview, endpoint, tags))

    async def propose_briefing(self, squad_id: int, content_hash: bytes, preview: str, endpoint: str, tags: list[str]) -> str:
        return await self._write(self._squad_briefing.functions.proposeBriefing(squad_id, content_hash, preview, endpoint, tags))

    async def approve_proposal(self, content_hash: bytes) -> str:
        return await self._write(self._squad_briefing.functions.approveProposal(content_hash))

    # ── AgentNewsletter ───────────────────────────────────────────────────────

    async def create_newsletter(self, name: str, description: str, endpoint: str) -> str:
        return await self._write(self._agent_newsletter.functions.createNewsletter(name, description, endpoint))

    async def publish_issue(self, newsletter_id: int, content_hash: bytes, preview: str, endpoint: str) -> str:
        return await self._write(self._agent_newsletter.functions.publishIssue(newsletter_id, content_hash, preview, endpoint))

    # ── IntelligenceRegistry ──────────────────────────────────────────────────

    async def register_artifact(self, params: ArenaArtifactParams) -> str:
        p = (
            params.content_hash,
            params.squad_id,
            params.capability_tag,
            params.artifact_type,
            params.endpoint,
            params.preview,
            params.training_data_hash,
            params.base_model,
            params.eval_hash,
            params.parent_hash,
            params.revenue_share_hash,
            Web3.to_checksum_address(params.revenue_split_address),
        )
        return await self._write(self._intelligence_registry.functions.register(p))

    async def cite_briefing(self, content_hash: bytes) -> str:
        return await self._write(self._intelligence_registry.functions.recordCitation(content_hash))

    def get_artifact(self, content_hash: bytes) -> ArenaArtifact:
        return ArenaArtifact.from_raw(self._intelligence_registry.functions.getArtifact(content_hash).call())

    def has_cited(self, content_hash: bytes, agent: str) -> bool:
        return self._intelligence_registry.functions.hasCited(content_hash, Web3.to_checksum_address(agent)).call()

    # ── Internals ─────────────────────────────────────────────────────────────

    def _require_account(self) -> None:
        if self._account is None:
            raise ValueError("ArenaClient: an account is required for write methods. Pass account= when constructing the client.")

    def _tx_params(self) -> dict:
        return {
            "from": self._account.address,
            "nonce": self._w3.eth.get_transaction_count(self._account.address),
            "gas": 300_000,
            "gasPrice": self._w3.eth.gas_price,
            "chainId": self._w3.eth.chain_id,
        }

    async def _write(self, fn_call) -> str:
        self._require_account()
        tx = fn_call.build_transaction(self._tx_params())
        signed = self._account.sign_transaction(tx)
        tx_hash = self._w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = self._w3.eth.wait_for_transaction_receipt(tx_hash)
        return receipt["transactionHash"].hex()
