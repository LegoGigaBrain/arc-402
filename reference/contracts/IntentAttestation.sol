// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IIntentAttestation.sol";

/**
 * @title IntentAttestation
 * @notice Immutable on-chain record of agent intent before spending
 * STATUS: DRAFT — not audited, do not use in production
 */
contract IntentAttestation is IIntentAttestation {
    struct Attestation {
        bytes32 attestationId;
        address wallet;
        string action;
        string reason;
        address recipient;
        uint256 amount;
        address token;      // address(0) for ETH, token address for ERC-20 (e.g. USDC)
        uint256 timestamp;
        uint256 expiresAt;  // 0 = no expiry. Otherwise: unix timestamp after which invalid.
    }

    mapping(bytes32 => Attestation) private attestations;
    mapping(bytes32 => bool) private exists;
    mapping(bytes32 => bool) public used;

    event AttestationCreated(
        bytes32 indexed attestationId,
        address indexed wallet,
        string action,
        address recipient,
        uint256 amount,
        address token,
        uint256 expiresAt
    );

    event AttestationConsumed(bytes32 indexed attestationId, address indexed wallet);

    function attest(
        bytes32 attestationId,
        string calldata action,
        string calldata reason,
        address recipient,
        uint256 amount,
        address token,
        uint256 expiresAt
    ) external {
        require(!exists[attestationId], "IntentAttestation: already exists");
        require(expiresAt == 0 || expiresAt > block.timestamp, "IA: expiry in past");
        attestations[attestationId] = Attestation({
            attestationId: attestationId,
            wallet: msg.sender,
            action: action,
            reason: reason,
            recipient: recipient,
            amount: amount,
            token: token,
            timestamp: block.timestamp,
            expiresAt: expiresAt
        });
        exists[attestationId] = true;
        emit AttestationCreated(attestationId, msg.sender, action, recipient, amount, token, expiresAt);
    }

    function verify(
        bytes32 attestationId,
        address wallet,
        address recipient,
        uint256 amount,
        address token
    ) external view returns (bool) {
        if (!exists[attestationId]) return false;
        if (used[attestationId]) return false;
        if (attestations[attestationId].expiresAt != 0 &&
            block.timestamp > attestations[attestationId].expiresAt) return false;
        Attestation storage a = attestations[attestationId];
        return a.wallet == wallet &&
               a.recipient == recipient &&
               a.amount == amount &&
               a.token == token;
    }

    function consume(bytes32 attestationId) external {
        require(exists[attestationId], "IA: not found");
        require(!used[attestationId], "IA: already used");
        require(attestations[attestationId].wallet == msg.sender, "IA: not wallet");
        used[attestationId] = true;
        emit AttestationConsumed(attestationId, msg.sender);
    }

    function isExpired(bytes32 attestationId) external view returns (bool) {
        if (!exists[attestationId]) return false;
        uint256 exp = attestations[attestationId].expiresAt;
        // slither-disable-next-line incorrect-equality
        if (exp == 0) return false; // exp == 0 means "no expiry set" — intentional sentinel value
        return block.timestamp > exp;
    }

    function getAttestation(bytes32 attestationId) external view returns (
        bytes32 id,
        address wallet,
        string memory action,
        string memory reason,
        address recipient,
        uint256 amount,
        address token,
        uint256 timestamp
    ) {
        require(exists[attestationId], "IntentAttestation: not found");
        Attestation storage a = attestations[attestationId];
        return (a.attestationId, a.wallet, a.action, a.reason, a.recipient, a.amount, a.token, a.timestamp);
    }
}
