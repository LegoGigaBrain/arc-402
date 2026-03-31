// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/IntelligenceRegistry.sol";

// ─── Mock AgentRegistry ───────────────────────────────────────────────────────

contract MockAgentRegistryIR {
    mapping(address => bool) private _registered;

    function setRegistered(address agent, bool val) external {
        _registered[agent] = val;
    }

    function isRegistered(address wallet) external view returns (bool) {
        return _registered[wallet];
    }
}

// ─── Mock TrustRegistry ───────────────────────────────────────────────────────

contract MockTrustRegistryIR {
    mapping(address => uint256) private _scores;

    function setScore(address agent, uint256 score) external {
        _scores[agent] = score;
    }

    function getGlobalScore(address agent) external view returns (uint256) {
        return _scores[agent];
    }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

contract IntelligenceRegistryTest is Test {
    IntelligenceRegistry public registry;
    MockAgentRegistryIR  public agentReg;
    MockTrustRegistryIR  public trustReg;

    address public creator   = address(0xA1);
    address public citer1    = address(0xB1);
    address public citer2    = address(0xB2);
    address public citer3    = address(0xB3);
    address public unregAgent = address(0xCC);

    bytes32 constant HASH_1   = keccak256("artifact-content-1");
    bytes32 constant HASH_2   = keccak256("artifact-content-2");
    string  constant TAG      = "market.crypto";
    string  constant TYPE     = "briefing";
    string  constant ENDPOINT = "gigabrain.arc402.xyz";
    string  constant PREVIEW  = "Q1 on-chain flows summary - brief preview text under 140 chars";

    function setUp() public {
        agentReg = new MockAgentRegistryIR();
        trustReg = new MockTrustRegistryIR();
        registry = new IntelligenceRegistry(address(agentReg), address(trustReg));

        agentReg.setRegistered(creator,    true);
        agentReg.setRegistered(citer1,     true);
        agentReg.setRegistered(citer2,     true);
        agentReg.setRegistered(citer3,     true);
        // unregAgent stays unregistered

        trustReg.setScore(citer1, 500); // high trust
        trustReg.setScore(citer2, 100); // low trust
        trustReg.setScore(citer3, 300); // exactly at threshold
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _makeParams(bytes32 hash, string memory tag) internal pure returns (IntelligenceRegistry.RegisterParams memory) {
        return IntelligenceRegistry.RegisterParams({
            contentHash:         hash,
            squadId:             1,
            capabilityTag:       tag,
            artifactType:        TYPE,
            endpoint:            ENDPOINT,
            preview:             PREVIEW,
            trainingDataHash:    bytes32(0),
            baseModel:           "",
            evalHash:            bytes32(0),
            parentHash:          bytes32(0),
            revenueShareHash:    bytes32(0),
            revenueSplitAddress: address(0)
        });
    }

    function _register(address caller, bytes32 hash) internal {
        vm.prank(caller);
        registry.register(_makeParams(hash, TAG));
    }

    function _registerDefault() internal {
        _register(creator, HASH_1);
    }

    // ─── 1. Register happy path ───────────────────────────────────────────────

    function test_Register_HappyPath() public {
        vm.expectEmit(true, true, false, true);
        emit IntelligenceRegistry.ArtifactRegistered(HASH_1, creator, TAG, TYPE);

        _registerDefault();

        IntelligenceRegistry.IntelligenceArtifact memory a = registry.getArtifact(HASH_1);
        assertEq(a.contentHash,   HASH_1);
        assertEq(a.creator,       creator);
        assertEq(a.squadId,       1);
        assertEq(a.capabilityTag, TAG);
        assertEq(a.artifactType,  TYPE);
        assertEq(a.endpoint,      ENDPOINT);
        assertEq(a.preview,       PREVIEW);
        assertEq(a.timestamp,     block.timestamp);
        assertEq(a.citationCount, 0);
        assertEq(a.weightedCitationCount, 0);
    }

    // ─── 2. Register stores optional fields correctly ─────────────────────────

    function test_Register_OptionalFieldsStored() public {
        bytes32 trainingHash   = keccak256("training-data");
        bytes32 evalHashVal    = keccak256("eval-data");
        bytes32 parentHashVal  = keccak256("parent-artifact");
        bytes32 revShareHash   = keccak256("rev-share-agreement");
        address splitAddr      = address(0xDEAD);

        vm.prank(creator);
        registry.register(IntelligenceRegistry.RegisterParams({
            contentHash:         HASH_1,
            squadId:             1,
            capabilityTag:       TAG,
            artifactType:        "lora",
            endpoint:            ENDPOINT,
            preview:             PREVIEW,
            trainingDataHash:    trainingHash,
            baseModel:           "llama-3.1-8b",
            evalHash:            evalHashVal,
            parentHash:          parentHashVal,
            revenueShareHash:    revShareHash,
            revenueSplitAddress: splitAddr
        }));

        IntelligenceRegistry.IntelligenceArtifact memory a = registry.getArtifact(HASH_1);
        assertEq(a.trainingDataHash,    trainingHash);
        assertEq(a.baseModel,           "llama-3.1-8b");
        assertEq(a.evalHash,            evalHashVal);
        assertEq(a.parentHash,          parentHashVal);
        assertEq(a.revenueShareHash,    revShareHash);
        assertEq(a.revenueSplitAddress, splitAddr);
    }

    // ─── 3. Register duplicate hash reverts ──────────────────────────────────

    function test_Register_DuplicateHash_Reverts() public {
        _registerDefault();

        vm.prank(creator);
        vm.expectRevert(IntelligenceRegistry.HashAlreadyRegistered.selector);
        registry.register(_makeParams(HASH_1, TAG));
    }

    // ─── 4. Register unregistered agent reverts ───────────────────────────────

    function test_Register_UnregisteredAgent_Reverts() public {
        vm.prank(unregAgent);
        vm.expectRevert(IntelligenceRegistry.NotRegistered.selector);
        registry.register(_makeParams(HASH_1, TAG));
    }

    // ─── 5. Register empty content hash reverts ───────────────────────────────

    function test_Register_EmptyContentHash_Reverts() public {
        vm.prank(creator);
        vm.expectRevert(IntelligenceRegistry.EmptyContentHash.selector);
        registry.register(_makeParams(bytes32(0), TAG));
    }

    // ─── 6. Register preview too long reverts ────────────────────────────────

    function test_Register_PreviewTooLong_Reverts() public {
        bytes memory buf = new bytes(141);
        for (uint i = 0; i < 141; i++) buf[i] = 0x41;

        IntelligenceRegistry.RegisterParams memory p = _makeParams(HASH_1, TAG);
        p.preview = string(buf);

        vm.prank(creator);
        vm.expectRevert(IntelligenceRegistry.PreviewTooLong.selector);
        registry.register(p);
    }

    // ─── 7. Register preview exactly 140 chars accepted ──────────────────────

    function test_Register_Preview140Accepted() public {
        bytes memory buf = new bytes(140);
        for (uint i = 0; i < 140; i++) buf[i] = 0x41;

        IntelligenceRegistry.RegisterParams memory p = _makeParams(HASH_1, TAG);
        p.preview = string(buf);

        vm.prank(creator);
        registry.register(p);

        assertEq(bytes(registry.getArtifact(HASH_1).preview).length, 140);
    }

    // ─── 8. Register empty endpoint reverts ──────────────────────────────────

    function test_Register_EmptyEndpoint_Reverts() public {
        IntelligenceRegistry.RegisterParams memory p = _makeParams(HASH_1, TAG);
        p.endpoint = "";

        vm.prank(creator);
        vm.expectRevert(IntelligenceRegistry.EmptyEndpoint.selector);
        registry.register(p);
    }

    // ─── 9. recordCitation happy path (high trust) ────────────────────────────

    function test_RecordCitation_HappyPath_HighTrust() public {
        _registerDefault();

        vm.expectEmit(true, true, false, true);
        emit IntelligenceRegistry.ArtifactCited(HASH_1, citer1, 1, 1);

        vm.prank(citer1);
        registry.recordCitation(HASH_1);

        IntelligenceRegistry.IntelligenceArtifact memory a = registry.getArtifact(HASH_1);
        assertEq(a.citationCount,         1);
        assertEq(a.weightedCitationCount, 1);
    }

    // ─── 10. recordCitation low trust — raw increments, weighted does NOT ─────

    function test_RecordCitation_LowTrust_RawCountOnly() public {
        _registerDefault();

        vm.prank(citer2); // score = 100, below MIN_CITER_TRUST
        registry.recordCitation(HASH_1);

        IntelligenceRegistry.IntelligenceArtifact memory a = registry.getArtifact(HASH_1);
        assertEq(a.citationCount,         1); // raw incremented
        assertEq(a.weightedCitationCount, 0); // weighted NOT incremented
    }

    // ─── 11. recordCitation dedup (same citer twice reverts) ─────────────────

    function test_RecordCitation_Dedup_Reverts() public {
        _registerDefault();

        vm.prank(citer1);
        registry.recordCitation(HASH_1);

        vm.prank(citer1);
        vm.expectRevert(IntelligenceRegistry.AlreadyCited.selector);
        registry.recordCitation(HASH_1);
    }

    // ─── 12. recordCitation unregistered citer reverts ───────────────────────

    function test_RecordCitation_UnregisteredCiter_Reverts() public {
        _registerDefault();

        vm.prank(unregAgent);
        vm.expectRevert(IntelligenceRegistry.NotRegistered.selector);
        registry.recordCitation(HASH_1);
    }

    // ─── 13. recordCitation on non-existent artifact reverts ─────────────────

    function test_RecordCitation_ArtifactNotFound_Reverts() public {
        vm.prank(citer1);
        vm.expectRevert(IntelligenceRegistry.ArtifactNotFound.selector);
        registry.recordCitation(keccak256("does-not-exist"));
    }

    // ─── 14. Threshold 1 event at 5 weighted citations ────────────────────────

    function test_CitationThreshold1_Event() public {
        _registerDefault();

        // Register 5 high-trust citers
        address[5] memory citers;
        for (uint i = 0; i < 5; i++) {
            citers[i] = address(uint160(0xF000 + i));
            agentReg.setRegistered(citers[i], true);
            trustReg.setScore(citers[i], 500);
        }

        // First 4 should NOT emit threshold
        for (uint i = 0; i < 4; i++) {
            vm.prank(citers[i]);
            registry.recordCitation(HASH_1);
        }

        // 5th citation should emit CitationThresholdReached(HASH_1, 5)
        vm.expectEmit(true, false, false, true);
        emit IntelligenceRegistry.CitationThresholdReached(HASH_1, 5);

        vm.prank(citers[4]);
        registry.recordCitation(HASH_1);

        assertEq(registry.getArtifact(HASH_1).weightedCitationCount, 5);
    }

    // ─── 15. Threshold 2 event at 20 weighted citations ───────────────────────

    function test_CitationThreshold2_Event() public {
        _registerDefault();

        // Register 20 high-trust citers
        address[20] memory citers;
        for (uint i = 0; i < 20; i++) {
            citers[i] = address(uint160(0xE000 + i));
            agentReg.setRegistered(citers[i], true);
            trustReg.setScore(citers[i], 500);
        }

        // First 19
        for (uint i = 0; i < 19; i++) {
            vm.prank(citers[i]);
            registry.recordCitation(HASH_1);
        }

        // 20th citation should emit CitationThresholdReached(HASH_1, 20)
        vm.expectEmit(true, false, false, true);
        emit IntelligenceRegistry.CitationThresholdReached(HASH_1, 20);

        vm.prank(citers[19]);
        registry.recordCitation(HASH_1);

        assertEq(registry.getArtifact(HASH_1).weightedCitationCount, 20);
    }

    // ─── 16. getByCapability returns correct hashes ───────────────────────────

    function test_GetByCapability_ReturnsCorrectHashes() public {
        _register(creator, HASH_1);
        _register(creator, HASH_2);

        bytes32[] memory hashes = registry.getByCapability(TAG);
        assertEq(hashes.length, 2);
        assertEq(hashes[0], HASH_1);
        assertEq(hashes[1], HASH_2);
    }

    // ─── 17. getByCapability different tags are isolated ─────────────────────

    function test_GetByCapability_DifferentTags_Isolated() public {
        _registerDefault(); // TAG = "market.crypto"
        _register(creator, HASH_2); // uses same TAG — let's use different tag via inline
        // Override: re-register HASH_2 under a different tag
        // (HASH_2 was already registered above, so use HASH_3)
        bytes32 HASH_3 = keccak256("artifact-content-3");
        vm.prank(creator);
        registry.register(_makeParams(HASH_3, "security.audit"));

        assertEq(registry.getByCapability(TAG).length,              2); // HASH_1, HASH_2
        assertEq(registry.getByCapability("security.audit").length, 1); // HASH_3
    }

    // ─── 18. hasCited returns correct boolean ────────────────────────────────

    function test_HasCited_CorrectBoolean() public {
        _registerDefault();

        assertFalse(registry.hasCited(HASH_1, citer1));

        vm.prank(citer1);
        registry.recordCitation(HASH_1);

        assertTrue(registry.hasCited(HASH_1, citer1));
        assertFalse(registry.hasCited(HASH_1, citer2)); // citer2 hasn't cited
    }

    // ─── 19. getArtifact on unknown hash reverts ──────────────────────────────

    function test_GetArtifact_UnknownHash_Reverts() public {
        vm.expectRevert(IntelligenceRegistry.ArtifactNotFound.selector);
        registry.getArtifact(keccak256("does-not-exist"));
    }

    // ─── 20. Constructor rejects zero addresses ───────────────────────────────

    function test_Constructor_RejectsZeroAddresses() public {
        vm.expectRevert(IntelligenceRegistry.ZeroAddress.selector);
        new IntelligenceRegistry(address(0), address(trustReg));

        vm.expectRevert(IntelligenceRegistry.ZeroAddress.selector);
        new IntelligenceRegistry(address(agentReg), address(0));
    }

    // ─── 21. Exactly-at-threshold trust score counts as weighted ─────────────

    function test_RecordCitation_ExactlyAtThreshold_CountsAsWeighted() public {
        _registerDefault();

        // citer3 has score exactly 300 = MIN_CITER_TRUST
        vm.prank(citer3);
        registry.recordCitation(HASH_1);

        IntelligenceRegistry.IntelligenceArtifact memory a = registry.getArtifact(HASH_1);
        assertEq(a.citationCount,         1);
        assertEq(a.weightedCitationCount, 1); // should count
    }

    // ─── 22. Multiple citers accumulate raw and weighted counts independently ─

    function test_MultipleCiters_RawAndWeightedAccumulate() public {
        _registerDefault();

        vm.prank(citer1); // high trust
        registry.recordCitation(HASH_1);

        vm.prank(citer2); // low trust
        registry.recordCitation(HASH_1);

        vm.prank(citer3); // exactly at threshold
        registry.recordCitation(HASH_1);

        IntelligenceRegistry.IntelligenceArtifact memory a = registry.getArtifact(HASH_1);
        assertEq(a.citationCount,         3); // all 3 raw
        assertEq(a.weightedCitationCount, 2); // only citer1 and citer3
    }

    // ─── 23. getByCapability returns empty for unknown tag ────────────────────

    function test_GetByCapability_UnknownTag_ReturnsEmpty() public {
        bytes32[] memory hashes = registry.getByCapability("unknown.tag");
        assertEq(hashes.length, 0);
    }
}
