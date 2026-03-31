// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/StatusRegistry.sol";

// ─── Minimal mock AgentRegistry ──────────────────────────────────────────────

contract MockAgentRegistry {
    mapping(address => bool) private _registered;

    function setRegistered(address agent, bool val) external {
        _registered[agent] = val;
    }

    function isRegistered(address wallet) external view returns (bool) {
        return _registered[wallet];
    }
}

// ─── Test suite ──────────────────────────────────────────────────────────────

contract StatusRegistryTest is Test {
    StatusRegistry    public registry;
    MockAgentRegistry public agentReg;

    address public agentA = address(0xA1);
    address public agentB = address(0xB2);
    address public unregistered = address(0xC3);

    // Shared test data
    bytes32 constant HASH_1   = keccak256("content-1");
    bytes32 constant HASH_2   = keccak256("content-2");
    string  constant CID_1    = "bafkreiabc123";
    string  constant CID_2    = "bafkreidef456";
    string  constant PREVIEW_OK = "This is a valid preview under 140 characters.";
    string  constant PREVIEW_141 =
        "12345678901234567890123456789012345678901234567890"  // 50
        "12345678901234567890123456789012345678901234567890"  // 50
        "1234567890123456789012345678901234567890123456789012"; // 52 → total 152 chars? 
        // Let's be precise: 50+50+41 = 141 chars

    function setUp() public {
        agentReg = new MockAgentRegistry();
        registry = new StatusRegistry(address(agentReg));

        agentReg.setRegistered(agentA, true);
        agentReg.setRegistered(agentB, true);
        // unregistered stays false
    }

    // ─── Helper ──────────────────────────────────────────────────────────────

    function _post(address agent, bytes32 hash, string memory cid, string memory preview) internal {
        vm.prank(agent);
        registry.postStatus(hash, cid, preview);
    }

    // ─── Test 1: Post status — happy path ────────────────────────────────────

    function test_PostStatus_HappyPath() public {
        vm.expectEmit(true, true, false, true);
        emit StatusRegistry.StatusPosted(agentA, HASH_1, CID_1, PREVIEW_OK, block.timestamp);

        vm.prank(agentA);
        registry.postStatus(HASH_1, CID_1, PREVIEW_OK);

        StatusRegistry.StatusMeta memory meta = registry.getStatus(HASH_1);
        assertEq(meta.agent,     agentA);
        assertEq(meta.cid,       CID_1);
        assertEq(meta.preview,   PREVIEW_OK);
        assertEq(meta.timestamp, block.timestamp);
        assertFalse(meta.deleted);
    }

    // ─── Test 2: Preview exactly 140 chars is accepted ───────────────────────

    function test_PostStatus_Preview140CharsAccepted() public {
        // Build a string that is exactly 140 bytes long
        bytes memory buf = new bytes(140);
        for (uint i = 0; i < 140; i++) buf[i] = 0x41; // 'A'
        string memory preview140 = string(buf);

        vm.prank(agentA);
        registry.postStatus(HASH_1, CID_1, preview140);

        StatusRegistry.StatusMeta memory meta = registry.getStatus(HASH_1);
        assertEq(bytes(meta.preview).length, 140);
    }

    // ─── Test 3: Preview over 140 chars reverts ───────────────────────────────

    function test_PostStatus_PreviewTooLong_Reverts() public {
        bytes memory buf = new bytes(141);
        for (uint i = 0; i < 141; i++) buf[i] = 0x41;
        string memory preview141 = string(buf);

        vm.prank(agentA);
        vm.expectRevert(StatusRegistry.PreviewTooLong.selector);
        registry.postStatus(HASH_1, CID_1, preview141);
    }

    // ─── Test 4: Unregistered agent posting reverts ───────────────────────────

    function test_PostStatus_UnregisteredAgent_Reverts() public {
        vm.prank(unregistered);
        vm.expectRevert(StatusRegistry.NotRegistered.selector);
        registry.postStatus(HASH_1, CID_1, PREVIEW_OK);
    }

    // ─── Test 5: Delete status — own post (tombstone) ─────────────────────────

    function test_DeleteStatus_OwnPost_Tombstone() public {
        _post(agentA, HASH_1, CID_1, PREVIEW_OK);

        vm.expectEmit(true, true, false, true);
        emit StatusRegistry.StatusDeleted(agentA, HASH_1, block.timestamp);

        vm.prank(agentA);
        registry.deleteStatus(HASH_1);

        // Record still exists — tombstone pattern
        StatusRegistry.StatusMeta memory meta = registry.getStatus(HASH_1);
        assertTrue(meta.deleted);
        assertEq(meta.agent, agentA);
        assertEq(meta.cid,   CID_1);
    }

    // ─── Test 6: Delete status — wrong agent reverts ─────────────────────────

    function test_DeleteStatus_WrongAgent_Reverts() public {
        _post(agentA, HASH_1, CID_1, PREVIEW_OK);

        vm.prank(agentB);
        vm.expectRevert(StatusRegistry.NotStatusOwner.selector);
        registry.deleteStatus(HASH_1);
    }

    // ─── Test 7: Delete nonexistent status reverts ───────────────────────────

    function test_DeleteStatus_NotFound_Reverts() public {
        vm.prank(agentA);
        vm.expectRevert(StatusRegistry.StatusNotFound.selector);
        registry.deleteStatus(HASH_1);
    }

    // ─── Test 8: Double-delete reverts ───────────────────────────────────────

    function test_DeleteStatus_AlreadyDeleted_Reverts() public {
        _post(agentA, HASH_1, CID_1, PREVIEW_OK);

        vm.prank(agentA);
        registry.deleteStatus(HASH_1);

        vm.prank(agentA);
        vm.expectRevert(StatusRegistry.AlreadyDeleted.selector);
        registry.deleteStatus(HASH_1);
    }

    // ─── Test 9: Duplicate contentHash reverts ───────────────────────────────

    function test_PostStatus_DuplicateHash_Reverts() public {
        _post(agentA, HASH_1, CID_1, PREVIEW_OK);

        vm.prank(agentA);
        vm.expectRevert(StatusRegistry.HashAlreadyUsed.selector);
        registry.postStatus(HASH_1, CID_1, PREVIEW_OK);
    }

    // ─── Test 10: getAgentStatuses returns correct hashes ────────────────────

    function test_GetAgentStatuses_ReturnsCorrectHashes() public {
        _post(agentA, HASH_1, CID_1, PREVIEW_OK);
        _post(agentA, HASH_2, CID_2, PREVIEW_OK);

        bytes32[] memory hashes = registry.getAgentStatuses(agentA);
        assertEq(hashes.length, 2);
        assertEq(hashes[0], HASH_1);
        assertEq(hashes[1], HASH_2);
    }

    // ─── Test 11: getStatus returns correct metadata ──────────────────────────

    function test_GetStatus_ReturnsCorrectMetadata() public {
        uint256 ts = block.timestamp;
        _post(agentA, HASH_1, CID_1, PREVIEW_OK);

        StatusRegistry.StatusMeta memory meta = registry.getStatus(HASH_1);
        assertEq(meta.agent,     agentA);
        assertEq(meta.cid,       CID_1);
        assertEq(meta.preview,   PREVIEW_OK);
        assertEq(meta.timestamp, ts);
        assertFalse(meta.deleted);
    }

    // ─── Test 12: Rate limit — 10 posts succeed, 11th reverts ────────────────

    function test_RateLimit_11thPostReverts() public {
        // Post 10 statuses — all should succeed
        for (uint256 i = 0; i < 10; i++) {
            bytes32 h = keccak256(abi.encodePacked("rate-content", i));
            vm.prank(agentA);
            registry.postStatus(h, CID_1, PREVIEW_OK);
        }

        // 11th should revert
        bytes32 h11 = keccak256("rate-content-11");
        vm.prank(agentA);
        vm.expectRevert(StatusRegistry.RateLimitExceeded.selector);
        registry.postStatus(h11, CID_1, PREVIEW_OK);
    }

    // ─── Test 13: Rate limit resets after 24h ─────────────────────────────────

    function test_RateLimit_ResetsAfter24Hours() public {
        // Fill the window
        for (uint256 i = 0; i < 10; i++) {
            bytes32 h = keccak256(abi.encodePacked("window1", i));
            vm.prank(agentA);
            registry.postStatus(h, CID_1, PREVIEW_OK);
        }

        // Advance past the 24h window
        vm.warp(block.timestamp + 24 hours + 1);

        // Should succeed in the new window
        bytes32 hNew = keccak256("window2-post-1");
        vm.prank(agentA);
        registry.postStatus(hNew, CID_1, PREVIEW_OK);

        StatusRegistry.StatusMeta memory meta = registry.getStatus(hNew);
        assertEq(meta.agent, agentA);

        // And the counter should have reset to 1
        assertEq(registry.dailyCount(agentA), 1);
    }

    // ─── Test 14: Multiple agents independent rate limits ────────────────────

    function test_RateLimit_IndependentPerAgent() public {
        // Fill agentA's window
        for (uint256 i = 0; i < 10; i++) {
            bytes32 h = keccak256(abi.encodePacked("agentA-content", i));
            vm.prank(agentA);
            registry.postStatus(h, CID_1, PREVIEW_OK);
        }

        // agentB should still be able to post
        vm.prank(agentB);
        registry.postStatus(HASH_1, CID_1, PREVIEW_OK);

        StatusRegistry.StatusMeta memory meta = registry.getStatus(HASH_1);
        assertEq(meta.agent, agentB);
    }

    // ─── Test 15: getAgentStatuses includes tombstoned entries ───────────────

    function test_GetAgentStatuses_IncludesDeleted() public {
        _post(agentA, HASH_1, CID_1, PREVIEW_OK);

        vm.prank(agentA);
        registry.deleteStatus(HASH_1);

        bytes32[] memory hashes = registry.getAgentStatuses(agentA);
        assertEq(hashes.length, 1);
        assertEq(hashes[0], HASH_1);

        assertTrue(registry.getStatus(HASH_1).deleted);
    }

    // ─── Test 16: Constructor rejects zero address ────────────────────────────

    function test_Constructor_RejectsZeroAddress() public {
        vm.expectRevert(bytes("StatusRegistry: zero address"));
        new StatusRegistry(address(0));
    }

    // ─── Test 17: Constants are as expected ──────────────────────────────────

    function test_Constants() public view {
        assertEq(registry.MAX_PREVIEW_LENGTH(), 140);
        assertEq(registry.MAX_DAILY_POSTS(),    10);
        assertEq(registry.WINDOW_DURATION(),    24 hours);
        assertEq(registry.MAX_CID_BYTES(),      100);
    }

    // ─── Test 18: [FIX MED-3] Empty CID reverts ──────────────────────────────

    function test_PostStatus_EmptyCID_Reverts() public {
        vm.prank(agentA);
        vm.expectRevert(StatusRegistry.EmptyCID.selector);
        registry.postStatus(HASH_1, "", PREVIEW_OK);
    }

    // ─── Test 19: [FIX MED-3] CID too long reverts ───────────────────────────

    function test_PostStatus_CIDTooLong_Reverts() public {
        bytes memory longCid = new bytes(101);
        for (uint i = 0; i < 101; i++) longCid[i] = 0x62; // 'b'

        vm.prank(agentA);
        vm.expectRevert(StatusRegistry.CIDTooLong.selector);
        registry.postStatus(HASH_1, string(longCid), PREVIEW_OK);
    }

    // ─── Test 20: [FIX LOW-2] Zero contentHash reverts ───────────────────────

    function test_PostStatus_ZeroHash_Reverts() public {
        vm.prank(agentA);
        vm.expectRevert(StatusRegistry.InvalidHash.selector);
        registry.postStatus(bytes32(0), CID_1, PREVIEW_OK);
    }

    // ─── Test 21: Valid CID exactly at max length (100 bytes) succeeds ────────

    function test_PostStatus_CID100Bytes_Accepted() public {
        bytes memory cid100 = new bytes(100);
        for (uint i = 0; i < 100; i++) cid100[i] = 0x62;

        vm.prank(agentA);
        registry.postStatus(HASH_1, string(cid100), PREVIEW_OK);
        assertEq(registry.getStatus(HASH_1).agent, agentA);
    }
}
