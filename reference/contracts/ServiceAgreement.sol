// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IServiceAgreement.sol";
import "./ITrustRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ServiceAgreement
 * @notice Bilateral agent-to-agent service agreements with escrow for ARC-402
 * @dev Implements a state machine: PROPOSED → ACCEPTED → FULFILLED/DISPUTED/CANCELLED
 *      Escrow is held in this contract until released on fulfill, cancel, or dispute resolution.
 *      ETH agreements use msg.value; ERC-20 agreements use SafeERC20 transferFrom/transfer.
 *      Dispute resolution is centralised to the contract owner (intended to be a trusted
 *      arbiter or a future governance module).
 *
 * Security hardening applied (pre-mainnet audit):
 *   T-02: trustRegistry integration — trust scores update automatically on fulfill/dispute.
 *         Only ServiceAgreement is an authorized TrustRegistry updater; no arbitrary
 *         address can call recordSuccess() directly. Eliminates trust-score farming.
 *   T-03: Token allowlist — only owner-approved ERC-20 tokens can be used as payment.
 *         Prevents malicious / fee-on-transfer tokens from permanently locking escrow.
 *   T-04: Fee-on-transfer protection — prevented by the allowlist (T-03). The allowlist
 *         is the primary guard; only known-safe tokens (e.g. USDC) are approved. No
 *         balance-delta tracking is needed when token behaviour is controlled by allowlist.
 *
 * STATUS: DRAFT — not audited, do not use in production
 */
contract ServiceAgreement is IServiceAgreement, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── State ───────────────────────────────────────────────────────────────

    address public owner;

    /// @notice Immutable reference to the TrustRegistry. Set at deploy time.
    ///         Address 0 disables trust-score updates (e.g. in test environments
    ///         that don't need a registry). In production this must be non-zero.
    address public immutable trustRegistry;

    /// @notice ETH payment sentinel (address(0) means native ETH, not an ERC-20).
    address public constant ETH = address(0);

    /// @notice Allowlist of ERC-20 tokens (and ETH) accepted as payment.
    ///         ETH (address(0)) is allowed by default at construction.
    ///         Only known-safe tokens should be added — fee-on-transfer or
    ///         malicious tokens are prevented by keeping them off this list (T-03 / T-04).
    mapping(address => bool) public allowedTokens;

    uint256 private _nextId;  // increments before use, so first ID = 1

    mapping(uint256 => Agreement) private _agreements;

    /// @dev client → list of agreement IDs
    mapping(address => uint256[]) private _byClient;

    /// @dev provider → list of agreement IDs
    mapping(address => uint256[]) private _byProvider;

    // ─── Events ──────────────────────────────────────────────────────────────

    event AgreementProposed(
        uint256 indexed id,
        address indexed client,
        address indexed provider,
        string serviceType,
        uint256 price,
        address token,
        uint256 deadline
    );
    event AgreementAccepted(uint256 indexed id, address indexed provider);
    event AgreementFulfilled(uint256 indexed id, address indexed provider, bytes32 deliverablesHash);
    event AgreementDisputed(uint256 indexed id, address indexed initiator, string reason);
    event AgreementCancelled(uint256 indexed id, address indexed client);
    event DisputeResolved(uint256 indexed id, bool favorProvider);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event TokenAllowed(address indexed token);
    event TokenDisallowed(address indexed token);

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "ServiceAgreement: not owner");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    /// @param _trustRegistry Address of the TrustRegistry contract. Pass address(0)
    ///                        to disable trust-score updates (testing only).
    constructor(address _trustRegistry) {
        owner = msg.sender;
        trustRegistry = _trustRegistry;
        // ETH (address(0)) is the native payment token and is always allowed.
        allowedTokens[address(0)] = true;
        emit TokenAllowed(address(0));
    }

    // ─── Ownership ───────────────────────────────────────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ServiceAgreement: zero address");
        address old = owner;
        owner = newOwner;
        emit OwnershipTransferred(old, newOwner);
    }

    // ─── Token Allowlist (Fix T-03) ──────────────────────────────────────────

    /// @notice Allow an ERC-20 token to be used as payment in agreements.
    ///         Only add tokens whose transfer() behaviour is known-safe:
    ///         no fee-on-transfer, no revert-on-transfer, no rebasing.
    function allowToken(address token) external onlyOwner {
        allowedTokens[token] = true;
        emit TokenAllowed(token);
    }

    /// @notice Remove an ERC-20 token from the payment allowlist.
    ///         Existing agreements with this token are unaffected.
    function disallowToken(address token) external onlyOwner {
        allowedTokens[token] = false;
        emit TokenDisallowed(token);
    }

    // ─── Core: Propose ───────────────────────────────────────────────────────

    /**
     * @inheritdoc IServiceAgreement
     * @dev For ETH (token == address(0)) msg.value must equal price.
     *      For ERC-20, msg.value must be 0 and the caller must have approved
     *      this contract for at least `price` tokens before calling.
     *
     *      Fee-on-transfer protection (T-04): the allowedTokens list (T-03) is the
     *      primary guard. Only tokens explicitly approved by the owner are accepted.
     *      Approved tokens (e.g. USDC) are known to transfer the full requested amount
     *      with no hidden fee. If a previously-safe token introduces a transfer fee,
     *      the owner must call disallowToken() before new agreements are created.
     */
    function propose(
        address provider,
        string calldata serviceType,
        string calldata description,
        uint256 price,
        address token,
        uint256 deadline,
        bytes32 deliverablesHash
    ) external payable nonReentrant returns (uint256 agreementId) {
        require(provider != address(0),      "ServiceAgreement: zero provider");
        require(provider != msg.sender,      "ServiceAgreement: client == provider");
        require(price > 0,                   "ServiceAgreement: zero price");
        require(deadline > block.timestamp,  "ServiceAgreement: deadline in past");
        // T-03: reject non-allowlisted tokens (blocks malicious & fee-on-transfer tokens)
        require(allowedTokens[token],        "ServiceAgreement: token not allowed");

        // Escrow handling
        if (token == address(0)) {
            // ETH
            require(msg.value == price, "ServiceAgreement: ETH value != price");
        } else {
            // ERC-20 — token is on the allowlist so it is known-safe
            require(msg.value == 0, "ServiceAgreement: ETH sent with ERC-20 agreement");
            IERC20(token).safeTransferFrom(msg.sender, address(this), price);
        }

        // Mint new ID
        unchecked { _nextId++; }
        agreementId = _nextId;

        _agreements[agreementId] = Agreement({
            id:               agreementId,
            client:           msg.sender,
            provider:         provider,
            serviceType:      serviceType,
            description:      description,
            price:            price,
            token:            token,
            deadline:         deadline,
            deliverablesHash: deliverablesHash,
            status:           Status.PROPOSED,
            createdAt:        block.timestamp,
            resolvedAt:       0
        });

        _byClient[msg.sender].push(agreementId);
        _byProvider[provider].push(agreementId);

        emit AgreementProposed(
            agreementId,
            msg.sender,
            provider,
            serviceType,
            price,
            token,
            deadline
        );
    }

    // ─── Core: Accept ────────────────────────────────────────────────────────

    /**
     * @inheritdoc IServiceAgreement
     */
    function accept(uint256 agreementId) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(msg.sender == ag.provider,   "ServiceAgreement: not provider");
        require(ag.status == Status.PROPOSED, "ServiceAgreement: not PROPOSED");

        ag.status = Status.ACCEPTED;

        emit AgreementAccepted(agreementId, msg.sender);
    }

    // ─── Core: Fulfill ───────────────────────────────────────────────────────

    /**
     * @inheritdoc IServiceAgreement
     * @dev Releases escrow to provider. Must be called before the deadline.
     *      On success, automatically records a trust score increment for the provider
     *      in the TrustRegistry (T-02). This ensures scores only rise through real
     *      on-chain ServiceAgreement fulfillments, not arbitrary updater calls.
     */
    function fulfill(uint256 agreementId, bytes32 actualDeliverablesHash) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(msg.sender == ag.provider,    "ServiceAgreement: not provider");
        require(ag.status == Status.ACCEPTED,  "ServiceAgreement: not ACCEPTED");
        require(block.timestamp <= ag.deadline, "ServiceAgreement: past deadline");

        ag.status      = Status.FULFILLED;
        ag.resolvedAt  = block.timestamp;
        ag.deliverablesHash = actualDeliverablesHash;

        emit AgreementFulfilled(agreementId, msg.sender, actualDeliverablesHash);

        _releaseEscrow(ag.token, ag.provider, ag.price);

        // T-02: Trust score auto-update — only ServiceAgreement can call recordSuccess.
        if (trustRegistry != address(0)) {
            ITrustRegistry(trustRegistry).recordSuccess(ag.provider);
        }
    }

    // ─── Core: Dispute ───────────────────────────────────────────────────────

    /**
     * @inheritdoc IServiceAgreement
     * @dev Either party may raise a dispute on an ACCEPTED agreement.
     *      Escrow remains locked until resolveDispute().
     */
    function dispute(uint256 agreementId, string calldata reason) external {
        Agreement storage ag = _get(agreementId);
        require(
            msg.sender == ag.client || msg.sender == ag.provider,
            "ServiceAgreement: not a party"
        );
        require(ag.status == Status.ACCEPTED, "ServiceAgreement: not ACCEPTED");

        ag.status = Status.DISPUTED;

        emit AgreementDisputed(agreementId, msg.sender, reason);
    }

    // ─── Core: Cancel (PROPOSED) ─────────────────────────────────────────────

    /**
     * @inheritdoc IServiceAgreement
     * @dev Only the client may cancel a PROPOSED agreement. Refunds escrow.
     */
    function cancel(uint256 agreementId) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(msg.sender == ag.client,      "ServiceAgreement: not client");
        require(ag.status == Status.PROPOSED,  "ServiceAgreement: not PROPOSED");

        ag.status     = Status.CANCELLED;
        ag.resolvedAt = block.timestamp;

        emit AgreementCancelled(agreementId, msg.sender);

        _releaseEscrow(ag.token, ag.client, ag.price);
    }

    // ─── Core: Expired Cancel ────────────────────────────────────────────────

    /**
     * @notice Client may cancel an ACCEPTED agreement that has passed its deadline.
     *         Refunds escrow to client.
     * @param agreementId The agreement to cancel
     */
    function expiredCancel(uint256 agreementId) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(msg.sender == ag.client,      "ServiceAgreement: not client");
        require(ag.status == Status.ACCEPTED,  "ServiceAgreement: not ACCEPTED");
        require(block.timestamp > ag.deadline, "ServiceAgreement: not past deadline");

        ag.status     = Status.CANCELLED;
        ag.resolvedAt = block.timestamp;

        emit AgreementCancelled(agreementId, msg.sender);

        _releaseEscrow(ag.token, ag.client, ag.price);
    }

    // ─── Core: Resolve Dispute ───────────────────────────────────────────────

    /**
     * @notice Owner (arbiter) resolves a disputed agreement.
     * @param agreementId The disputed agreement
     * @param favorProvider If true, escrow goes to provider (FULFILLED).
     *                      If false, escrow goes to client (CANCELLED).
     *
     * @dev T-02: Trust score auto-update on resolution.
     *      - Provider wins → recordSuccess (dispute was frivolous / provider delivered)
     *      - Client wins  → recordAnomaly  (provider failed to deliver)
     */
    function resolveDispute(uint256 agreementId, bool favorProvider) external onlyOwner nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(ag.status == Status.DISPUTED, "ServiceAgreement: not DISPUTED");

        ag.resolvedAt = block.timestamp;

        emit DisputeResolved(agreementId, favorProvider);

        if (favorProvider) {
            ag.status = Status.FULFILLED;
            _releaseEscrow(ag.token, ag.provider, ag.price);
            // T-02: provider vindicated — increment trust score
            if (trustRegistry != address(0)) {
                ITrustRegistry(trustRegistry).recordSuccess(ag.provider);
            }
        } else {
            ag.status = Status.CANCELLED;
            _releaseEscrow(ag.token, ag.client, ag.price);
            // T-02: provider failed — decrement trust score
            if (trustRegistry != address(0)) {
                ITrustRegistry(trustRegistry).recordAnomaly(ag.provider);
            }
        }
    }

    // ─── Getters ─────────────────────────────────────────────────────────────

    /**
     * @inheritdoc IServiceAgreement
     */
    function getAgreement(uint256 id) external view returns (Agreement memory) {
        require(_agreements[id].id != 0, "ServiceAgreement: not found");
        return _agreements[id];
    }

    /**
     * @notice Returns all agreement IDs where `client` is the paying party
     */
    function getAgreementsByClient(address client) external view returns (uint256[] memory) {
        return _byClient[client];
    }

    /**
     * @notice Returns all agreement IDs where `provider` is the delivering party
     */
    function getAgreementsByProvider(address provider) external view returns (uint256[] memory) {
        return _byProvider[provider];
    }

    /**
     * @notice Total number of agreements ever created
     */
    function agreementCount() external view returns (uint256) {
        return _nextId;
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    function _get(uint256 id) internal view returns (Agreement storage) {
        require(_agreements[id].id != 0, "ServiceAgreement: not found");
        return _agreements[id];
    }

    function _releaseEscrow(address token, address recipient, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok, ) = recipient.call{value: amount}("");
            require(ok, "ServiceAgreement: ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }
    }

    // ─── Receive ─────────────────────────────────────────────────────────────

    receive() external payable {}
}
