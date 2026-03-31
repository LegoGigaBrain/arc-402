// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IAgentRegistry.sol";

// ─── ResearchSquad interface ──────────────────────────────────────────────────

interface IResearchSquad {
    enum Role { Contributor, Lead }
    function isMember(uint256 squadId, address agent) external view returns (bool);
    function getMemberRole(uint256 squadId, address member) external view returns (Role);
}

/**
 * @title SquadBriefing
 * @notice Registry of published intelligence outputs from research squads.
 *
 *         Two publication paths:
 *           1. LEAD direct publish — squad LEAD publishes immediately
 *           2. Contributor proposal — any squad member proposes a briefing,
 *              a LEAD approves it, which triggers publication
 *
 *         This contract is a PURE REGISTRY. It stores:
 *           - contentHash  keccak256 of the full briefing content (on-chain proof)
 *           - preview      ≤140-char excerpt for feed rendering without a fetch
 *           - endpoint     publisher's daemon endpoint for peer-to-peer delivery
 *           - tags         arbitrary categorisation strings
 *
 *         Payment for paid briefings is handled externally via ServiceAgreement
 *         (0xC98B402CAB9156da68A87a69E3B4bf167A3CCcF6). The publisher's daemon
 *         checks ServiceAgreement state before serving full content peer-to-peer.
 *         This contract is not involved in access control at runtime.
 *
 *         Security:
 *         - CEI pattern throughout
 *         - No value transfer → no reentrancy risk
 *         - Custom errors only
 *
 * @dev    Solidity 0.8.24 · immutable · no via_ir · no upgradeable proxy
 */
contract SquadBriefing {

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant MAX_PREVIEW_LENGTH = 140;

    // ─── Types ────────────────────────────────────────────────────────────────

    struct Briefing {
        uint256   squadId;
        bytes32   contentHash;  // keccak256 of full briefing content
        string    preview;      // ≤140-char excerpt
        string    endpoint;     // publisher's daemon endpoint
        string[]  tags;
        address   publisher;
        uint256   timestamp;
    }

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotRegistered();
    error NotSquadLead();
    error NotSquadMember();
    error PreviewTooLong();
    error HashAlreadyPublished();
    error BriefingNotFound();
    error ProposalNotFound();
    error ProposalAlreadyExists();
    error ProposalAlreadyApproved();
    error NotProposalSquad();
    error ZeroAddress();
    error EmptyEndpoint();
    error EmptyContentHash();

    // ─── Types ────────────────────────────────────────────────────────────────

    enum ProposalStatus { Pending, Approved, Rejected }

    struct Proposal {
        uint256        squadId;
        bytes32        contentHash;
        string         preview;
        string         endpoint;
        string[]       tags;
        address        proposer;
        uint256        timestamp;
        ProposalStatus status;
    }

    // ─── Events ───────────────────────────────────────────────────────────────

    event BriefingPublished(
        uint256 indexed squadId,
        bytes32 indexed contentHash,
        string  preview,
        string  endpoint,
        uint256 timestamp
    );

    event BriefingProposed(
        uint256 indexed squadId,
        bytes32 indexed contentHash,
        address indexed proposer,
        uint256 timestamp
    );

    event ProposalApproved(
        uint256 indexed squadId,
        bytes32 indexed contentHash,
        address indexed approver,
        uint256 timestamp
    );

    event ProposalRejected(
        uint256 indexed squadId,
        bytes32 indexed contentHash,
        address indexed rejector,
        uint256 timestamp
    );

    // ─── State ────────────────────────────────────────────────────────────────

    IResearchSquad public immutable researchSquad;
    IAgentRegistry public immutable agentRegistry;

    /// contentHash → Briefing
    mapping(bytes32 => Briefing) private _briefings;

    /// contentHash → exists
    mapping(bytes32 => bool) private _published;

    /// squadId → ordered list of contentHashes
    mapping(uint256 => bytes32[]) private _squadBriefings;

    /// contentHash → Proposal (pending contributor proposals)
    mapping(bytes32 => Proposal) private _proposals;

    /// contentHash → proposal exists
    mapping(bytes32 => bool) private _proposalExists;

    /// squadId → ordered list of pending proposal contentHashes
    mapping(uint256 => bytes32[]) private _squadProposals;

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _researchSquad, address _agentRegistry) {
        if (_researchSquad == address(0)) revert ZeroAddress();
        if (_agentRegistry == address(0)) revert ZeroAddress();
        researchSquad = IResearchSquad(_researchSquad);
        agentRegistry = IAgentRegistry(_agentRegistry);
    }

    // ─── Writes ───────────────────────────────────────────────────────────────

    /**
     * @notice Publish a briefing for a squad. Caller must be a LEAD of that squad.
     *
     *         Full content is served peer-to-peer from the publisher's daemon at
     *         `endpoint`. For paid briefings, the daemon checks ServiceAgreement
     *         state before serving — this contract is not involved in that check.
     *
     * @param squadId       Squad to publish for.
     * @param contentHash   keccak256 of full briefing content (dedup + proof key).
     * @param preview       ≤140-char excerpt rendered in feeds without a fetch.
     * @param endpoint      Publisher's daemon endpoint (e.g. gigabrain.arc402.xyz).
     * @param tags          Arbitrary categorisation strings.
     */
    function publishBriefing(
        uint256           squadId,
        bytes32           contentHash,
        string  calldata  preview,
        string  calldata  endpoint,
        string[] calldata tags
    ) external {
        // Checks
        if (!agentRegistry.isRegistered(msg.sender))    revert NotRegistered();
        if (contentHash == bytes32(0))                  revert EmptyContentHash();
        if (bytes(endpoint).length == 0)                revert EmptyEndpoint();
        if (bytes(preview).length > MAX_PREVIEW_LENGTH) revert PreviewTooLong();
        if (_published[contentHash])                    revert HashAlreadyPublished();

        // Caller must be a LEAD of the squad
        if (!researchSquad.isMember(squadId, msg.sender))
            revert NotSquadLead();
        if (researchSquad.getMemberRole(squadId, msg.sender) != IResearchSquad.Role.Lead)
            revert NotSquadLead();

        // Effects
        _published[contentHash] = true;
        _squadBriefings[squadId].push(contentHash);

        Briefing storage b = _briefings[contentHash];
        b.squadId     = squadId;
        b.contentHash = contentHash;
        b.preview     = preview;
        b.endpoint    = endpoint;
        b.publisher   = msg.sender;
        b.timestamp   = block.timestamp;
        for (uint256 i = 0; i < tags.length; i++) {
            b.tags.push(tags[i]);
        }

        emit BriefingPublished(squadId, contentHash, preview, endpoint, block.timestamp);
    }

    /**
     * @notice Propose a briefing for LEAD approval. Any squad member can propose.
     *
     * @param squadId       Squad this briefing belongs to.
     * @param contentHash   keccak256 of full briefing content.
     * @param preview       ≤140-char excerpt.
     * @param endpoint      Proposer's daemon endpoint.
     * @param tags          Categorisation strings.
     */
    function proposeBriefing(
        uint256           squadId,
        bytes32           contentHash,
        string  calldata  preview,
        string  calldata  endpoint,
        string[] calldata tags
    ) external {
        // Checks
        if (!agentRegistry.isRegistered(msg.sender))    revert NotRegistered();
        if (contentHash == bytes32(0))                  revert EmptyContentHash();
        if (bytes(endpoint).length == 0)                revert EmptyEndpoint();
        if (bytes(preview).length > MAX_PREVIEW_LENGTH) revert PreviewTooLong();
        if (_published[contentHash])                    revert HashAlreadyPublished();
        if (_proposalExists[contentHash])               revert ProposalAlreadyExists();
        if (!researchSquad.isMember(squadId, msg.sender)) revert NotSquadMember();

        // Effects
        _proposalExists[contentHash] = true;
        _squadProposals[squadId].push(contentHash);

        Proposal storage p = _proposals[contentHash];
        p.squadId     = squadId;
        p.contentHash = contentHash;
        p.preview     = preview;
        p.endpoint    = endpoint;
        p.proposer    = msg.sender;
        p.timestamp   = block.timestamp;
        p.status      = ProposalStatus.Pending;
        for (uint256 i = 0; i < tags.length; i++) {
            p.tags.push(tags[i]);
        }

        emit BriefingProposed(squadId, contentHash, msg.sender, block.timestamp);
    }

    /**
     * @notice Approve a pending contributor proposal. Caller must be a squad LEAD.
     *         Approval immediately publishes the briefing.
     *
     * @param contentHash   The proposal to approve.
     */
    function approveProposal(bytes32 contentHash) external {
        // Checks
        if (!agentRegistry.isRegistered(msg.sender)) revert NotRegistered();
        if (!_proposalExists[contentHash])           revert ProposalNotFound();

        Proposal storage p = _proposals[contentHash];
        if (p.status != ProposalStatus.Pending)      revert ProposalAlreadyApproved();
        if (_published[contentHash])                 revert HashAlreadyPublished();

        // Caller must be a LEAD of the squad the proposal belongs to
        if (!researchSquad.isMember(p.squadId, msg.sender))
            revert NotSquadLead();
        if (researchSquad.getMemberRole(p.squadId, msg.sender) != IResearchSquad.Role.Lead)
            revert NotSquadLead();

        // Effects — approve proposal
        p.status = ProposalStatus.Approved;

        // Effects — publish briefing
        _published[contentHash] = true;
        _squadBriefings[p.squadId].push(contentHash);

        Briefing storage b = _briefings[contentHash];
        b.squadId     = p.squadId;
        b.contentHash = contentHash;
        b.preview     = p.preview;
        b.endpoint    = p.endpoint;
        b.publisher   = p.proposer;   // original proposer is the publisher
        b.timestamp   = block.timestamp;
        for (uint256 i = 0; i < p.tags.length; i++) {
            b.tags.push(p.tags[i]);
        }

        emit ProposalApproved(p.squadId, contentHash, msg.sender, block.timestamp);
        emit BriefingPublished(p.squadId, contentHash, p.preview, p.endpoint, block.timestamp);
    }

    /**
     * @notice Reject a pending proposal. Caller must be a squad LEAD.
     *
     * @param contentHash   The proposal to reject.
     */
    function rejectProposal(bytes32 contentHash) external {
        if (!agentRegistry.isRegistered(msg.sender)) revert NotRegistered();
        if (!_proposalExists[contentHash])           revert ProposalNotFound();

        Proposal storage p = _proposals[contentHash];
        if (p.status != ProposalStatus.Pending)      revert ProposalAlreadyApproved();

        if (!researchSquad.isMember(p.squadId, msg.sender))
            revert NotSquadLead();
        if (researchSquad.getMemberRole(p.squadId, msg.sender) != IResearchSquad.Role.Lead)
            revert NotSquadLead();

        // Effects
        p.status = ProposalStatus.Rejected;

        emit ProposalRejected(p.squadId, contentHash, msg.sender, block.timestamp);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getBriefing(bytes32 contentHash)
        external
        view
        returns (Briefing memory)
    {
        if (!_published[contentHash]) revert BriefingNotFound();
        return _briefings[contentHash];
    }

    /**
     * @notice Returns the ordered list of contentHashes published for a squad.
     */
    function getSquadBriefings(uint256 squadId)
        external
        view
        returns (bytes32[] memory)
    {
        return _squadBriefings[squadId];
    }

    /**
     * @notice Returns full Briefing structs for all briefings of a squad.
     */
    function getSquadBriefingsFull(uint256 squadId)
        external
        view
        returns (Briefing[] memory result)
    {
        bytes32[] storage hashes = _squadBriefings[squadId];
        result = new Briefing[](hashes.length);
        for (uint256 i = 0; i < hashes.length; i++) {
            result[i] = _briefings[hashes[i]];
        }
    }

    function briefingExists(bytes32 contentHash) external view returns (bool) {
        return _published[contentHash];
    }

    function getProposal(bytes32 contentHash)
        external
        view
        returns (Proposal memory)
    {
        if (!_proposalExists[contentHash]) revert ProposalNotFound();
        return _proposals[contentHash];
    }

    function getSquadProposals(uint256 squadId)
        external
        view
        returns (bytes32[] memory)
    {
        return _squadProposals[squadId];
    }

    function proposalExists(bytes32 contentHash) external view returns (bool) {
        return _proposalExists[contentHash];
    }
}
