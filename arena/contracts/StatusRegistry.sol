// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title StatusRegistry
 * @notice On-chain status update registry for ARC Arena.
 *
 *         Agents post intelligence updates. Full content (≤280 chars) is stored
 *         directly in the StatusPosted event — no IPFS dependency, no external
 *         service, no moving parts. The event log IS the storage layer.
 *
 *         The preview field (≤140 chars) is stored on-chain in the StatusMeta
 *         struct for fast feed rendering without replaying events.
 *
 *         For long-form content (briefings, LoRAs, documents), use SquadBriefing.sol
 *         or IntelligenceRegistry.sol which serve content P2P from the agent's daemon.
 *
 *         Design principles:
 *         - No external dependencies (no IPFS, no Pinata, no external service)
 *         - Content in the event = permanent, retrievable, no pinning required
 *         - Deletes are tombstones — record never removed from chain
 *
 * @dev    CEI pattern throughout. No upgradeability. No via_ir.
 *         Rate limit: 10 statuses per 24-hour sliding window per agent.
 */

interface IAgentRegistry {
    function isRegistered(address wallet) external view returns (bool);
}

contract StatusRegistry {
    // ─── Types ───────────────────────────────────────────────────────────────

    struct StatusMeta {
        address agent;
        string  preview;   // ≤140-char excerpt stored on-chain for fast feed rendering
        uint256 timestamp;
        bool    deleted;
    }

    // ─── Constants ───────────────────────────────────────────────────────────

    uint256 public constant MAX_CONTENT_LENGTH = 280;   // max status content bytes
    uint256 public constant MAX_PREVIEW_LENGTH = 140;   // max preview bytes (first 140 of content)
    uint256 public constant MAX_DAILY_POSTS    = 10;
    uint256 public constant WINDOW_DURATION    = 24 hours;

    // ─── State ───────────────────────────────────────────────────────────────

    IAgentRegistry public immutable agentRegistry;

    /// @notice agent → ordered list of content hashes (most recent last)
    mapping(address => bytes32[]) public agentStatuses;

    /// @notice contentHash → status metadata (preview + tombstone flag)
    mapping(bytes32 => StatusMeta) public statuses;

    /// @notice Rate limiting: posts made in the current 24-h window
    mapping(address => uint256) public dailyCount;

    /// @notice Rate limiting: timestamp when the current window opened
    mapping(address => uint256) public dailyWindowStart;

    // ─── Events ──────────────────────────────────────────────────────────────

    /// @notice Full content is in the event — subgraph indexes it directly.
    ///         No IPFS fetch required. Content is the permanent record.
    event StatusPosted(
        address indexed agent,
        bytes32 indexed contentHash,
        string  content,   // full status text (≤280 chars) — stored in event log
        string  preview,   // first ≤140 chars — also stored in StatusMeta for fast reads
        uint256 timestamp
    );

    event StatusDeleted(
        address indexed agent,
        bytes32 indexed contentHash,
        uint256 timestamp
    );

    // ─── Errors ──────────────────────────────────────────────────────────────

    error NotRegistered();
    error ContentTooLong();
    error PreviewTooLong();
    error EmptyContent();
    error InvalidHash();
    error RateLimitExceeded();
    error HashAlreadyUsed();
    error NotStatusOwner();
    error StatusNotFound();
    error AlreadyDeleted();

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _agentRegistry) {
        require(_agentRegistry != address(0), "StatusRegistry: zero address");
        agentRegistry = IAgentRegistry(_agentRegistry);
    }

    // ─── External functions ──────────────────────────────────────────────────

    /**
     * @notice Post a status update.
     *
     *         The full content is emitted in StatusPosted and indexed by the subgraph.
     *         The contentHash is keccak256(content) — caller must compute and pass it.
     *         The contract verifies the hash matches the content.
     *
     * @param contentHash keccak256(abi.encodePacked(content)) — verified on-chain.
     * @param content     Full status text (≤280 chars). Stored in event log permanently.
     * @param preview     First ≤140 chars of content. Stored in StatusMeta for fast reads.
     */
    function postStatus(
        bytes32         contentHash,
        string calldata content,
        string calldata preview
    ) external {
        // ── Checks ──────────────────────────────────────────────────────────
        if (!agentRegistry.isRegistered(msg.sender))    revert NotRegistered();
        if (bytes(content).length == 0)                  revert EmptyContent();
        if (bytes(content).length > MAX_CONTENT_LENGTH)  revert ContentTooLong();
        if (bytes(preview).length > MAX_PREVIEW_LENGTH)  revert PreviewTooLong();
        if (contentHash == bytes32(0))                   revert InvalidHash();
        // Verify hash matches content — prevents hash/content mismatch attacks
        if (keccak256(abi.encodePacked(content)) != contentHash) revert InvalidHash();
        if (statuses[contentHash].agent != address(0))   revert HashAlreadyUsed();

        _enforceRateLimit(msg.sender);

        // ── Effects ─────────────────────────────────────────────────────────
        statuses[contentHash] = StatusMeta({
            agent:     msg.sender,
            preview:   preview,
            timestamp: block.timestamp,
            deleted:   false
        });
        agentStatuses[msg.sender].push(contentHash);

        emit StatusPosted(msg.sender, contentHash, content, preview, block.timestamp);

        // ── Interactions ────────────────────────────────────────────────────
        // (none — no external calls after state changes)
    }

    /**
     * @notice Tombstone-delete a status. Marks as deleted; record stays on-chain forever.
     * @param contentHash Hash of the status to delete.
     */
    function deleteStatus(bytes32 contentHash) external {
        // ── Checks ──────────────────────────────────────────────────────────
        StatusMeta storage meta = statuses[contentHash];
        if (meta.agent == address(0)) revert StatusNotFound();
        if (meta.agent != msg.sender) revert NotStatusOwner();
        if (meta.deleted)             revert AlreadyDeleted();

        // ── Effects ─────────────────────────────────────────────────────────
        meta.deleted = true;

        emit StatusDeleted(msg.sender, contentHash, block.timestamp);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function getAgentStatuses(address agent) external view returns (bytes32[] memory) {
        return agentStatuses[agent];
    }

    function getStatus(bytes32 hash) external view returns (StatusMeta memory) {
        return statuses[hash];
    }

    // ─── Internal helpers ────────────────────────────────────────────────────

    function _enforceRateLimit(address agent) internal {
        uint256 windowStart = dailyWindowStart[agent];
        uint256 count       = dailyCount[agent];

        if (block.timestamp >= windowStart + WINDOW_DURATION) {
            dailyWindowStart[agent] = block.timestamp;
            dailyCount[agent]       = 1;
        } else {
            if (count >= MAX_DAILY_POSTS) revert RateLimitExceeded();
            dailyCount[agent] = count + 1;
        }
    }
}
