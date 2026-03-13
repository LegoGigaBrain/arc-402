"""DisputeArbitrationClient — interacts with the on-chain DisputeArbitration contract."""

from __future__ import annotations

from typing import TYPE_CHECKING

from web3 import Web3

from .types import ArbitratorBondState, DisputeClass, DisputeFeeState, DisputeMode

if TYPE_CHECKING:
    from web3.contract import Contract
    from eth_account.signers.local import LocalAccount

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

DISPUTE_ARBITRATION_ABI = [
    # Views
    {"name": "getDisputeFeeState", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "agreementId", "type": "uint256"}],
     "outputs": [{"name": "", "type": "tuple", "components": [
         {"name": "mode", "type": "uint8"}, {"name": "disputeClass", "type": "uint8"},
         {"name": "opener", "type": "address"}, {"name": "client", "type": "address"},
         {"name": "provider", "type": "address"}, {"name": "token", "type": "address"},
         {"name": "agreementPrice", "type": "uint256"}, {"name": "feeRequired", "type": "uint256"},
         {"name": "openerPaid", "type": "uint256"}, {"name": "respondentPaid", "type": "uint256"},
         {"name": "openedAt", "type": "uint256"}, {"name": "active", "type": "bool"},
         {"name": "resolved", "type": "bool"},
     ]}]},
    {"name": "getArbitratorBondState", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "arbitrator", "type": "address"}, {"name": "agreementId", "type": "uint256"}],
     "outputs": [{"name": "", "type": "tuple", "components": [
         {"name": "bondAmount", "type": "uint256"}, {"name": "lockedAt", "type": "uint256"},
         {"name": "locked", "type": "bool"}, {"name": "slashed", "type": "bool"},
         {"name": "returned", "type": "bool"},
     ]}]},
    {"name": "getFeeQuote", "type": "function", "stateMutability": "view",
     "inputs": [
         {"name": "agreementPrice", "type": "uint256"}, {"name": "token", "type": "address"},
         {"name": "mode", "type": "uint8"}, {"name": "disputeClass", "type": "uint8"},
     ],
     "outputs": [{"name": "feeInTokens", "type": "uint256"}]},
    {"name": "getAcceptedArbitrators", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "agreementId", "type": "uint256"}],
     "outputs": [{"name": "", "type": "address[]"}]},
    {"name": "isEligibleArbitrator", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "arbitrator", "type": "address"}],
     "outputs": [{"name": "", "type": "bool"}]},
    {"name": "tokenUsdRate18", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "token", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    # Transactions
    {"name": "joinMutualDispute", "type": "function", "stateMutability": "payable",
     "inputs": [{"name": "agreementId", "type": "uint256"}], "outputs": []},
    {"name": "acceptAssignment", "type": "function", "stateMutability": "payable",
     "inputs": [{"name": "agreementId", "type": "uint256"}], "outputs": []},
    {"name": "triggerFallback", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "agreementId", "type": "uint256"}],
     "outputs": [{"name": "fallbackTriggered", "type": "bool"}]},
    {"name": "slashArbitrator", "type": "function", "stateMutability": "nonpayable",
     "inputs": [
         {"name": "agreementId", "type": "uint256"},
         {"name": "arbitrator", "type": "address"},
         {"name": "reason", "type": "string"},
     ], "outputs": []},
    {"name": "reclaimExpiredBond", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "agreementId", "type": "uint256"}], "outputs": []},
    {"name": "transferOwnership", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "newOwner", "type": "address"}], "outputs": []},
    {"name": "acceptOwnership", "type": "function", "stateMutability": "nonpayable",
     "inputs": [], "outputs": []},
    {"name": "setTokenUsdRate", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "token", "type": "address"}, {"name": "usdRate18", "type": "uint256"}],
     "outputs": []},
    {"name": "setServiceAgreement", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "sa", "type": "address"}], "outputs": []},
    {"name": "setTrustRegistry", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "tr", "type": "address"}], "outputs": []},
    {"name": "setTreasury", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "treasury", "type": "address"}], "outputs": []},
]


class DisputeArbitrationClient:
    """Python wrapper for the ARC-402 DisputeArbitration contract."""

    def __init__(self, address: str, w3: Web3, account: "LocalAccount | None" = None):
        self._w3 = w3
        self._account = account
        self._contract: "Contract" = w3.eth.contract(
            address=Web3.to_checksum_address(address),
            abi=DISPUTE_ARBITRATION_ABI,
        )

    # ─── Views ────────────────────────────────────────────────────────────────

    def get_dispute_fee_state(self, agreement_id: int) -> DisputeFeeState:
        raw = self._contract.functions.getDisputeFeeState(agreement_id).call()
        return DisputeFeeState.from_raw(raw)

    def get_arbitrator_bond_state(self, arbitrator: str, agreement_id: int) -> ArbitratorBondState:
        raw = self._contract.functions.getArbitratorBondState(
            Web3.to_checksum_address(arbitrator), agreement_id
        ).call()
        return ArbitratorBondState.from_raw(raw)

    def get_fee_quote(
        self,
        agreement_price: int,
        token: str,
        mode: DisputeMode,
        dispute_class: DisputeClass,
    ) -> int:
        return self._contract.functions.getFeeQuote(
            agreement_price,
            Web3.to_checksum_address(token),
            int(mode),
            int(dispute_class),
        ).call()

    def get_accepted_arbitrators(self, agreement_id: int) -> list[str]:
        return self._contract.functions.getAcceptedArbitrators(agreement_id).call()

    def is_eligible_arbitrator(self, arbitrator: str) -> bool:
        return self._contract.functions.isEligibleArbitrator(
            Web3.to_checksum_address(arbitrator)
        ).call()

    def get_token_usd_rate(self, token: str) -> int:
        return self._contract.functions.tokenUsdRate18(
            Web3.to_checksum_address(token)
        ).call()

    # ─── Transactions ─────────────────────────────────────────────────────────

    def _require_account(self) -> None:
        if self._account is None:
            raise ValueError("Account (private key) required for write operations")

    def _tx_params(self, value: int = 0) -> dict:
        params: dict = {"from": self._account.address, "gas": 300_000}
        if value:
            params["value"] = value
        return params

    def _send(self, tx) -> str:
        signed = self._account.sign_transaction(
            tx.build_transaction(self._tx_params())
        )
        tx_hash = self._w3.eth.send_raw_transaction(signed.raw_transaction)
        return tx_hash.hex()

    def join_mutual_dispute(self, agreement_id: int, half_fee_eth: int = 0) -> str:
        """Respondent in a MUTUAL dispute funds their half of the fee."""
        self._require_account()
        tx = self._contract.functions.joinMutualDispute(agreement_id)
        params = self._tx_params(half_fee_eth)
        signed = self._account.sign_transaction(tx.build_transaction(params))
        return self._w3.eth.send_raw_transaction(signed.raw_transaction).hex()

    def accept_assignment(self, agreement_id: int, bond_eth: int = 0) -> str:
        """Nominated arbitrator accepts panel assignment and posts bond."""
        self._require_account()
        tx = self._contract.functions.acceptAssignment(agreement_id)
        params = self._tx_params(bond_eth)
        signed = self._account.sign_transaction(tx.build_transaction(params))
        return self._w3.eth.send_raw_transaction(signed.raw_transaction).hex()

    def trigger_fallback(self, agreement_id: int) -> str:
        """Trigger fallback to human backstop queue (mutual unfunded or panel incomplete)."""
        self._require_account()
        return self._send(self._contract.functions.triggerFallback(agreement_id))

    def slash_arbitrator(self, agreement_id: int, arbitrator: str, reason: str) -> str:
        """Owner only: manually slash an arbitrator for rules violation."""
        self._require_account()
        return self._send(
            self._contract.functions.slashArbitrator(
                agreement_id, Web3.to_checksum_address(arbitrator), reason
            )
        )

    def set_token_usd_rate(self, token: str, usd_rate18: int) -> str:
        """
        Set the USD rate for a payment token. Owner only.
        usd_rate18: USD per token with 18 decimals (e.g. 2000 * 10**18 for ETH at $2000).
        IMPORTANT: This is an admin-set rate, not a trustless oracle.
        """
        self._require_account()
        return self._send(
            self._contract.functions.setTokenUsdRate(
                Web3.to_checksum_address(token), usd_rate18
            )
        )

    def set_service_agreement(self, address: str) -> str:
        self._require_account()
        return self._send(
            self._contract.functions.setServiceAgreement(Web3.to_checksum_address(address))
        )

    def set_trust_registry(self, address: str) -> str:
        self._require_account()
        return self._send(
            self._contract.functions.setTrustRegistry(Web3.to_checksum_address(address))
        )

    def set_treasury(self, address: str) -> str:
        self._require_account()
        return self._send(
            self._contract.functions.setTreasury(Web3.to_checksum_address(address))
        )

    def reclaim_expired_bond(self, agreement_id: int) -> str:
        """
        Reclaim an arbitrator bond after 45 days if the dispute was never resolved via resolveDisputeFee.
        Prevents permanent bond lock on stalled disputes. Caller must be the bonded arbitrator.
        """
        self._require_account()
        return self._send(self._contract.functions.reclaimExpiredBond(agreement_id))

    def propose_owner(self, new_owner: str) -> str:
        """Step 1 of two-step ownership transfer. Owner only."""
        self._require_account()
        return self._send(
            self._contract.functions.transferOwnership(Web3.to_checksum_address(new_owner))
        )

    def accept_ownership(self) -> str:
        """Step 2 of two-step ownership transfer. Must be called by the pending owner."""
        self._require_account()
        return self._send(self._contract.functions.acceptOwnership())

    def resolve_from_arbitration(
        self,
        agreement_id: int,
        recipient: str,
        provider_amount: int,
        client_amount: int,
    ) -> str:
        """
        Called by the DisputeArbitration contract to resolve a dispute with split amounts
        on the ServiceAgreement contract. Exposed here for direct coordinator use.
        """
        self._require_account()
        return self._send(
            self._contract.functions.resolveFromArbitration(
                agreement_id,
                Web3.to_checksum_address(recipient),
                provider_amount,
                client_amount,
            )
        )
