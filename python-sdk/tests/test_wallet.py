"""Tests for ARC402Wallet and upgraded protocol clients."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from arc402 import ARC402Wallet
from arc402.agent import AgentInfo, AgentRegistryClient
from arc402.agreement import ServiceAgreementClient
from arc402.exceptions import ContextNotOpen, NetworkNotSupported, PolicyViolation
from arc402.reputation import ReputationOracleClient
from arc402.sponsorship import SponsorshipAttestationClient
from arc402.trust import TrustClient
from arc402.types import (
    ArbitrationVote,
    CapabilitySlot,
    IdentityTier,
    OperationalMetrics,
    ProviderResponseType,
    TrustProfile,
    TrustScore,
)

FAKE_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
FAKE_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
FAKE_RECIPIENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"


def make_wallet():
    with patch("arc402.wallet.Web3") as MockWeb3, patch("arc402.policy.Web3") as MockWeb3Policy, patch("arc402.trust.Web3") as MockWeb3Trust, patch("arc402.intent.Web3") as MockWeb3Intent, patch("arc402.settlement.Web3") as MockWeb3Settlement:
        for m in [MockWeb3, MockWeb3Policy, MockWeb3Trust, MockWeb3Intent, MockWeb3Settlement]:
            m.to_checksum_address.side_effect = lambda x: x
            m.to_wei.side_effect = lambda val, unit: int(float(val) * 10**18)

        w3 = MagicMock()
        w3.eth.chain_id = 84532
        w3.eth.gas_price = 1_000_000_000
        w3.eth.get_transaction_count.return_value = 0
        w3.eth.contract.return_value = MagicMock()

        MockWeb3.HTTPProvider.return_value = MagicMock()
        MockWeb3.return_value = w3

        wallet = ARC402Wallet(address=FAKE_ADDRESS, private_key=FAKE_PRIVATE_KEY, network="base-sepolia")
        wallet._w3 = w3
        wallet._wallet_contract = MagicMock()
        wallet._wallet_contract.functions.contextOpen.return_value.call.return_value = False
        wallet._wallet_contract.functions.openContext.return_value.build_transaction.return_value = {}
        wallet._wallet_contract.functions.closeContext.return_value.build_transaction.return_value = {}
        wallet._wallet_contract.functions.executeSpend.return_value.build_transaction.return_value = {}
        wallet._send = AsyncMock(return_value={"transactionHash": bytes.fromhex("ab" * 32), "logs": []})

        wallet._policy = MagicMock()
        wallet._policy.validate_spend = AsyncMock()
        wallet._policy.set_policy = AsyncMock(return_value="0x" + "ab" * 32)

        wallet._trust = MagicMock()
        wallet._trust.get_score = AsyncMock(return_value=TrustScore.from_raw(105))
        wallet._trust.record_success = AsyncMock()
        wallet._trust.record_anomaly = AsyncMock()

        wallet._intent = MagicMock()
        wallet._intent.attest = AsyncMock(return_value=b"\xab" * 32)
        wallet._intent.history = AsyncMock(return_value=[])

        wallet._settlement = MagicMock()
        return wallet


class TestARC402Wallet:
    def test_unsupported_network_raises(self):
        with pytest.raises(NetworkNotSupported):
            ARC402Wallet(address=FAKE_ADDRESS, private_key=FAKE_PRIVATE_KEY, network="ethereum")

    def test_context_opens_and_closes(self):
        wallet = make_wallet()

        async def run():
            async with wallet.context("claims_processing"):
                assert wallet._active_context_id is not None

        asyncio.run(run())
        assert wallet._active_context_id is None
        wallet._trust.record_success.assert_called_once_with(FAKE_ADDRESS)

    def test_spend_without_context_raises(self):
        wallet = make_wallet()
        with pytest.raises(ContextNotOpen):
            asyncio.run(wallet.spend(FAKE_RECIPIENT, "0.05 ether", "claims_processing", "Test"))

    def test_spend_policy_violation_propagates(self):
        wallet = make_wallet()
        wallet._policy.validate_spend = AsyncMock(side_effect=PolicyViolation("Exceeds", category="claims_processing"))

        async def run():
            async with wallet.context("claims_processing"):
                await wallet.spend(FAKE_RECIPIENT, "100 ether", "claims_processing", "Too much")

        with pytest.raises(PolicyViolation):
            asyncio.run(run())


class TestTrustClientV2Reads:
    def test_v2_read_helpers(self):
        w3 = MagicMock()
        account = MagicMock(address=FAKE_ADDRESS)
        with patch("arc402.trust.Web3") as mock_web3:
            mock_web3.to_checksum_address.side_effect = lambda x: x
            contract = MagicMock()
            w3.eth.contract.return_value = contract
            client = TrustClient(w3, "0xtrust", account)
            client._contract = contract
            contract.functions.getScore.return_value.call.return_value = 120
            contract.functions.getGlobalScore.return_value.call.return_value = 130
            contract.functions.getEffectiveScore.return_value.call.return_value = 125
            contract.functions.profiles.return_value.call.return_value = (130, 100, b"\x01" * 32)
            contract.functions.getCapabilityScore.return_value.call.return_value = 77
            contract.functions.getCapabilitySlots.return_value.call.return_value = [(b"\x02" * 32, 77)]
            contract.functions.meetsThreshold.return_value.call.return_value = True
            contract.functions.meetsCapabilityThreshold.return_value.call.return_value = False
            assert asyncio.run(client.get_score(FAKE_ADDRESS)).score == 120
            assert asyncio.run(client.get_global_score(FAKE_ADDRESS)) == 130
            assert asyncio.run(client.get_effective_score(FAKE_ADDRESS)) == 125
            assert isinstance(asyncio.run(client.get_profile(FAKE_ADDRESS)), TrustProfile)
            assert asyncio.run(client.get_capability_score(FAKE_ADDRESS, "claims.v1")) == 77
            assert isinstance(asyncio.run(client.get_capability_slots(FAKE_ADDRESS))[0], CapabilitySlot)
            assert asyncio.run(client.meets_threshold(FAKE_ADDRESS, 100)) is True
            assert asyncio.run(client.meets_capability_threshold(FAKE_ADDRESS, 100, "claims.v1")) is False


class TestServiceAgreementClient:
    def test_remediation_and_evidence_writes(self):
        w3 = MagicMock()
        account = MagicMock(address=FAKE_ADDRESS)
        with patch("arc402.agreement.Web3") as mock_web3:
            mock_web3.to_checksum_address.side_effect = lambda x: x
            contract = MagicMock()
            w3.eth.contract.return_value = contract
            client = ServiceAgreementClient("0xagreement", w3, account)
            client._contract = contract
            client._send = AsyncMock(return_value={"transactionHash": bytes.fromhex("ab" * 32)})
            contract.functions.requestRevision.return_value.build_transaction.return_value = {}
            contract.functions.respondToRevision.return_value.build_transaction.return_value = {}
            contract.functions.submitDisputeEvidence.return_value.build_transaction.return_value = {}
            contract.functions.nominateArbitrator.return_value.build_transaction.return_value = {}
            contract.functions.castArbitrationVote.return_value.build_transaction.return_value = {}
            contract.functions.requestHumanEscalation.return_value.build_transaction.return_value = {}
            contract.functions.getRemediationCase.return_value.call.return_value = (1, 2, 3, 4, b"\x01" * 32, True)
            contract.functions.getArbitrationCase.return_value.call.return_value = (
                1,
                ["0x1", "0x2", "0x3"],
                3,
                1,
                0,
                0,
                0,
                10,
                20,
                0,
                0,
                False,
                False,
            )
            asyncio.run(client.request_revision(1, "0x" + "11" * 32, "ipfs://feedback"))
            asyncio.run(client.respond_to_revision(1, ProviderResponseType.REVISE, 0, "0x" + "22" * 32))
            asyncio.run(client.submit_dispute_evidence(1, 2, "0x" + "33" * 32, "ipfs://evidence"))
            asyncio.run(client.nominate_arbitrator(1, "0xArb"))
            asyncio.run(client.cast_arbitration_vote(1, ArbitrationVote.PROVIDER_WINS, 100, 0))
            asyncio.run(client.request_human_escalation(1, "stalled"))
            assert client.get_remediation_case(1).active is True
            assert client.get_arbitration_case(1).arbitrator_count == 3


class TestRegistryAndAttestations:
    def test_agent_registry_operational_reads(self):
        w3 = MagicMock()
        account = MagicMock(address=FAKE_ADDRESS)
        with patch("arc402.agent.Web3") as mock_web3:
            mock_web3.to_checksum_address.side_effect = lambda x: x
            contract = MagicMock()
            w3.eth.contract.return_value = contract
            client = AgentRegistryClient("0xagent", w3, account)
            client._contract = contract
            contract.functions.getAgent.return_value.call.return_value = (FAKE_ADDRESS, "Forge", ["claims.v1"], "oracle", "https://x", "ipfs://m", True, 1, 2, 3)
            contract.functions.getTrustScore.return_value.call.return_value = 150
            contract.functions.getOperationalMetrics.return_value.call.return_value = (60, 15, 100, 250, 4, 1, 90, 88)
            contract.functions.getEndpointStability.return_value.call.return_value = 70
            agent = client.get_agent(FAKE_ADDRESS, include_operational=True)
            assert isinstance(agent, AgentInfo)
            assert isinstance(agent.operational_metrics, OperationalMetrics)
            assert client.get_operational_trust(FAKE_ADDRESS)["endpoint_stability"] == 70

    def test_reputation_and_sponsorship_reads(self):
        w3 = MagicMock()
        account = MagicMock(address=FAKE_ADDRESS)
        with patch("arc402.reputation.Web3") as rep_web3, patch("arc402.sponsorship.Web3") as sponsor_web3:
            rep_web3.to_checksum_address.side_effect = lambda x: x
            sponsor_web3.to_checksum_address.side_effect = lambda x: x
            rep_contract = MagicMock()
            sponsor_contract = MagicMock()
            w3.eth.contract.side_effect = [rep_contract, sponsor_contract]
            reputation = ReputationOracleClient("0xrep", w3, account)
            sponsorship = SponsorshipAttestationClient("0xsponsor", w3, account)
            reputation._contract = rep_contract
            sponsorship._contract = sponsor_contract
            rep_contract.functions.getReputation.return_value.call.return_value = (2, 1, 0, 100)
            sponsor_contract.functions.getHighestTier.return_value.call.return_value = 2
            sponsor_contract.functions.getAttestation.return_value.call.return_value = ("0xS", "0xA", 1, 2, False, 2, "ipfs://proof")
            assert reputation.get_reputation(FAKE_ADDRESS).weighted_score == 100
            assert sponsorship.get_highest_tier(FAKE_ADDRESS) == IdentityTier.VERIFIED_PROVIDER
            assert sponsorship.is_verified(FAKE_ADDRESS) is True
