"""SessionChannels — EIP-712 state signing for ARC-402 session payment channels.

MA-07 FIX: Uses EIP-712 domain separation (chainId + contract address) instead of
plain keccak256 + eth_sign. This matches the on-chain _verifyChannelStateSigs()
implementation in SessionChannels.sol.

Breaking change from the old scheme: signatures produced by this module are NOT
compatible with the previous eth_sign-over-raw-keccak scheme.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional

from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3

# ─── EIP-712 Type Strings ──────────────────────────────────────────────────────

DOMAIN_TYPEHASH: bytes = Web3.keccak(
    text="EIP712Domain(string name,uint256 chainId,address verifyingContract)"
)

CHANNEL_STATE_TYPEHASH: bytes = Web3.keccak(
    text=(
        "ChannelState(bytes32 channelId,uint256 sequenceNumber,uint256 callCount,"
        "uint256 cumulativePayment,address token,uint256 timestamp)"
    )
)

CONTRACT_NAME_HASH: bytes = Web3.keccak(text="ARC402SessionChannels")


# ─── Data Classes ──────────────────────────────────────────────────────────────

@dataclass
class ChannelState:
    channel_id: bytes          # bytes32
    sequence_number: int
    call_count: int
    cumulative_payment: int    # in token units
    token: str                 # address (checksummed)
    timestamp: int
    client_sig: Optional[bytes] = field(default=None)
    provider_sig: Optional[bytes] = field(default=None)


# ─── EIP-712 Helpers ──────────────────────────────────────────────────────────

def domain_separator(chain_id: int, contract_address: str) -> bytes:
    """Compute the EIP-712 domain separator.

    Must match SessionChannels._domainSeparator() on-chain.
    """
    encoded = Web3.solidity_keccak(
        ["bytes32", "bytes32", "uint256", "address"],
        [DOMAIN_TYPEHASH, CONTRACT_NAME_HASH, chain_id, contract_address],
    )
    return encoded


def channel_state_digest(state: ChannelState, chain_id: int, contract_address: str) -> bytes:
    """Compute the EIP-712 typed-data digest for a ChannelState.

    Must match the digest computed in SessionChannels._verifyChannelStateSigs().
    """
    struct_hash = Web3.solidity_keccak(
        ["bytes32", "bytes32", "uint256", "uint256", "uint256", "address", "uint256"],
        [
            CHANNEL_STATE_TYPEHASH,
            state.channel_id,
            state.sequence_number,
            state.call_count,
            state.cumulative_payment,
            state.token,
            state.timestamp,
        ],
    )
    dom_sep = domain_separator(chain_id, contract_address)
    # EIP-712 envelope: \x19\x01 + domainSeparator + structHash
    digest = Web3.keccak(b"\x19\x01" + dom_sep + struct_hash)
    return digest


# ─── Signing / Verification ────────────────────────────────────────────────────

def sign_channel_state(
    private_key: str,
    state: ChannelState,
    chain_id: int,
    contract_address: str,
) -> bytes:
    """Sign a ChannelState with EIP-712 domain separation.

    Returns the 65-byte signature (r, s, v).
    """
    digest = channel_state_digest(state, chain_id, contract_address)
    # Sign the raw digest bytes (no additional prefix — EIP-712 digest is final)
    signed = Account.signHash(digest, private_key=private_key)
    return signed.signature


def verify_channel_state(
    sig: bytes,
    state: ChannelState,
    expected_signer: str,
    chain_id: int,
    contract_address: str,
) -> bool:
    """Verify an EIP-712 channel state signature.

    Returns True if sig was produced by expected_signer.
    """
    try:
        digest = channel_state_digest(state, chain_id, contract_address)
        recovered = Account.recover_message(encode_defunct(hexstr=digest.hex()), signature=sig)
        return recovered.lower() == expected_signer.lower()
    except Exception:
        return False


# ─── Convenience factory ──────────────────────────────────────────────────────

def make_channel_state(
    channel_id: bytes,
    sequence_number: int,
    call_count: int,
    cumulative_payment: int,
    token: str,
    timestamp: Optional[int] = None,
) -> ChannelState:
    """Create a ChannelState with the current timestamp if not provided."""
    return ChannelState(
        channel_id=channel_id,
        sequence_number=sequence_number,
        call_count=call_count,
        cumulative_payment=cumulative_payment,
        token=token,
        timestamp=timestamp if timestamp is not None else int(time.time()),
    )
