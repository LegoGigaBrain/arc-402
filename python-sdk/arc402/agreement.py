"""ServiceAgreementClient — interacts with the on-chain ServiceAgreement contract."""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
from typing import TYPE_CHECKING

from web3 import Web3

from .abis import ServiceAgreement_ABI

if TYPE_CHECKING:
    from web3.contract import Contract
    from eth_account.signers.local import LocalAccount

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


class AgreementStatus(IntEnum):
    PROPOSED = 0
    ACCEPTED = 1
    FULFILLED = 2
    DISPUTED = 3
    CANCELLED = 4


@dataclass
class Agreement:
    id: int
    client: str
    provider: str
    service_type: str
    description: str
    price: int
    token: str          # zero address = ETH
    deadline: int
    deliverables_hash: str
    status: AgreementStatus
    created_at: int
    resolved_at: int

    @classmethod
    def from_raw(cls, raw: tuple) -> "Agreement":
        """Build from the tuple returned by getAgreement()."""
        (
            id_,
            client,
            provider,
            service_type,
            description,
            price,
            token,
            deadline,
            deliverables_hash,
            status,
            created_at,
            resolved_at,
        ) = raw
        return cls(
            id=id_,
            client=client,
            provider=provider,
            service_type=service_type,
            description=description,
            price=price,
            token=token,
            deadline=deadline,
            deliverables_hash=(
                deliverables_hash.hex()
                if isinstance(deliverables_hash, bytes)
                else deliverables_hash
            ),
            status=AgreementStatus(status),
            created_at=created_at,
            resolved_at=resolved_at,
        )


class ServiceAgreementClient:
    """Python wrapper for the ARC-402 ServiceAgreement contract.

    ``account`` is optional — required only for write methods.
    """

    def __init__(self, address: str, w3: Web3, account: "LocalAccount | None" = None):
        self._w3 = w3
        self._account = account
        self._contract: "Contract" = w3.eth.contract(
            address=Web3.to_checksum_address(address),
            abi=ServiceAgreement_ABI,
        )

    # ─── Write methods ────────────────────────────────────────────────────────

    async def propose(
        self,
        provider: str,
        service_type: str,
        description: str,
        price: int,
        token: str,
        deadline: int,
        deliverables_hash: str,
    ) -> tuple[int, str]:
        """Propose a new service agreement.

        For ETH agreements pass ``token`` as the zero address and ensure
        ``price`` matches the wei value sent.

        Returns ``(agreement_id, tx_hash)``.
        """
        self._require_account()

        # Convert hex deliverables_hash string → bytes32
        dh_bytes = (
            bytes.fromhex(deliverables_hash.removeprefix("0x"))
            if isinstance(deliverables_hash, str)
            else deliverables_hash
        )
        dh_bytes = dh_bytes.ljust(32, b"\x00")[:32]

        is_eth = token == ZERO_ADDRESS or token is None
        tx_params = self._tx_params()
        if is_eth:
            tx_params["value"] = price

        tx = self._contract.functions.propose(
            Web3.to_checksum_address(provider),
            service_type,
            description,
            price,
            Web3.to_checksum_address(token) if token else ZERO_ADDRESS,
            deadline,
            dh_bytes,
        ).build_transaction(tx_params)

        receipt = await self._send(tx)
        tx_hash = receipt["transactionHash"].hex()

        # Extract agreement ID from AgreementProposed event
        agreement_id = self._extract_agreement_id(receipt)
        return agreement_id, tx_hash

    async def accept(self, agreement_id: int) -> str:
        """Provider accepts a proposed agreement. Returns tx hash."""
        self._require_account()
        tx = self._contract.functions.accept(agreement_id).build_transaction(
            self._tx_params()
        )
        receipt = await self._send(tx)
        return receipt["transactionHash"].hex()

    async def fulfill(self, agreement_id: int, actual_deliverables_hash: str) -> str:
        """Provider fulfills an accepted agreement. Returns tx hash."""
        self._require_account()
        dh_bytes = (
            bytes.fromhex(actual_deliverables_hash.removeprefix("0x"))
            if isinstance(actual_deliverables_hash, str)
            else actual_deliverables_hash
        )
        dh_bytes = dh_bytes.ljust(32, b"\x00")[:32]

        tx = self._contract.functions.fulfill(agreement_id, dh_bytes).build_transaction(
            self._tx_params()
        )
        receipt = await self._send(tx)
        return receipt["transactionHash"].hex()

    async def dispute(self, agreement_id: int, reason: str) -> str:
        """Raise a dispute on an accepted agreement. Returns tx hash."""
        self._require_account()
        tx = self._contract.functions.dispute(agreement_id, reason).build_transaction(
            self._tx_params()
        )
        receipt = await self._send(tx)
        return receipt["transactionHash"].hex()

    async def cancel(self, agreement_id: int) -> str:
        """Client cancels a proposed agreement and retrieves escrow. Returns tx hash."""
        self._require_account()
        tx = self._contract.functions.cancel(agreement_id).build_transaction(
            self._tx_params()
        )
        receipt = await self._send(tx)
        return receipt["transactionHash"].hex()

    async def expired_cancel(self, agreement_id: int) -> str:
        """Client cancels an accepted agreement that has passed its deadline. Returns tx hash."""
        self._require_account()
        tx = self._contract.functions.expiredCancel(agreement_id).build_transaction(
            self._tx_params()
        )
        receipt = await self._send(tx)
        return receipt["transactionHash"].hex()

    # ─── Read methods ─────────────────────────────────────────────────────────

    def get_agreement(self, id: int) -> Agreement:
        """Return a full Agreement. Raises if not found."""
        raw = self._contract.functions.getAgreement(id).call()
        return Agreement.from_raw(raw)

    def get_agreements_by_client(self, client: str) -> list[int]:
        return list(
            self._contract.functions.getAgreementsByClient(
                Web3.to_checksum_address(client)
            ).call()
        )

    def get_agreements_by_provider(self, provider: str) -> list[int]:
        return list(
            self._contract.functions.getAgreementsByProvider(
                Web3.to_checksum_address(provider)
            ).call()
        )

    def agreement_count(self) -> int:
        return self._contract.functions.agreementCount().call()

    # ─── Utility ──────────────────────────────────────────────────────────────

    def get_client_agreements(self, client: str) -> list[Agreement]:
        """Return full Agreement objects for all agreements where *client* is the payer."""
        ids = self.get_agreements_by_client(client)
        agreements = []
        for aid in ids:
            try:
                agreements.append(self.get_agreement(aid))
            except Exception:
                pass
        return agreements

    def get_provider_agreements(self, provider: str) -> list[Agreement]:
        """Return full Agreement objects for all agreements where *provider* is the deliverer."""
        ids = self.get_agreements_by_provider(provider)
        agreements = []
        for aid in ids:
            try:
                agreements.append(self.get_agreement(aid))
            except Exception:
                pass
        return agreements

    # ─── Internals ────────────────────────────────────────────────────────────

    def _extract_agreement_id(self, receipt: dict) -> int:
        """Parse the AgreementProposed event to get the new agreement ID."""
        try:
            events = self._contract.events.AgreementProposed().process_receipt(receipt)
            if events:
                return int(events[0]["args"]["id"])
        except Exception:
            pass

        # Fallback: first indexed topic of the first log is the agreement ID
        for log in receipt.get("logs", []):
            topics = log.get("topics", [])
            if len(topics) >= 2:
                return int.from_bytes(topics[1], "big")
        raise ValueError("ServiceAgreementClient: could not extract agreement ID from receipt")

    def _require_account(self) -> None:
        if self._account is None:
            raise ValueError(
                "ServiceAgreementClient: an account is required for write methods. "
                "Pass account= when constructing the client."
            )

    def _tx_params(self) -> dict:
        return {
            "from": self._account.address,
            "nonce": self._w3.eth.get_transaction_count(self._account.address),
            "gas": 400_000,
            "gasPrice": self._w3.eth.gas_price,
            "chainId": self._w3.eth.chain_id,
        }

    async def _send(self, tx: dict) -> dict:
        signed = self._account.sign_transaction(tx)
        tx_hash = self._w3.eth.send_raw_transaction(signed.raw_transaction)
        return self._w3.eth.wait_for_transaction_receipt(tx_hash)
