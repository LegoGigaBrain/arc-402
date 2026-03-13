// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ITrustRegistry.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title TrustRegistry
 * @notice On-chain trust scores for ARC-402 wallets (0–1000)
 * STATUS: DRAFT — not audited, do not use in production
 *
 * @dev Security: inherits Ownable2Step so ownership transfer requires the
 *      new owner to explicitly accept. Prevents single-step ownership hijack
 *      via phishing or malicious signed tx. (Fix T-02)
 */
contract TrustRegistry is ITrustRegistry, Ownable2Step {
    uint256 public constant MAX_SCORE = 1000;
    uint256 public constant INITIAL_SCORE = 100;
    uint256 public constant INCREMENT = 5;
    uint256 public constant DECREMENT = 20;
    uint256 public constant ARBITRATOR_SLASH_DECREMENT = 50;

    mapping(address => uint256) private scores;
    mapping(address => bool) private initialized;
    mapping(address => bool) public isAuthorizedUpdater;

    event WalletInitialized(address indexed wallet, uint256 score);
    event ScoreUpdated(address indexed wallet, uint256 oldScore, uint256 newScore, string reason);
    event UpdaterAdded(address indexed updater);
    event UpdaterRemoved(address indexed updater);

    // NOTE: OwnershipTransferred and OwnableUnauthorizedAccount events/errors
    //       are provided by OpenZeppelin Ownable — no manual redeclaration needed.

    modifier onlyUpdater() {
        require(isAuthorizedUpdater[msg.sender], "TrustRegistry: not authorized updater");
        _;
    }

    /// @dev Ownable(msg.sender) sets the deployer as initial owner via Ownable2Step → Ownable.
    constructor() Ownable(msg.sender) {
        isAuthorizedUpdater[msg.sender] = true;
    }

    function addUpdater(address updater) external onlyOwner {
        isAuthorizedUpdater[updater] = true;
        emit UpdaterAdded(updater);
    }

    function removeUpdater(address updater) external onlyOwner {
        isAuthorizedUpdater[updater] = false;
        emit UpdaterRemoved(updater);
    }

    // transferOwnership() and acceptOwnership() are provided by Ownable2Step.
    // renounceOwnership() is provided by Ownable.
    // Two-step flow: current owner calls transferOwnership(newOwner),
    //                new owner calls acceptOwnership() to complete the transfer.

    function initWallet(address wallet) external {
        if (!initialized[wallet]) {
            initialized[wallet] = true;
            scores[wallet] = INITIAL_SCORE;
            emit WalletInitialized(wallet, INITIAL_SCORE);
        }
    }

    function getScore(address wallet) external view returns (uint256) {
        if (!initialized[wallet]) return 0;
        return scores[wallet];
    }

    function recordSuccess(
        address wallet,
        address /*counterparty*/,
        string calldata /*capability*/,
        uint256 /*agreementValueWei*/
    ) external onlyUpdater {
        if (!initialized[wallet]) {
            initialized[wallet] = true;
            scores[wallet] = INITIAL_SCORE;
        }
        uint256 oldScore = scores[wallet];
        uint256 newScore = oldScore + INCREMENT > MAX_SCORE ? MAX_SCORE : oldScore + INCREMENT;
        scores[wallet] = newScore;
        emit ScoreUpdated(wallet, oldScore, newScore, "success");
    }

    function recordAnomaly(
        address wallet,
        address /*counterparty*/,
        string calldata /*capability*/,
        uint256 /*agreementValueWei*/
    ) external onlyUpdater {
        if (!initialized[wallet]) {
            initialized[wallet] = true;
            scores[wallet] = INITIAL_SCORE;
        }
        uint256 oldScore = scores[wallet];
        uint256 newScore = oldScore < DECREMENT ? 0 : oldScore - DECREMENT;
        scores[wallet] = newScore;
        emit ScoreUpdated(wallet, oldScore, newScore, "anomaly");
    }


    /// @notice Slash an arbitrator's trust score for misconduct.
    /// @dev Caller must be a registered authorized updater (e.g. DisputeArbitration).
    ///      Uses a heavier penalty (50 points) than standard anomaly (20 points).
    function recordArbitratorSlash(
        address arbitrator,
        string calldata reason
    ) external onlyUpdater {
        if (!initialized[arbitrator]) {
            initialized[arbitrator] = true;
            scores[arbitrator] = INITIAL_SCORE;
        }
        uint256 oldScore = scores[arbitrator];
        uint256 newScore = oldScore < ARBITRATOR_SLASH_DECREMENT ? 0 : oldScore - ARBITRATOR_SLASH_DECREMENT;
        scores[arbitrator] = newScore;
        emit ScoreUpdated(arbitrator, oldScore, newScore, reason);
    }

    function getTrustLevel(address wallet) external view returns (string memory) {
        uint256 score = scores[wallet];
        if (!initialized[wallet]) return "probationary";
        if (score < 100) return "probationary";
        if (score < 300) return "restricted";
        if (score < 600) return "standard";
        if (score < 800) return "elevated";
        return "autonomous";
    }
}
