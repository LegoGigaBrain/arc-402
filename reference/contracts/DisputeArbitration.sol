// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IDisputeArbitration.sol";
import "./ITrustRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @title DisputeArbitration
/// @notice Standalone arbitration fee, bond, and trust layer for ARC-402.
///
/// INTEGRATION:
///   1. Deploy this contract.
///   2. Call ServiceAgreement.setDisputeArbitration(address(this)).
///   3. Call TrustRegistry.addUpdater(address(this)).
///   4. Call setTokenUsdRate() for each allowed payment token.
///
/// USD PRICING NOTE:
///   All fees are USD-denominated and converted to tokens at open time using
///   admin-set tokenUsdRate18 values. This is NOT a trustless price oracle.
///   The owner is responsible for keeping rates current.
///   Fee is locked in tokens at dispute-open time; subsequent rate changes
///   do not affect open disputes.
///
/// STATUS: Production-ready — audited 2026-03-14
contract DisputeArbitration is IDisputeArbitration, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ───────────────────────────────────────────────────────────

    uint8 public constant PANEL_SIZE = 3;
    uint256 public constant MUTUAL_FUNDING_WINDOW = 48 hours;

    // DisputeOutcome uint8 values (must match IServiceAgreement.DisputeOutcome)
    uint8 private constant OUTCOME_PROVIDER_WINS  = 2;
    uint8 private constant OUTCOME_CLIENT_REFUND  = 3;
    uint8 private constant OUTCOME_PARTIAL_PROVIDER = 4;
    uint8 private constant OUTCOME_PARTIAL_CLIENT   = 5;
    uint8 private constant OUTCOME_MUTUAL_CANCEL    = 6;
    uint8 private constant OUTCOME_HUMAN_REVIEW     = 7;

    // Class multipliers in basis points (10000 = 1.0x)
    uint256 private constant CLASS_HARD_FAILURE_BPS      = 10000;
    uint256 private constant CLASS_AMBIGUITY_BPS         = 12500;
    uint256 private constant CLASS_HIGH_SENSITIVITY_BPS  = 15000;

    // ─── State ───────────────────────────────────────────────────────────────

    address public owner;
    address public pendingOwner; // R-03: Ownable2Step
    address public serviceAgreement;
    address public disputeModule; // set to DisputeModule address when DM calls openDispute/recordArbitratorVote
    address public trustRegistry;
    address public treasury;

    /// @notice Admin-set USD rate per token. 1e18 = $1.
    /// @dev NOT a trustless oracle. Owner must keep rates current.
    mapping(address => uint256) public tokenUsdRate18;

    uint256 public feeFloorUsd18    = 5e18;   // $5
    uint256 public feeCapUsd18      = 250e18;  // $250
    uint256 public minBondFloorUsd18 = 20e18;  // $20

    mapping(uint256 => DisputeFeeState) private _fees;
    mapping(uint256 => mapping(address => ArbitratorBondState)) private _bonds;
    mapping(uint256 => address[]) private _accepted; // arbitrators who called acceptAssignment
    mapping(uint256 => mapping(address => bool)) private _voted; // local vote tracking

    /// @notice Commit hash for arbitrator seed selection. agreementId => keccak256(abi.encode(reveal)).
    /// @dev Set by owner before calling selectArbitratorFromPool. Zero = not yet committed.
    mapping(uint256 => bytes32) public arbitratorCommits;

    /// @notice Pending bond/fee withdrawals for arbitrators (pull payment pattern).
    ///         token => account => amount
    mapping(address => mapping(address => uint256)) public pendingWithdrawals;

    // ─── Admin events ────────────────────────────────────────────────────────

    event OwnershipTransferProposed(address indexed proposed);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event ArbitratorSeedCommitted(uint256 indexed agreementId, bytes32 commit);
    event FeeFloorUpdated(uint256 newFloor);
    event FeeCapUpdated(uint256 newCap);
    event MinBondFloorUpdated(uint256 newFloor);
    event ServiceAgreementUpdated(address indexed newServiceAgreement);
    event TrustRegistryUpdated(address indexed newTrustRegistry);

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "DisputeArbitration: not owner");
        _;
    }

    modifier onlyServiceAgreement() {
        require(
            msg.sender == serviceAgreement || (disputeModule != address(0) && msg.sender == disputeModule),
            "DisputeArbitration: not ServiceAgreement"
        );
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _trustRegistry, address _treasury) {
        require(_trustRegistry != address(0), "DisputeArbitration: zero trust registry");
        owner = msg.sender;
        trustRegistry = _trustRegistry;
        treasury = _treasury != address(0) ? _treasury : msg.sender;
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    function setTokenUsdRate(address token, uint256 usdRate18) external onlyOwner {
        tokenUsdRate18[token] = usdRate18;
        emit TokenRateSet(token, usdRate18);
    }

    function setFeeFloorUsd(uint256 floorUsd18) external onlyOwner {
        require(floorUsd18 <= feeCapUsd18, "DisputeArbitration: floor exceeds cap");
        feeFloorUsd18 = floorUsd18;
        emit FeeFloorUpdated(floorUsd18);
    }

    function setFeeCapUsd(uint256 capUsd18) external onlyOwner {
        require(capUsd18 >= feeFloorUsd18, "DisputeArbitration: cap below floor");
        feeCapUsd18 = capUsd18;
        emit FeeCapUpdated(capUsd18);
    }

    function setMinBondFloorUsd(uint256 floorUsd18) external onlyOwner {
        minBondFloorUsd18 = floorUsd18;
        emit MinBondFloorUpdated(floorUsd18);
    }

    function setServiceAgreement(address sa) external onlyOwner {
        require(sa != address(0), "DisputeArbitration: zero address");
        serviceAgreement = sa;
        emit ServiceAgreementUpdated(sa);
    }

    function setDisputeModule(address dm) external onlyOwner {
        disputeModule = dm;
    }

    function setTrustRegistry(address tr) external onlyOwner {
        require(tr != address(0), "DisputeArbitration: zero address");
        trustRegistry = tr;
        emit TrustRegistryUpdated(tr);
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "DisputeArbitration: zero treasury");
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    /// @notice Step 1 — propose a new owner. R-03: Ownable2Step prevents single-tx ownership hijack.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "DisputeArbitration: zero address");
        pendingOwner = newOwner;
        emit OwnershipTransferProposed(newOwner);
    }

    /// @notice Step 2 — new owner must call this to complete the transfer.
    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "DisputeArbitration: not pending owner");
        address old = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(old, owner);
    }

    // ─── ServiceAgreement integration ────────────────────────────────────────

    /// @inheritdoc IDisputeArbitration
    // slither-disable-next-line reentrancy-eth
    function openDispute(
        uint256 agreementId,
        DisputeMode mode,
        DisputeClass disputeClass,
        address opener,
        address client,
        address provider,
        uint256 agreementPrice,
        address token
    ) external payable nonReentrant onlyServiceAgreement returns (uint256 feeRequired) {
        require(!_fees[agreementId].active, "DisputeArbitration: dispute already open");
        require(tokenUsdRate18[token] > 0, "DisputeArbitration: no rate for token");

        feeRequired = _calcFee(agreementPrice, token, disputeClass);

        uint256 openerOwes = mode == DisputeMode.UNILATERAL ? feeRequired : feeRequired / 2;

        _collectPayment(token, opener, openerOwes);

        _fees[agreementId] = DisputeFeeState({
            mode: mode,
            disputeClass: disputeClass,
            opener: opener,
            client: client,
            provider: provider,
            token: token,
            agreementPrice: agreementPrice,
            feeRequired: feeRequired,
            openerPaid: openerOwes,
            respondentPaid: 0,
            openedAt: block.timestamp,
            active: true,
            resolved: false
        });

        emit DisputeFeeOpened(agreementId, mode, disputeClass, feeRequired, token);
    }

    /// @inheritdoc IDisputeArbitration
    // slither-disable-next-line reentrancy-eth
    function joinMutualDispute(uint256 agreementId) external payable nonReentrant {
        DisputeFeeState storage fs = _fees[agreementId];
        require(fs.active && !fs.resolved, "DisputeArbitration: not active");
        require(fs.mode == DisputeMode.MUTUAL, "DisputeArbitration: not mutual");
        require(fs.respondentPaid == 0, "DisputeArbitration: already funded");
        // slither-disable-next-line timestamp
        require(block.timestamp <= fs.openedAt + MUTUAL_FUNDING_WINDOW, "DisputeArbitration: funding window closed");

        address respondent = (msg.sender == fs.client) ? fs.client : fs.provider;
        require(msg.sender != fs.opener, "DisputeArbitration: opener cannot join");
        require(msg.sender == fs.client || msg.sender == fs.provider, "DisputeArbitration: not a party");

        uint256 halfFee = fs.feeRequired / 2;
        _collectPayment(fs.token, respondent, halfFee);
        fs.respondentPaid = halfFee;

        emit MutualDisputeFunded(agreementId, respondent, halfFee);
    }

    /// @inheritdoc IDisputeArbitration
    function resolveDisputeFee(uint256 agreementId, uint8 outcome) external nonReentrant onlyServiceAgreement {
        DisputeFeeState storage fs = _fees[agreementId];
        require(fs.active && !fs.resolved, "DisputeArbitration: not active or already resolved");

        fs.resolved = true;
        fs.active = false;

        uint256 totalFeeCollected = fs.openerPaid + fs.respondentPaid;
        uint256 openerRefund = 0;

        // ─── Fee refund logic ─────────────────────────────────────────────
        if (fs.mode == DisputeMode.UNILATERAL) {
            bool openerWon = (outcome == OUTCOME_PROVIDER_WINS && fs.opener == fs.provider)
                || (outcome == OUTCOME_CLIENT_REFUND && fs.opener == fs.client);
            if (openerWon) {
                openerRefund = fs.feeRequired / 2;
                _releasePayment(fs.token, fs.opener, openerRefund);
            }
            // else: fee fully consumed
        }
        // MUTUAL: no refund regardless of outcome

        uint256 feeForArbitrators = totalFeeCollected - openerRefund;

        // ─── Arbitrator bonds + fee payout ───────────────────────────────
        _settleArbitratorBondsAndFees(agreementId, fs.token, feeForArbitrators);

        _writeTrust(fs, outcome);

        emit DisputeFeeResolved(agreementId, outcome, openerRefund);
    }

    /// @inheritdoc IDisputeArbitration
    function isEligibleArbitrator(address arbitrator) external view returns (bool) {
        // Base check: non-zero address, not zero trust (if registry configured)
        if (arbitrator == address(0)) return false;
        if (trustRegistry != address(0)) {
            // B-07: use getEffectiveScore (time-decayed) not getScore (raw)
            uint256 score = ITrustRegistry(trustRegistry).getEffectiveScore(arbitrator);
            // score == 0 means uninitialized (no trust history) — ineligible.
            // Scores 1–49 indicate post-slash or heavy decay — also ineligible.
            if (score < 50) return false;
        }
        return true;
    }

    // ─── Arbitrator panel ────────────────────────────────────────────────────

    /// @inheritdoc IDisputeArbitration
    // slither-disable-next-line reentrancy-eth
    function acceptAssignment(uint256 agreementId) external payable nonReentrant {
        DisputeFeeState storage fs = _fees[agreementId];
        require(fs.active, "DisputeArbitration: dispute not active");
        require(_accepted[agreementId].length < PANEL_SIZE, "DisputeArbitration: panel full");
        require(!_bonds[agreementId][msg.sender].locked, "DisputeArbitration: already accepted");

        uint256 bondRequired = _calcBond(fs.feeRequired, fs.token);
        _collectPayment(fs.token, msg.sender, bondRequired);

        _bonds[agreementId][msg.sender] = ArbitratorBondState({
            bondAmount: bondRequired,
            lockedAt: block.timestamp,
            locked: true,
            slashed: false,
            returned: false
        });
        _accepted[agreementId].push(msg.sender);

        emit ArbitratorAssigned(agreementId, msg.sender, bondRequired);
    }

    /// @inheritdoc IDisputeArbitration
    function triggerFallback(uint256 agreementId) external nonReentrant returns (bool) {
        DisputeFeeState storage fs = _fees[agreementId];
        require(fs.active && !fs.resolved, "DisputeArbitration: not active");

        bool mutualUnfunded = fs.mode == DisputeMode.MUTUAL
            && fs.respondentPaid == 0
            && block.timestamp > fs.openedAt + MUTUAL_FUNDING_WINDOW;

        // Panel formation timeout is tracked externally (ServiceAgreement.ARBITRATION_SELECTION_WINDOW)
        // For mutual unfunded: we can determine this here
        if (!mutualUnfunded) {
            revert("DisputeArbitration: fallback conditions not met");
        }

        emit DisputeFallbackTriggered(agreementId, "mutual-dispute-unfunded");
        // NOTE: Owner must manually call ServiceAgreement.resolveDispute to route to human backstop.
        // Future: call ServiceAgreement.requestHumanEscalation once authorization is wired.
        return true;
    }

    /// @inheritdoc IDisputeArbitration
    function slashArbitrator(
        uint256 agreementId,
        address arbitrator,
        string calldata reason
    ) external nonReentrant onlyOwner {
        ArbitratorBondState storage bond = _bonds[agreementId][arbitrator];
        require(bond.locked && !bond.slashed && !bond.returned, "DisputeArbitration: bond not slashable");

        bond.slashed = true;
        uint256 amount = bond.bondAmount;

        _releasePayment(_fees[agreementId].token, treasury, amount);
        emit ArbitratorBondSlashed(agreementId, arbitrator, amount, reason);

        if (trustRegistry != address(0)) {
            try ITrustRegistry(trustRegistry).recordArbitratorSlash(arbitrator, reason) {} catch {}
        }
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function getDisputeFeeState(uint256 agreementId) external view returns (DisputeFeeState memory) {
        return _fees[agreementId];
    }

    function getArbitratorBondState(
        address arbitrator,
        uint256 agreementId
    ) external view returns (ArbitratorBondState memory) {
        return _bonds[agreementId][arbitrator];
    }

    function getFeeQuote(
        uint256 agreementPrice,
        address token,
        DisputeMode, /* mode — fee amount is the same; mode affects who pays and refund logic */
        DisputeClass disputeClass
    ) external view returns (uint256 feeInTokens) {
        require(tokenUsdRate18[token] > 0, "DisputeArbitration: no rate for token");
        return _calcFee(agreementPrice, token, disputeClass);
    }

    function getAcceptedArbitrators(uint256 agreementId) external view returns (address[] memory) {
        return _accepted[agreementId];
    }

    // ─── Internal helpers ────────────────────────────────────────────────────

    function _calcFee(
        uint256 agreementPrice,
        address token,
        DisputeClass disputeClass
    ) internal view returns (uint256) {
        uint256 rate = tokenUsdRate18[token]; // USD per token, 1e18 = $1 per token
        require(rate > 0, "DisputeArbitration: no rate for token");

        // Convert agreement price (in token wei) to USD (18-decimal).
        // rate = USD/token in 1e18. agreementPrice is in token wei (1e18 = 1 token).
        // agreementPriceUsd = agreementPrice [token wei] * rate [USD/token, 1e18] / 1e18 [wei/token]
        uint256 agreementPriceUsd = Math.mulDiv(agreementPrice, rate, 1e18);

        // 3% of agreement value in USD
        uint256 rawFeeUsd = Math.mulDiv(agreementPriceUsd, 3, 100);

        // clamp to floor/cap
        uint256 clampedFeeUsd = rawFeeUsd < feeFloorUsd18 ? feeFloorUsd18
            : rawFeeUsd > feeCapUsd18 ? feeCapUsd18
            : rawFeeUsd;

        // apply class multiplier
        uint256 multiplierBps = _classMultiplierBps(disputeClass);
        uint256 classFeeUsd = Math.mulDiv(clampedFeeUsd, multiplierBps, 10000);

        // cap again after multiplier
        uint256 finalFeeUsd = classFeeUsd > feeCapUsd18 ? feeCapUsd18 : classFeeUsd;

        // convert USD back to tokens: tokens = USD / (USD/token) = USD * 1e18 / rate
        return Math.mulDiv(finalFeeUsd, 1e18, rate);
    }

    function _classMultiplierBps(DisputeClass disputeClass) internal pure returns (uint256) {
        if (disputeClass == DisputeClass.HARD_FAILURE)      return CLASS_HARD_FAILURE_BPS;
        if (disputeClass == DisputeClass.AMBIGUITY_QUALITY) return CLASS_AMBIGUITY_BPS;
        if (disputeClass == DisputeClass.HIGH_SENSITIVITY)  return CLASS_HIGH_SENSITIVITY_BPS;
        return CLASS_HARD_FAILURE_BPS;
    }

    function _calcBond(uint256 feeRequired, address token) internal view returns (uint256) {
        uint256 twiceFee = feeRequired * 2;
        uint256 rate = tokenUsdRate18[token];
        // bondFloorTokens = minBondFloor [USD, 1e18] * 1e18 / rate [USD/token, 1e18]
        uint256 bondFloorTokens = rate > 0 ? (minBondFloorUsd18 * 1e18) / rate : 0;
        return twiceFee > bondFloorTokens ? twiceFee : bondFloorTokens;
    }

    // wake-disable-next-line reentrancy
    // @dev Called only from nonReentrant-guarded entry points. Reentrancy path blocked upstream.
    function _collectPayment(address token, address from, uint256 amount) internal {
        if (amount == 0) return;
        if (token == address(0)) {
            require(msg.value >= amount, "DisputeArbitration: insufficient ETH");
            // refund excess ETH
            if (msg.value > amount) {
                (bool ok, ) = from.call{value: msg.value - amount}("");
                require(ok, "DisputeArbitration: ETH refund failed");
            }
        } else {
            IERC20(token).safeTransferFrom(from, address(this), amount);
        }
    }

    // wake-disable-next-line reentrancy
    // @dev Called only from nonReentrant-guarded entry points. Reentrancy path blocked upstream.
    // slither-disable-next-line arbitrary-send-eth
    function _releasePayment(address token, address to, uint256 amount) internal {
        if (amount == 0 || to == address(0)) return;
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            require(ok, "DisputeArbitration: ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    // wake-disable-next-line reentrancy
    // @dev Called only from nonReentrant-guarded entry points. Reentrancy path blocked upstream.
    // slither-disable-next-line reentrancy-eth
    function _settleArbitratorBondsAndFees(
        uint256 agreementId,
        address token,
        uint256 feePool
    ) internal {
        address[] storage panel = _accepted[agreementId];
        uint256 panelCount = panel.length;
        if (panelCount == 0) {
            // No arbitrators accepted: send fee pool to treasury
            _releasePayment(token, treasury, feePool);
            return;
        }

        // Identify voted vs missed arbitrators
        uint256 votedCount = 0;
        for (uint256 i = 0; i < panelCount; i++) {
            if (_voted[agreementId][panel[i]]) votedCount++;
        }

        uint256 feePerArbitrator = votedCount > 0 ? feePool / votedCount : 0;
        uint256 remainder = feePool - (feePerArbitrator * votedCount);

        for (uint256 i = 0; i < panelCount; i++) {
            address arb = panel[i];
            ArbitratorBondState storage bond = _bonds[agreementId][arb];
            if (!bond.locked || bond.slashed || bond.returned) continue;

            if (_voted[agreementId][arb]) {
                // Clean completion: queue bond + fee share for pull withdrawal (DoS-safe)
                bond.returned = true;
                pendingWithdrawals[token][arb] += bond.bondAmount;
                emit ArbitratorBondReturned(agreementId, arb, bond.bondAmount);
                if (feePerArbitrator > 0) {
                    pendingWithdrawals[token][arb] += feePerArbitrator;
                    emit ArbitratorFeePaid(agreementId, arb, feePerArbitrator);
                }
            } else {
                // Missed deadline: slash bond to treasury
                bond.slashed = true;
                _releasePayment(token, treasury, bond.bondAmount);
                emit ArbitratorBondSlashed(agreementId, arb, bond.bondAmount, "missed-deadline");
                if (trustRegistry != address(0)) {
                    try ITrustRegistry(trustRegistry).recordArbitratorSlash(arb, "missed-deadline") {} catch {}
                }
            }
        }

        // Remainder to treasury
        if (remainder > 0) {
            _releasePayment(token, treasury, remainder);
        }
    }

    // wake-disable-next-line reentrancy
    // @dev Called only from nonReentrant-guarded entry points. Reentrancy path blocked upstream.
    function _writeTrust(DisputeFeeState storage fs, uint8 outcome) internal {
        if (trustRegistry == address(0)) return;

        // SPLIT (4/5), MUTUAL_CANCEL (6), HUMAN_REVIEW (7): no trust write
        if (outcome == OUTCOME_PARTIAL_PROVIDER
            || outcome == OUTCOME_PARTIAL_CLIENT
            || outcome == OUTCOME_MUTUAL_CANCEL
            || outcome == OUTCOME_HUMAN_REVIEW) {
            return;
        }

        if (outcome == OUTCOME_PROVIDER_WINS) {
            // Provider delivered: recordSuccess for provider
            try ITrustRegistry(trustRegistry).recordSuccess(
                fs.provider, fs.client, "dispute", fs.agreementPrice
            ) {} catch {}
        } else if (outcome == OUTCOME_CLIENT_REFUND) {
            // Provider failed: recordAnomaly for provider
            try ITrustRegistry(trustRegistry).recordAnomaly(
                fs.provider, fs.client, "dispute", fs.agreementPrice
            ) {} catch {}
        }
        // For mutual mode: same verdict-driven writes (mode only affects fee; trust is outcome-based)
    }

    /// @notice Called by ServiceAgreement (via event or direct) to record that an arbitrator voted.
    ///         This is necessary so _settleArbitratorBondsAndFees can distinguish voted vs missed.
    /// @dev In the current design, ServiceAgreement emits ArbitrationVoteCast. DisputeArbitration
    ///      must be notified of votes to track them. Two options:
    ///      (A) ServiceAgreement calls this after each castArbitrationVote — requires ServiceAgreement
    ///          to have a reference to DisputeArbitration (already the case).
    ///      (B) Owner calls markArbitratorVoted after observing the event.
    ///      For freeze-state: use option A — ServiceAgreement calls recordArbitratorVote after each vote.
    function recordArbitratorVote(uint256 agreementId, address arbitrator) external onlyServiceAgreement {
        _voted[agreementId][arbitrator] = true;
    }

    // ─── Randomised Arbitrator Selection — Commit-Reveal ─────────────────────
    //
    // Two-step scheme to eliminate validator/miner manipulation of entropy:
    //   1. Owner commits a hash off-chain:  commitArbitratorSeed(agreementId, keccak256(reveal))
    //   2. Owner reveals in a later block:  selectArbitratorFromPool(agreementId, pool, reveal)
    //
    // The reveal is the pre-image; on-chain we check keccak256(abi.encode(reveal)) == commit
    // and use reveal as entropy for the Fisher-Yates shuffle.
    // Chainlink VRF remains the v2 upgrade path for fully trustless randomness.

    /// @notice Step 1 — Owner commits a hash before the reveal block.
    /// @param agreementId The dispute for which a panel is being selected.
    /// @param commit      keccak256(abi.encode(reveal)) — the pre-image stays off-chain until reveal.
    function commitArbitratorSeed(uint256 agreementId, bytes32 commit) external onlyOwner {
        require(arbitratorCommits[agreementId] == bytes32(0), "DisputeArbitration: already committed");
        arbitratorCommits[agreementId] = commit;
        emit ArbitratorSeedCommitted(agreementId, commit);
    }

    /// @notice Step 2 — Reveal the pre-image and select PANEL_SIZE arbitrators from the pool.
    ///
    /// @dev Fisher-Yates partial shuffle using commit-reveal entropy.
    ///      The entropy seed is re-hashed at each step to avoid index-correlation bias.
    ///      Caller must have previously called commitArbitratorSeed for this agreementId.
    ///
    /// @param agreementId  The dispute being assigned (included in entropy for uniqueness).
    /// @param pool         Candidate arbitrator addresses. Must have >= PANEL_SIZE entries.
    /// @param reveal       Pre-image: keccak256(abi.encode(reveal)) must equal the stored commit.
    /// @return selected    The PANEL_SIZE randomly chosen arbitrators. Caller must assign them.
    function selectArbitratorFromPool(
        uint256 agreementId,
        address[] calldata pool,
        bytes32 reveal
    ) external view returns (address[] memory selected) {
        bytes32 commit = arbitratorCommits[agreementId];
        require(commit != bytes32(0), "DisputeArbitration: no commit for agreement");
        require(keccak256(abi.encode(reveal)) == commit, "DisputeArbitration: reveal mismatch");
        require(pool.length >= PANEL_SIZE, "DisputeArbitration: pool too small");

        // Build memory copy for in-place shuffle
        address[] memory candidates = new address[](pool.length);
        for (uint256 i = 0; i < pool.length; i++) {
            candidates[i] = pool[i];
        }

        // Derive seed from reveal + agreementId for dispute-specific entropy
        bytes32 seed = keccak256(abi.encode(reveal, agreementId));

        // Fisher-Yates partial shuffle — only first PANEL_SIZE positions needed
        selected = new address[](PANEL_SIZE);
        for (uint256 i = 0; i < PANEL_SIZE; i++) {
            // Re-derive seed per step to avoid index-correlation bias
            seed = keccak256(abi.encode(seed, i));
            uint256 j = i + (uint256(seed) % (candidates.length - i));
            // Swap candidates[i] ↔ candidates[j]
            address tmp = candidates[i];
            candidates[i] = candidates[j];
            candidates[j] = tmp;
            selected[i] = candidates[i];
        }
    }

    // ─── Pull Withdrawal (arbitrator bonds and fees) ──────────────────────────

    /// @notice Arbitrators call this to collect their bond return and fee share after settlement.
    /// @param token The payment token (address(0) for ETH) used in the dispute.
    function withdrawBond(address token) external nonReentrant {
        uint256 amount = pendingWithdrawals[token][msg.sender];
        require(amount > 0, "DisputeArbitration: nothing to withdraw");
        pendingWithdrawals[token][msg.sender] = 0;
        _releasePayment(token, msg.sender, amount);
    }

    // ─── R-05: Arbitrator bond griefing recovery ──────────────────────────────

    uint256 public constant BOND_RECOVERY_TIMEOUT = 45 days; // 15 days after 30-day dispute timeout

    event BondReclaimed(uint256 indexed agreementId, address indexed arbitrator, uint256 amount);

    /// @notice Arbitrators can reclaim their bond if a dispute expires without resolution.
    ///         Prevents permanent bond lock if ServiceAgreement never calls resolveDisputeFee.
    function reclaimExpiredBond(uint256 agreementId) external nonReentrant {
        DisputeFeeState storage fs = _fees[agreementId];
        require(fs.active, "DisputeArbitration: dispute not active");
        require(!fs.resolved, "DisputeArbitration: already resolved");
        // slither-disable-next-line timestamp
        require(
            block.timestamp > fs.openedAt + BOND_RECOVERY_TIMEOUT,
            "DisputeArbitration: timeout not reached"
        );

        ArbitratorBondState storage bond = _bonds[agreementId][msg.sender];
        require(bond.locked && !bond.slashed && !bond.returned, "DisputeArbitration: no reclaimable bond");

        bond.returned = true;
        uint256 amount = bond.bondAmount;

        emit BondReclaimed(agreementId, msg.sender, amount);
        _releasePayment(_fees[agreementId].token, msg.sender, amount);
    }

    // ─── MA-14: Keeper / UI helper ────────────────────────────────────────────

    /// @notice Returns whether a dispute fee is stuck and when the bond-recovery
    ///         timeout expires (at which point reclaimExpiredBond becomes callable).
    /// @dev "Stuck" means the dispute is active, not yet resolved, and the SA has not
    ///      called resolveDisputeFee — a condition that should not persist in normal operation.
    ///      UIs and keepers can poll this to identify actionable disputes.
    /// @return stuck True if the dispute fee is unresolved and BOND_RECOVERY_TIMEOUT > now.
    /// @return recoveryUnlockAt Timestamp when reclaimExpiredBond becomes callable (0 if not active).
    function hasStuckFees(uint256 agreementId) external view returns (bool stuck, uint256 recoveryUnlockAt) {
        DisputeFeeState storage fs = _fees[agreementId];
        if (!fs.active || fs.resolved) {
            return (false, 0);
        }
        recoveryUnlockAt = fs.openedAt + BOND_RECOVERY_TIMEOUT;
        // slither-disable-next-line timestamp
        stuck = block.timestamp <= recoveryUnlockAt;
    }

    receive() external payable {}
}
