// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/StatusRegistry.sol";

contract MockAgentRegistry {
    mapping(address => bool) private _reg;
    function setRegistered(address a, bool v) external { _reg[a] = v; }
    function isRegistered(address a) external view returns (bool) { return _reg[a]; }
}

contract StatusRegistryTest is Test {
    StatusRegistry    public registry;
    MockAgentRegistry public agentReg;

    address public agentA       = address(0xA1);
    address public agentB       = address(0xB2);
    address public unregistered = address(0xC3);

    string  constant CONTENT_1  = "Testing a new DeFi risk workflow on ARC Arena.";
    string  constant CONTENT_2  = "Entering the prediction round at $68k consolidation.";
    string  constant PREVIEW_OK = "Testing a new DeFi risk workflow on ARC Arena.";

    function setUp() public {
        agentReg = new MockAgentRegistry();
        registry = new StatusRegistry(address(agentReg));
        agentReg.setRegistered(agentA, true);
        agentReg.setRegistered(agentB, true);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _hash(string memory content) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(content));
    }

    function _post(address agent, string memory content, string memory preview) internal {
        vm.prank(agent);
        registry.postStatus(_hash(content), content, preview);
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    function test_Constructor_RejectsZeroAddress() public {
        vm.expectRevert();
        new StatusRegistry(address(0));
    }

    function test_Constants() public view {
        assertEq(registry.MAX_CONTENT_LENGTH(), 280);
        assertEq(registry.MAX_PREVIEW_LENGTH(), 140);
        assertEq(registry.MAX_DAILY_POSTS(),    10);
    }

    // ─── postStatus ──────────────────────────────────────────────────────────

    function test_PostStatus_HappyPath() public {
        bytes32 h = _hash(CONTENT_1);
        vm.prank(agentA);
        registry.postStatus(h, CONTENT_1, PREVIEW_OK);

        StatusRegistry.StatusMeta memory meta = registry.getStatus(h);
        assertEq(meta.agent,     agentA);
        assertEq(meta.preview,   PREVIEW_OK);
        assertFalse(meta.deleted);
        assertGt(meta.timestamp, 0);
    }

    function test_PostStatus_EmitsEvent() public {
        bytes32 h = _hash(CONTENT_1);
        vm.expectEmit(true, true, false, true);
        emit StatusRegistry.StatusPosted(agentA, h, CONTENT_1, PREVIEW_OK, block.timestamp);
        vm.prank(agentA);
        registry.postStatus(h, CONTENT_1, PREVIEW_OK);
    }

    function test_PostStatus_UnregisteredAgent_Reverts() public {
        vm.prank(unregistered);
        vm.expectRevert(StatusRegistry.NotRegistered.selector);
        registry.postStatus(_hash(CONTENT_1), CONTENT_1, PREVIEW_OK);
    }

    function test_PostStatus_EmptyContent_Reverts() public {
        vm.prank(agentA);
        vm.expectRevert(StatusRegistry.EmptyContent.selector);
        registry.postStatus(keccak256(abi.encodePacked("")), "", PREVIEW_OK);
    }

    function test_PostStatus_ContentTooLong_Reverts() public {
        // exactly 281 bytes
        bytes memory b = new bytes(281);
        for (uint i = 0; i < 281; i++) b[i] = 0x61; // 'a'
        string memory long281 = string(b);
        vm.prank(agentA);
        vm.expectRevert(StatusRegistry.ContentTooLong.selector);
        registry.postStatus(_hash(long281), long281, PREVIEW_OK);
    }

    function test_PostStatus_Preview140Chars_Accepted() public {
        string memory p140 = "1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012"; // 142? let's use exactly 140
        // Build 140-char string
        string memory p = "12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890";
        assertEq(bytes(p).length, 140);
        _post(agentA, CONTENT_1, p);
        StatusRegistry.StatusMeta memory meta = registry.getStatus(_hash(CONTENT_1));
        assertEq(bytes(meta.preview).length, 140);
    }

    function test_PostStatus_PreviewTooLong_Reverts() public {
        string memory p141 = "123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901";
        assertEq(bytes(p141).length, 141);
        vm.prank(agentA);
        vm.expectRevert(StatusRegistry.PreviewTooLong.selector);
        registry.postStatus(_hash(CONTENT_1), CONTENT_1, p141);
    }

    function test_PostStatus_ZeroHash_Reverts() public {
        vm.prank(agentA);
        vm.expectRevert(StatusRegistry.InvalidHash.selector);
        registry.postStatus(bytes32(0), CONTENT_1, PREVIEW_OK);
    }

    function test_PostStatus_HashMismatch_Reverts() public {
        vm.prank(agentA);
        vm.expectRevert(StatusRegistry.InvalidHash.selector);
        registry.postStatus(_hash(CONTENT_2), CONTENT_1, PREVIEW_OK); // wrong hash for content
    }

    function test_PostStatus_DuplicateHash_Reverts() public {
        _post(agentA, CONTENT_1, PREVIEW_OK);
        vm.prank(agentA);
        vm.expectRevert(StatusRegistry.HashAlreadyUsed.selector);
        registry.postStatus(_hash(CONTENT_1), CONTENT_1, PREVIEW_OK);
    }

    // ─── deleteStatus ────────────────────────────────────────────────────────

    function test_DeleteStatus_HappyPath() public {
        _post(agentA, CONTENT_1, PREVIEW_OK);
        vm.prank(agentA);
        registry.deleteStatus(_hash(CONTENT_1));
        assertTrue(registry.getStatus(_hash(CONTENT_1)).deleted);
    }

    function test_DeleteStatus_EmitsEvent() public {
        _post(agentA, CONTENT_1, PREVIEW_OK);
        vm.expectEmit(true, true, false, true);
        emit StatusRegistry.StatusDeleted(agentA, _hash(CONTENT_1), block.timestamp);
        vm.prank(agentA);
        registry.deleteStatus(_hash(CONTENT_1));
    }

    function test_DeleteStatus_WrongAgent_Reverts() public {
        _post(agentA, CONTENT_1, PREVIEW_OK);
        vm.prank(agentB);
        vm.expectRevert(StatusRegistry.NotStatusOwner.selector);
        registry.deleteStatus(_hash(CONTENT_1));
    }

    function test_DeleteStatus_NotFound_Reverts() public {
        vm.prank(agentA);
        vm.expectRevert(StatusRegistry.StatusNotFound.selector);
        registry.deleteStatus(_hash(CONTENT_1));
    }

    function test_DeleteStatus_AlreadyDeleted_Reverts() public {
        _post(agentA, CONTENT_1, PREVIEW_OK);
        vm.prank(agentA);
        registry.deleteStatus(_hash(CONTENT_1));
        vm.prank(agentA);
        vm.expectRevert(StatusRegistry.AlreadyDeleted.selector);
        registry.deleteStatus(_hash(CONTENT_1));
    }

    // ─── getAgentStatuses ────────────────────────────────────────────────────

    function test_GetAgentStatuses_ReturnsCorrectHashes() public {
        _post(agentA, CONTENT_1, PREVIEW_OK);
        _post(agentA, CONTENT_2, PREVIEW_OK);
        bytes32[] memory hashes = registry.getAgentStatuses(agentA);
        assertEq(hashes.length, 2);
        assertEq(hashes[0], _hash(CONTENT_1));
        assertEq(hashes[1], _hash(CONTENT_2));
    }

    function test_GetAgentStatuses_IncludesDeleted() public {
        _post(agentA, CONTENT_1, PREVIEW_OK);
        vm.prank(agentA);
        registry.deleteStatus(_hash(CONTENT_1));
        bytes32[] memory hashes = registry.getAgentStatuses(agentA);
        assertEq(hashes.length, 1); // tombstone still in list
    }

    function test_GetAgentStatuses_EmptyForNewAgent() public view {
        bytes32[] memory hashes = registry.getAgentStatuses(agentA);
        assertEq(hashes.length, 0);
    }

    // ─── Rate limiting ───────────────────────────────────────────────────────

    function _makeContent(uint256 n) internal pure returns (string memory) {
        return string(abi.encodePacked("unique content number ", vm.toString(n)));
    }

    function test_RateLimit_10PostsSucceed() public {
        for (uint256 i = 0; i < 10; i++) {
            string memory c = _makeContent(i);
            vm.prank(agentA);
            registry.postStatus(_hash(c), c, PREVIEW_OK);
        }
    }

    function test_RateLimit_11thPostReverts() public {
        for (uint256 i = 0; i < 10; i++) {
            string memory c = _makeContent(i);
            vm.prank(agentA);
            registry.postStatus(_hash(c), c, PREVIEW_OK);
        }
        string memory c11 = _makeContent(10);
        vm.prank(agentA);
        vm.expectRevert(StatusRegistry.RateLimitExceeded.selector);
        registry.postStatus(_hash(c11), c11, PREVIEW_OK);
    }

    function test_RateLimit_ResetsAfter24Hours() public {
        for (uint256 i = 0; i < 10; i++) {
            string memory c = _makeContent(i);
            vm.prank(agentA);
            registry.postStatus(_hash(c), c, PREVIEW_OK);
        }
        vm.warp(block.timestamp + 24 hours + 1);
        string memory c11 = _makeContent(100);
        vm.prank(agentA);
        registry.postStatus(_hash(c11), c11, PREVIEW_OK); // should succeed
    }

    function test_RateLimit_IndependentPerAgent() public {
        for (uint256 i = 0; i < 10; i++) {
            string memory c = _makeContent(i);
            vm.prank(agentA);
            registry.postStatus(_hash(c), c, PREVIEW_OK);
        }
        // agentB should still be able to post
        vm.prank(agentB);
        registry.postStatus(_hash(CONTENT_1), CONTENT_1, PREVIEW_OK);
    }
}
