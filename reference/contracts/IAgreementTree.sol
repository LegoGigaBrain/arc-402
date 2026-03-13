// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAgreementTree
 * @notice Interface for multi-party agreement tree linkage (Spec 19).
 *
 * Each node in the tree is a standard ServiceAgreement ID. The tree records
 * parent/child relationships so that settlement can cascade and partial
 * failures can be attributed to the correct sub-agreement.
 *
 * STATUS: DRAFT — not audited, do not use in production
 */
interface IAgreementTree {

    // ─── Events ──────────────────────────────────────────────────────────────

    event SubAgreementRegistered(uint256 indexed parentId, uint256 indexed childId);
    event SubAgreementDisputed(uint256 indexed parentId, uint256 indexed childId);

    // ─── Write ───────────────────────────────────────────────────────────────

    /**
     * @notice Link a sub-agreement to its parent.
     * @dev Only the provider of the parent agreement may call this.
     *      Reverts if the tree depth would exceed MAX_DEPTH (8).
     *      Reverts if childId is already registered (single-parent invariant).
     *      Reverts if childId is an ancestor of parentId (circular reference).
     */
    function registerSubAgreement(uint256 parentAgreementId, uint256 childAgreementId) external;

    /**
     * @notice Emit SubAgreementDisputed for a child agreement that entered dispute.
     * @dev Callable by anyone; verifies on-chain that the child is actually disputed.
     */
    function reportChildDisputed(uint256 parentAgreementId, uint256 childAgreementId) external;

    // ─── Read ────────────────────────────────────────────────────────────────

    /// @notice Returns all direct children of an agreement.
    function getChildren(uint256 agreementId) external view returns (uint256[] memory);

    /// @notice Returns the root agreement of the tree containing agreementId.
    function getRoot(uint256 agreementId) external view returns (uint256);

    /// @notice Returns the path from the root down to agreementId (inclusive).
    function getPath(uint256 agreementId) external view returns (uint256[] memory);

    /// @notice Returns true if all direct children of agreementId are settled.
    function allChildrenSettled(uint256 agreementId) external view returns (bool);

    /// @notice Returns the depth of agreementId from its root (root = 0).
    function getDepth(uint256 agreementId) external view returns (uint256);
}
