// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPolicyEngine.sol";
import "./ITrustRegistry.sol";
import "./IIntentAttestation.sol";
import "./ARC402Registry.sol";
import "./SettlementCoordinator.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ARC402Wallet
 * @notice Reference implementation of an ARC-402 agentic wallet
 * @dev ERC-4337 compatible. Implements Policy, Context, Trust, and Intent primitives.
 *      Supports both ETH and ERC-20 (e.g. USDC) governed spending for x402 integration.
 *      Registry-based upgrade: owner can point wallet at a new ARC402Registry to opt into
 *      new infrastructure versions. Nobody else can force an upgrade.
 * STATUS: DRAFT — not audited, do not use in production
 */
contract ARC402Wallet {
    using SafeERC20 for IERC20;

    // ─── State ───────────────────────────────────────────────────────────────

    address public immutable owner;
    ARC402Registry public registry;  // NOT immutable — can be updated by owner

    bytes32 public activePolicyId;
    bytes32 public activeContextId;
    string public activeTaskType;
    bool public contextOpen;
    uint256 public contextOpenedAt;

    // ─── Authorized Interceptor ───────────────────────────────────────────────

    /// @notice Address allowed to call executeTokenSpend on behalf of the owner.
    ///         Set by owner via setAuthorizedInterceptor(). Used by X402Interceptor.
    address public authorizedInterceptor;

    // ─── Circuit Breaker State ────────────────────────────────────────────────

    bool public frozen;
    uint256 public frozenAt;
    address public frozenBy;

    // ─── Velocity Limit State ─────────────────────────────────────────────────

    uint256 public spendingWindowStart;
    /// @notice ETH spend accumulator for rolling velocity window. Unit: wei.
    uint256 public ethSpendingInWindow;
    /// @notice ERC-20 spend accumulator for rolling velocity window. Unit: token-native (e.g. USDC 1e6).
    ///         Tracked separately from ETH — units are incommensurable.
    uint256 public tokenSpendingInWindow;
    uint256 public constant SPEND_WINDOW = 1 days;
    uint256 public velocityLimit; // 0 = disabled; applied independently to ETH and token paths

    // ─── Registry Timelock State ──────────────────────────────────────────────

    uint256 public constant REGISTRY_TIMELOCK = 2 days;
    address public pendingRegistry;
    uint256 public registryUpdateUnlockAt;

    // ─── Events ──────────────────────────────────────────────────────────────

    event RegistryUpdateProposed(address indexed newRegistry, uint256 unlockAt);
    event RegistryUpdateExecuted(address indexed oldRegistry, address indexed newRegistry);
    event RegistryUpdateCancelled(address indexed cancelledRegistry);
    event ContextOpened(bytes32 indexed contextId, string taskType, uint256 timestamp);
    event ContextClosed(bytes32 indexed contextId, uint256 timestamp);
    event SpendExecuted(address indexed recipient, uint256 amount, string category, bytes32 attestationId);
    event SpendRejected(address indexed recipient, uint256 amount, string reason);
    event TokenSpendExecuted(address indexed token, address indexed recipient, uint256 amount, string category, bytes32 attestationId);
    event PolicyUpdated(bytes32 newPolicyId);
    event SettlementProposed(address indexed recipientWallet, uint256 amount, bytes32 attestationId);
    event WalletFrozen(address indexed by, string reason, uint256 timestamp);
    event WalletUnfrozen(address indexed by, uint256 timestamp);
    event VelocityLimitUpdated(uint256 newLimit);
    event InterceptorUpdated(address indexed interceptor);

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "ARC402: not owner");
        _;
    }

    modifier onlyOwnerOrInterceptor() {
        require(
            msg.sender == owner || msg.sender == authorizedInterceptor,
            "ARC402: not authorized"
        );
        _;
    }

    modifier requireOpenContext() {
        require(contextOpen, "ARC402: no active context");
        _;
    }

    modifier notFrozen() {
        require(!frozen, "ARC402: wallet frozen");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _registry, address _owner) {
        require(_owner != address(0), "ARC402: zero owner");
        owner = _owner;
        registry = ARC402Registry(_registry);
        _trustRegistry().initWallet(address(this));
    }

    // ─── Registry Upgrade (timelocked — owner-controlled) ────────────────────

    /**
     * @notice Begin a registry upgrade. Starts a 2-day timelock before the new
     *         registry can be activated. Gives the owner time to cancel if phished.
     * @param newRegistry The candidate registry address.
     */
    function proposeRegistryUpdate(address newRegistry) external onlyOwner {
        require(newRegistry != address(0), "ARC402: zero registry");
        require(pendingRegistry == address(0), "ARC402: upgrade already pending - cancel first");
        pendingRegistry = newRegistry;
        registryUpdateUnlockAt = block.timestamp + REGISTRY_TIMELOCK;
        emit RegistryUpdateProposed(newRegistry, registryUpdateUnlockAt);
    }

    /**
     * @notice Complete a registry upgrade after the timelock has elapsed.
     */
    function executeRegistryUpdate() external onlyOwner {
        require(pendingRegistry != address(0), "ARC402: no pending registry");
        require(block.timestamp >= registryUpdateUnlockAt, "ARC402: timelock not elapsed");
        address old = address(registry);
        registry = ARC402Registry(pendingRegistry);
        pendingRegistry = address(0);
        registryUpdateUnlockAt = 0;
        emit RegistryUpdateExecuted(old, address(registry));
    }

    /**
     * @notice Cancel a pending registry upgrade.
     */
    function cancelRegistryUpdate() external onlyOwner {
        require(pendingRegistry != address(0), "ARC402: no pending registry");
        address cancelled = pendingRegistry;
        pendingRegistry = address(0);
        registryUpdateUnlockAt = 0;
        emit RegistryUpdateCancelled(cancelled);
    }

    // ─── Interceptor Authorization ────────────────────────────────────────────

    /**
     * @notice Authorize an X402Interceptor contract to call executeTokenSpend.
     * @dev Without this, X402Interceptor.executeX402Payment() would revert because
     *      msg.sender would be the interceptor, not the owner EOA.
     * @param interceptor The X402Interceptor contract address to authorize.
     */
    function setAuthorizedInterceptor(address interceptor) external onlyOwner {
        require(interceptor != address(0), "ARC402: zero interceptor");
        authorizedInterceptor = interceptor;
        emit InterceptorUpdated(interceptor);
    }

    // ─── Circuit Breaker ──────────────────────────────────────────────────────

    function freeze(string calldata reason) external onlyOwner {
        require(!frozen, "ARC402: already frozen");
        frozen = true;
        frozenAt = block.timestamp;
        frozenBy = msg.sender;
        emit WalletFrozen(msg.sender, reason, block.timestamp);
    }

    function unfreeze() external onlyOwner {
        require(frozen, "ARC402: not frozen");
        frozen = false;
        emit WalletUnfrozen(msg.sender, block.timestamp);
    }

    function setVelocityLimit(uint256 limit) external onlyOwner {
        velocityLimit = limit;
        emit VelocityLimitUpdated(limit);
    }

    // ─── Internal Contract Accessors ─────────────────────────────────────────

    function _policyEngine() internal view returns (IPolicyEngine) {
        return IPolicyEngine(registry.policyEngine());
    }

    function _trustRegistry() internal view returns (ITrustRegistry) {
        return ITrustRegistry(registry.trustRegistry());
    }

    function _intentAttestation() internal view returns (IIntentAttestation) {
        return IIntentAttestation(registry.intentAttestation());
    }

    function _settlementCoordinator() internal view returns (SettlementCoordinator) {
        return SettlementCoordinator(registry.settlementCoordinator());
    }

    // ─── Intent Attestation ───────────────────────────────────────────────────

    /**
     * @notice Create an intent attestation on behalf of this wallet.
     *         Must be called before executeSpend/executeTokenSpend.
     * @param attestationId Unique ID for this attestation
     * @param action Human-readable action type (e.g. "pay_api", "settle_claim")
     * @param reason Reason for the spend
     * @param recipient Intended recipient address
     * @param amount Intended spend amount
     * @param token Token address (address(0) for ETH, token address for ERC-20)
     * @param expiresAt Unix timestamp after which attestation is invalid (0 = no expiry)
     * @return attestationId The ID passed in (for convenience)
     */
    function attest(
        bytes32 attestationId,
        string calldata action,
        string calldata reason,
        address recipient,
        uint256 amount,
        address token,
        uint256 expiresAt
    ) external onlyOwner returns (bytes32) {
        _intentAttestation().attest(attestationId, action, reason, recipient, amount, token, expiresAt);
        return attestationId;
    }

    // ─── Context Management ──────────────────────────────────────────────────

    function openContext(bytes32 contextId, string calldata taskType) external onlyOwner {
        require(!contextOpen, "ARC402: context already open");
        activeContextId = contextId;
        activeTaskType = taskType;
        contextOpen = true;
        contextOpenedAt = block.timestamp;
        emit ContextOpened(contextId, taskType, block.timestamp);
    }

    function closeContext() external onlyOwner requireOpenContext {
        bytes32 closedContextId = activeContextId;
        activeContextId = bytes32(0);
        activeTaskType = "";
        contextOpen = false;
        emit ContextClosed(closedContextId, block.timestamp);
        // Trust updates via ServiceAgreement.fulfill() only — see spec/03-trust-primitive.md
    }

    // ─── ETH Spend Execution ─────────────────────────────────────────────────

    function executeSpend(
        address payable recipient,
        uint256 amount,
        string calldata category,
        bytes32 attestationId
    ) external onlyOwner requireOpenContext notFrozen {
        require(recipient != address(0), "ARC402: zero address recipient");

        // 1. Verify intent attestation exists and matches spend parameters
        require(
            _intentAttestation().verify(attestationId, address(this), recipient, amount, address(0)),
            "ARC402: invalid intent attestation"
        );

        // 2. Validate against policy
        (bool valid, string memory reason) = _policyEngine().validateSpend(
            address(this),
            category,
            amount,
            activeContextId
        );

        if (!valid) {
            emit SpendRejected(recipient, amount, reason);
            // Trust updates via ServiceAgreement.fulfill() only — see spec/03-trust-primitive.md
            revert(reason);
        }
        _policyEngine().recordSpend(address(this), category, amount, activeContextId);

        // 3. Rolling window velocity check (ETH path — unit: wei)
        if (block.timestamp > spendingWindowStart + SPEND_WINDOW) {
            spendingWindowStart = block.timestamp;
            ethSpendingInWindow = 0;
            tokenSpendingInWindow = 0;
        }
        ethSpendingInWindow += amount;
        if (velocityLimit > 0 && ethSpendingInWindow > velocityLimit) {
            // Freeze persists (no revert here); current spend is silently blocked.
            // All subsequent calls will fail at the notFrozen modifier.
            frozen = true;
            frozenAt = block.timestamp;
            emit WalletFrozen(address(this), "velocity limit exceeded", block.timestamp);
            return;
        }

        // 4. Consume attestation (single-use) then execute transfer (CEI pattern)
        _intentAttestation().consume(attestationId);
        emit SpendExecuted(recipient, amount, category, attestationId);
        (bool success,) = recipient.call{value: amount}("");
        require(success, "ARC402: transfer failed");
    }

    // ─── ERC-20 Token Spend Execution (x402 / USDC) ──────────────────────────

    /**
     * @notice Execute a governed ERC-20 token spend (e.g. USDC for x402 payments)
     * @param token ERC-20 token address (e.g. USDC)
     * @param recipient Payment recipient
     * @param amount Token amount (in token decimals)
     * @param category Policy category for validation
     * @param attestationId Pre-created intent attestation
     */
    function executeTokenSpend(
        address token,
        address recipient,
        uint256 amount,
        string calldata category,
        bytes32 attestationId
    ) external onlyOwnerOrInterceptor requireOpenContext notFrozen {
        require(recipient != address(0), "ARC402: zero address recipient");
        require(token != address(0), "ARC402: zero token address");

        // 1. Verify intent attestation exists and matches spend parameters
        require(
            _intentAttestation().verify(attestationId, address(this), recipient, amount, token),
            "ARC402: invalid attestation"
        );

        // 2. Validate policy
        (bool valid, string memory reason) = _policyEngine().validateSpend(
            address(this), category, amount, activeContextId
        );
        if (!valid) {
            emit SpendRejected(recipient, amount, reason);
            // Trust updates via ServiceAgreement.fulfill() only — see spec/03-trust-primitive.md
            revert(reason);
        }
        _policyEngine().recordSpend(address(this), category, amount, activeContextId);

        // 3. Rolling window velocity check (token path — unit: token-native, e.g. USDC 1e6)
        //    Tracked separately from ethSpendingInWindow — units are incommensurable.
        if (block.timestamp > spendingWindowStart + SPEND_WINDOW) {
            spendingWindowStart = block.timestamp;
            ethSpendingInWindow = 0;
            tokenSpendingInWindow = 0;
        }
        tokenSpendingInWindow += amount;
        if (velocityLimit > 0 && tokenSpendingInWindow > velocityLimit) {
            // Freeze persists (no revert here); current spend is silently blocked.
            // All subsequent calls will fail at the notFrozen modifier.
            frozen = true;
            frozenAt = block.timestamp;
            emit WalletFrozen(address(this), "velocity limit exceeded", block.timestamp);
            return;
        }

        // 4. Consume attestation (single-use), emit, then transfer (CEI pattern)
        _intentAttestation().consume(attestationId);
        emit TokenSpendExecuted(token, recipient, amount, category, attestationId);

        // 5. Execute ERC-20 transfer
        IERC20(token).safeTransfer(recipient, amount);
    }

    // ─── Multi-Agent Settlement ───────────────────────────────────────────────

    function proposeMASSettlement(
        address recipientWallet,
        uint256 amount,
        string calldata category,
        bytes32 attestationId
    ) external onlyOwner requireOpenContext notFrozen {
        require(
            _intentAttestation().verify(attestationId, address(this), recipientWallet, amount, address(0)),
            "ARC402: invalid intent attestation"
        );
        (bool valid, string memory reason) = _policyEngine().validateSpend(
            address(this),
            category,
            amount,
            activeContextId
        );
        require(valid, reason);
        _policyEngine().recordSpend(address(this), category, amount, activeContextId);
        _intentAttestation().consume(attestationId);
        emit SettlementProposed(recipientWallet, amount, attestationId);
        _settlementCoordinator().propose(
            address(this),
            recipientWallet,
            amount,
            address(0),
            attestationId,
            block.timestamp + 1 days
        );
    }

    // ─── Policy Management ───────────────────────────────────────────────────

    function updatePolicy(bytes32 newPolicyId) external onlyOwner {
        activePolicyId = newPolicyId;
        emit PolicyUpdated(newPolicyId);
    }

    // ─── Trust Query ─────────────────────────────────────────────────────────

    function getTrustScore() external view returns (uint256) {
        return _trustRegistry().getScore(address(this));
    }

    // ─── Context Query ───────────────────────────────────────────────────────

    function getActiveContext() external view returns (bytes32, string memory, uint256, bool) {
        return (activeContextId, activeTaskType, contextOpenedAt, contextOpen);
    }

    // ─── Receive ─────────────────────────────────────────────────────────────

    receive() external payable {}
}
