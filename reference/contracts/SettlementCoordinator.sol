// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title SettlementCoordinator
 * @notice Multi-Agent Settlement coordinator for ARC-402
 *         Supports both ETH and ERC-20 (e.g. USDC) bilateral settlement.
 * STATUS: DRAFT — not audited, do not use in production
 */
contract SettlementCoordinator {
    using SafeERC20 for IERC20;

    enum ProposalStatus { PENDING, ACCEPTED, REJECTED, EXECUTED, EXPIRED }

    /// @notice Maximum time a proposal may remain ACCEPTED before execution.
    ///         After this window, anyone may call expireAccepted() to clean it up.
    uint256 public constant EXECUTION_WINDOW = 7 days;

    struct Proposal {
        bytes32 proposalId;
        address fromWallet;
        address toWallet;
        uint256 amount;
        address token;          // address(0) for ETH, token address for ERC-20
        bytes32 intentId;
        uint256 expiresAt;
        uint256 acceptedAt;     // set when status moves to ACCEPTED; starts execution window clock
        ProposalStatus status;
        string rejectionReason;
    }

    mapping(bytes32 => Proposal) private proposals;
    mapping(bytes32 => bool) private proposalExists;

    event ProposalCreated(bytes32 indexed proposalId, address indexed from, address indexed to, uint256 amount, address token);
    event ProposalAccepted(bytes32 indexed proposalId);
    event ProposalRejected(bytes32 indexed proposalId, string reason);
    event ProposalExecuted(bytes32 indexed proposalId, uint256 amount);
    event ProposalExpired(bytes32 indexed proposalId);

    function propose(
        address fromWallet,
        address toWallet,
        uint256 amount,
        address token,
        bytes32 intentId,
        uint256 expiresAt
    ) external returns (bytes32 proposalId) {
        // SC-AUTH: caller must be the wallet they claim to represent.
        // ARC402Wallet.proposeMASSettlement() calls this with address(this), so
        // msg.sender == fromWallet is always satisfied for legitimate wallet calls.
        require(msg.sender == fromWallet, "SC: caller must be fromWallet");
        proposalId = keccak256(abi.encodePacked(fromWallet, toWallet, amount, token, intentId, block.timestamp));
        require(!proposalExists[proposalId], "SettlementCoordinator: proposal exists");

        proposals[proposalId] = Proposal({
            proposalId: proposalId,
            fromWallet: fromWallet,
            toWallet: toWallet,
            amount: amount,
            token: token,
            intentId: intentId,
            expiresAt: expiresAt,
            acceptedAt: 0,
            status: ProposalStatus.PENDING,
            rejectionReason: ""
        });
        proposalExists[proposalId] = true;

        emit ProposalCreated(proposalId, fromWallet, toWallet, amount, token);
        return proposalId;
    }

    function accept(bytes32 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(proposalExists[proposalId], "SettlementCoordinator: not found");
        require(p.status == ProposalStatus.PENDING, "SettlementCoordinator: not pending");
        require(block.timestamp <= p.expiresAt, "SettlementCoordinator: expired");
        require(msg.sender == p.toWallet, "SettlementCoordinator: not recipient");

        p.status = ProposalStatus.ACCEPTED;
        p.acceptedAt = block.timestamp;
        emit ProposalAccepted(proposalId);
    }

    /**
     * @notice Expire a proposal that has been ACCEPTED but not executed within EXECUTION_WINDOW.
     *         Anyone may call this to clean up stale accepted proposals.
     * @param proposalId The proposal to expire.
     */
    function expireAccepted(bytes32 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(proposalExists[proposalId], "SettlementCoordinator: not found");
        require(p.status == ProposalStatus.ACCEPTED, "SettlementCoordinator: not accepted");
        require(
            block.timestamp > p.acceptedAt + EXECUTION_WINDOW,
            "SettlementCoordinator: execution window open"
        );
        p.status = ProposalStatus.EXPIRED;
        emit ProposalExpired(proposalId);
    }

    function reject(bytes32 proposalId, string calldata reason) external {
        Proposal storage p = proposals[proposalId];
        require(proposalExists[proposalId], "SettlementCoordinator: not found");
        require(p.status == ProposalStatus.PENDING, "SettlementCoordinator: not pending");
        require(msg.sender == p.toWallet, "SettlementCoordinator: not recipient");

        p.status = ProposalStatus.REJECTED;
        p.rejectionReason = reason;
        emit ProposalRejected(proposalId, reason);
    }

    function execute(bytes32 proposalId) external payable {
        Proposal storage p = proposals[proposalId];
        require(proposalExists[proposalId], "SettlementCoordinator: not found");
        require(p.status == ProposalStatus.ACCEPTED, "SettlementCoordinator: not accepted");
        require(block.timestamp <= p.expiresAt, "SettlementCoordinator: expired");
        require(
            block.timestamp <= p.acceptedAt + EXECUTION_WINDOW,
            "SettlementCoordinator: execution window expired"
        );
        require(msg.sender == p.fromWallet, "SettlementCoordinator: not sender");

        p.status = ProposalStatus.EXECUTED;
        emit ProposalExecuted(proposalId, p.amount);

        if (p.token == address(0)) {
            // ETH settlement
            require(msg.value == p.amount, "SettlementCoordinator: wrong amount");
            (bool success,) = p.toWallet.call{value: p.amount}("");
            require(success, "SettlementCoordinator: transfer failed");
        } else {
            // ERC-20 settlement (e.g. USDC)
            // msg.sender == p.fromWallet is enforced above; use msg.sender to avoid
            // arbitrary-from-in-transferFrom Slither finding.
            require(msg.value == 0, "SettlementCoordinator: ETH not accepted for token proposal");
            IERC20(p.token).safeTransferFrom(msg.sender, p.toWallet, p.amount);
        }
    }

    function getProposal(bytes32 proposalId) external view returns (
        address fromWallet,
        address toWallet,
        uint256 amount,
        address token,
        bytes32 intentId,
        uint256 expiresAt,
        uint256 acceptedAt,
        ProposalStatus status,
        string memory rejectionReason
    ) {
        require(proposalExists[proposalId], "SettlementCoordinator: not found");
        Proposal storage p = proposals[proposalId];
        return (p.fromWallet, p.toWallet, p.amount, p.token, p.intentId, p.expiresAt, p.acceptedAt, p.status, p.rejectionReason);
    }

    function checkExpiry(bytes32 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(proposalExists[proposalId], "SettlementCoordinator: not found");
        require(p.status == ProposalStatus.PENDING, "SettlementCoordinator: not pending");
        require(block.timestamp > p.expiresAt, "SettlementCoordinator: not expired");
        p.status = ProposalStatus.EXPIRED;
        emit ProposalExpired(proposalId);
    }
}
