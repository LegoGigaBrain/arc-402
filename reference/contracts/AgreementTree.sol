// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IAgreementTree.sol";
import "./IServiceAgreement.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title AgreementTree
 * @notice Records parent/child relationships between ServiceAgreements (Spec 19).
 *
 * Rules:
 *   - Only the provider of a parent agreement may register sub-agreements.
 *   - Maximum tree depth is 8 (prevents gas exhaustion).
 *   - A child may only have one parent (strict tree, not a DAG).
 *   - Circular references are impossible: every node in the tree is registered
 *     exactly once. Any cycle attempt requires reusing a registered node as a
 *     child, which the `_registered` guard rejects before any ancestor walk.
 *
 * STATUS: Production-ready — audited 2026-03-14
 */
contract AgreementTree is IAgreementTree, Ownable2Step {

    // ─── Constants ───────────────────────────────────────────────────────────

    uint256 public constant MAX_DEPTH = 8;

    // ─── State ───────────────────────────────────────────────────────────────

    IServiceAgreement public immutable serviceAgreement;

    /// @dev parent[childId] = parentId  (0 means "is root or unregistered")
    mapping(uint256 => uint256) private _parent;

    /// @dev children[parentId] = list of direct child IDs
    mapping(uint256 => uint256[]) private _children;

    /// @dev whether an agreementId has ever been added to this tree
    mapping(uint256 => bool) private _registered;

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _serviceAgreement, address owner_) Ownable(owner_) {
        require(_serviceAgreement != address(0), "AgreementTree: zero service agreement");
        require(owner_ != address(0), "AgreementTree: zero owner");
        serviceAgreement = IServiceAgreement(_serviceAgreement);
    }

    // ─── Write ───────────────────────────────────────────────────────────────

    /// @inheritdoc IAgreementTree
    function registerSubAgreement(uint256 parentAgreementId, uint256 childAgreementId) external override {
        require(parentAgreementId != childAgreementId, "AgreementTree: self-link");
        // This guard also prevents circular references: any cycle requires reusing a node
        // that is already in the tree (_registered == true). No ancestor walk needed.
        require(!_registered[childAgreementId], "AgreementTree: node already in tree");

        // Verify caller is the provider of the parent agreement
        IServiceAgreement.Agreement memory parentAg = serviceAgreement.getAgreement(parentAgreementId);
        require(msg.sender == parentAg.provider, "AgreementTree: not parent provider");

        // Register parent as root if this is its first appearance
        if (!_registered[parentAgreementId]) {
            _registered[parentAgreementId] = true;
            // _parent[parentAgreementId] stays 0 (root)
        }

        // Check depth: parent's depth + 1 must not exceed MAX_DEPTH
        uint256 parentDepth = _computeDepth(parentAgreementId);
        require(parentDepth < MAX_DEPTH, "AgreementTree: max depth exceeded");

        // Register the child
        _registered[childAgreementId] = true;
        _parent[childAgreementId] = parentAgreementId;
        _children[parentAgreementId].push(childAgreementId);

        emit SubAgreementRegistered(parentAgreementId, childAgreementId);
    }

    /// @inheritdoc IAgreementTree
    function reportChildDisputed(uint256 parentAgreementId, uint256 childAgreementId) external override {
        require(msg.sender == address(serviceAgreement), "AgreementTree: only ServiceAgreement");
        require(_registered[childAgreementId], "AgreementTree: child not registered");
        require(_parent[childAgreementId] == parentAgreementId, "AgreementTree: wrong parent");

        // Verify the child agreement is actually in a disputed state
        IServiceAgreement.Agreement memory childAg = serviceAgreement.getAgreement(childAgreementId);
        require(
            childAg.status == IServiceAgreement.Status.DISPUTED ||
            childAg.status == IServiceAgreement.Status.ESCALATED_TO_HUMAN ||
            childAg.status == IServiceAgreement.Status.ESCALATED_TO_ARBITRATION,
            "AgreementTree: child not disputed"
        );

        emit SubAgreementDisputed(parentAgreementId, childAgreementId);
    }

    // ─── Read ─────────────────────────────────────────────────────────────────

    /// @inheritdoc IAgreementTree
    function getChildren(uint256 agreementId) external view override returns (uint256[] memory) {
        return _children[agreementId];
    }

    /// @inheritdoc IAgreementTree
    function getRoot(uint256 agreementId) external view override returns (uint256) {
        require(_registered[agreementId], "AgreementTree: not registered");
        return _findRoot(agreementId);
    }

    /// @inheritdoc IAgreementTree
    function getPath(uint256 agreementId) external view override returns (uint256[] memory) {
        require(_registered[agreementId], "AgreementTree: not registered");

        // Walk from agreementId up to root, collecting IDs
        uint256 depth = _computeDepth(agreementId);
        uint256[] memory reversed = new uint256[](depth + 1);
        uint256 current = agreementId;
        for (uint256 i = 0; i <= depth; i++) {
            reversed[i] = current;
            current = _parent[current];
        }

        // Reverse so path goes root → node
        uint256[] memory path = new uint256[](depth + 1);
        for (uint256 i = 0; i <= depth; i++) {
            path[i] = reversed[depth - i];
        }
        return path;
    }

    /// @inheritdoc IAgreementTree
    function allChildrenSettled(uint256 agreementId) external view override returns (bool) {
        uint256[] storage kids = _children[agreementId];
        for (uint256 i = 0; i < kids.length; i++) {
            IServiceAgreement.Agreement memory ag = serviceAgreement.getAgreement(kids[i]);
            if (!_isSettled(ag.status)) return false;
        }
        return true;
    }

    /// @inheritdoc IAgreementTree
    function getDepth(uint256 agreementId) external view override returns (uint256) {
        require(_registered[agreementId], "AgreementTree: not registered");
        return _computeDepth(agreementId);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _findRoot(uint256 id) internal view returns (uint256) {
        uint256 current = id;
        for (uint256 i = 0; i <= MAX_DEPTH; i++) {
            uint256 p = _parent[current];
            if (p == 0) return current;
            current = p;
        }
        return current; // Should never reach here given depth limit
    }

    function _computeDepth(uint256 id) internal view returns (uint256) {
        uint256 depth = 0;
        uint256 current = id;
        for (uint256 i = 0; i <= MAX_DEPTH; i++) {
            uint256 p = _parent[current];
            if (p == 0) return depth;
            depth++;
            current = p;
        }
        return depth;
    }

    function _isSettled(IServiceAgreement.Status status) internal pure returns (bool) {
        return
            status == IServiceAgreement.Status.FULFILLED ||
            status == IServiceAgreement.Status.CANCELLED ||
            status == IServiceAgreement.Status.PARTIAL_SETTLEMENT ||
            status == IServiceAgreement.Status.MUTUAL_CANCEL;
    }
}
