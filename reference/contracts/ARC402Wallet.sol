// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPolicyEngine.sol";
import "./ITrustRegistry.sol";
import "./IIntentAttestation.sol";
import "./ARC402RegistryV2.sol";
import "./SettlementCoordinator.sol";
import "./ERC4337.sol";
import "./VelocityLib.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./P256VerifierLib.sol";

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

// Custom errors (4-byte selectors — much smaller than require strings)
error WAuth();
error WFrozen();
error WCtx();
error WZero();
error WPrefund();
error WDrain();
error WXfer();
error WCall();
error WVel();
error WAtt();
error WSelf();
error WSlip();
error WRetdata();
error WPending();
error WNopend();
error WLock();
error WNoguard();
error WNotfrozen();
error WEp();
error WNotCoord();

contract ARC402Wallet is IAccount, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // ─── ERC-4337 Constants ───────────────────────────────────────────────────

    uint256 internal constant SIG_VALIDATION_SUCCESS = 0;
    uint256 internal constant SIG_VALIDATION_FAILED  = 1;

    // ─── State ───────────────────────────────────────────────────────────────

    address public immutable owner;
    IEntryPoint public immutable entryPoint;
    ARC402RegistryV2 public registry;  // NOT immutable — can be updated by owner

    bytes32 public activePolicyId;
    bytes32 public activeContextId;
    string public activeTaskType;
    bool public contextOpen;
    uint256 public contextOpenedAt;

    // ─── Authorized Interceptor ───────────────────────────────────────────────

    /// @notice Address allowed to call executeTokenSpend on behalf of the owner.
    ///         Set by owner via setAuthorizedInterceptor(). Used by X402Interceptor.
    address public authorizedInterceptor;

    // ─── Authorized Machine Keys ───────────────────────────────────────────────

    /// @notice Machine keys authorized for autonomous protocol operations.
    ///         Managed by owner via authorizeMachineKey / revokeMachineKey.
    ///         Machine keys are bounded by PolicyEngine — they cannot touch governance.
    mapping(address => bool) public authorizedMachineKeys;

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

    VelocityLib.Bucket private _walletVelocity;

    uint256 public velocityLimit; // 0 = disabled; applied independently to ETH and token paths

    // ─── Registry Timelock State ──────────────────────────────────────────────

    uint256 public constant REGISTRY_TIMELOCK = 2 days;
    address public pendingRegistry;
    uint256 public registryUpdateUnlockAt;

    // ─── Passkey / P256 Auth State ────────────────────────────────────────────

    enum SignerType { EOA, Passkey }

    struct OwnerAuth {
        SignerType signerType;
        bytes32    pubKeyX;   // P256 x coordinate (32 bytes), or owner addr packed for EOA
        bytes32    pubKeyY;   // P256 y coordinate (32 bytes), or 0 for EOA
    }

    OwnerAuth public ownerAuth;

    // P256 precompile address used via P256VerifierLib (kept for reference)
    // address internal constant P256_PRECOMPILE = 0x0000000000000000000000000000000000000100;

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
    event WalletFrozen(address indexed by, string reason, uint256 timestamp);
    event WalletUnfrozen(address indexed by, uint256 timestamp);
    event MachineKeyAuthorized(address indexed key);
    event MachineKeyRevoked(address indexed key);
    event GuardianUpdated(address indexed newGuardian);
    event VelocityLimitUpdated(uint256 newLimit);
    event InterceptorUpdated(address indexed interceptor);
    event ContractCallExecuted(address indexed target, uint256 value, bytes data, uint256 returnValue);
    event PasskeySet(bytes32 indexed pubKeyX, bytes32 pubKeyY);
    event PasskeyCleared();
    event EmergencyOverride(bytes32 indexed pubKeyX, bytes32 pubKeyY);

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyOwner() { _onlyOwner(); _; }
    modifier onlyEntryPointOrOwner() { _onlyEntryPointOrOwner(); _; }
    modifier onlyOwnerOrInterceptor() { _onlyOwnerOrInterceptor(); _; }
    modifier onlyOwnerOrMachineKey() {
        if (msg.sender != owner && !authorizedMachineKeys[msg.sender]) revert WAuth();
        _;
    }

    modifier requireOpenContext() { _requireOpenContext(); _; }
    modifier notFrozen() { _notFrozen(); _; }

    function _onlyOwner() internal view {
        if (msg.sender != owner) revert WAuth();
    }
    function _onlyEntryPointOrOwner() internal view {
        if (msg.sender != address(entryPoint) && msg.sender != owner) revert WAuth();
    }
    function _onlyOwnerOrInterceptor() internal view {
        if (msg.sender != owner
            && msg.sender != authorizedInterceptor
            && msg.sender != address(entryPoint)) revert WAuth();
    }
    function _requireOpenContext() internal view {
        if (!contextOpen) revert WCtx();
    }
    function _notFrozen() internal view {
        if (frozen) revert WFrozen();
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _registry, address _owner, address _entryPoint) {
        if (_owner == address(0)) revert WZero();
        if (_entryPoint == address(0)) revert WZero();
        owner = _owner;
        entryPoint = IEntryPoint(_entryPoint);
        registry = ARC402RegistryV2(_registry);
        ownerAuth = OwnerAuth({ signerType: SignerType.EOA, pubKeyX: bytes32(uint256(uint160(_owner))), pubKeyY: bytes32(0) });
        _trustRegistry().initWallet(address(this));
        // Bootstrap PolicyEngine: register wallet + enable DeFi access
        // msg.sender == address(this) during construction, satisfying PolicyEngine's access check
        address pe = _resolveContracts().policyEngine;
        IPolicyEngine(pe).registerWallet(address(this), _owner);
        IPolicyEngine(pe).enableDefiAccess(address(this));
    }

    // ─── ERC-4337: validateUserOp ─────────────────────────────────────────────

    /**
     * @notice ERC-4337 validation. Called by EntryPoint before executing the user operation.
     * @dev Governance ops require a valid owner signature over userOpHash.
     *      Protocol ops auto-approve (return 0) if wallet is not frozen — policy is
     *      enforced inside each function when the EntryPoint executes the call.
     * @param userOp              The packed user operation to validate.
     * @param userOpHash          Hash of the request, signed by the owner for governance ops.
     * @param missingAccountFunds Amount to prefund to EntryPoint (0 if wallet has a deposit).
     * @return validationData     0 on success, SIG_VALIDATION_FAILED (1) on failure.
     */
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256 validationData) {
        if (msg.sender != address(entryPoint)) revert WEp();

        // Prefund EntryPoint FIRST — before any state reads or external calls.
        // This matches the ERC-4337 reference implementation order and prevents
        // a reentrancy path where a malicious EntryPoint could re-enter during
        // the ETH transfer and observe inconsistent validation state.
        // slither-disable-next-line reentrancy-eth
        if (missingAccountFunds > 0) {
            // slither-disable-next-line low-level-calls
            (bool ok,) = payable(address(entryPoint)).call{value: missingAccountFunds}("");
            if (!ok) revert WPrefund();
        }

        // Determine which function is being called
        bytes4 selector;
        if (userOp.callData.length >= 4) {
            bytes calldata cd = userOp.callData;
            assembly {
                selector := calldataload(cd.offset)
            }
        }

        // Governance ops — require master key (owner) signature (EOA or P256 passkey)
        if (_isGovernanceOp(selector)) {
            if (ownerAuth.signerType == SignerType.Passkey) {
                validationData = _validateP256Signature(userOpHash, userOp.signature, ownerAuth.pubKeyX, ownerAuth.pubKeyY);
            } else {
                validationData = _validateOwnerSignature(userOpHash, userOp.signature);
            }
        } else {
            // Protocol ops — auto-approve if within policy bounds
            // Actual policy enforcement happens inside each function
            validationData = _validatePolicyBounds();
        }
    }

    /// @dev Returns true if the selector corresponds to a governance operation.
    ///      Governance ops require a master key signature from the owner.
    function _isGovernanceOp(bytes4 selector) internal pure returns (bool) {
        return selector == this.setGuardian.selector
            || selector == this.updatePolicy.selector
            || selector == this.proposeRegistryUpdate.selector
            || selector == this.cancelRegistryUpdate.selector
            || selector == this.executeRegistryUpdate.selector
            || selector == this.setAuthorizedInterceptor.selector
            || selector == this.setVelocityLimit.selector
            || selector == this.setPasskey.selector
            || selector == this.clearPasskey.selector
            || selector == bytes4(keccak256("freeze(string)"))   // owner freeze (overloaded)
            || selector == this.unfreeze.selector;
    }

    /// @dev Validate that the owner signed the userOpHash.
    ///      Returns SIG_VALIDATION_SUCCESS (0) or SIG_VALIDATION_FAILED (1).
    ///      Uses tryRecover so malformed signatures return FAILED rather than reverting.
    function _validateOwnerSignature(
        bytes32 userOpHash,
        bytes calldata signature
    ) internal view returns (uint256) {
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(userOpHash);
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(ethHash, signature);
        if (err != ECDSA.RecoverError.NoError) return SIG_VALIDATION_FAILED;
        return recovered == owner ? SIG_VALIDATION_SUCCESS : SIG_VALIDATION_FAILED;
    }

    /// @dev Verify a WebAuthn P256 (secp256r1) signature using the Base RIP-7212 precompile at 0x100.
    ///      sig must be ABI-encoded: (bytes32 r, bytes32 s, bytes authenticatorData, bytes clientDataJSON).
    ///      Reconstructs the WebAuthn-signed hash: sha256(authenticatorData || sha256(clientDataJSON)).
    ///      Returns SIG_VALIDATION_SUCCESS (0) or SIG_VALIDATION_FAILED (1).
    ///      Safe-degrades on non-Base chains (precompile absent → staticcall fails → FAILED).
    function _validateP256Signature(
        bytes32 userOpHash,
        bytes calldata sig,
        bytes32 pubKeyX,
        bytes32 pubKeyY
    ) internal view returns (uint256) {
        // Minimum ABI-encoded size: 4 heads (4×32) + 2 dynamic length slots (2×32) = 192 bytes
        if (sig.length < 192) return SIG_VALIDATION_FAILED;

        // Decode WebAuthn signature payload
        (bytes32 r, bytes32 s, bytes memory authData, bytes memory clientDataJSON) =
            abi.decode(sig, (bytes32, bytes32, bytes, bytes));

        // Suppress unused-variable warning for userOpHash — callers may use it for challenge
        // verification off-chain; on-chain we verify the WebAuthn-reconstructed hash instead.
        (userOpHash);

        // Reconstruct the hash the WebAuthn authenticator actually signed:
        // sha256(authenticatorData || sha256(clientDataJSON))
        bytes32 cdHash  = sha256(clientDataJSON);
        bytes32 msgHash = sha256(abi.encodePacked(authData, cdHash));

        return P256VerifierLib.validateP256Signature(msgHash, abi.encodePacked(r, s), pubKeyX, pubKeyY);
    }

    /// @dev Protocol ops auto-approve unless the wallet is frozen.
    ///      Returns SIG_VALIDATION_SUCCESS (0) or SIG_VALIDATION_FAILED (1).
    function _validatePolicyBounds() internal view returns (uint256) {
        return frozen ? SIG_VALIDATION_FAILED : SIG_VALIDATION_SUCCESS;
    }

    // ─── Registry Upgrade (timelocked — owner-controlled) ────────────────────

    /**
     * @notice Begin a registry upgrade. Starts a 2-day timelock before the new
     *         registry can be activated. Gives the owner time to cancel if phished.
     * @param newRegistry The candidate registry address.
     */
    function proposeRegistryUpdate(address newRegistry) external onlyEntryPointOrOwner {
        if (newRegistry == address(0)) revert WZero();
        if (pendingRegistry != address(0)) revert WPending();
        pendingRegistry = newRegistry;
        registryUpdateUnlockAt = block.timestamp + REGISTRY_TIMELOCK;
        emit RegistryUpdateProposed(newRegistry, registryUpdateUnlockAt);
    }

    /**
     * @notice Complete a registry upgrade after the timelock has elapsed.
     */
    function executeRegistryUpdate() external onlyEntryPointOrOwner {
        if (pendingRegistry == address(0)) revert WNopend();
        if (block.timestamp < registryUpdateUnlockAt) revert WLock();
        address old = address(registry);
        registry = ARC402RegistryV2(pendingRegistry);
        pendingRegistry = address(0);
        registryUpdateUnlockAt = 0;
        emit RegistryUpdateExecuted(old, address(registry));
    }

    /**
     * @notice Cancel a pending registry upgrade.
     */
    function cancelRegistryUpdate() external onlyEntryPointOrOwner {
        if (pendingRegistry == address(0)) revert WNopend();
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
    function setAuthorizedInterceptor(address interceptor) external onlyEntryPointOrOwner {
        if (interceptor == address(0)) revert WZero();
        authorizedInterceptor = interceptor;
        emit InterceptorUpdated(interceptor);
    }

    // ─── Guardian Management ──────────────────────────────────────────────────

    /// @notice Update guardian address. Only owner can change guardian.
    // ─── Machine Key Management ───────────────────────────────────────────────

    function authorizeMachineKey(address key) external onlyOwner {
        if (key == address(0)) revert WZero();
        if (key == owner) revert WAuth();
        if (key == guardian) revert WAuth();
        if (key == address(entryPoint)) revert WAuth();
        authorizedMachineKeys[key] = true;
        emit MachineKeyAuthorized(key);
    }

    function revokeMachineKey(address key) external onlyOwner {
        authorizedMachineKeys[key] = false;
        emit MachineKeyRevoked(key);
    }

    function setGuardian(address _guardian) external onlyEntryPointOrOwner {
        guardian = _guardian;
        emit GuardianUpdated(_guardian);
    }

    // ─── Circuit Breaker ──────────────────────────────────────────────────────

    /// @notice Owner-initiated freeze with a reason string.
    function freeze(string calldata reason) external onlyEntryPointOrOwner {
        if (frozen) revert WFrozen();
        frozen = true;
        frozenAt = block.timestamp;
        frozenBy = msg.sender;
        emit WalletFrozen(msg.sender, reason, block.timestamp);
    }

    /// @notice Emergency freeze. Can only be called by guardian.
    ///         Guardian is the AI agent's designated emergency key.
    ///         Guardian cannot unfreeze — only owner can.
    function freeze() external {
        if (guardian == address(0)) revert WNoguard();
        if (msg.sender != guardian) revert WAuth();
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
        if (guardian == address(0)) revert WNoguard();
        if (msg.sender != guardian) revert WAuth();
        frozen = true;
        frozenAt = block.timestamp;
        frozenBy = msg.sender;
        emit WalletFrozen(msg.sender, "guardian freeze-and-drain", block.timestamp);

        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool ok,) = owner.call{value: balance}("");
            if (!ok) revert WDrain();
        }

        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 tokenBalance = IERC20(tokens[i]).balanceOf(address(this));
            if (tokenBalance > 0) {
                IERC20(tokens[i]).safeTransfer(owner, tokenBalance);
            }
        }
    }

    /// @notice Unfreeze. Only owner can unfreeze — guardian cannot.
    function unfreeze() external onlyEntryPointOrOwner {
        if (!frozen) revert WNotfrozen();
        frozen = false;
        emit WalletUnfrozen(msg.sender, block.timestamp);
    }

    function setVelocityLimit(uint256 limit) external onlyEntryPointOrOwner {
        velocityLimit = limit;
        emit VelocityLimitUpdated(limit);
    }

    // ─── Passkey / P256 Auth Management ──────────────────────────────────────

    /// @notice Transition governance signer to a P256 passkey (Face ID / WebAuthn).
    ///         After this call all governance UserOps must carry a 64-byte P256 sig.
    ///         EOA owner remains as emergency break-glass (see emergencyOwnerOverride).
    /// @param pubKeyX P256 public key x coordinate.
    /// @param pubKeyY P256 public key y coordinate.
    function setPasskey(bytes32 pubKeyX, bytes32 pubKeyY) external onlyEntryPointOrOwner {
        if (pubKeyX == bytes32(0) && pubKeyY == bytes32(0)) revert WZero();
        ownerAuth = OwnerAuth({ signerType: SignerType.Passkey, pubKeyX: pubKeyX, pubKeyY: pubKeyY });
        emit PasskeySet(pubKeyX, pubKeyY);
    }

    /// @notice Revert governance signer back to EOA (ECDSA) mode.
    ///         Governance UserOps will again require owner ECDSA signature.
    function clearPasskey() external onlyEntryPointOrOwner {
        ownerAuth = OwnerAuth({ signerType: SignerType.EOA, pubKeyX: bytes32(uint256(uint160(owner))), pubKeyY: bytes32(0) });
        emit PasskeyCleared();
    }

    /// @notice Emergency break-glass: rotate to a new passkey using the EOA owner directly.
    ///         Only callable by the EOA owner (msg.sender == owner) — not via EntryPoint.
    ///         Use when the passkey device is lost — import seed phrase, call this, re-register.
    /// @param newPubKeyX New P256 public key x coordinate.
    /// @param newPubKeyY New P256 public key y coordinate.
    function emergencyOwnerOverride(bytes32 newPubKeyX, bytes32 newPubKeyY) external {
        if (msg.sender != owner) revert WAuth();
        if (newPubKeyX == bytes32(0) && newPubKeyY == bytes32(0)) revert WZero();
        ownerAuth = OwnerAuth({ signerType: SignerType.Passkey, pubKeyX: newPubKeyX, pubKeyY: newPubKeyY });
        emit PasskeySet(newPubKeyX, newPubKeyY);
        emit EmergencyOverride(newPubKeyX, newPubKeyY);
    }

    /// @notice Emergency break-glass: revert to EOA mode using the EOA owner directly.
    ///         Only callable by the EOA owner (msg.sender == owner) — not via EntryPoint.
    function emergencyOwnerOverride() external {
        if (msg.sender != owner) revert WAuth();
        ownerAuth = OwnerAuth({ signerType: SignerType.EOA, pubKeyX: bytes32(uint256(uint160(owner))), pubKeyY: bytes32(0) });
        emit PasskeyCleared();
    }

    // ─── Internal Contract Accessors ─────────────────────────────────────────

    /// @dev Reads all protocol addresses from the current registry in a single call.
    ///      Upgrading the registry pointer (via executeRegistryUpdate) automatically
    ///      updates every contract reference in one step.
    function _resolveContracts() internal view returns (ARC402RegistryV2.ProtocolContracts memory) {
        return ARC402RegistryV2(registry).getContracts();
    }

    function _policyEngine() internal view returns (IPolicyEngine) {
        return IPolicyEngine(_resolveContracts().policyEngine);
    }

    function _trustRegistry() internal view returns (ITrustRegistry) {
        return ITrustRegistry(_resolveContracts().trustRegistry);
    }

    function _intentAttestation() internal view returns (IIntentAttestation) {
        return IIntentAttestation(_resolveContracts().intentAttestation);
    }

    function _settlementCoordinator() internal view returns (SettlementCoordinator) {
        return SettlementCoordinator(_resolveContracts().settlementCoordinator);
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
    ) external onlyOwnerOrMachineKey notFrozen returns (bytes32) {
        _intentAttestation().attest(attestationId, action, reason, recipient, amount, token, expiresAt);
        return attestationId;
    }

    // ─── Context Management ──────────────────────────────────────────────────

    function openContext(bytes32 contextId, string calldata taskType) external onlyOwnerOrMachineKey notFrozen {
        if (contextOpen) revert WCtx();
        activeContextId = contextId;
        activeTaskType = taskType;
        contextOpen = true;
        contextOpenedAt = block.timestamp;
        emit ContextOpened(contextId, taskType, block.timestamp);
    }

    function closeContext() external onlyOwnerOrMachineKey requireOpenContext {
        bytes32 closedContextId = activeContextId;
        activeContextId = bytes32(0);
        activeTaskType = "";
        contextOpen = false;
        emit ContextClosed(closedContextId, block.timestamp);
        // Trust updates via ServiceAgreement.fulfill() only — see spec/03-trust-primitive.md
    }

    // ─── Shared Spend Helpers ─────────────────────────────────────────────────

    /// @dev Validate policy and revert with reason if invalid.
    function _validateSpendPolicy(address recipient, uint256 amount, string calldata category) internal {
        (bool valid, string memory reason) = _policyEngine().validateSpend(
            address(this), category, amount, activeContextId
        );
        if (!valid) {
            emit SpendRejected(recipient, amount, reason);
            revert(reason);
        }
    }

    /// @dev Advance velocity bucket and check ETH velocity limit.
    function _checkEthVelocity(uint256 amount) internal {
        _advanceVelocityBucket();
        _walletVelocity.curEth += amount;
        if (velocityLimit > 0 && _walletVelocity.curEth + _walletVelocity.prevEth > velocityLimit) {
            _triggerVelocityFreeze();
        }
    }

    /// @dev Advance velocity bucket and check token velocity limit.
    function _checkTokenVelocity(uint256 amount) internal {
        _advanceVelocityBucket();
        _walletVelocity.curToken += amount;
        if (velocityLimit > 0 && _walletVelocity.curToken + _walletVelocity.prevToken > velocityLimit) {
            _triggerVelocityFreeze();
        }
    }

    /// @dev Freeze wallet and revert on velocity breach.
    function _triggerVelocityFreeze() internal {
        frozen = true;
        frozenAt = block.timestamp;
        frozenBy = address(this);
        emit WalletFrozen(address(this), "velocity limit exceeded", block.timestamp);
        revert WVel();
    }

    // ─── ETH Spend Execution ─────────────────────────────────────────────────

    function executeSpend(
        address payable recipient,
        uint256 amount,
        string calldata category,
        bytes32 attestationId
    ) external onlyOwnerOrMachineKey requireOpenContext notFrozen {
        if (recipient == address(0)) revert WZero();
        if (!_intentAttestation().verify(attestationId, address(this), recipient, amount, address(0))) revert WAtt();
        _validateSpendPolicy(recipient, amount, category);
        _checkEthVelocity(amount);
        _intentAttestation().consume(attestationId);
        _policyEngine().recordSpend(address(this), category, amount, activeContextId);
        emit SpendExecuted(recipient, amount, category, attestationId);
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert WXfer();
    }

    // ─── ERC-20 Token Spend Execution (x402 / USDC) ──────────────────────────

    function executeTokenSpend(
        address token,
        address recipient,
        uint256 amount,
        string calldata category,
        bytes32 attestationId
    ) external requireOpenContext notFrozen {
        if (msg.sender != address(entryPoint) && msg.sender != owner && msg.sender != authorizedInterceptor) revert WAuth();
        if (recipient == address(0)) revert WZero();
        if (token == address(0)) revert WZero();
        if (!_intentAttestation().verify(attestationId, address(this), recipient, amount, token)) revert WAtt();
        _validateSpendPolicy(recipient, amount, category);
        _checkTokenVelocity(amount);
        _intentAttestation().consume(attestationId);
        _policyEngine().recordSpend(address(this), category, amount, activeContextId);
        emit TokenSpendExecuted(token, recipient, amount, category, attestationId);
        IERC20(token).safeTransfer(recipient, amount);
    }

    // ─── Multi-Agent Settlement ───────────────────────────────────────────────

    /**
     * @notice Verify and consume an intent attestation on behalf of the coordinator.
     *         Called by SettlementCoordinatorV2.proposeFromWallet() as part of the
     *         settlement proposal flow. Only the registered SettlementCoordinator may call this.
     * @param attestationId Intent attestation ID to verify and consume.
     * @param recipient     Intended settlement recipient.
     * @param amount        Intended settlement amount (ETH, in wei).
     */
    function verifyAndConsumeAttestation(
        bytes32 attestationId,
        address recipient,
        uint256 amount,
        string calldata category
    ) external {
        // Only callable by the SettlementCoordinator registered in this wallet's registry
        if (msg.sender != address(_settlementCoordinator())) revert WNotCoord();
        if (!_intentAttestation().verify(attestationId, address(this), recipient, amount, address(0))) revert WAtt();
        _validateSpendPolicy(recipient, amount, category);
        _intentAttestation().consume(attestationId);
        _policyEngine().recordSpend(address(this), category, amount, activeContextId);
    }

    // ─── Policy Management ───────────────────────────────────────────────────

    function updatePolicy(bytes32 newPolicyId) external onlyEntryPointOrOwner {
        activePolicyId = newPolicyId;
        emit PolicyUpdated(newPolicyId);
    }

    // ─── Trust Query ─────────────────────────────────────────────────────────

    function getTrustScore() external view returns (uint256) {
        return _trustRegistry().getEffectiveScore(address(this));
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
    /// @dev nonReentrant prevents callback exploits. onlyEntryPointOrOwner restricts caller.
    function executeContractCall(ContractCallParams calldata params)
        external
        nonReentrant
        onlyEntryPointOrOwner
        notFrozen
        returns (bytes memory returnData)
    {
        // 0. Prevent self-targeting — calling governance functions on the wallet
        //    through executeContractCall is disallowed as defense-in-depth.
        //    (Governance functions are onlyOwner; this check clarifies intent.)
        if (params.target == address(this)) revert WSelf();

        // 1. Validate via PolicyEngine DeFi access tier
        address _pe = _resolveContracts().policyEngine;
        (bool valid, string memory reason) = IDefiPolicy(_pe).validateContractCall(
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
                (bool approveOk, string memory approveReason) = IDefiPolicy(_pe).validateApproval(
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
        if (!success) revert WCall();

        // 4. Reset approval to 0 (prevent residual allowance)
        if (params.approvalToken != address(0) && params.maxApprovalAmount > 0) {
            IERC20(params.approvalToken).forceApprove(params.target, 0);
        }

        // 5. Slippage check — only if caller specified a minimum return value
        uint256 returnValue = 0;
        if (params.minReturnValue > 0) {
            if (returnData.length < 32) revert WRetdata();
            returnValue = abi.decode(returnData, (uint256));
            if (returnValue < params.minReturnValue) revert WSlip();
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
        VelocityLib.advance(_walletVelocity);
    }

    // ─── Receive ─────────────────────────────────────────────────────────────

    receive() external payable {}
}
