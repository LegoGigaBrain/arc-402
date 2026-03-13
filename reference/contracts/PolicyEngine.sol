// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPolicyEngine.sol";

/**
 * @title PolicyEngine
 * @notice Stores and validates spending policies for ARC-402 wallets
 * STATUS: DRAFT — not audited, do not use in production
 */
contract PolicyEngine is IPolicyEngine {
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

    // Cumulative spend tracking
    mapping(address => mapping(string => uint256)) public dailySpend;
    mapping(address => mapping(string => uint256)) public periodStart;

    // contextId deduplication — prevents same agreement being validated twice
    mapping(bytes32 => bool) private _usedContextIds;

    // ─── Blocklist ───────────────────────────────────────────────────────────

    /// @notice wallet → provider → blocked
    mapping(address => mapping(address => bool)) private _blocklist;

    // ─── Shortlist (preferred providers per capability) ───────────────────────

    /// @notice wallet → capabilityHash → preferred provider list
    mapping(address => mapping(bytes32 => address[])) private _shortlist;
    /// @notice wallet → capabilityHash → provider → 1-based index (0 = not present)
    mapping(address => mapping(bytes32 => mapping(address => uint256))) private _shortlistIdx;

    event PolicySet(address indexed wallet, bytes32 policyHash);
    event CategoryLimitSet(address indexed wallet, string category, uint256 limitPerTx);
    event DailyCategoryLimitSet(address indexed wallet, string category, uint256 dailyLimit);
    event SpendRecorded(address indexed wallet, string category, uint256 amount, bytes32 contextId);
    event ProviderBlocked(address indexed wallet, address indexed provider);
    event ProviderUnblocked(address indexed wallet, address indexed provider);
    event ProviderPreferred(address indexed wallet, address indexed provider, string capability);
    event ProviderUnpreferred(address indexed wallet, address indexed provider, string capability);

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

    function setCategoryLimit(string calldata category, uint256 limitPerTx) external {
        categoryLimits[msg.sender][category] = limitPerTx;
        emit CategoryLimitSet(msg.sender, category, limitPerTx);
    }

    function setCategoryLimitFor(address wallet, string calldata category, uint256 limitPerTx) external {
        // Allow owner to set limits for their wallet
        require(walletOwners[wallet] == msg.sender || wallet == msg.sender, "PolicyEngine: not authorized");
        categoryLimits[wallet][category] = limitPerTx;
        emit CategoryLimitSet(wallet, category, limitPerTx);
    }

    function setDailyLimit(string calldata category, uint256 limit) external {
        dailyCategoryLimit[msg.sender][category] = limit;
        emit DailyCategoryLimitSet(msg.sender, category, limit);
    }

    function setDailyLimitFor(address wallet, string calldata category, uint256 limit) external {
        require(walletOwners[wallet] == msg.sender || wallet == msg.sender, "PolicyEngine: not authorized");
        dailyCategoryLimit[wallet][category] = limit;
        emit DailyCategoryLimitSet(wallet, category, limit);
    }

    function validateSpend(
        address wallet,
        string calldata category,
        uint256 amount,
        bytes32 contextId
    ) external view returns (bool valid, string memory reason) {
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

        // Daily cumulative check
        // NOTE: "Daily" limit uses a rolling 24-hour window from the first spend of a period,
        // NOT calendar-day resets. On Base L2, block.timestamp is reliable to within ~2 seconds.
        // This is intentional — UTC midnight resets require oracle coordination and add complexity.
        // NOTE: dailySpend[wallet][category] accumulates GLOBALLY across ALL concurrent agreements
        // for this wallet and category. If 100 agreements each call recordSpend in the same period,
        // the accumulator reflects the sum of all of them. Per-agreement escaping is not possible.
        uint256 daily = dailyCategoryLimit[wallet][category];
        if (daily > 0) {
            uint256 accumulated = (block.timestamp > periodStart[wallet][category] + 1 days)
                ? 0
                : dailySpend[wallet][category];
            if (accumulated + amount > daily) {
                return (false, "PolicyEngine: daily limit exceeded");
            }
        }

        return (true, "");
    }

    /// @notice Record a validated spend. Only callable by the wallet itself or its registered owner.
    /// @dev ARC402Wallet MUST call this immediately after validateSpend returns (true, "").
    function recordSpend(
        address wallet,
        string calldata category,
        uint256 amount,
        bytes32 contextId
    ) external {
        require(msg.sender == wallet || msg.sender == walletOwners[wallet], "PolicyEngine: not authorized");

        // Reset period if expired
        if (block.timestamp > periodStart[wallet][category] + 1 days) {
            dailySpend[wallet][category] = 0;
            periodStart[wallet][category] = block.timestamp;
        }

        // Accumulate
        dailySpend[wallet][category] += amount;

        // Mark contextId as used
        if (contextId != bytes32(0)) {
            _usedContextIds[contextId] = true;
        }

        emit SpendRecorded(wallet, category, amount, contextId);
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
}
