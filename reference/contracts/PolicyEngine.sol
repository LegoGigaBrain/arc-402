// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPolicyEngine.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title PolicyEngine
 * @notice Stores and validates spending policies for ARC-402 wallets
 * STATUS: DRAFT — not audited, do not use in production
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

    // Cumulative spend tracking
    mapping(address => mapping(string => uint256)) public dailySpend;
    mapping(address => mapping(string => uint256)) public periodStart;

    // contextId deduplication — prevents same agreement being validated twice
    mapping(bytes32 => bool) private _usedContextIds;

    // ─── DeFi Access Tier ─────────────────────────────────────────────────────
    // Opt-in DeFi access — NOT enabled by default.
    mapping(address => bool) public defiAccessEnabled;
    /// @dev Per-wallet whitelist of allowed external contract targets.
    mapping(address => EnumerableSet.AddressSet) private _whitelistedContracts;
    /// @notice Maximum value (wei / token units) allowed per contract call. 0 = unlimited.
    mapping(address => uint256) public maxContractCallValue;
    /// @dev Per-wallet allowed NFT contracts (ERC-721 / ERC-1155).
    mapping(address => EnumerableSet.AddressSet) private _allowedNFTContracts;

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
    event DefiAccessEnabled(address indexed wallet);
    event DefiAccessDisabled(address indexed wallet);
    event ContractWhitelisted(address indexed wallet, address indexed target);
    event ContractRemoved(address indexed wallet, address indexed target);
    event MaxContractCallValueSet(address indexed wallet, uint256 value);
    event NFTContractAllowed(address indexed wallet, address indexed nftContract);
    event NFTContractDisallowed(address indexed wallet, address indexed nftContract);

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

    /// @dev Uses block.timestamp for rolling daily window tracking.
    ///      Validator timestamp manipulation is bounded to ~12 seconds.
    ///      Daily window is 86400 seconds; 12s = 0.014% max drift.
    ///      Formally documented in SECURITY-ASSUMPTIONS-RC0.md (SWC-116 accepted risk).
    // slither-disable-next-line timestamp
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
    // slither-disable-next-line timestamp
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
