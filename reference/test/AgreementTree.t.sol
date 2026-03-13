// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/AgreementTree.sol";
import "../contracts/IAgreementTree.sol";
import "../contracts/IServiceAgreement.sol";

// ─── Minimal Mock ServiceAgreement ───────────────────────────────────────────

/// @dev Stores settable agreement data; only implements getAgreement.
contract MockServiceAgreement {
    mapping(uint256 => IServiceAgreement.Agreement) private _agreements;

    function setAgreement(uint256 id, address prov, IServiceAgreement.Status status) external {
        _agreements[id] = IServiceAgreement.Agreement({
            id:              id,
            client:          address(0x1),
            provider:        prov,
            serviceType:     "mock",
            description:     "",
            price:           1 ether,
            token:           address(0),
            deadline:        block.timestamp + 7 days,
            deliverablesHash: bytes32(0),
            status:          status,
            createdAt:       block.timestamp,
            resolvedAt:      0,
            verifyWindowEnd: 0,
            committedHash:   bytes32(0),
            protocolVersion: "1.0.0"
        });
    }

    function setAgreementStatus(uint256 id, IServiceAgreement.Status status) external {
        _agreements[id].status = status;
    }

    function getAgreement(uint256 id) external view returns (IServiceAgreement.Agreement memory) {
        require(_agreements[id].id != 0, "MockSA: not found");
        return _agreements[id];
    }
}

// ─── AgreementTree Tests ──────────────────────────────────────────────────────

contract AgreementTreeTest is Test {

    AgreementTree        tree;
    MockServiceAgreement mockSA;

    address owner    = address(this);
    address provider = address(0xA1);
    address stranger = address(0xBEEF);

    // ─── Setup ───────────────────────────────────────────────────────────────

    function setUp() public {
        mockSA = new MockServiceAgreement();
        tree   = new AgreementTree(address(mockSA), owner);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    /// @dev Register an agreement in the mock SA with ACCEPTED status.
    function _setAgreement(uint256 id) internal {
        mockSA.setAgreement(id, provider, IServiceAgreement.Status.ACCEPTED);
    }

    /// @dev Build a linear chain: ids[0] → ids[1] → ... → ids[n-1].
    ///      Caller (provider) must register each step.
    function _buildChain(uint256[] memory ids) internal {
        for (uint256 i = 0; i < ids.length; i++) {
            _setAgreement(ids[i]);
        }
        for (uint256 i = 0; i + 1 < ids.length; i++) {
            vm.prank(provider);
            tree.registerSubAgreement(ids[i], ids[i + 1]);
        }
    }

    // ─── registerSubAgreement: happy path ────────────────────────────────────

    function test_RegisterSubAgreement_success_links_parent_child() public {
        _setAgreement(1);
        _setAgreement(2);

        vm.prank(provider);
        tree.registerSubAgreement(1, 2);

        uint256[] memory children = tree.getChildren(1);
        assertEq(children.length, 1);
        assertEq(children[0], 2);
    }

    function test_RegisterSubAgreement_multiple_children_same_parent() public {
        _setAgreement(1);
        _setAgreement(2);
        _setAgreement(3);

        vm.prank(provider); tree.registerSubAgreement(1, 2);
        vm.prank(provider); tree.registerSubAgreement(1, 3);

        uint256[] memory children = tree.getChildren(1);
        assertEq(children.length, 2);
    }

    function test_RegisterSubAgreement_emits_event() public {
        _setAgreement(1);
        _setAgreement(2);

        vm.expectEmit(true, true, false, false);
        emit IAgreementTree.SubAgreementRegistered(1, 2);

        vm.prank(provider);
        tree.registerSubAgreement(1, 2);
    }

    // ─── registerSubAgreement: access control ────────────────────────────────

    function test_RegisterSubAgreement_revert_not_parent_provider() public {
        _setAgreement(1);
        _setAgreement(2);

        vm.prank(stranger);
        vm.expectRevert("AgreementTree: not parent provider");
        tree.registerSubAgreement(1, 2);
    }

    function test_RegisterSubAgreement_revert_self_link() public {
        _setAgreement(1);

        vm.prank(provider);
        vm.expectRevert("AgreementTree: self-link");
        tree.registerSubAgreement(1, 1);
    }

    // ─── registerSubAgreement: depth limit ───────────────────────────────────

    function test_RegisterSubAgreement_max_depth_8_allowed() public {
        // Build chain of 9 nodes: 1→2→3→4→5→6→7→8→9 (depth 0 through 8)
        uint256[] memory ids = new uint256[](9);
        for (uint256 i = 0; i < 9; i++) ids[i] = i + 1;
        _buildChain(ids);

        // Node 9 is at depth 8 — should exist without revert
        assertEq(tree.getDepth(9), 8);
    }

    function test_RegisterSubAgreement_revert_depth_9() public {
        // Build chain 1→2→...→9 (node 9 at depth 8), then try to add node 10
        uint256[] memory ids = new uint256[](9);
        for (uint256 i = 0; i < 9; i++) ids[i] = i + 1;
        _buildChain(ids);

        _setAgreement(10);

        vm.prank(provider);
        vm.expectRevert("AgreementTree: max depth exceeded");
        tree.registerSubAgreement(9, 10);
    }

    // ─── registerSubAgreement: single-parent invariant ───────────────────────

    function test_RegisterSubAgreement_revert_child_already_registered() public {
        _setAgreement(1);
        _setAgreement(2);
        _setAgreement(3);

        vm.prank(provider); tree.registerSubAgreement(1, 2);

        // Try to register child 2 under a different parent (3)
        _setAgreement(3);
        vm.prank(provider);
        vm.expectRevert("AgreementTree: child already registered");
        tree.registerSubAgreement(3, 2);
    }

    // ─── registerSubAgreement: circular reference ────────────────────────────
    // NOTE: In this implementation, any attempt to create a circular reference
    // requires reusing an already-registered ancestor node as the child. The
    // "child already registered" guard fires before the _isAncestor check, so
    // that is the observable revert for circular-reference attempts.

    function test_RegisterSubAgreement_revert_circular_direct() public {
        // Register 1→2, then try 2→1 (circular attempt)
        // Node 1 is already registered as root, so "child already registered" fires.
        _setAgreement(1);
        _setAgreement(2);
        vm.prank(provider); tree.registerSubAgreement(1, 2);

        vm.prank(provider);
        vm.expectRevert("AgreementTree: child already registered");
        tree.registerSubAgreement(2, 1);
    }

    function test_RegisterSubAgreement_revert_circular_indirect() public {
        // Build 1→2→3, then try 3→1 (circular attempt through chain)
        // Node 1 is already registered as root, so "child already registered" fires.
        _setAgreement(1); _setAgreement(2); _setAgreement(3);
        vm.prank(provider); tree.registerSubAgreement(1, 2);
        vm.prank(provider); tree.registerSubAgreement(2, 3);

        vm.prank(provider);
        vm.expectRevert("AgreementTree: child already registered");
        tree.registerSubAgreement(3, 1);
    }

    // ─── getChildren ─────────────────────────────────────────────────────────

    function test_GetChildren_empty_for_leaf() public {
        _setAgreement(1);
        _setAgreement(2);
        vm.prank(provider); tree.registerSubAgreement(1, 2);

        uint256[] memory children = tree.getChildren(2);
        assertEq(children.length, 0, "leaf should have no children");
    }

    function test_GetChildren_returns_all_direct_children() public {
        _setAgreement(1); _setAgreement(2); _setAgreement(3); _setAgreement(4);
        vm.prank(provider); tree.registerSubAgreement(1, 2);
        vm.prank(provider); tree.registerSubAgreement(1, 3);
        vm.prank(provider); tree.registerSubAgreement(1, 4);

        uint256[] memory children = tree.getChildren(1);
        assertEq(children.length, 3);
    }

    // ─── getRoot ─────────────────────────────────────────────────────────────

    function test_GetRoot_returns_self_for_root_node() public {
        _setAgreement(1);
        _setAgreement(2);
        vm.prank(provider); tree.registerSubAgreement(1, 2);

        assertEq(tree.getRoot(1), 1, "root of root is itself");
    }

    function test_GetRoot_returns_root_for_deep_child() public {
        uint256[] memory ids = new uint256[](5);
        for (uint256 i = 0; i < 5; i++) ids[i] = i + 1;
        _buildChain(ids);

        assertEq(tree.getRoot(5), 1, "deep child should trace back to root");
        assertEq(tree.getRoot(3), 1);
    }

    function test_GetRoot_revert_unregistered() public {
        vm.expectRevert("AgreementTree: not registered");
        tree.getRoot(999);
    }

    // ─── getPath ─────────────────────────────────────────────────────────────

    function test_GetPath_root_only() public {
        _setAgreement(1);
        _setAgreement(2);
        vm.prank(provider); tree.registerSubAgreement(1, 2);

        uint256[] memory path = tree.getPath(1);
        assertEq(path.length, 1);
        assertEq(path[0], 1);
    }

    function test_GetPath_correct_order_root_to_node() public {
        uint256[] memory ids = new uint256[](4);
        for (uint256 i = 0; i < 4; i++) ids[i] = i + 1;
        _buildChain(ids);

        // Path for node 4: should be [1, 2, 3, 4]
        uint256[] memory path = tree.getPath(4);
        assertEq(path.length, 4);
        assertEq(path[0], 1);
        assertEq(path[1], 2);
        assertEq(path[2], 3);
        assertEq(path[3], 4);
    }

    function test_GetPath_revert_unregistered() public {
        vm.expectRevert("AgreementTree: not registered");
        tree.getPath(888);
    }

    // ─── allChildrenSettled ───────────────────────────────────────────────────

    function test_AllChildrenSettled_true_when_no_children() public {
        _setAgreement(1);
        _setAgreement(2);
        vm.prank(provider); tree.registerSubAgreement(1, 2);

        // Node 2 has no children → vacuously settled
        assertTrue(tree.allChildrenSettled(2), "leaf with no children should be settled");
    }

    function test_AllChildrenSettled_false_with_open_children() public {
        _setAgreement(1);
        _setAgreement(2);
        vm.prank(provider); tree.registerSubAgreement(1, 2);

        // Child 2 is ACCEPTED (not settled)
        assertFalse(tree.allChildrenSettled(1), "should be false when child not settled");
    }

    function test_AllChildrenSettled_true_when_child_fulfilled() public {
        _setAgreement(1);
        _setAgreement(2);
        vm.prank(provider); tree.registerSubAgreement(1, 2);

        mockSA.setAgreementStatus(2, IServiceAgreement.Status.FULFILLED);
        assertTrue(tree.allChildrenSettled(1), "should be true when child is FULFILLED");
    }

    function test_AllChildrenSettled_true_for_multiple_settled_children() public {
        _setAgreement(1);
        _setAgreement(2); _setAgreement(3); _setAgreement(4);
        vm.prank(provider); tree.registerSubAgreement(1, 2);
        vm.prank(provider); tree.registerSubAgreement(1, 3);
        vm.prank(provider); tree.registerSubAgreement(1, 4);

        mockSA.setAgreementStatus(2, IServiceAgreement.Status.FULFILLED);
        mockSA.setAgreementStatus(3, IServiceAgreement.Status.CANCELLED);
        mockSA.setAgreementStatus(4, IServiceAgreement.Status.MUTUAL_CANCEL);
        assertTrue(tree.allChildrenSettled(1), "all settled statuses");
    }

    function test_AllChildrenSettled_false_if_one_child_open() public {
        _setAgreement(1);
        _setAgreement(2); _setAgreement(3);
        vm.prank(provider); tree.registerSubAgreement(1, 2);
        vm.prank(provider); tree.registerSubAgreement(1, 3);

        mockSA.setAgreementStatus(2, IServiceAgreement.Status.FULFILLED);
        // child 3 remains ACCEPTED

        assertFalse(tree.allChildrenSettled(1), "one open child => false");
    }

    // ─── getDepth ─────────────────────────────────────────────────────────────

    function test_GetDepth_root_is_zero() public {
        _setAgreement(1);
        _setAgreement(2);
        vm.prank(provider); tree.registerSubAgreement(1, 2);
        assertEq(tree.getDepth(1), 0, "root depth should be 0");
    }

    function test_GetDepth_correct_at_each_level() public {
        uint256[] memory ids = new uint256[](5);
        for (uint256 i = 0; i < 5; i++) ids[i] = i + 1;
        _buildChain(ids);

        for (uint256 i = 0; i < 5; i++) {
            assertEq(tree.getDepth(ids[i]), i, "depth mismatch at level");
        }
    }

    function test_GetDepth_revert_unregistered() public {
        vm.expectRevert("AgreementTree: not registered");
        tree.getDepth(777);
    }
}
