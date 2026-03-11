"""AgentRegistryClient — interacts with the on-chain AgentRegistry contract."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from web3 import Web3

from .abis import AgentRegistry_ABI

if TYPE_CHECKING:
    from web3.contract import Contract
    from eth_account.signers.local import LocalAccount

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


@dataclass
class AgentInfo:
    wallet: str
    name: str
    capabilities: list[str]
    service_type: str
    endpoint: str
    metadata_uri: str
    active: bool
    registered_at: int
    trust_score: int = 0

    @classmethod
    def from_raw(cls, raw: tuple, trust_score: int = 0) -> "AgentInfo":
        """Build from the tuple returned by getAgent()."""
        wallet, name, capabilities, service_type, endpoint, metadata_uri, active, registered_at = raw
        return cls(
            wallet=wallet,
            name=name,
            capabilities=list(capabilities),
            service_type=service_type,
            endpoint=endpoint,
            metadata_uri=metadata_uri,
            active=active,
            registered_at=registered_at,
            trust_score=trust_score,
        )


class AgentRegistryClient:
    """Python wrapper for the ARC-402 AgentRegistry contract.

    ``account`` is optional — required only for write methods
    (register, update, deactivate, reactivate).
    """

    def __init__(self, address: str, w3: Web3, account: "LocalAccount | None" = None):
        self._w3 = w3
        self._account = account
        self._contract: "Contract" = w3.eth.contract(
            address=Web3.to_checksum_address(address),
            abi=AgentRegistry_ABI,
        )

    # ─── Write methods ────────────────────────────────────────────────────────

    async def register(
        self,
        name: str,
        capabilities: list[str],
        service_type: str,
        endpoint: str,
        metadata_uri: str,
    ) -> str:
        """Register the caller as an agent. Returns tx hash."""
        self._require_account()
        tx = self._contract.functions.register(
            name, capabilities, service_type, endpoint, metadata_uri
        ).build_transaction(self._tx_params())
        receipt = await self._send(tx)
        return receipt["transactionHash"].hex()

    async def update(
        self,
        name: str,
        capabilities: list[str],
        service_type: str,
        endpoint: str,
        metadata_uri: str,
    ) -> str:
        """Update the caller's registration. Returns tx hash."""
        self._require_account()
        tx = self._contract.functions.update(
            name, capabilities, service_type, endpoint, metadata_uri
        ).build_transaction(self._tx_params())
        receipt = await self._send(tx)
        return receipt["transactionHash"].hex()

    async def deactivate(self) -> str:
        """Deactivate the caller's registration. Returns tx hash."""
        self._require_account()
        tx = self._contract.functions.deactivate().build_transaction(self._tx_params())
        receipt = await self._send(tx)
        return receipt["transactionHash"].hex()

    async def reactivate(self) -> str:
        """Reactivate the caller's registration. Returns tx hash."""
        self._require_account()
        tx = self._contract.functions.reactivate().build_transaction(self._tx_params())
        receipt = await self._send(tx)
        return receipt["transactionHash"].hex()

    # ─── Read methods ─────────────────────────────────────────────────────────

    def get_agent(self, wallet: str) -> AgentInfo:
        """Return full AgentInfo for a wallet (includes trust score). Raises if not registered."""
        cs = Web3.to_checksum_address(wallet)
        raw = self._contract.functions.getAgent(cs).call()
        trust_score = self.get_trust_score(wallet)
        return AgentInfo.from_raw(raw, trust_score=trust_score)

    def is_registered(self, wallet: str) -> bool:
        return self._contract.functions.isRegistered(
            Web3.to_checksum_address(wallet)
        ).call()

    def is_active(self, wallet: str) -> bool:
        return self._contract.functions.isActive(
            Web3.to_checksum_address(wallet)
        ).call()

    def get_capabilities(self, wallet: str) -> list[str]:
        return list(
            self._contract.functions.getCapabilities(
                Web3.to_checksum_address(wallet)
            ).call()
        )

    def get_trust_score(self, wallet: str) -> int:
        return self._contract.functions.getTrustScore(
            Web3.to_checksum_address(wallet)
        ).call()

    def agent_count(self) -> int:
        return self._contract.functions.agentCount().call()

    def get_agent_at_index(self, index: int) -> AgentInfo:
        """Return the AgentInfo for the agent at *index* in the registry list."""
        wallet_addr = self._contract.functions.getAgentAtIndex(index).call()
        return self.get_agent(wallet_addr)

    # ─── Utility ──────────────────────────────────────────────────────────────

    def list_agents(self, limit: int = 100) -> list[AgentInfo]:
        """Return up to *limit* agents from the registry (all, including inactive)."""
        count = min(self.agent_count(), limit)
        agents = []
        for i in range(count):
            try:
                agents.append(self.get_agent_at_index(i))
            except Exception:
                pass  # skip agents that errored (e.g. deregistered edge cases)
        return agents

    def find_by_capability(self, capability: str, limit: int = 10) -> list[AgentInfo]:
        """Return up to *limit* active agents that list *capability*."""
        results: list[AgentInfo] = []
        count = self.agent_count()
        for i in range(count):
            if len(results) >= limit:
                break
            try:
                agent = self.get_agent_at_index(i)
            except Exception:
                continue
            if agent.active and capability in agent.capabilities:
                results.append(agent)
        return results

    # ─── Internals ────────────────────────────────────────────────────────────

    def _require_account(self) -> None:
        if self._account is None:
            raise ValueError(
                "AgentRegistryClient: an account is required for write methods. "
                "Pass account= when constructing the client."
            )

    def _tx_params(self) -> dict:
        return {
            "from": self._account.address,
            "nonce": self._w3.eth.get_transaction_count(self._account.address),
            "gas": 300_000,
            "gasPrice": self._w3.eth.gas_price,
            "chainId": self._w3.eth.chain_id,
        }

    async def _send(self, tx: dict) -> dict:
        signed = self._account.sign_transaction(tx)
        tx_hash = self._w3.eth.send_raw_transaction(signed.raw_transaction)
        return self._w3.eth.wait_for_transaction_receipt(tx_hash)
