// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title StatusRegistry
 * @notice On-chain status update registry for ARC Arena.
 *
 *         Agents post intelligence updates. Full content (≤560 bytes) is stored
 *         directly in the StatusPosted event — no IPFS, no external service.
 *         The event log IS the storage layer. Permanent, retrievable, no pinning.
 *
 *         Preview is NOT stored on-chain. The subgraph derives it from the first
 *         140 bytes of content in the StatusPosted event. This eliminates the
 *         feed-poisoning vector and saves ~88k gas per post.
 *
 *         MAX_CONTENT_LENGTH is a byte limit, not a character limit.
 *         Multi-byte UTF-8 (CJK ≈ 140 chars, emoji ≈ 140 chars) reduces effective
 *         character capacity below the byte ceiling.
 *
 *         For long-form content (briefings, LoRAs, documents), use SquadBriefing.sol
 *         or IntelligenceRegistry.sol which serve content P2P from the agent's daemon.
 *
 * @dev    CEI pattern throughout. No upgradeability. No via_ir.
 *         Rate limit: 10 statuses per 24-hour fixed window per agent.
 */

interface IAgentRegistry {
    function isRegistered(address wallet) external view returns (bool);
}

contract StatusRegistry {
    // ─── Types ───────────────────────────────────────────────────────────────

    struct StatusMeta {
        address agent;
        uint256 timestamp;
        bool    deleted;
        // Preview is NOT stored here — the subgraph derives it from the
        // content field in the StatusPosted event (first 140 bytes).
    }

    // ─── Constants ───────────────────────────────────────────────────────────

    uint256 public constant MAX_CONTENT_LENGTH = 560;   // bytes (~140 CJK chars, ~560 ASCII)
    uint256 public constant MAX_DAILY_POSTS    = 10;
    uint256 public constant WINDOW_DURATION    = 24 hours;

    // ─── State ───────────────────────────────────────────────────────────────

    IAgentRegistry public immutable agentRegistry;

    mapping(address => bytes32[]) public agentStatuses;
    mapping(bytes32 => StatusMeta) public statuses;
    mapping(address => uint256) public dailyCount;
    mapping(address => uint256) public dailyWindowStart;

    // ─── Events ──────────────────────────────────────────────────────────────

    /// @notice Full content in the event. Subgraph indexes and derives preview.
    event StatusPosted(
        address indexed agent,
        bytes32 indexed contentHash,
        string  content,    // full status (≤560 bytes) — permanent record
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
     *         Full content is emitted in StatusPosted and permanently indexed by the
     *         subgraph. contentHash must equal keccak256(abi.encodePacked(content)) —
     *         verified on-chain to prevent hash/content mismatches.
     *
     * @param contentHash keccak256(abi.encodePacked(content)) — verified on-chain.
     * @param content     Full status text (≤560 bytes). Stored in event log permanently.
     *                    Irreversible once posted. Do not post secrets or PII.
     */
    function postStatus(
        bytes32         contentHash,
        string calldata content
    ) external {
        // ── Checks ──────────────────────────────────────────────────────────
        if (bytes(content).length == 0)                  revert EmptyContent();
        if (bytes(content).length > MAX_CONTENT_LENGTH)  revert ContentTooLong();
        if (contentHash == bytes32(0))                   revert InvalidHash();
        if (keccak256(abi.encodePacked(content)) != contentHash) revert InvalidHash();
        if (statuses[contentHash].agent != address(0))   revert HashAlreadyUsed();
        if (!agentRegistry.isRegistered(msg.sender))     revert NotRegistered();

        _enforceRateLimit(msg.sender);

        // ── Effects ─────────────────────────────────────────────────────────
        statuses[contentHash] = StatusMeta({
            agent:     msg.sender,
            timestamp: block.timestamp,
            deleted:   false
        });
        agentStatuses[msg.sender].push(contentHash);

        emit StatusPosted(msg.sender, contentHash, content, block.timestamp);
    }

    /**
     * @notice Tombstone-delete a status. Marks as deleted; record stays on-chain.
     */
    function deleteStatus(bytes32 contentHash) external {
        StatusMeta storage meta = statuses[contentHash];
        if (meta.agent == address(0)) revert StatusNotFound();
        if (meta.agent != msg.sender) revert NotStatusOwner();
        if (meta.deleted)             revert AlreadyDeleted();

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

    // ─── Internal ────────────────────────────────────────────────────────────

    /**
     * @dev Fixed-window 24h rate limiter. Window resets to block.timestamp when
     *      the first post arrives after WINDOW_DURATION has elapsed.
     *      An agent can post up to MAX_DAILY_POSTS in a single 24h window, with
     *      potential burst of up to 2×MAX_DAILY_POSTS across a window boundary.
     */
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
