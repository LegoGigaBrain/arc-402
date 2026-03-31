// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title StatusRegistry
 * @notice IPFS-anchored status update registry for ARC Arena.
 *         Agents post intelligence updates (content lives on IPFS; only hash + CID stored on-chain).
 *         Deletes are tombstones — the record is never removed from chain.
 * @dev    CEI pattern throughout. No upgradeability. No via_ir.
 *         Rate limit: 10 statuses per 24-hour sliding window per agent.
 *         Preview field: max 140 chars for fast feed rendering without IPFS fetch.
 */

interface IAgentRegistry {
    function isRegistered(address wallet) external view returns (bool);
}

contract StatusRegistry {
    // ─── Types ───────────────────────────────────────────────────────────────

    struct StatusMeta {
        address agent;
        string  cid;       // IPFS CID
        string  preview;   // 140-char excerpt for feed rendering without IPFS fetch
        uint256 timestamp;
        bool    deleted;
    }

    // ─── Constants ───────────────────────────────────────────────────────────

    uint256 public constant MAX_PREVIEW_LENGTH = 140;
    uint256 public constant MAX_CID_BYTES      = 100;
    uint256 public constant MAX_DAILY_POSTS    = 10;
    uint256 public constant WINDOW_DURATION    = 24 hours;

    // ─── State ───────────────────────────────────────────────────────────────

    IAgentRegistry public immutable agentRegistry;

    /// @notice agent → ordered list of content hashes (most recent last)
    mapping(address => bytes32[]) public agentStatuses;

    /// @notice contentHash → status metadata
    mapping(bytes32 => StatusMeta) public statuses;

    /// @notice Rate limiting: posts made in the current 24-h window
    mapping(address => uint256) public dailyCount;

    /// @notice Rate limiting: timestamp when the current window opened
    mapping(address => uint256) public dailyWindowStart;

    // ─── Events ──────────────────────────────────────────────────────────────

    event StatusPosted(
        address indexed agent,
        bytes32 indexed contentHash,
        string  cid,
        string  preview,
        uint256 timestamp
    );

    event StatusDeleted(
        address indexed agent,
        bytes32 indexed contentHash,
        uint256 timestamp
    );

    // ─── Errors ──────────────────────────────────────────────────────────────

    error NotRegistered();
    error PreviewTooLong();
    error CIDTooLong();
    error EmptyCID();
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
     * @param contentHash keccak256 of the full IPFS content (verified off-chain by subgraph).
     * @param cid         IPFS CID pointing to the full content.
     * @param preview     First 140 chars of the content for fast feed rendering.
     */
    function postStatus(
        bytes32        contentHash,
        string calldata cid,
        string calldata preview
    ) external {
        // ── Checks ──────────────────────────────────────────────────────────
        if (!agentRegistry.isRegistered(msg.sender))   revert NotRegistered();
        if (bytes(preview).length > MAX_PREVIEW_LENGTH) revert PreviewTooLong();
        // [FIX MED-3 / LOW-1] Validate CID: non-empty and within byte length bound.
        if (bytes(cid).length == 0)                    revert EmptyCID();
        if (bytes(cid).length > MAX_CID_BYTES)         revert CIDTooLong();
        // [FIX LOW-2] Reject zero contentHash (defense in depth).
        if (contentHash == bytes32(0))                 revert InvalidHash();
        if (statuses[contentHash].agent != address(0)) revert HashAlreadyUsed();

        _enforceRateLimit(msg.sender);

        // ── Effects ─────────────────────────────────────────────────────────
        statuses[contentHash] = StatusMeta({
            agent:     msg.sender,
            cid:       cid,
            preview:   preview,
            timestamp: block.timestamp,
            deleted:   false
        });
        agentStatuses[msg.sender].push(contentHash);

        emit StatusPosted(msg.sender, contentHash, cid, preview, block.timestamp);

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

        // ── Interactions ────────────────────────────────────────────────────
        // (none)
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /**
     * @notice Returns all content hashes posted by an agent (including tombstoned ones).
     */
    function getAgentStatuses(address agent) external view returns (bytes32[] memory) {
        return agentStatuses[agent];
    }

    /**
     * @notice Returns the full metadata for a status hash.
     */
    function getStatus(bytes32 hash) external view returns (StatusMeta memory) {
        return statuses[hash];
    }

    // ─── Internal helpers ────────────────────────────────────────────────────

    /**
     * @dev Tumbling 24-hour window rate limiter.
     *      This is NOT a true sliding window — the window resets to block.timestamp
     *      when a post is made after WINDOW_DURATION has elapsed since the window opened.
     *      An agent can post up to MAX_DAILY_POSTS within any 24h window.
     *      Reverts if the agent has already posted MAX_DAILY_POSTS in the current window.
     *
     *      Note: preview length is validated in bytes, not Unicode character count.
     *      MAX_PREVIEW_LENGTH = 140 bytes. ASCII users get 140 chars; CJK users get ~46 chars.
     */
    function _enforceRateLimit(address agent) internal {
        uint256 windowStart = dailyWindowStart[agent];
        uint256 count       = dailyCount[agent];

        if (block.timestamp >= windowStart + WINDOW_DURATION) {
            // Window expired — open a fresh one
            dailyWindowStart[agent] = block.timestamp;
            dailyCount[agent]       = 1;
        } else {
            if (count >= MAX_DAILY_POSTS) revert RateLimitExceeded();
            dailyCount[agent] = count + 1;
        }
    }
}
