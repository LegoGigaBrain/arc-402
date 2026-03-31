// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./interfaces/IArenaPool.sol";

// ─── Minimal interfaces ───────────────────────────────────────────────────────

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IAgentRegistry {
    function isRegistered(address wallet) external view returns (bool);
}

interface IPolicyEngine {
    function validateSpend(address agent, string calldata category, uint256 amount, address token) external view;
    function recordSpend(address agent, string calldata category, uint256 amount, address token) external;
}

/**
 * @title ArenaPool
 * @notice Parimutuel prediction pools for ARC Arena.
 *
 *         Agents stake USDC on binary YES/NO outcomes. Winners split the losing
 *         pot proportionally to their stake share, minus a protocol fee.
 *
 *         Integration points:
 *         - AgentRegistry: entry requires a registered ARC-402 agent wallet
 *         - PolicyEngine: validates and records each spend against the agent's spend limits
 *
 *         Security:
 *         - CEI pattern throughout (effects before interactions on every function)
 *         - Reentrancy guard on all state-changing functions
 *         - Staking closes 30 min before resolution (anti front-running)
 *         - 1 entry per agent per round
 *         - Freeze mechanism for disputed rounds
 *
 * @dev    No upgradeable proxy. No via_ir. Immutable contract.
 *         Fee: configurable 0–10% (default 3%), paid to treasury on claim.
 */
contract ArenaPool is IArenaPool {

    // ─── Reentrancy guard ─────────────────────────────────────────────────────

    uint256 private _reentrancyStatus;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED     = 2;

    modifier nonReentrant() {
        require(_reentrancyStatus != _ENTERED, "ArenaPool: reentrant call");
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    // ─── Access modifiers ─────────────────────────────────────────────────────

    modifier onlyResolver() {
        require(msg.sender == resolver, "ArenaPool: not resolver");
        _;
    }

    // ─── Immutables ───────────────────────────────────────────────────────────

    IERC20           public immutable usdc;
    IPolicyEngine    public immutable policyEngine;
    IAgentRegistry   public immutable agentRegistry;
    address          public immutable resolver;
    address          public immutable treasury;

    // ─── Constants ───────────────────────────────────────────────────────────

    uint256 public constant STAKING_CUTOFF_BEFORE_RESOLVE = 30 minutes;
    uint256 public constant MAX_FEE_BPS                   = 1_000;  // 10%
    uint256 public constant DEFAULT_MIN_ENTRY             = 1_000_000; // 1 USDC (6 decimals)
    uint256 public constant NOTE_MAX_BYTES                = 280;
    uint256 public constant BPS_DENOMINATOR               = 10_000;
    uint256 public constant MAX_FREEZE_DURATION           = 30 days;
    uint256 public constant RESOLUTION_GRACE_PERIOD       = 72 hours;

    // ─── Protocol fee ─────────────────────────────────────────────────────────

    /// @notice Fee in basis points deducted from the winning pot. Configurable up to MAX_FEE_BPS.
    uint256 public feeBps;

    // ─── Round storage ────────────────────────────────────────────────────────

    uint256 private _nextRoundId;

    /// @notice roundId → round data
    mapping(uint256 => Round) private _rounds;

    /// @notice roundId → entrant address → entry
    mapping(uint256 => mapping(address => Entry)) private _entries;

    /// @notice roundId → list of entrant addresses (for standings computation)
    mapping(uint256 => address[]) private _entrants;

    /// @notice roundId → frozen flag
    mapping(uint256 => bool) private _frozen;

    /// @notice roundId → agent → has claimed
    mapping(uint256 => mapping(address => bool)) private _claimed;

    // ─── Standings storage ────────────────────────────────────────────────────

    /// @notice Ordered list of agents that have participated (for getStandings())
    address[] private _standingAgents;

    /// @notice Whether an agent is already in _standingAgents
    mapping(address => bool) private _inStandings;

    struct AgentStats {
        uint256 roundsEntered;
        uint256 roundsWon;
        uint256 totalEarned;
    }

    mapping(address => AgentStats) private _stats;

    // ─── Errors ───────────────────────────────────────────────────────────────

    error ZeroAddress();
    error FeeTooHigh();
    error InvalidSide();
    error BelowMinEntry();
    error NotRegistered();
    error StakingClosed();
    error RoundIsFrozen();
    error AlreadyEntered();
    error RoundNotFound();
    error AlreadyResolved();
    error NotResolved();
    error NothingToClaim();
    error AlreadyClaimed();
    error NoteTooLong();
    error InvalidDuration();
    error TooEarlyToResolve();
    error FreezePeriodActive();
    error GracePeriodActive();

    // ─── Constructor ─────────────────────────────────────────────────────────

    /**
     * @param _usdc          USDC token address (6 decimals on Base)
     * @param _policyEngine  PolicyEngine contract address
     * @param _agentRegistry AgentRegistry contract address
     * @param _resolver      Designated resolver (protocol multisig — upgradeable to watchtower quorum)
     * @param _treasury      Protocol fee destination
     * @param _feeBps        Initial fee in basis points (e.g. 300 = 3%)
     */
    constructor(
        address _usdc,
        address _policyEngine,
        address _agentRegistry,
        address _resolver,
        address _treasury,
        uint256 _feeBps
    ) {
        if (_usdc          == address(0)) revert ZeroAddress();
        if (_policyEngine  == address(0)) revert ZeroAddress();
        if (_agentRegistry == address(0)) revert ZeroAddress();
        if (_resolver      == address(0)) revert ZeroAddress();
        if (_treasury      == address(0)) revert ZeroAddress();
        if (_feeBps > MAX_FEE_BPS)        revert FeeTooHigh();

        usdc          = IERC20(_usdc);
        policyEngine  = IPolicyEngine(_policyEngine);
        agentRegistry = IAgentRegistry(_agentRegistry);
        resolver      = _resolver;
        treasury      = _treasury;
        feeBps        = _feeBps;

        _reentrancyStatus = _NOT_ENTERED;
    }

    // ─── Round lifecycle ──────────────────────────────────────────────────────

    /**
     * @notice Create a new prediction round.
     * @param question  Human-readable question (e.g. "BTC 24h close above $70,000?")
     * @param category  Category tag (e.g. "market.crypto")
     * @param duration  Seconds until the round resolves from now.
     *                  Staking closes 30 min before that.
     * @param minEntry  Minimum USDC amount per entry. Pass 0 to use the default (1 USDC).
     * @return roundId  The ID of the created round.
     */
    function createRound(
        string calldata question,
        string calldata category,
        uint256         duration,
        uint256         minEntry
    ) external nonReentrant returns (uint256 roundId) {
        // ── Checks ──────────────────────────────────────────────────────────
        if (duration <= STAKING_CUTOFF_BEFORE_RESOLVE) revert InvalidDuration();
        if (!agentRegistry.isRegistered(msg.sender))   revert NotRegistered();

        uint256 effectiveMin = minEntry == 0 ? DEFAULT_MIN_ENTRY : minEntry;

        // ── Effects ─────────────────────────────────────────────────────────
        roundId = _nextRoundId++;

        uint256 resolvesAt      = block.timestamp + duration;
        uint256 stakingClosesAt = resolvesAt - STAKING_CUTOFF_BEFORE_RESOLVE;

        _rounds[roundId] = Round({
            question:       question,
            category:       category,
            yesPot:         0,
            noPot:          0,
            stakingClosesAt: stakingClosesAt,
            resolvesAt:     resolvesAt,
            resolved:       false,
            outcome:        false,
            evidenceHash:   bytes32(0),
            creator:        msg.sender
        });

        // Store minEntry in the round via a side mapping isn't in the struct,
        // so we repurpose evidenceHash slot cleverly — but actually we track it separately.
        // Since minEntry isn't in the spec struct, we store it in a separate mapping.
        _roundMinEntry[roundId] = effectiveMin;

        emit RoundCreated(roundId, msg.sender, question, category, stakingClosesAt, resolvesAt);

        // ── Interactions ────────────────────────────────────────────────────
        // (none)
    }

    /// @dev Per-round minimum entry amount (not in spec struct, stored separately).
    mapping(uint256 => uint256) private _roundMinEntry;

    /// @dev Per-round fee snapshot — locked at resolution time to prevent fee frontrun.
    mapping(uint256 => uint256) private _roundFeeBps;

    /// @dev Per-round freeze timestamp (for emergency refund timeout).
    mapping(uint256 => uint256) public frozenAt;

    /**
     * @notice Enter a prediction round by staking USDC on YES or NO.
     * @param roundId  Round to enter.
     * @param side     0 = YES, 1 = NO.
     * @param amount   USDC amount to stake (6 decimals, must meet round minimum).
     * @param note     Optional conviction note (max 280 bytes).
     */
    function enterRound(
        uint256         roundId,
        uint8           side,
        uint256         amount,
        string calldata note
    ) external nonReentrant {
        // ── Checks ──────────────────────────────────────────────────────────
        if (side > 1)                                         revert InvalidSide();
        if (bytes(note).length > NOTE_MAX_BYTES)              revert NoteTooLong();

        Round storage round = _rounds[roundId];
        // Round exists if resolvesAt > 0 (freshly created rounds always have resolvesAt set)
        if (round.resolvesAt == 0)                            revert RoundNotFound();
        if (round.resolved)                                   revert AlreadyResolved();
        if (_frozen[roundId])                                 revert RoundIsFrozen();
        if (block.timestamp >= round.stakingClosesAt)         revert StakingClosed();

        uint256 minEntry = _roundMinEntry[roundId];
        if (amount < minEntry)                                revert BelowMinEntry();
        if (_entries[roundId][msg.sender].agent != address(0)) revert AlreadyEntered();
        if (!agentRegistry.isRegistered(msg.sender))          revert NotRegistered();

        // PolicyEngine: validate then record spend (revert if not whitelisted / over limit)
        policyEngine.validateSpend(msg.sender, "arena", amount, address(usdc));

        // ── Effects ─────────────────────────────────────────────────────────
        _entries[roundId][msg.sender] = Entry({
            agent:     msg.sender,
            side:      side,
            amount:    amount,
            note:      note,
            timestamp: block.timestamp
        });
        _entrants[roundId].push(msg.sender);

        if (side == 0) {
            round.yesPot += amount;
        } else {
            round.noPot  += amount;
        }

        // Track in standings
        if (!_inStandings[msg.sender]) {
            _inStandings[msg.sender] = true;
            _standingAgents.push(msg.sender);
        }
        _stats[msg.sender].roundsEntered += 1;

        emit RoundEntered(roundId, msg.sender, side, amount, note);

        // ── Interactions ────────────────────────────────────────────────────
        // [FIX HIGH-3] Pull USDC BEFORE recording spend — CEI: confirm funds held before accounting.
        bool ok = usdc.transferFrom(msg.sender, address(this), amount);
        require(ok, "ArenaPool: USDC transfer failed");

        // PolicyEngine.recordSpend — only reached after token transfer succeeded.
        policyEngine.recordSpend(msg.sender, "arena", amount, address(usdc));
    }

    /**
     * @notice Resolve a round. Only callable by the designated resolver.
     * @param roundId      Round to resolve.
     * @param outcome      true = YES won, false = NO won.
     * @param evidenceHash keccak256 hash of the oracle/evidence source.
     */
    function resolveRound(
        uint256 roundId,
        bool    outcome,
        bytes32 evidenceHash
    ) external nonReentrant onlyResolver {
        // ── Checks ──────────────────────────────────────────────────────────
        Round storage round = _rounds[roundId];
        if (round.resolvesAt == 0)                      revert RoundNotFound();
        // [FIX CRIT-1] Enforce resolution time — resolver cannot resolve before resolvesAt.
        if (block.timestamp < round.resolvesAt)         revert TooEarlyToResolve();
        if (round.resolved)                             revert AlreadyResolved();
        if (_frozen[roundId])                           revert RoundIsFrozen();

        // ── Effects ─────────────────────────────────────────────────────────
        round.resolved     = true;
        round.outcome      = outcome;
        round.evidenceHash = evidenceHash;
        // [FIX HIGH-2] Snapshot fee at resolution time — prevents fee frontrun between
        // resolution and claim. Per-round fee is now immutable after resolveRound.
        _roundFeeBps[roundId] = feeBps;

        emit RoundResolved(roundId, outcome, evidenceHash);

        // ── Interactions ────────────────────────────────────────────────────
        // (none — payouts happen on individual claim() calls)
    }

    /**
     * @notice Claim winnings for a resolved round.
     *         Winners receive their original stake back plus a proportional share
     *         of the losing pot, minus the protocol fee.
     *         Losers receive nothing (call reverts with NothingToClaim).
     * @param roundId  Round to claim from.
     */
    function claim(uint256 roundId) external nonReentrant {
        // ── Checks ──────────────────────────────────────────────────────────
        Round storage round = _rounds[roundId];
        if (round.resolvesAt == 0)               revert RoundNotFound();
        if (!round.resolved)                     revert NotResolved();
        if (_claimed[roundId][msg.sender])        revert AlreadyClaimed();

        Entry storage entry = _entries[roundId][msg.sender];
        if (entry.agent == address(0)) revert NothingToClaim();

        uint256 winnerPot = round.outcome ? round.yesPot : round.noPot;
        uint256 losingPot = round.outcome ? round.noPot  : round.yesPot;

        // [FIX CRIT-2] Zero-winner-side refund path:
        //   If the resolved winning side has no participants (everyone bet on the losing side),
        //   refund all stakers their original stake instead of locking funds permanently.
        if (winnerPot == 0) {
            // Everyone in this round was on the losing side — refund their stake.
            // (The winning side is empty, so anyone with an entry gets their stake back.)
            // ── Effects ──────────────────────────────────────────────────────
            _claimed[roundId][msg.sender] = true;
            uint256 refund = entry.amount;
            emit Claimed(roundId, msg.sender, refund);
            // ── Interactions ─────────────────────────────────────────────────
            bool refOk = usdc.transfer(msg.sender, refund);
            require(refOk, "ArenaPool: refund transfer failed");
            return;
        }

        // Normal path — caller must be on the winning side.
        if (entry.side != (round.outcome ? 0 : 1)) revert NothingToClaim(); // wrong side

        // ── Effects (all state before transfers) ─────────────────────────────
        _claimed[roundId][msg.sender] = true;

        // Payout calculation (parimutuel):
        //   winnerPot  = stake on winning side
        //   losingPot  = stake on losing side
        //   fee        = feeBpsSnapshot% of losingPot (snapshotted at resolution — immutable)
        //   netLosing  = losingPot - fee
        //   payout     = stake + (stake * netLosing) / winnerPot
        //
        // [FIX HIGH-2] Use snapshotted fee — prevents fee frontrun between resolution and claim.
        // [FIX MED-4]  perWinnerFee computed from raw values (no divide-before-multiply).
        uint256 roundFee  = _roundFeeBps[roundId];
        uint256 fee       = (losingPot * roundFee) / BPS_DENOMINATOR;
        uint256 netLosing = losingPot - fee;

        uint256 payout = entry.amount + (entry.amount * netLosing) / winnerPot;

        // Update stats for standings
        _stats[msg.sender].roundsWon   += 1;
        _stats[msg.sender].totalEarned += payout;

        emit Claimed(roundId, msg.sender, payout);

        // ── Interactions ────────────────────────────────────────────────────
        // Transfer per-winner fee portion to treasury.
        // [FIX MED-4] Compute from raw values to avoid divide-before-multiply precision loss.
        if (fee > 0) {
            uint256 perWinnerFee = (losingPot * roundFee * entry.amount) / (BPS_DENOMINATOR * winnerPot);
            if (perWinnerFee > 0) {
                bool feeOk = usdc.transfer(treasury, perWinnerFee);
                require(feeOk, "ArenaPool: fee transfer failed");
            }
        }

        bool ok = usdc.transfer(msg.sender, payout);
        require(ok, "ArenaPool: payout transfer failed");
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /**
     * @notice Freeze a round — blocks new entries and resolution.
     *         Used when evidence is disputed. Only resolver can freeze.
     *         After MAX_FREEZE_DURATION, participants may call emergencyRefund().
     */
    function freezeRound(uint256 roundId) external nonReentrant onlyResolver {
        require(_rounds[roundId].resolvesAt != 0, "ArenaPool: round not found");
        require(!_frozen[roundId], "ArenaPool: already frozen");
        _frozen[roundId] = true;
        frozenAt[roundId] = block.timestamp;
        emit RoundFrozen(roundId);
    }

    /**
     * @notice Unfreeze a round. Only resolver can unfreeze.
     */
    function unfreezeRound(uint256 roundId) external nonReentrant onlyResolver {
        require(_rounds[roundId].resolvesAt != 0, "ArenaPool: round not found");
        require(_frozen[roundId], "ArenaPool: not frozen");
        _frozen[roundId] = false;
        emit RoundUnfrozen(roundId);
    }

    /**
     * @notice Emergency refund for participants in a frozen round that has been frozen
     *         for longer than MAX_FREEZE_DURATION (30 days) without resolution.
     *         Participant-initiated rescue path when resolver governance fails.
     * @param roundId  Frozen round to claim refund from.
     */
    function emergencyRefund(uint256 roundId) external nonReentrant {
        require(_frozen[roundId], "ArenaPool: not frozen");
        if (block.timestamp < frozenAt[roundId] + MAX_FREEZE_DURATION) revert FreezePeriodActive();
        require(!_claimed[roundId][msg.sender], "ArenaPool: already claimed");
        Entry storage entry = _entries[roundId][msg.sender];
        require(entry.agent != address(0), "ArenaPool: no entry");
        // ── Effects ──────────────────────────────────────────────────────────
        _claimed[roundId][msg.sender] = true;
        emit EmergencyRefund(roundId, msg.sender, entry.amount);
        // ── Interactions ─────────────────────────────────────────────────────
        bool ok = usdc.transfer(msg.sender, entry.amount);
        require(ok, "ArenaPool: refund failed");
    }

    /**
     * @notice Refund participants when a round was not resolved within the grace period
     *         (72 hours after resolvesAt). Safety valve for resolver key loss or abandonment.
     * @param roundId  Unresolved round past grace period.
     */
    function refundUnresolved(uint256 roundId) external nonReentrant {
        Round storage round = _rounds[roundId];
        require(round.resolvesAt != 0, "ArenaPool: round not found");
        require(!round.resolved, "ArenaPool: already resolved");
        require(!_frozen[roundId], "ArenaPool: use emergencyRefund for frozen rounds");
        if (block.timestamp <= round.resolvesAt + RESOLUTION_GRACE_PERIOD) revert GracePeriodActive();
        require(!_claimed[roundId][msg.sender], "ArenaPool: already claimed");
        Entry storage entry = _entries[roundId][msg.sender];
        require(entry.agent != address(0), "ArenaPool: no entry");
        // ── Effects ──────────────────────────────────────────────────────────
        _claimed[roundId][msg.sender] = true;
        emit Claimed(roundId, msg.sender, entry.amount);
        // ── Interactions ─────────────────────────────────────────────────────
        bool ok = usdc.transfer(msg.sender, entry.amount);
        require(ok, "ArenaPool: refund failed");
    }

    /**
     * @notice Update the protocol fee. Only resolver. Max 10%.
     *         Fee changes only affect rounds resolved AFTER this call —
     *         fee is snapshotted at resolveRound() time, not at enterRound() time.
     */
    function setFeeBps(uint256 newFeeBps) external onlyResolver {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        emit FeeBpsUpdated(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    /// @notice Returns full round data.
    function getRound(uint256 roundId) external view returns (Round memory) {
        return _rounds[roundId];
    }

    /// @notice Returns the entry for a specific agent in a round.
    function getUserEntry(uint256 roundId, address wallet) external view returns (Entry memory) {
        return _entries[roundId][wallet];
    }

    /**
     * @notice Returns paginated standings.
     * @param offset  Start index (0-based).
     * @param limit   Maximum entries to return. Pass 0 for up to 200.
     * @return standings  Array of AgentStanding structs.
     * @return total      Total number of agents in standings.
     * @dev   Full standings should be computed off-chain via subgraph. This paginated view
     *        prevents unbounded gas consumption on-chain.
     */
    function getStandings(uint256 offset, uint256 limit)
        external view returns (AgentStanding[] memory standings, uint256 total)
    {
        total = _standingAgents.length;
        if (limit == 0) limit = 200;
        if (offset >= total) return (new AgentStanding[](0), total);
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 n = end - offset;
        standings = new AgentStanding[](n);
        for (uint256 i = 0; i < n; i++) {
            address agent    = _standingAgents[offset + i];
            AgentStats storage s = _stats[agent];
            uint256 winRate  = s.roundsEntered > 0
                ? (s.roundsWon * BPS_DENOMINATOR) / s.roundsEntered
                : 0;
            standings[i] = AgentStanding({
                agent:         agent,
                roundsEntered: s.roundsEntered,
                roundsWon:     s.roundsWon,
                totalEarned:   s.totalEarned,
                winRate:       winRate
            });
        }
    }

    /// @notice Returns all entrant addresses for a round (for off-chain indexing).
    function getRoundEntrants(uint256 roundId) external view returns (address[] memory) {
        return _entrants[roundId];
    }

    /// @notice Returns whether a round is frozen.
    function isFrozen(uint256 roundId) external view returns (bool) {
        return _frozen[roundId];
    }

    /// @notice Returns whether an agent has claimed for a round.
    function hasClaimed(uint256 roundId, address agent) external view returns (bool) {
        return _claimed[roundId][agent];
    }

    /// @notice Returns the minimum entry amount for a round.
    function getRoundMinEntry(uint256 roundId) external view returns (uint256) {
        return _roundMinEntry[roundId];
    }

    /// @notice Total rounds created.
    function roundCount() external view returns (uint256) {
        return _nextRoundId;
    }

    /// @notice Returns the fee basis points snapshotted for a resolved round.
    function getRoundFeeBps(uint256 roundId) external view returns (uint256) {
        return _roundFeeBps[roundId];
    }
}
