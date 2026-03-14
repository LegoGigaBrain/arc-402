// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPolicyEngine.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title PolicyEngine
 * @notice Stores and validates spending policies for ARC-402 wallets
 * STATUS: Production-ready — audited 2026-03-14
 */
contract PolicyEngine is IPolicyEngine {
    using EnumerableSet for EnumerableSet.AddressSet;

    struct PolicyData {
        bytes32 policyHash;
        bytes policyData;
        uint256 updatedAt;
    }

    mapping(address => PolicyData) private policies;
    mapping(address => mapping(string => uint256)) public categoryLimits;
    mapping(address => address) public walletOwners;

    // Per-day cumulative limits (separate from per-tx limits)
    mapping(address => mapping(string => uint256)) public dailyCategoryLimit;

    // ─── Fix 1: Two-bucket spend window (replaces single dailySpend/periodStart) ──

    /// @dev 12-hour bucket. Effective spend = current + previous bucket.
    ///      Worst-case boundary spend is 1.5× daily limit (vs 2× with discrete reset).
    uint256 private constant BUCKET_DURATION = 43200; // 12 hours

    struct SpendWindow {
        uint256 currentBucketStart;
        uint256 currentBucketSpend;
        uint256 previousBucketSpend;
    }

    /// @dev Per-wallet per-category two-bucket window.
    mapping(address => mapping(string => SpendWindow)) private _spendWindows;

    // contextId deduplication — prevents same agreement being validated twice
    mapping(bytes32 => bool) private _usedContextIds;

    // ─── Fix 2: Emergency freeze ──────────────────────────────────────────────

    /// @notice Whether spending from this wallet is frozen.
    mapping(address => bool) public spendFrozen;

    /// @dev wallet → agent → authorized to freeze
    mapping(address => mapping(address => bool)) private _authorizedFreezeAgents;

    // ─── Fix 3: Velocity detection (1-hour rate limit via 30-min buckets) ────

    uint256 private constant VELOCITY_BUCKET = 1800; // 30 minutes

    struct VelocityWindow {
        uint256 currentBucketStart;
        uint256 currentBucketCount;
        uint256 previousBucketCount;
        uint256 currentBucketSpend;
        uint256 previousBucketSpend;
    }

    /// @dev Per-wallet (not per-category) hourly velocity tracking.
    mapping(address => VelocityWindow) private _velocityWindows;

    /// @notice Maximum transactions per hour. 0 = disabled.
    mapping(address => uint256) public maxTxPerHour;

    /// @notice Maximum spend per hour (across all categories). 0 = disabled.
    mapping(address => uint256) public maxSpendPerHour;

    // ─── Fix 4: Per-agreement cap with timelock ───────────────────────────────

    struct PendingCapReduction {
        uint256 newCap;
        uint256 effectiveAt;
    }

    /// @notice Pending daily-limit reductions keyed by wallet+category.
    ///         Only reductions (not increases) may be queued. A 24-hour timelock
    ///         applies before the new cap can be applied.
    mapping(address => mapping(string => PendingCapReduction)) public pendingCapReductions;

    // ─── DeFi Access Tier ─────────────────────────────────────────────────────
    // Opt-in DeFi access — NOT enabled by default.
    mapping(address => bool) public defiAccessEnabled;
    /// @dev Per-wallet whitelist of allowed external contract targets.
    mapping(address => EnumerableSet.AddressSet) private _whitelistedContracts;
    /// @notice Maximum value (wei / token units) allowed per contract call. 0 = unlimited.
    mapping(address => uint256) public maxContractCallValue;
    /// @dev Per-wallet allowed NFT contracts (ERC-721 / ERC-1155).
    mapping(address => EnumerableSet.AddressSet) private _allowedNFTContracts;

    // ─── Approval Tracking ────────────────────────────────────────────────────

    /// @notice Outstanding ERC-20 approval amounts per wallet per token.
    ///         Updated whenever the wallet calls approve() via executeContractCall.
    mapping(address => mapping(address => uint256)) public outstandingApprovals;

    // ─── Blocklist ───────────────────────────────────────────────────────────

    /// @notice wallet → provider → blocked
    mapping(address => mapping(address => bool)) private _blocklist;

    // ─── Shortlist (preferred providers per capability) ───────────────────────

    /// @notice wallet → capabilityHash → preferred provider list
    mapping(address => mapping(bytes32 => address[])) private _shortlist;
    /// @notice wallet → capabilityHash → provider → 1-based index (0 = not present)
    mapping(address => mapping(bytes32 => mapping(address => uint256))) private _shortlistIdx;

    // ─── Events ───────────────────────────────────────────────────────────────

    event PolicySet(address indexed wallet, bytes32 policyHash);
    event CategoryLimitSet(address indexed wallet, string category, uint256 limitPerTx);
    event DailyCategoryLimitSet(address indexed wallet, string category, uint256 dailyLimit);
    event SpendRecorded(address indexed wallet, string category, uint256 amount, bytes32 contextId);
    event ProviderBlocked(address indexed wallet, address indexed provider);
    event ProviderUnblocked(address indexed wallet, address indexed provider);
    event ProviderPreferred(address indexed wallet, address indexed provider, string capability);
    event ProviderUnpreferred(address indexed wallet, address indexed provider, string capability);
    event DefiAccessEnabled(address indexed wallet);
    event DefiAccessDisabled(address indexed wallet);
    event ContractWhitelisted(address indexed wallet, address indexed target);
    event ContractRemoved(address indexed wallet, address indexed target);
    event MaxContractCallValueSet(address indexed wallet, uint256 value);
    event NFTContractAllowed(address indexed wallet, address indexed nftContract);
    event NFTContractDisallowed(address indexed wallet, address indexed nftContract);

    // Fix 2 events
    event SpendFrozen(address indexed wallet, address indexed by);
    event SpendUnfrozen(address indexed wallet, address indexed by);

    // Approval tracking event
    event ApprovalRecorded(address indexed wallet, address indexed token, uint256 amount);

    // Fix 4 events
    event CapReductionQueued(address indexed wallet, string category, uint256 newCap, uint256 effectiveAt);
    event CapReductionApplied(address indexed wallet, string category, uint256 newCap);

    /**
     * @notice Register a wallet and record its owner.
     * @dev Only the wallet itself may call this (msg.sender == wallet). This prevents
     *      a third party from hijacking the walletOwners mapping for a wallet they
     *      don't control. ARC402Wallet calls this indirectly via its constructor.
     *      Re-registration is blocked once an owner is set — the current owner must
     *      call setCategoryLimitFor() for any subsequent changes.
     */
    function registerWallet(address wallet, address owner) external {
        require(msg.sender == wallet, "PolicyEngine: caller must be wallet");
        require(walletOwners[wallet] == address(0), "PolicyEngine: already registered");
        walletOwners[wallet] = owner;
    }

    function setPolicy(bytes32 policyHash, bytes calldata policyData) external {
        policies[msg.sender] = PolicyData({
            policyHash: policyHash,
            policyData: policyData,
            updatedAt: block.timestamp
        });
        emit PolicySet(msg.sender, policyHash);
    }

    function getPolicy(address wallet) external view returns (bytes32, bytes memory) {
        PolicyData storage p = policies[wallet];
        return (p.policyHash, p.policyData);
    }

    // @dev Intentionally does not reset spend window state. Only limit values change.
    // Spend windows reset based on time only — see _recordBucketSpend.
    function setCategoryLimit(string calldata category, uint256 limitPerTx) external {
        categoryLimits[msg.sender][category] = limitPerTx;
        emit CategoryLimitSet(msg.sender, category, limitPerTx);
    }

    // @dev Intentionally does not reset spend window state. Only limit values change.
    // Spend windows reset based on time only — see _recordBucketSpend.
    function setCategoryLimitFor(address wallet, string calldata category, uint256 limitPerTx) external {
        // Allow owner to set limits for their wallet
        require(walletOwners[wallet] == msg.sender || wallet == msg.sender, "PolicyEngine: not authorized");
        categoryLimits[wallet][category] = limitPerTx;
        emit CategoryLimitSet(wallet, category, limitPerTx);
    }

    // @dev Intentionally does not reset spend window state. Only limit values change.
    // Spend windows reset based on time only — see _recordBucketSpend.
    function setDailyLimit(string calldata category, uint256 limit) external {
        dailyCategoryLimit[msg.sender][category] = limit;
        emit DailyCategoryLimitSet(msg.sender, category, limit);
    }

    // @dev Intentionally does not reset spend window state. Only limit values change.
    // Spend windows reset based on time only — see _recordBucketSpend.
    function setDailyLimitFor(address wallet, string calldata category, uint256 limit) external {
        require(walletOwners[wallet] == msg.sender || wallet == msg.sender, "PolicyEngine: not authorized");
        dailyCategoryLimit[wallet][category] = limit;
        emit DailyCategoryLimitSet(wallet, category, limit);
    }

    // ─── Fix 3: Velocity limit config ─────────────────────────────────────────

    // @dev Intentionally does not reset spend window state. Only limit values change.
    // Spend windows reset based on time only — see _recordBucketSpend.
    function setMaxTxPerHour(address wallet, uint256 limit) external {
        require(walletOwners[wallet] == msg.sender || wallet == msg.sender, "PolicyEngine: not authorized");
        maxTxPerHour[wallet] = limit;
    }

    // @dev Intentionally does not reset spend window state. Only limit values change.
    // Spend windows reset based on time only — see _recordBucketSpend.
    function setMaxSpendPerHour(address wallet, uint256 limit) external {
        require(walletOwners[wallet] == msg.sender || wallet == msg.sender, "PolicyEngine: not authorized");
        maxSpendPerHour[wallet] = limit;
    }

    // ─── Fix 1: Two-bucket window helpers ─────────────────────────────────────

    /// @dev Returns the effective accumulated spend for wallet+category across both buckets.
    ///      Uses a rolling two-bucket window: if both buckets have expired, returns 0.
    ///      If only the current bucket has expired but previous is still visible, returns current.
    // slither-disable-next-line timestamp
    function _getEffectiveSpend(address wallet, string memory category) internal view returns (uint256) {
        SpendWindow storage w = _spendWindows[wallet][category];
        if (block.timestamp >= w.currentBucketStart + 2 * BUCKET_DURATION) {
            return 0;
        }
        if (block.timestamp >= w.currentBucketStart + BUCKET_DURATION) {
            return w.currentBucketSpend;
        }
        return w.currentBucketSpend + w.previousBucketSpend;
    }

    /// @dev Records spend in the two-bucket window for wallet+category.
    // slither-disable-next-line timestamp
    function _recordBucketSpend(address wallet, string memory category, uint256 amount) internal {
        SpendWindow storage w = _spendWindows[wallet][category];
        if (block.timestamp >= w.currentBucketStart + 2 * BUCKET_DURATION) {
            w.previousBucketSpend = 0;
            w.currentBucketSpend = amount;
            w.currentBucketStart = block.timestamp;
        } else if (block.timestamp >= w.currentBucketStart + BUCKET_DURATION) {
            w.previousBucketSpend = w.currentBucketSpend;
            w.currentBucketSpend = amount;
            w.currentBucketStart = w.currentBucketStart + BUCKET_DURATION;
        } else {
            w.currentBucketSpend += amount;
        }
    }

    // ─── Fix 3: Velocity window helpers ───────────────────────────────────────

    // slither-disable-next-line timestamp
    function _getEffectiveTxCount(address wallet) internal view returns (uint256) {
        VelocityWindow storage v = _velocityWindows[wallet];
        if (block.timestamp >= v.currentBucketStart + 2 * VELOCITY_BUCKET) {
            return 0;
        }
        if (block.timestamp >= v.currentBucketStart + VELOCITY_BUCKET) {
            return v.currentBucketCount;
        }
        return v.currentBucketCount + v.previousBucketCount;
    }

    // slither-disable-next-line timestamp
    function _getEffectiveHourlySpend(address wallet) internal view returns (uint256) {
        VelocityWindow storage v = _velocityWindows[wallet];
        if (block.timestamp >= v.currentBucketStart + 2 * VELOCITY_BUCKET) {
            return 0;
        }
        if (block.timestamp >= v.currentBucketStart + VELOCITY_BUCKET) {
            return v.currentBucketSpend;
        }
        return v.currentBucketSpend + v.previousBucketSpend;
    }

    // slither-disable-next-line timestamp
    function _recordVelocitySpend(address wallet, uint256 amount) internal {
        VelocityWindow storage v = _velocityWindows[wallet];
        if (block.timestamp >= v.currentBucketStart + 2 * VELOCITY_BUCKET) {
            v.previousBucketCount = 0;
            v.previousBucketSpend = 0;
            v.currentBucketCount = 1;
            v.currentBucketSpend = amount;
            v.currentBucketStart = block.timestamp;
        } else if (block.timestamp >= v.currentBucketStart + VELOCITY_BUCKET) {
            v.previousBucketCount = v.currentBucketCount;
            v.previousBucketSpend = v.currentBucketSpend;
            v.currentBucketCount = 1;
            v.currentBucketSpend = amount;
            v.currentBucketStart = v.currentBucketStart + VELOCITY_BUCKET;
        } else {
            v.currentBucketCount += 1;
            v.currentBucketSpend += amount;
        }
    }

    /// @dev Uses block.timestamp for rolling window tracking.
    ///      Validator timestamp manipulation is bounded to ~12 seconds.
    ///      BUCKET_DURATION is 43200 seconds; 12s = 0.028% max drift.
    ///      Formally documented in SECURITY-ASSUMPTIONS-RC0.md (SWC-116 accepted risk).
    // slither-disable-next-line timestamp
    function validateSpend(
        address wallet,
        string calldata category,
        uint256 amount,
        bytes32 contextId
    ) external view returns (bool valid, string memory reason) {
        // Fix 2: Emergency freeze check (hard revert — does not return false)
        require(!spendFrozen[wallet], "PolicyEngine: spend frozen");

        // Per-tx limit check
        uint256 limit = categoryLimits[wallet][category];
        if (limit == 0) {
            return (false, "PolicyEngine: category not configured");
        }
        if (amount > limit) {
            return (false, "PolicyEngine: amount exceeds per-tx limit");
        }

        // contextId replay check
        if (contextId != bytes32(0) && _usedContextIds[contextId]) {
            return (false, "PolicyEngine: contextId already used");
        }

        // Fix 1: Daily cumulative check using two-bucket window.
        // NOTE: dailyCategoryLimit accumulates GLOBALLY across ALL concurrent agreements
        // for this wallet and category. Per-agreement escaping is not possible.
        uint256 daily = dailyCategoryLimit[wallet][category];
        if (daily > 0) {
            uint256 accumulated = _getEffectiveSpend(wallet, category);
            if (accumulated + amount > daily) {
                return (false, "PolicyEngine: daily limit exceeded");
            }
        }

        // Fix 3: Velocity checks (0 = disabled; defaults are 0 so existing wallets unaffected)
        if (maxTxPerHour[wallet] > 0) {
            if (_getEffectiveTxCount(wallet) + 1 > maxTxPerHour[wallet]) {
                return (false, "PolicyEngine: tx rate limit exceeded");
            }
        }
        if (maxSpendPerHour[wallet] > 0) {
            if (_getEffectiveHourlySpend(wallet) + amount > maxSpendPerHour[wallet]) {
                return (false, "PolicyEngine: hourly spend limit exceeded");
            }
        }

        return (true, "");
    }

    /// @notice Record a validated spend. Only callable by the wallet itself or its registered owner.
    /// @dev ARC402Wallet MUST call this immediately after validateSpend returns (true, "").
    // slither-disable-next-line timestamp
    function recordSpend(
        address wallet,
        string calldata category,
        uint256 amount,
        bytes32 contextId
    ) external {
        require(msg.sender == wallet || msg.sender == walletOwners[wallet], "PolicyEngine: not authorized");

        // Fix 1: Record in two-bucket window (replaces old dailySpend/periodStart reset)
        _recordBucketSpend(wallet, category, amount);

        // Fix 3: Update velocity window
        _recordVelocitySpend(wallet, amount);

        // Mark contextId as used
        if (contextId != bytes32(0)) {
            _usedContextIds[contextId] = true;
        }

        emit SpendRecorded(wallet, category, amount, contextId);
    }

    // ─── Approval Tracking ────────────────────────────────────────────────────

    /// @notice Validate a proposed ERC-20 approve() call against policy.
    ///         Infinite (MAX_UINT256) approvals are always rejected.
    ///         If maxSpendPerHour is configured, large approvals are checked against it.
    // slither-disable-next-line timestamp
    function validateApproval(
        address wallet,
        address, /* token — reserved for future per-token limit checks */
        uint256 amount
    ) external view returns (bool valid, string memory reason) {
        // Hard block on frozen wallets
        require(!spendFrozen[wallet], "PolicyEngine: spend frozen");

        // Never allow infinite approvals — this is the primary bypass vector
        if (amount == type(uint256).max) {
            return (false, "PolicyEngine: infinite approval rejected");
        }

        // If a per-hour spend cap is configured, treat approval as a virtual spend
        if (maxSpendPerHour[wallet] > 0) {
            if (_getEffectiveHourlySpend(wallet) + amount > maxSpendPerHour[wallet]) {
                return (false, "PolicyEngine: approval exceeds hourly spend limit");
            }
        }

        return (true, "");
    }

    /// @notice Record an ERC-20 approval. Counts against the velocity window.
    ///         Only callable by the wallet itself or its registered owner.
    // slither-disable-next-line timestamp
    function recordApproval(address wallet, address token, uint256 amount) external {
        require(msg.sender == wallet || msg.sender == walletOwners[wallet], "PolicyEngine: not authorized");
        _recordVelocitySpend(wallet, amount);
        outstandingApprovals[wallet][token] = amount;
        emit ApprovalRecorded(wallet, token, amount);
    }

    // ─── Fix 2: Emergency freeze ──────────────────────────────────────────────

    /// @notice Freeze spending for a wallet. Callable by wallet owner or authorized watchtower.
    function freezeSpend(address wallet) external {
        require(
            msg.sender == wallet || msg.sender == walletOwners[wallet] || _authorizedFreezeAgents[wallet][msg.sender],
            "PolicyEngine: not authorized"
        );
        spendFrozen[wallet] = true;
        emit SpendFrozen(wallet, msg.sender);
    }

    /// @notice Unfreeze spending for a wallet. Only callable by the wallet or its registered owner.
    function unfreeze(address wallet) external {
        require(msg.sender == wallet || msg.sender == walletOwners[wallet], "PolicyEngine: only owner can unfreeze");
        spendFrozen[wallet] = false;
        emit SpendUnfrozen(wallet, msg.sender);
    }

    /// @notice Authorize a watchtower agent to freeze this wallet's spending.
    function authorizeFreezeAgent(address agent) external {
        _authorizedFreezeAgents[msg.sender][agent] = true;
    }

    /// @notice Revoke a watchtower agent's freeze authorization.
    function revokeFreezeAgent(address agent) external {
        _authorizedFreezeAgents[msg.sender][agent] = false;
    }

    /// @notice Returns true if the given agent is authorized to freeze wallet's spending.
    function isFreezeAgent(address wallet, address agent) external view returns (bool) {
        return _authorizedFreezeAgents[wallet][agent];
    }

    // ─── Fix 4: Per-agreement cap with 24-hour reduction timelock ─────────────

    /// @notice Queue a daily-limit reduction for wallet+category.
    ///         Only reductions (newCap < current cap) are allowed.
    ///         A 24-hour timelock applies before the new cap can be applied.
    function queueCapReduction(address wallet, string calldata category, uint256 newCap) external {
        require(walletOwners[wallet] == msg.sender || wallet == msg.sender, "PolicyEngine: not authorized");
        require(newCap < dailyCategoryLimit[wallet][category], "PolicyEngine: can only reduce cap");
        uint256 effectiveAt = block.timestamp + 86400;
        pendingCapReductions[wallet][category] = PendingCapReduction({
            newCap: newCap,
            effectiveAt: effectiveAt
        });
        emit CapReductionQueued(wallet, category, newCap, effectiveAt);
    }

    /// @notice Apply a queued cap reduction after the timelock has elapsed.
    // @dev Intentionally does not reset spend window state. Only limit values change.
    // Spend windows reset based on time only — see _recordBucketSpend.
    // slither-disable-next-line timestamp
    function applyCapReduction(address wallet, string calldata category) external {
        PendingCapReduction storage p = pendingCapReductions[wallet][category];
        require(p.effectiveAt > 0, "PolicyEngine: no pending reduction");
        require(block.timestamp >= p.effectiveAt, "PolicyEngine: timelock active");
        uint256 newCap = p.newCap;
        dailyCategoryLimit[wallet][category] = newCap;
        delete pendingCapReductions[wallet][category];
        emit CapReductionApplied(wallet, category, newCap);
    }

    // ─── Blocklist ────────────────────────────────────────────────────────────

    modifier onlyWalletOwnerOrWallet(address wallet) {
        require(
            msg.sender == wallet || msg.sender == walletOwners[wallet],
            "PolicyEngine: not authorized"
        );
        _;
    }

    /// @notice Block a provider from being hired by this wallet.
    function addToBlocklist(address wallet, address provider) external onlyWalletOwnerOrWallet(wallet) {
        require(provider != address(0), "PolicyEngine: zero provider");
        require(!_blocklist[wallet][provider], "PolicyEngine: already blocked");
        _blocklist[wallet][provider] = true;
        emit ProviderBlocked(wallet, provider);
    }

    /// @notice Remove a provider from the blocklist.
    function removeFromBlocklist(address wallet, address provider) external onlyWalletOwnerOrWallet(wallet) {
        require(_blocklist[wallet][provider], "PolicyEngine: not blocked");
        _blocklist[wallet][provider] = false;
        emit ProviderUnblocked(wallet, provider);
    }

    /// @notice Returns true if the provider is blocked by this wallet.
    function isBlocked(address wallet, address provider) external view returns (bool) {
        return _blocklist[wallet][provider];
    }

    // ─── Shortlist ────────────────────────────────────────────────────────────

    /// @notice Add a provider to the preferred list for a specific capability.
    function addPreferred(address wallet, string calldata capability, address provider)
        external onlyWalletOwnerOrWallet(wallet)
    {
        require(provider != address(0), "PolicyEngine: zero provider");
        bytes32 cap = keccak256(bytes(capability));
        require(_shortlistIdx[wallet][cap][provider] == 0, "PolicyEngine: already preferred");
        _shortlist[wallet][cap].push(provider);
        _shortlistIdx[wallet][cap][provider] = _shortlist[wallet][cap].length; // 1-based
        emit ProviderPreferred(wallet, provider, capability);
    }

    /// @notice Remove a provider from the preferred list for a capability.
    function removePreferred(address wallet, string calldata capability, address provider)
        external onlyWalletOwnerOrWallet(wallet)
    {
        bytes32 cap = keccak256(bytes(capability));
        uint256 idx = _shortlistIdx[wallet][cap][provider];
        require(idx != 0, "PolicyEngine: not preferred");

        address[] storage list = _shortlist[wallet][cap];
        uint256 lastIdx = list.length - 1;
        if (idx - 1 != lastIdx) {
            // Swap with last to preserve dense array
            address last = list[lastIdx];
            list[idx - 1] = last;
            _shortlistIdx[wallet][cap][last] = idx;
        }
        list.pop();
        delete _shortlistIdx[wallet][cap][provider];
        emit ProviderUnpreferred(wallet, provider, capability);
    }

    /// @notice Returns the preferred provider list for a wallet+capability.
    function getPreferred(address wallet, string calldata capability)
        external view returns (address[] memory)
    {
        return _shortlist[wallet][keccak256(bytes(capability))];
    }

    /// @notice Returns true if provider is preferred by this wallet for this capability.
    function isPreferred(address wallet, string calldata capability, address provider)
        external view returns (bool)
    {
        return _shortlistIdx[wallet][keccak256(bytes(capability))][provider] != 0;
    }

    // ─── DeFi Access Tier ─────────────────────────────────────────────────────

    /// @notice Opt this wallet into DeFi contract-call access. NOT enabled by default.
    function enableDefiAccess(address wallet) external onlyWalletOwnerOrWallet(wallet) {
        defiAccessEnabled[wallet] = true;
        emit DefiAccessEnabled(wallet);
    }

    /// @notice Revoke DeFi contract-call access for this wallet.
    function disableDefiAccess(address wallet) external onlyWalletOwnerOrWallet(wallet) {
        defiAccessEnabled[wallet] = false;
        emit DefiAccessDisabled(wallet);
    }

    /// @notice Add a contract address to the per-wallet DeFi whitelist.
    function whitelistContract(address wallet, address target) external onlyWalletOwnerOrWallet(wallet) {
        require(target != address(0), "PolicyEngine: zero target");
        require(_whitelistedContracts[wallet].add(target), "PolicyEngine: already whitelisted");
        emit ContractWhitelisted(wallet, target);
    }

    /// @notice Remove a contract address from the per-wallet DeFi whitelist.
    function removeWhitelistedContract(address wallet, address target) external onlyWalletOwnerOrWallet(wallet) {
        require(_whitelistedContracts[wallet].remove(target), "PolicyEngine: not whitelisted");
        emit ContractRemoved(wallet, target);
    }

    /// @notice Set the maximum value per contract call for this wallet. 0 = unlimited.
    function setMaxContractCallValue(address wallet, uint256 value) external onlyWalletOwnerOrWallet(wallet) {
        maxContractCallValue[wallet] = value;
        emit MaxContractCallValueSet(wallet, value);
    }

    /// @notice Validate a proposed external contract call against the DeFi policy.
    /// @return valid  True if the call is permitted.
    /// @return reason Human-readable rejection reason if not valid.
    function validateContractCall(
        address wallet,
        address target,
        uint256 value
    ) external view returns (bool valid, string memory reason) {
        if (!defiAccessEnabled[wallet]) {
            return (false, "PolicyEngine: DeFi access not enabled");
        }
        if (!_whitelistedContracts[wallet].contains(target)) {
            return (false, "PolicyEngine: contract not whitelisted");
        }
        uint256 maxVal = maxContractCallValue[wallet];
        if (maxVal > 0 && value > maxVal) {
            return (false, "PolicyEngine: value exceeds max contract call limit");
        }
        return (true, "");
    }

    /// @notice Returns true if the target contract is whitelisted for this wallet.
    function isContractWhitelisted(address wallet, address target) external view returns (bool) {
        return _whitelistedContracts[wallet].contains(target);
    }

    // ─── NFT Contract Governance ──────────────────────────────────────────────

    /// @notice Allow an NFT contract (ERC-721 / ERC-1155) for this wallet's governance.
    function allowNFTContract(address wallet, address nftContract) external onlyWalletOwnerOrWallet(wallet) {
        require(nftContract != address(0), "PolicyEngine: zero nft contract");
        require(_allowedNFTContracts[wallet].add(nftContract), "PolicyEngine: NFT contract already allowed");
        emit NFTContractAllowed(wallet, nftContract);
    }

    /// @notice Remove an NFT contract from this wallet's allowed list.
    function disallowNFTContract(address wallet, address nftContract) external onlyWalletOwnerOrWallet(wallet) {
        require(_allowedNFTContracts[wallet].remove(nftContract), "PolicyEngine: NFT contract not allowed");
        emit NFTContractDisallowed(wallet, nftContract);
    }

    /// @notice Returns true if the NFT contract is allowed for this wallet.
    function isNFTContractAllowed(address wallet, address nftContract) external view returns (bool) {
        return _allowedNFTContracts[wallet].contains(nftContract);
    }
}
