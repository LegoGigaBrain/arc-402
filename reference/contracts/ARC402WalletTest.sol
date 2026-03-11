// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPolicyEngine.sol";
import "./ITrustRegistry.sol";
import "./IIntentAttestation.sol";

/// @dev Extended attestation interface not present in the minimal IIntentAttestation
interface IIntentAttestationFull {
    function attest(
        bytes32         attestationId,
        string calldata action,
        string calldata reason,
        address         recipient,
        uint256         amount,
        address         token
    ) external;
    function verify(bytes32 attestationId, address wallet, address recipient, uint256 amount, address token) external view returns (bool);
}

/**
 * @title ARC402WalletTest
 * @notice Extended ARC402Wallet for testnet validation — adds relayAttest so the
 *         deployer can create IntentAttestation records attributed to this wallet.
 *         DO NOT use in production.
 */
contract ARC402WalletTest {
    address public immutable owner;
    IPolicyEngine public immutable policyEngine;
    ITrustRegistry public immutable trustRegistry;
    IIntentAttestation public immutable intentAttestation;

    bytes32 public activeContextId;
    string  public activeTaskType;
    bool    public contextOpen;
    uint256 public contextOpenedAt;

    event ContextOpened(bytes32 indexed contextId, string taskType, uint256 timestamp);
    event ContextClosed(bytes32 indexed contextId, uint256 timestamp);
    event SpendExecuted(address indexed recipient, uint256 amount, string category, bytes32 attestationId);
    event SettlementProposed(address indexed recipientWallet, uint256 amount, bytes32 attestationId);

    modifier onlyOwner() {
        require(msg.sender == owner, "ARC402: not owner");
        _;
    }

    modifier requireOpenContext() {
        require(contextOpen, "ARC402: no active context");
        _;
    }

    constructor(address _policyEngine, address _trustRegistry, address _intentAttestation) {
        owner = msg.sender;
        policyEngine    = IPolicyEngine(_policyEngine);
        trustRegistry   = ITrustRegistry(_trustRegistry);
        intentAttestation = IIntentAttestation(_intentAttestation);
        trustRegistry.initWallet(address(this));
    }

    // ─── Context ─────────────────────────────────────────────────────────────

    function openContext(bytes32 contextId, string calldata taskType) external onlyOwner {
        require(!contextOpen, "ARC402: context already open");
        activeContextId  = contextId;
        activeTaskType   = taskType;
        contextOpen      = true;
        contextOpenedAt  = block.timestamp;
        emit ContextOpened(contextId, taskType, block.timestamp);
    }

    function closeContext() external onlyOwner requireOpenContext {
        bytes32 cid = activeContextId;
        activeContextId = bytes32(0);
        activeTaskType  = "";
        contextOpen     = false;
        emit ContextClosed(cid, block.timestamp);
        trustRegistry.recordSuccess(address(this), address(0), activeTaskType, 0);
    }

    // ─── Relay: lets owner set category limits in the wallet's name ─────────

    function relayCategoryLimit(
        string calldata category,
        uint256         limitPerTx
    ) external onlyOwner {
        // PolicyEngine.setCategoryLimit stores limits keyed to msg.sender (this wallet address).
        // Use a low-level call because IPolicyEngine only exposes validateSpend.
        (bool success,) = address(policyEngine).call(
            abi.encodeWithSignature("setCategoryLimit(string,uint256)", category, limitPerTx)
        );
        require(success, "ARC402: relayCategoryLimit failed");
    }

    // ─── Relay: lets the owner call attest in the wallet's name ──────────────

    function relayAttest(
        bytes32         id,
        string calldata action,
        string calldata reason,
        address         recipient,
        uint256         amount,
        address         token
    ) external onlyOwner {
        // Use the extended interface so Solidity generates correct ABI-encoded calldata
        IIntentAttestationFull(address(intentAttestation)).attest(
            id, action, reason, recipient, amount, token
        );
    }

    // ─── Spend ───────────────────────────────────────────────────────────────

    function executeSpend(
        address payable recipient,
        uint256         amount,
        string calldata category,
        bytes32         attestationId
    ) external onlyOwner requireOpenContext {
        require(recipient != address(0), "ARC402: zero address");
        require(
            intentAttestation.verify(attestationId, address(this), recipient, amount, address(0)),
            "ARC402: invalid intent attestation"
        );
        (bool valid, string memory reason) = policyEngine.validateSpend(
            address(this), category, amount, activeContextId
        );
        require(valid, reason);
        intentAttestation.consume(attestationId);
        emit SpendExecuted(recipient, amount, category, attestationId);
        (bool success,) = recipient.call{value: amount}("");
        require(success, "ARC402: transfer failed");
    }

    // ─── MAS Settlement proposal ─────────────────────────────────────────────

    function proposeMASSettlement(
        address      recipientWallet,
        uint256      amount,
        string calldata category,
        bytes32      attestationId
    ) external onlyOwner requireOpenContext {
        require(
            intentAttestation.verify(attestationId, address(this), recipientWallet, amount, address(0)),
            "ARC402: invalid attestation"
        );
        (bool valid, string memory reason) = policyEngine.validateSpend(
            address(this), category, amount, activeContextId
        );
        require(valid, reason);
        intentAttestation.consume(attestationId);
        emit SettlementProposed(recipientWallet, amount, attestationId);
    }

    // ─── Trust query ─────────────────────────────────────────────────────────

    function getTrustScore() external view returns (uint256) {
        return trustRegistry.getScore(address(this));
    }

    receive() external payable {}
}
