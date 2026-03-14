// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPolicyEngine.sol";
import "./ITrustRegistry.sol";
import "./IIntentAttestation.sol";
import "./ARC402Registry.sol";
import "./SettlementCoordinator.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ARC402Wallet
 * @notice Reference implementation of an ARC-402 agentic wallet
 * @dev ERC-4337 compatible. Implements Policy, Context, Trust, and Intent primitives.
 *      Supports both ETH and ERC-20 (e.g. USDC) governed spending for x402 integration.
 *      Registry-based upgrade: owner can point wallet at a new ARC402Registry to opt into
 *      new infrastructure versions. Nobody else can force an upgrade.
 * STATUS: Production-ready — audited 2026-03-14
 */
/// @dev Minimal interface for PolicyEngine DeFi access validation (avoids circular imports).
interface IDefiPolicy {
    function validateContractCall(
        address wallet,
        address target,
        uint256 value
    ) external view returns (bool valid, string memory reason);

    function validateApproval(
        address wallet,
        address token,
        uint256 amount
    ) external view returns (bool valid, string memory reason);
}

contract ARC402Wallet is ReentrancyGuard {
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

    // ─── Guardian State ───────────────────────────────────────────────────────

    /// @notice Emergency freeze guardian. Can only call freeze() and freezeAndDrain().
    ///         Held by the AI agent. Cannot unfreeze — only owner can unfreeze.
    address public guardian;

    // ─── Circuit Breaker State ────────────────────────────────────────────────

    bool public frozen;
    uint256 public frozenAt;
    address public frozenBy;

    // ─── Velocity Limit State (two-bucket rolling window) ────────────────────
    //
    // MA-05 FIX: Replace discrete-reset single window with a two-bucket approach
    // matching PolicyEngine. Worst-case boundary spend is 1.5× per-bucket limit
    // instead of 2× (discrete reset). Effective spend = current + previous bucket.

    uint256 public constant VELOCITY_BUCKET_DURATION = 43200; // 12 hours

    struct WalletVelocityBucket {
        uint256 bucketStart;
        uint256 curEth;
        uint256 prevEth;
        uint256 curToken;
        uint256 prevToken;
    }

    WalletVelocityBucket private _walletVelocity;

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
    event GuardianUpdated(address indexed newGuardian);
    event VelocityLimitUpdated(uint256 newLimit);
    event InterceptorUpdated(address indexed interceptor);
    event ContractCallExecuted(address indexed target, uint256 value, bytes data, uint256 returnValue);

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

    // ─── Guardian Management ──────────────────────────────────────────────────

    /// @notice Update guardian address. Only owner can change guardian.
    function setGuardian(address _guardian) external onlyOwner {
        guardian = _guardian;
        emit GuardianUpdated(_guardian);
    }

    // ─── Circuit Breaker ──────────────────────────────────────────────────────

    /// @notice Owner-initiated freeze with a reason string.
    function freeze(string calldata reason) external onlyOwner {
        require(!frozen, "ARC402: already frozen");
        frozen = true;
        frozenAt = block.timestamp;
        frozenBy = msg.sender;
        emit WalletFrozen(msg.sender, reason, block.timestamp);
    }

    /// @notice Emergency freeze. Can only be called by guardian.
    ///         Guardian is the AI agent's designated emergency key.
    ///         Guardian cannot unfreeze — only owner can.
    function freeze() external {
        require(guardian != address(0), "ARC402: guardian not set");
        require(msg.sender == guardian, "ARC402: not guardian");
        frozen = true;
        frozenAt = block.timestamp;
        frozenBy = msg.sender;
        emit WalletFrozen(msg.sender, "guardian emergency freeze", block.timestamp);
    }

    /// @notice Emergency freeze with fund extraction.
    ///         Freezes wallet AND transfers all ETH and specified ERC-20 balances to owner.
    ///         Use when machine compromise is suspected.
    /// @param tokens Array of ERC-20 token addresses to drain in addition to ETH.
    function freezeAndDrain(address[] calldata tokens) external {
        require(guardian != address(0), "ARC402: guardian not set");
        require(msg.sender == guardian, "ARC402: not guardian");
        frozen = true;
        frozenAt = block.timestamp;
        frozenBy = msg.sender;
        emit WalletFrozen(msg.sender, "guardian freeze-and-drain", block.timestamp);

        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool ok,) = owner.call{value: balance}("");
            require(ok, "ARC402: drain failed");
        }

        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 tokenBalance = IERC20(tokens[i]).balanceOf(address(this));
            if (tokenBalance > 0) {
                IERC20(tokens[i]).safeTransfer(owner, tokenBalance);
            }
        }
    }

    /// @notice Unfreeze. Only owner can unfreeze — guardian cannot.
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

        // 3. Two-bucket rolling window velocity check (MA-05: worst-case 1.5× vs 2× discrete reset)
        _advanceVelocityBucket();
        _walletVelocity.curEth += amount;
        uint256 effectiveEth = _walletVelocity.curEth + _walletVelocity.prevEth;
        if (velocityLimit > 0 && effectiveEth > velocityLimit) {
            frozen = true;
            frozenAt = block.timestamp;
            frozenBy = address(this);
            emit WalletFrozen(address(this), "velocity limit exceeded", block.timestamp);
            revert("ARC402: velocity limit exceeded");
        }

        // 4. Consume attestation (single-use), record spend, then execute transfer (CEI)
        _intentAttestation().consume(attestationId);
        _policyEngine().recordSpend(address(this), category, amount, activeContextId);
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

        // 3. Two-bucket rolling window velocity check (MA-05: ETH and token tracked separately — units incommensurable)
        _advanceVelocityBucket();
        _walletVelocity.curToken += amount;
        uint256 effectiveToken = _walletVelocity.curToken + _walletVelocity.prevToken;
        if (velocityLimit > 0 && effectiveToken > velocityLimit) {
            frozen = true;
            frozenAt = block.timestamp;
            frozenBy = address(this);
            emit WalletFrozen(address(this), "velocity limit exceeded", block.timestamp);
            revert("ARC402: velocity limit exceeded");
        }

        // 4. Consume attestation (single-use), record spend, emit, then transfer (CEI)
        _intentAttestation().consume(attestationId);
        _policyEngine().recordSpend(address(this), category, amount, activeContextId);
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
        // slither-disable-next-line unused-return
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

    // ─── DeFi Contract Calls ──────────────────────────────────────────────────

    /// @notice Parameters for a governed external contract call.
    struct ContractCallParams {
        address target;           // Contract to call
        bytes   data;             // Calldata
        uint256 value;            // ETH value to forward (wei)
        uint256 minReturnValue;   // Minimum acceptable return value (0 = no slippage check)
        uint256 maxApprovalAmount;// ERC-20 approval ceiling for this tx (NOT infinite)
        address approvalToken;    // ERC-20 token to approve (address(0) = no approval)
    }

    /// @notice Execute a governed DeFi contract call.
    ///         Validates against PolicyEngine DeFi whitelist, sets a per-tx ERC-20 approval
    ///         (never infinite), resets approval after the call, and checks slippage.
    /// @dev nonReentrant prevents callback exploits. onlyOwner restricts to wallet owner.
    function executeContractCall(ContractCallParams calldata params)
        external
        nonReentrant
        onlyOwner
        notFrozen
        returns (bytes memory returnData)
    {
        // 1. Validate via PolicyEngine DeFi access tier
        (bool valid, string memory reason) = IDefiPolicy(registry.policyEngine()).validateContractCall(
            address(this),
            params.target,
            params.value
        );
        require(valid, reason);

        // 1b. Detect ERC-20 approve() calls and validate approval amount against policy.
        //     approve(address,uint256) selector = 0x095ea7b3
        //     ABI layout: [0:4]=selector [4:36]=spender [36:68]=amount
        if (params.data.length >= 68) {
            bytes4 sel;
            uint256 approvalAmount;
            bytes calldata d = params.data;
            assembly {
                sel := calldataload(d.offset)
                approvalAmount := calldataload(add(d.offset, 36))
            }
            if (sel == bytes4(0x095ea7b3)) {
                (bool approveOk, string memory approveReason) = IDefiPolicy(registry.policyEngine()).validateApproval(
                    address(this), params.target, approvalAmount
                );
                require(approveOk, approveReason);
            }
        }

        // 2. Per-tx ERC-20 approval — NOT infinite
        if (params.approvalToken != address(0) && params.maxApprovalAmount > 0) {
            IERC20(params.approvalToken).forceApprove(params.target, params.maxApprovalAmount);
        }

        // 3. Call target
        bool success;
        (success, returnData) = params.target.call{value: params.value}(params.data);
        require(success, "ARC402: contract call failed");

        // 4. Reset approval to 0 (prevent residual allowance)
        if (params.approvalToken != address(0) && params.maxApprovalAmount > 0) {
            IERC20(params.approvalToken).forceApprove(params.target, 0);
        }

        // 5. Slippage check — only if caller specified a minimum return value
        uint256 returnValue = 0;
        if (params.minReturnValue > 0) {
            require(returnData.length >= 32, "ARC402: return data too short for slippage check");
            returnValue = abi.decode(returnData, (uint256));
            require(returnValue >= params.minReturnValue, "ARC402: slippage exceeded");
        }

        emit ContractCallExecuted(params.target, params.value, params.data, returnValue);
    }

    // ─── NFT Receiver Interfaces ──────────────────────────────────────────────

    /// @notice Accept ERC-721 safe transfers into this wallet.
    /// @return IERC721Receiver.onERC721Received.selector (0x150b7a02)
    function onERC721Received(
        address, /* operator */
        address, /* from */
        uint256, /* tokenId */
        bytes calldata /* data */
    ) external pure returns (bytes4) {
        return 0x150b7a02;
    }

    /// @notice Accept ERC-1155 safe transfers into this wallet.
    /// @return IERC1155Receiver.onERC1155Received.selector (0xf23a6e61)
    function onERC1155Received(
        address, /* operator */
        address, /* from */
        uint256, /* id */
        uint256, /* value */
        bytes calldata /* data */
    ) external pure returns (bytes4) {
        return 0xf23a6e61;
    }

    /// @notice Accept ERC-1155 batch safe transfers into this wallet.
    /// @return IERC1155Receiver.onERC1155BatchReceived.selector (0xbc197c81)
    function onERC1155BatchReceived(
        address, /* operator */
        address, /* from */
        uint256[] calldata, /* ids */
        uint256[] calldata, /* values */
        bytes calldata /* data */
    ) external pure returns (bytes4) {
        return 0xbc197c81;
    }

    // ─── Velocity Bucket Helper ───────────────────────────────────────────────

    /// @dev MA-05: Advance the two-bucket rolling window if needed.
    ///      - If one bucket has elapsed: rotate current → previous, reset current.
    ///      - If two buckets have elapsed: full reset (previous also zeroed).
    ///      This ensures effective spend = curEth + prevEth never exceeds 1.5× the limit
    ///      at a boundary, compared to 2× with a discrete single-bucket reset.
    function _advanceVelocityBucket() internal {
        WalletVelocityBucket storage v = _walletVelocity;
        if (block.timestamp >= v.bucketStart + VELOCITY_BUCKET_DURATION) {
            if (block.timestamp >= v.bucketStart + 2 * VELOCITY_BUCKET_DURATION) {
                v.prevEth = 0;
                v.prevToken = 0;
            } else {
                v.prevEth = v.curEth;
                v.prevToken = v.curToken;
            }
            v.curEth = 0;
            v.curToken = 0;
            v.bucketStart = block.timestamp;
        }
    }

    // ─── Receive ─────────────────────────────────────────────────────────────

    receive() external payable {}
}
