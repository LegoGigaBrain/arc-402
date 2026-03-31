// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IArenaPool
 * @notice Interface for the ArenaPool parimutuel prediction contract.
 *         Fully agentically governed — no human resolver, no admin keys.
 *         Resolution: WatchtowerRegistry quorum.
 *         Fee governance: ARC402Governance timelock.
 */
interface IArenaPool {
    // ─── Structs ─────────────────────────────────────────────────────────────

    struct Round {
        string  question;
        string  category;
        uint256 yesPot;
        uint256 noPot;
        uint256 stakingClosesAt;
        uint256 resolvesAt;
        bool    resolved;
        bool    outcome;
        bytes32 evidenceHash;
        address creator;
    }

    struct Entry {
        address agent;
        uint8   side;       // 0 = YES, 1 = NO
        uint256 amount;
        string  note;
        uint256 timestamp;
    }

    struct AgentStanding {
        address agent;
        uint256 roundsEntered;
        uint256 roundsWon;
        uint256 totalEarned;
        uint256 winRate;    // basis points (0–10_000)
    }

    // ─── Events ──────────────────────────────────────────────────────────────

    event RoundCreated(
        uint256 indexed roundId,
        address indexed creator,
        string          question,
        string          category,
        uint256         stakingClosesAt,
        uint256         resolvesAt
    );

    event RoundEntered(
        uint256 indexed roundId,
        address indexed agent,
        uint8           side,
        uint256         amount,
        string          note
    );

    event RoundResolved(
        uint256 indexed roundId,
        bool            outcome,
        bytes32         evidenceHash
    );

    event ResolutionAttested(
        uint256 indexed roundId,
        address indexed watchtower,
        bool            outcome,
        uint256         attestationCount
    );

    event RoundAutoResolved(
        uint256 indexed roundId,
        bool            outcome,
        uint256         quorumReached
    );

    event Claimed(
        uint256 indexed roundId,
        address indexed agent,
        uint256         amount
    );

    event EmergencyRefund(uint256 indexed roundId, address indexed agent, uint256 amount);
    event FeeBpsUpdated(uint256 indexed oldFeeBps, uint256 indexed newFeeBps);

    // ─── Functions ───────────────────────────────────────────────────────────

    function createRound(
        string calldata question,
        string calldata category,
        uint256         duration,
        uint256         minEntry
    ) external returns (uint256 roundId);

    function enterRound(
        uint256         roundId,
        uint8           side,
        uint256         amount,
        string calldata note
    ) external;

    function submitResolution(
        uint256 roundId,
        bool    outcome,
        bytes32 evidenceHash
    ) external;

    function claim(uint256 roundId) external;

    function emergencyRefund(uint256 roundId) external;

    function refundUnresolved(uint256 roundId) external;

    function setFeeBps(uint256 newFeeBps) external;

    // ─── Views ───────────────────────────────────────────────────────────────

    function getRound(uint256 roundId) external view returns (Round memory);

    function getUserEntry(uint256 roundId, address wallet) external view returns (Entry memory);

    function getStandings(uint256 offset, uint256 limit) external view returns (AgentStanding[] memory standings, uint256 total);

    function getAttestationCount(uint256 roundId, bool outcome) external view returns (uint256);

    function hasAttested(uint256 roundId, address watchtower) external view returns (bool);
}
