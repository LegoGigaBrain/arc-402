"""ServiceAgreementClient — interacts with the on-chain ServiceAgreement contract."""

from __future__ import annotations

from typing import TYPE_CHECKING

from web3 import Web3

from .abis import ServiceAgreement_ABI
from .types import (
    Agreement,
    DirectDisputeReason,
    DisputeCase,
    DisputeEvidence,
    DisputeOutcome,
    EvidenceType,
    ProviderResponseType,
    RemediationCase,
    RemediationFeedback,
    RemediationResponse,
)

if TYPE_CHECKING:
    from web3.contract import Contract
    from eth_account.signers.local import LocalAccount

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


class ServiceAgreementClient:
    """Python wrapper for the ARC-402 ServiceAgreement contract."""

    def __init__(self, address: str, w3: Web3, account: "LocalAccount | None" = None):
        self._w3 = w3
        self._account = account
        self._contract: "Contract" = w3.eth.contract(
            address=Web3.to_checksum_address(address),
            abi=ServiceAgreement_ABI,
        )

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
        self._require_account()
        dh_bytes = self._to_bytes32(deliverables_hash)
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
        return self._extract_agreement_id(receipt), receipt["transactionHash"].hex()

    async def accept(self, agreement_id: int) -> str:
        return await self._simple_write("accept", agreement_id)

    async def fulfill(self, agreement_id: int, actual_deliverables_hash: str) -> str:
        return await self._simple_write("fulfill", agreement_id, self._to_bytes32(actual_deliverables_hash))

    async def commit_deliverable(self, agreement_id: int, deliverable_hash: str) -> str:
        return await self._simple_write("commitDeliverable", agreement_id, self._to_bytes32(deliverable_hash))

    async def verify_deliverable(self, agreement_id: int) -> str:
        return await self._simple_write("verifyDeliverable", agreement_id)

    async def auto_release(self, agreement_id: int) -> str:
        return await self._simple_write("autoRelease", agreement_id)

    async def dispute(self, agreement_id: int, reason: str) -> str:
        return await self._simple_write("dispute", agreement_id, reason)

    async def direct_dispute(self, agreement_id: int, direct_reason: DirectDisputeReason, reason: str) -> str:
        return await self._simple_write("directDispute", agreement_id, int(direct_reason), reason)

    async def request_revision(
        self,
        agreement_id: int,
        feedback_hash: str,
        feedback_uri: str = "",
        previous_transcript_hash: str | bytes | None = None,
    ) -> str:
        return await self._simple_write(
            "requestRevision",
            agreement_id,
            self._to_bytes32(feedback_hash),
            feedback_uri,
            self._to_bytes32(previous_transcript_hash),
        )

    async def respond_to_revision(
        self,
        agreement_id: int,
        response_type: ProviderResponseType,
        proposed_provider_payout: int,
        response_hash: str,
        response_uri: str = "",
        previous_transcript_hash: str | bytes | None = None,
    ) -> str:
        return await self._simple_write(
            "respondToRevision",
            agreement_id,
            int(response_type),
            proposed_provider_payout,
            self._to_bytes32(response_hash),
            response_uri,
            self._to_bytes32(previous_transcript_hash),
        )

    async def propose_partial_settlement(
        self,
        agreement_id: int,
        provider_payout: int,
        response_hash: str,
        response_uri: str = "",
        previous_transcript_hash: str | bytes | None = None,
    ) -> str:
        return await self.respond_to_revision(
            agreement_id=agreement_id,
            response_type=ProviderResponseType.PARTIAL_SETTLEMENT,
            proposed_provider_payout=provider_payout,
            response_hash=response_hash,
            response_uri=response_uri,
            previous_transcript_hash=previous_transcript_hash,
        )

    async def request_human_review(
        self,
        agreement_id: int,
        response_hash: str,
        response_uri: str = "",
        previous_transcript_hash: str | bytes | None = None,
    ) -> str:
        return await self.respond_to_revision(
            agreement_id=agreement_id,
            response_type=ProviderResponseType.REQUEST_HUMAN_REVIEW,
            proposed_provider_payout=0,
            response_hash=response_hash,
            response_uri=response_uri,
            previous_transcript_hash=previous_transcript_hash,
        )

    async def escalate_to_dispute(self, agreement_id: int, reason: str) -> str:
        return await self._simple_write("escalateToDispute", agreement_id, reason)

    def can_direct_dispute(self, agreement_id: int, direct_reason: DirectDisputeReason) -> bool:
        return bool(self._contract.functions.canDirectDispute(agreement_id, int(direct_reason)).call())

    async def submit_dispute_evidence(
        self,
        agreement_id: int,
        evidence_type: EvidenceType,
        evidence_hash: str,
        evidence_uri: str = "",
    ) -> str:
        return await self._simple_write(
            "submitDisputeEvidence",
            agreement_id,
            int(evidence_type),
            self._to_bytes32(evidence_hash),
            evidence_uri,
        )

    async def resolve_dispute_detailed(
        self,
        agreement_id: int,
        outcome: DisputeOutcome,
        provider_award: int,
        client_award: int,
    ) -> str:
        return await self._simple_write(
            "resolveDisputeDetailed",
            agreement_id,
            int(outcome),
            provider_award,
            client_award,
        )

    async def cancel(self, agreement_id: int) -> str:
        return await self._simple_write("cancel", agreement_id)

    async def expired_cancel(self, agreement_id: int) -> str:
        return await self._simple_write("expiredCancel", agreement_id)

    async def expired_dispute_refund(self, agreement_id: int) -> str:
        return await self._simple_write("expiredDisputeRefund", agreement_id)

    def get_agreement(self, agreement_id: int) -> Agreement:
        return Agreement.from_raw(self._contract.functions.getAgreement(agreement_id).call())

    def get_agreements_by_client(self, client: str) -> list[int]:
        return list(self._contract.functions.getAgreementsByClient(Web3.to_checksum_address(client)).call())

    def get_agreements_by_provider(self, provider: str) -> list[int]:
        return list(self._contract.functions.getAgreementsByProvider(Web3.to_checksum_address(provider)).call())

    def get_remediation_case(self, agreement_id: int) -> RemediationCase:
        return RemediationCase.from_raw(self._contract.functions.getRemediationCase(agreement_id).call())

    def get_remediation_feedback(self, agreement_id: int, index: int) -> RemediationFeedback:
        return RemediationFeedback.from_raw(self._contract.functions.getRemediationFeedback(agreement_id, index).call())

    def get_remediation_response(self, agreement_id: int, index: int) -> RemediationResponse:
        return RemediationResponse.from_raw(self._contract.functions.getRemediationResponse(agreement_id, index).call())

    def get_dispute_case(self, agreement_id: int) -> DisputeCase:
        return DisputeCase.from_raw(self._contract.functions.getDisputeCase(agreement_id).call())

    def get_dispute_evidence(self, agreement_id: int, index: int) -> DisputeEvidence:
        return DisputeEvidence.from_raw(self._contract.functions.getDisputeEvidence(agreement_id, index).call())

    def agreement_count(self) -> int:
        return self._contract.functions.agreementCount().call()

    def remediation_history(self, agreement_id: int) -> dict[str, list]:
        case = self.get_remediation_case(agreement_id)
        feedback = [self.get_remediation_feedback(agreement_id, i) for i in range(case.cycle_count)]
        responses = []
        for i in range(case.cycle_count):
            try:
                responses.append(self.get_remediation_response(agreement_id, i))
            except Exception:
                break
        return {"case": case, "feedback": feedback, "responses": responses}

    def dispute_evidence_list(self, agreement_id: int) -> list[DisputeEvidence]:
        dispute = self.get_dispute_case(agreement_id)
        return [self.get_dispute_evidence(agreement_id, i) for i in range(dispute.evidence_count)]

    def _extract_agreement_id(self, receipt: dict) -> int:
        try:
            events = self._contract.events.AgreementProposed().process_receipt(receipt)
            if events:
                return int(events[0]["args"]["id"])
        except Exception:
            pass
        for log in receipt.get("logs", []):
            topics = log.get("topics", [])
            if len(topics) >= 2:
                return int.from_bytes(topics[1], "big")
        raise ValueError("ServiceAgreementClient: could not extract agreement ID from receipt")

    async def _simple_write(self, fn_name: str, *args) -> str:
        self._require_account()
        fn = getattr(self._contract.functions, fn_name)(*args)
        receipt = await self._send(fn.build_transaction(self._tx_params()))
        return receipt["transactionHash"].hex()

    def _require_account(self) -> None:
        if self._account is None:
            raise ValueError("ServiceAgreementClient: an account is required for write methods. Pass account= when constructing the client.")

    def _to_bytes32(self, value: str | bytes | None) -> bytes:
        if value in (None, ""):
            return b"\x00" * 32
        if isinstance(value, bytes):
            return value.ljust(32, b"\x00")[:32]
        return bytes.fromhex(value.removeprefix("0x")).ljust(32, b"\x00")[:32]

    def _tx_params(self) -> dict:
        return {
            "from": self._account.address,
            "nonce": self._w3.eth.get_transaction_count(self._account.address),
            "gas": 500_000,
            "gasPrice": self._w3.eth.gas_price,
            "chainId": self._w3.eth.chain_id,
        }

    async def _send(self, tx: dict) -> dict:
        signed = self._account.sign_transaction(tx)
        tx_hash = self._w3.eth.send_raw_transaction(signed.raw_transaction)
        return self._w3.eth.wait_for_transaction_receipt(tx_hash)
