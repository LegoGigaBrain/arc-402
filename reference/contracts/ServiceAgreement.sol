// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IServiceAgreement.sol";
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
 * STATUS: DRAFT — not audited, do not use in production
 */
contract ServiceAgreement is IServiceAgreement, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── State ───────────────────────────────────────────────────────────────

    address public owner;

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

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "ServiceAgreement: not owner");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ─── Ownership ───────────────────────────────────────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ServiceAgreement: zero address");
        address old = owner;
        owner = newOwner;
        emit OwnershipTransferred(old, newOwner);
    }

    // ─── Core: Propose ───────────────────────────────────────────────────────

    /**
     * @inheritdoc IServiceAgreement
     * @dev For ETH (token == address(0)) msg.value must equal price.
     *      For ERC-20, msg.value must be 0 and the caller must have approved
     *      this contract for at least `price` tokens before calling.
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

        // Escrow handling
        if (token == address(0)) {
            // ETH
            require(msg.value == price, "ServiceAgreement: ETH value != price");
        } else {
            // ERC-20
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
     */
    function resolveDispute(uint256 agreementId, bool favorProvider) external onlyOwner nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(ag.status == Status.DISPUTED, "ServiceAgreement: not DISPUTED");

        ag.resolvedAt = block.timestamp;

        emit DisputeResolved(agreementId, favorProvider);

        if (favorProvider) {
            ag.status = Status.FULFILLED;
            _releaseEscrow(ag.token, ag.provider, ag.price);
        } else {
            ag.status = Status.CANCELLED;
            _releaseEscrow(ag.token, ag.client, ag.price);
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
