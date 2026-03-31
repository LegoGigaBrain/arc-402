// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/ResearchSquad.sol";
import "../contracts/SquadBriefing.sol";

// ─── Mock AgentRegistry ───────────────────────────────────────────────────────

contract MockAgentRegistrySB {
    mapping(address => bool) private _registered;

    function setRegistered(address agent, bool val) external {
        _registered[agent] = val;
    }

    function isRegistered(address wallet) external view returns (bool) {
        return _registered[wallet];
    }
}

// ─── Mock TrustRegistry ───────────────────────────────────────────────────────

contract MockTrustRegistrySB {
    mapping(address => uint256) private _scores;

    function setScore(address agent, uint256 score) external {
        _scores[agent] = score;
    }

    function getGlobalScore(address agent) external view returns (uint256) {
        return _scores[agent];
    }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

contract SquadBriefingTest is Test {
    ResearchSquad        public researchSquad;
    SquadBriefing        public briefing;
    MockAgentRegistrySB  public agentReg;
    MockTrustRegistrySB  public trustReg;

    address public lead        = address(0xA1);
    address public contributor = address(0xB2);
    address public outsider    = address(0xC3);
    address public highCiter   = address(0xD1);
    address public lowCiter    = address(0xD2);

    uint256 public squadId;

    string  constant ENDPOINT_1  = "gigabrain.arc402.xyz";
    string  constant ENDPOINT_2  = "researchbot.arc402.xyz";
    bytes32 constant HASH_1      = keccak256("briefing-content-1");
    bytes32 constant HASH_2      = keccak256("briefing-content-2");
    string  constant PREVIEW_OK  = "Q1 on-chain flows: net accumulation at 68k. BTC likely to consolidate.";
    function setUp() public {
        agentReg      = new MockAgentRegistrySB();
        trustReg      = new MockTrustRegistrySB();
        researchSquad = new ResearchSquad(address(agentReg));
        briefing      = new SquadBriefing(address(researchSquad), address(agentReg), address(trustReg));

        agentReg.setRegistered(lead,        true);
        agentReg.setRegistered(contributor, true);
        agentReg.setRegistered(highCiter,   true);
        agentReg.setRegistered(lowCiter,    true);

        trustReg.setScore(highCiter, 500); // above MIN_CITER_TRUST
        trustReg.setScore(lowCiter,  100); // below MIN_CITER_TRUST

        // Create a squad — lead is auto-assigned LEAD role
        vm.prank(lead);
        squadId = researchSquad.createSquad("BTC Research", "market.crypto", false);

        // Contributor joins
        vm.prank(contributor);
        researchSquad.joinSquad(squadId);
    }

    // ─── Helper ──────────────────────────────────────────────────────────────

    function _publish(
        address caller,
        bytes32 hash,
        string memory preview,
        string memory endpoint,
        string[] memory tags
    ) internal {
        vm.prank(caller);
        briefing.publishBriefing(squadId, hash, preview, endpoint, tags);
    }

    function _noTags() internal pure returns (string[] memory t) {
        t = new string[](0);
    }

    function _tags2() internal pure returns (string[] memory t) {
        t = new string[](2);
        t[0] = "bitcoin";
        t[1] = "q1-2026";
    }

    // ─── 1. Publish briefing happy path ──────────────────────────────────────

    function test_PublishBriefing_HappyPath() public {
        vm.expectEmit(true, true, false, true);
        emit SquadBriefing.BriefingPublished(squadId, HASH_1, lead, PREVIEW_OK, ENDPOINT_1, block.timestamp);

        _publish(lead, HASH_1, PREVIEW_OK, ENDPOINT_1, _noTags());

        assertTrue(briefing.briefingExists(HASH_1));

        SquadBriefing.Briefing memory b = briefing.getBriefing(HASH_1);
        assertEq(b.squadId,     squadId);
        assertEq(b.contentHash, HASH_1);
        assertEq(b.preview,     PREVIEW_OK);
        assertEq(b.endpoint,    ENDPOINT_1);
        assertEq(b.publisher,   lead);
        assertEq(b.timestamp,   block.timestamp);
    }

    // ─── 2. Tags stored correctly ────────────────────────────────────────────

    function test_PublishBriefing_TagsStored() public {
        string[] memory tags = _tags2();
        _publish(lead, HASH_1, PREVIEW_OK, ENDPOINT_1, tags);

        SquadBriefing.Briefing memory b = briefing.getBriefing(HASH_1);
        assertEq(b.tags.length, 2);
        assertEq(b.tags[0],     "bitcoin");
        assertEq(b.tags[1],     "q1-2026");
    }

    // ─── 3. Contributor (non-lead) cannot publish ────────────────────────────

    function test_PublishBriefing_Contributor_Reverts() public {
        vm.prank(contributor);
        vm.expectRevert(SquadBriefing.NotSquadLead.selector);
        briefing.publishBriefing(squadId, HASH_1, PREVIEW_OK, ENDPOINT_1, _noTags());
    }

    // ─── 4. Outsider (non-member) cannot publish ─────────────────────────────

    function test_PublishBriefing_Outsider_Reverts() public {
        vm.prank(outsider);
        vm.expectRevert(SquadBriefing.NotRegistered.selector);
        briefing.publishBriefing(squadId, HASH_1, PREVIEW_OK, ENDPOINT_1, _noTags());
    }

    // ─── 5. Preview exactly 140 chars accepted ───────────────────────────────

    function test_PublishBriefing_Preview140Accepted() public {
        bytes memory buf = new bytes(140);
        for (uint i = 0; i < 140; i++) buf[i] = 0x41;
        string memory preview140 = string(buf);

        _publish(lead, HASH_1, preview140, ENDPOINT_1, _noTags());

        assertEq(bytes(briefing.getBriefing(HASH_1).preview).length, 140);
    }

    // ─── 6. Preview over 140 chars reverts ───────────────────────────────────

    function test_PublishBriefing_PreviewTooLong_Reverts() public {
        bytes memory buf = new bytes(141);
        for (uint i = 0; i < 141; i++) buf[i] = 0x41;

        vm.prank(lead);
        vm.expectRevert(SquadBriefing.PreviewTooLong.selector);
        briefing.publishBriefing(squadId, HASH_1, string(buf), ENDPOINT_1, _noTags());
    }

    // ─── 7. Duplicate contentHash reverts ────────────────────────────────────

    function test_PublishBriefing_DuplicateHash_Reverts() public {
        _publish(lead, HASH_1, PREVIEW_OK, ENDPOINT_1, _noTags());

        vm.prank(lead);
        vm.expectRevert(SquadBriefing.HashAlreadyPublished.selector);
        briefing.publishBriefing(squadId, HASH_1, PREVIEW_OK, ENDPOINT_2, _noTags());
    }

    // ─── 8. Zero contentHash reverts ─────────────────────────────────────────

    function test_PublishBriefing_ZeroHash_Reverts() public {
        vm.prank(lead);
        vm.expectRevert(SquadBriefing.EmptyContentHash.selector);
        briefing.publishBriefing(squadId, bytes32(0), PREVIEW_OK, ENDPOINT_1, _noTags());
    }

    // ─── 9. Empty endpoint reverts ───────────────────────────────────────────

    function test_PublishBriefing_EmptyEndpoint_Reverts() public {
        vm.prank(lead);
        vm.expectRevert(SquadBriefing.EmptyEndpoint.selector);
        briefing.publishBriefing(squadId, HASH_1, PREVIEW_OK, "", _noTags());
    }

    // ─── 10. getSquadBriefings returns correct hashes ────────────────────────

    function test_GetSquadBriefings_ReturnsHashes() public {
        _publish(lead, HASH_1, PREVIEW_OK, ENDPOINT_1, _noTags());
        _publish(lead, HASH_2, PREVIEW_OK, ENDPOINT_2, _noTags());

        bytes32[] memory hashes = briefing.getSquadBriefings(squadId);
        assertEq(hashes.length, 2);
        assertEq(hashes[0], HASH_1);
        assertEq(hashes[1], HASH_2);
    }

    // ─── 11. getSquadBriefingsFull returns full structs ──────────────────────

    function test_GetSquadBriefingsFull_ReturnsStructs() public {
        _publish(lead, HASH_1, PREVIEW_OK, ENDPOINT_1, _noTags());
        _publish(lead, HASH_2, PREVIEW_OK, ENDPOINT_2, _noTags());

        SquadBriefing.Briefing[] memory bs = briefing.getSquadBriefingsFull(squadId);
        assertEq(bs.length, 2);
        assertEq(bs[0].contentHash, HASH_1);
        assertEq(bs[1].contentHash, HASH_2);
        assertEq(bs[1].endpoint,    ENDPOINT_2);
    }

    // ─── 12. getBriefing on unknown hash reverts ──────────────────────────────

    function test_GetBriefing_UnknownHash_Reverts() public {
        vm.expectRevert(SquadBriefing.BriefingNotFound.selector);
        briefing.getBriefing(keccak256("does-not-exist"));
    }

    // ─── 13. Constructor rejects zero addresses ───────────────────────────────

    function test_Constructor_RejectsZeroAddresses() public {
        vm.expectRevert(SquadBriefing.ZeroAddress.selector);
        new SquadBriefing(address(0), address(agentReg), address(trustReg));

        vm.expectRevert(SquadBriefing.ZeroAddress.selector);
        new SquadBriefing(address(researchSquad), address(0), address(trustReg));

        vm.expectRevert(SquadBriefing.ZeroAddress.selector);
        new SquadBriefing(address(researchSquad), address(agentReg), address(0));
    }

    // ─── 14. Empty squad returns empty briefing list ──────────────────────────

    function test_GetSquadBriefings_EmptySquad_ReturnsEmpty() public {
        bytes32[] memory hashes = briefing.getSquadBriefings(squadId);
        assertEq(hashes.length, 0);
    }

    // ─── 15. Registered agent not in squad cannot publish ─────────────────────

    function test_PublishBriefing_RegisteredButNotMember_Reverts() public {
        // agentReg.setRegistered(outsider, true) but outsider never joined
        agentReg.setRegistered(outsider, true);

        vm.prank(outsider);
        vm.expectRevert(SquadBriefing.NotSquadLead.selector);
        briefing.publishBriefing(squadId, HASH_1, PREVIEW_OK, ENDPOINT_1, _noTags());
    }

    // ─── Proposal flow ────────────────────────────────────────────────────────

    function test_ProposeBriefing_HappyPath() public {
        bytes32 h = keccak256("proposal-content");
        vm.prank(contributor);
        briefing.proposeBriefing(squadId, h, "preview", "https://ep.xyz", new string[](0));
        assertTrue(briefing.proposalExists(h));
        SquadBriefing.Proposal memory p = briefing.getProposal(h);
        assertEq(p.proposer, contributor);
        assertEq(uint(p.status), uint(SquadBriefing.ProposalStatus.Pending));
    }

    function test_ProposeBriefing_NonMember_Reverts() public {
        address nonMember = address(0xFEED);
        agentReg.setRegistered(nonMember, true);
        bytes32 h = keccak256("outsider-proposal");
        vm.prank(nonMember);
        vm.expectRevert(SquadBriefing.NotSquadMember.selector);
        briefing.proposeBriefing(squadId, h, "preview", "https://ep.xyz", new string[](0));
    }

    function test_ProposeBriefing_DuplicateHash_Reverts() public {
        bytes32 h = keccak256("dup-proposal");
        vm.prank(contributor);
        briefing.proposeBriefing(squadId, h, "preview", "https://ep.xyz", new string[](0));
        vm.prank(contributor);
        vm.expectRevert(SquadBriefing.ProposalAlreadyExists.selector);
        briefing.proposeBriefing(squadId, h, "preview", "https://ep.xyz", new string[](0));
    }

    function test_ApproveProposal_LeadApproves_Publishes() public {
        bytes32 h = keccak256("approve-me");
        vm.prank(contributor);
        briefing.proposeBriefing(squadId, h, "approved preview", "https://ep.xyz", new string[](0));
        vm.prank(lead);
        briefing.approveProposal(h);
        assertTrue(briefing.briefingExists(h));
        SquadBriefing.Briefing memory b = briefing.getBriefing(h);
        assertEq(b.publisher, contributor); // proposer is the publisher
        assertEq(uint(briefing.getProposal(h).status), uint(SquadBriefing.ProposalStatus.Approved));
    }

    function test_ApproveProposal_Contributor_Reverts() public {
        bytes32 h = keccak256("contributor-cant-approve");
        vm.prank(contributor);
        briefing.proposeBriefing(squadId, h, "preview", "https://ep.xyz", new string[](0));
        vm.prank(contributor);
        vm.expectRevert(SquadBriefing.NotSquadLead.selector);
        briefing.approveProposal(h);
    }

    function test_RejectProposal_LeadRejects() public {
        bytes32 h = keccak256("reject-me");
        vm.prank(contributor);
        briefing.proposeBriefing(squadId, h, "preview", "https://ep.xyz", new string[](0));
        vm.prank(lead);
        briefing.rejectProposal(h);
        assertFalse(briefing.briefingExists(h));
        assertEq(uint(briefing.getProposal(h).status), uint(SquadBriefing.ProposalStatus.Rejected));
    }

    function test_ApproveProposal_AlreadyApproved_Reverts() public {
        bytes32 h = keccak256("double-approve");
        vm.prank(contributor);
        briefing.proposeBriefing(squadId, h, "preview", "https://ep.xyz", new string[](0));
        vm.prank(lead);
        briefing.approveProposal(h);
        vm.prank(lead);
        vm.expectRevert(SquadBriefing.ProposalAlreadyApproved.selector);
        briefing.approveProposal(h);
    }

    function test_GetSquadProposals_ReturnsPending() public {
        bytes32 h1 = keccak256("p1");
        bytes32 h2 = keccak256("p2");
        vm.prank(contributor);
        briefing.proposeBriefing(squadId, h1, "p1", "https://ep.xyz", new string[](0));
        vm.prank(contributor);
        briefing.proposeBriefing(squadId, h2, "p2", "https://ep.xyz", new string[](0));
        bytes32[] memory proposals = briefing.getSquadProposals(squadId);
        assertEq(proposals.length, 2);
        assertEq(proposals[0], h1);
        assertEq(proposals[1], h2);
    }
    // ─── NEW: Publishing for concluded squad is allowed ───────────────────────
    // A concluded squad is complete, not deleted. Post-hoc briefings (wrap-up
    // reports, retrospectives) are valid outputs from a finished squad.
    // The daemon uses ServiceAgreement for access gating; the squad status is
    // irrelevant to the briefing registry.

    function test_PublishBriefing_ConcludedSquad_Succeeds() public {
        // Conclude the squad
        vm.prank(lead);
        researchSquad.concludeSquad(squadId);

        // Lead publishes a post-conclusion wrap-up briefing
        bytes32 wrapUpHash = keccak256("wrap-up-report");
        string memory wrapUpPreview = "Squad concluded: final report on Q1 BTC flows.";

        vm.prank(lead);
        briefing.publishBriefing(
            squadId,
            wrapUpHash,
            wrapUpPreview,
            ENDPOINT_1,
            _noTags()
        );

        assertTrue(briefing.briefingExists(wrapUpHash));
        SquadBriefing.Briefing memory b = briefing.getBriefing(wrapUpHash);
        assertEq(b.squadId,     squadId);
        assertEq(b.contentHash, wrapUpHash);
        assertEq(b.publisher,   lead);
    }

    // ─── citeBriefing tests ───────────────────────────────────────────────────

    function _publishDefault() internal {
        _publish(lead, HASH_1, PREVIEW_OK, ENDPOINT_1, _noTags());
    }

    function test_CiteBriefing_HappyPath_HighTrust() public {
        _publishDefault();

        vm.expectEmit(true, true, false, true);
        emit SquadBriefing.BriefingCited(HASH_1, highCiter, HASH_2, 1);

        vm.prank(highCiter);
        briefing.citeBriefing(HASH_1, HASH_2, "great briefing");

        assertEq(briefing.citationCount(HASH_1),         1);
        assertEq(briefing.weightedCitationCount(HASH_1), 1);
        assertTrue(briefing.hasCited(HASH_1, highCiter));
    }

    function test_CiteBriefing_LowTrust_RawCountOnly() public {
        _publishDefault();

        vm.prank(lowCiter); // score = 100, below MIN_CITER_TRUST
        briefing.citeBriefing(HASH_1, HASH_2, "citing");

        assertEq(briefing.citationCount(HASH_1),         1); // raw incremented
        assertEq(briefing.weightedCitationCount(HASH_1), 0); // weighted NOT incremented
        assertTrue(briefing.hasCited(HASH_1, lowCiter));
    }

    function test_CiteBriefing_AlreadyCited_Reverts() public {
        _publishDefault();

        vm.prank(highCiter);
        briefing.citeBriefing(HASH_1, HASH_2, "first");

        vm.prank(highCiter);
        vm.expectRevert(SquadBriefing.AlreadyCited.selector);
        briefing.citeBriefing(HASH_1, HASH_2, "second");
    }

    function test_CiteBriefing_UnpublishedBriefing_Reverts() public {
        // HASH_1 not published yet
        vm.prank(highCiter);
        vm.expectRevert(SquadBriefing.BriefingNotPublished.selector);
        briefing.citeBriefing(HASH_1, HASH_2, "citing unpublished");
    }

    function test_CiteBriefing_Threshold1_Event() public {
        _publishDefault();

        // Register 5 high-trust citers
        address[5] memory citers;
        for (uint i = 0; i < 5; i++) {
            citers[i] = address(uint160(0xF100 + i));
            agentReg.setRegistered(citers[i], true);
            trustReg.setScore(citers[i], 500);
        }

        // First 4 — no threshold event
        for (uint i = 0; i < 4; i++) {
            vm.prank(citers[i]);
            briefing.citeBriefing(HASH_1, HASH_2, "cite");
        }

        // 5th should emit CitationThresholdReached(HASH_1, 5)
        vm.expectEmit(true, false, false, true);
        emit SquadBriefing.CitationThresholdReached(HASH_1, 5);

        vm.prank(citers[4]);
        briefing.citeBriefing(HASH_1, HASH_2, "cite");

        assertEq(briefing.weightedCitationCount(HASH_1), 5);
    }

    function test_CiteBriefing_UnregisteredCiter_Reverts() public {
        _publishDefault();

        vm.prank(outsider); // not registered in agentReg
        vm.expectRevert(SquadBriefing.NotRegistered.selector);
        briefing.citeBriefing(HASH_1, HASH_2, "outsider cite");
    }
}
