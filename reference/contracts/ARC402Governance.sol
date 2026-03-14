// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ARC402Governance
 * @notice Minimal N-of-M multisig for ARC-402 operator governance.
 *         It is intentionally generic: governance can call owned protocol
 *         contracts (token whitelist, parameter stores, capability registry)
 *         through standard calldata execution.
 */
contract ARC402Governance {
    struct Transaction {
        address target;
        uint256 value;
        bytes data;
        bool executed;
        uint256 confirmationCount;
    }

    mapping(address => bool) public isSigner;
    address[] public signers;
    uint256 public immutable threshold;

    Transaction[] private _transactions;
    mapping(uint256 => mapping(address => bool)) public isConfirmed;

    event TransactionSubmitted(uint256 indexed txId, address indexed signer, address indexed target, uint256 value, bytes data);
    event TransactionConfirmed(uint256 indexed txId, address indexed signer);
    event TransactionRevoked(uint256 indexed txId, address indexed signer);
    event TransactionExecuted(uint256 indexed txId, address indexed executor, bytes returnData);

    modifier onlySigner() {
        require(isSigner[msg.sender], "ARC402Governance: not signer");
        _;
    }

    modifier txExists(uint256 txId) {
        require(txId < _transactions.length, "ARC402Governance: unknown tx");
        _;
    }

    modifier notExecuted(uint256 txId) {
        require(!_transactions[txId].executed, "ARC402Governance: already executed");
        _;
    }

    constructor(address[] memory _signers, uint256 _threshold) payable {
        require(_signers.length > 0, "ARC402Governance: no signers");
        require(_threshold > 0 && _threshold <= _signers.length, "ARC402Governance: invalid threshold");

        for (uint256 i = 0; i < _signers.length; i++) {
            address signer = _signers[i];
            require(signer != address(0), "ARC402Governance: zero signer");
            require(!isSigner[signer], "ARC402Governance: duplicate signer");
            isSigner[signer] = true;
            signers.push(signer);
        }

        threshold = _threshold;
    }

    receive() external payable {}

    function submitTransaction(address target, uint256 value, bytes calldata data) external onlySigner returns (uint256 txId) {
        require(target != address(0), "ARC402Governance: zero target");
        txId = _transactions.length;
        _transactions.push(Transaction({
            target: target,
            value: value,
            data: data,
            executed: false,
            confirmationCount: 0
        }));

        emit TransactionSubmitted(txId, msg.sender, target, value, data);
        _confirm(txId, msg.sender);
    }

    function confirmTransaction(uint256 txId) external onlySigner txExists(txId) notExecuted(txId) {
        _confirm(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlySigner txExists(txId) notExecuted(txId) {
        require(isConfirmed[txId][msg.sender], "ARC402Governance: not confirmed");
        isConfirmed[txId][msg.sender] = false;
        _transactions[txId].confirmationCount -= 1;
        emit TransactionRevoked(txId, msg.sender);
    }

    function executeTransaction(uint256 txId) external onlySigner txExists(txId) notExecuted(txId) returns (bytes memory returnData) {
        Transaction storage txn = _transactions[txId];
        require(txn.confirmationCount >= threshold, "ARC402Governance: insufficient confirmations");

        txn.executed = true;
        (bool ok, bytes memory result) = txn.target.call{value: txn.value}(txn.data);
        require(ok, _getRevertMsg(result));

        emit TransactionExecuted(txId, msg.sender, result);
        return result;
    }

    function getTransaction(uint256 txId) external view txExists(txId) returns (Transaction memory) {
        return _transactions[txId];
    }

    function transactionCount() external view returns (uint256) {
        return _transactions.length;
    }

    function _confirm(uint256 txId, address signer) internal {
        require(!isConfirmed[txId][signer], "ARC402Governance: already confirmed");
        isConfirmed[txId][signer] = true;
        _transactions[txId].confirmationCount += 1;
        emit TransactionConfirmed(txId, signer);
    }

    /// @dev MA-13: Decode revert reason from low-level call returnData.
    ///      Handles three cases:
    ///        1. Empty / too short (<4 bytes) → "unknown revert"
    ///        2. Standard Error(string) (selector 0x08c379a0) → decoded string
    ///        3. Custom error or other → raw 4-byte selector returned as hex
    function _getRevertMsg(bytes memory returnData) internal pure returns (string memory) {
        if (returnData.length < 4) return "ARC402Governance: unknown revert";

        bytes4 selector;
        assembly {
            selector := mload(add(returnData, 0x20))
        }

        // Error(string) selector = 0x08c379a0
        if (selector == 0x08c379a0 && returnData.length >= 68) {
            assembly {
                returnData := add(returnData, 0x04)
            }
            return abi.decode(returnData, (string));
        }

        // Custom error or unknown: return raw selector as hex for debugging
        return string(abi.encodePacked(
            "ARC402Governance: custom error 0x",
            _toHexNibble(uint8(selector[0] >> 4)), _toHexNibble(uint8(selector[0] & 0x0f)),
            _toHexNibble(uint8(selector[1] >> 4)), _toHexNibble(uint8(selector[1] & 0x0f)),
            _toHexNibble(uint8(selector[2] >> 4)), _toHexNibble(uint8(selector[2] & 0x0f)),
            _toHexNibble(uint8(selector[3] >> 4)), _toHexNibble(uint8(selector[3] & 0x0f))
        ));
    }

    function _toHexNibble(uint8 v) internal pure returns (bytes1) {
        return v < 10 ? bytes1(v + 0x30) : bytes1(v + 0x57);
    }
}
