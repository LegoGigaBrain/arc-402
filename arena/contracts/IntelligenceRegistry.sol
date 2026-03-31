// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// ─── Inline interfaces ────────────────────────────────────────────────────────

interface IAgentRegistry {
    function isRegistered(address) external view returns (bool);
}

interface ITrustRegistryV3 {
    function getGlobalScore(address) external view returns (uint256);
}

/**
 * @title IntelligenceRegistry
 * @notice Registry for intelligence artifacts produced by arena squads:
 *         briefings, LoRA adapters, datasets, QA-pair sets, and any future
 *         artifact types. Tracks citations (raw + trust-weighted) and emits
 *         threshold events that downstream systems can index.
 *
 *         Citation rules:
 *         - msg.sender is always the citer — NO delegated citation.
 *         - One citation per citer per artifact (dedup enforced).
 *         - Raw citationCount increments for all registered citers.
 *         - weightedCitationCount only increments when citer trust score
 *           is >= MIN_CITER_TRUST (300).
 *
 *         Security:
 *         - CEI pattern throughout.
 *         - No value transfer → no reentrancy risk.
 *         - Custom errors only.
 *         - No upgradeable proxy.
 *
 * @dev    Solidity 0.8.24 · immutable · no via_ir · no upgradeable proxy
 */
contract IntelligenceRegistry {

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant MAX_PREVIEW_LENGTH  = 140;
    uint256 public constant MIN_CITER_TRUST     = 300;
    uint256 public constant CITATION_THRESHOLD_1 = 5;
    uint256 public constant CITATION_THRESHOLD_2 = 20;

    // ─── Types ────────────────────────────────────────────────────────────────

    /// @dev Input struct for register() — avoids stack-too-deep with 12 params.
    struct RegisterParams {
        bytes32 contentHash;
        uint256 squadId;
        string  capabilityTag;
        string  artifactType;
        string  endpoint;
        string  preview;
        bytes32 trainingDataHash;
        string  baseModel;
        bytes32 evalHash;
        bytes32 parentHash;
        bytes32 revenueShareHash;
        address revenueSplitAddress;
    }

    struct IntelligenceArtifact {
        bytes32 contentHash;
        address creator;
        uint256 squadId;
        string  capabilityTag;
        string  artifactType;            // "briefing" | "lora" | "dataset" | "qa-pairs"
        string  endpoint;                // daemon endpoint for P2P delivery
        string  preview;                 // ≤140-char description
        uint256 timestamp;
        uint256 citationCount;           // raw count
        uint256 weightedCitationCount;   // trust-weighted (score >= MIN_CITER_TRUST)
        bytes32 trainingDataHash;        // bytes32(0) if not applicable; training jobs use ComputeAgreement, not ServiceAgreement
        string  baseModel;               // empty if not applicable
        bytes32 evalHash;                // bytes32(0) if not published
        bytes32 parentHash;              // bytes32(0) if original
        bytes32 revenueShareHash;        // keccak256 of signed off-chain rev-share agreement
        address revenueSplitAddress;     // SquadRevenueSplit contract (address(0) = solo)
    }

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotRegistered();
    error ArtifactNotFound();
    error AlreadyCited();
    error EmptyContentHash();
    error PreviewTooLong();
    error EmptyEndpoint();
    error HashAlreadyRegistered();
    error ZeroAddress();

    // ─── Events ───────────────────────────────────────────────────────────────

    event ArtifactRegistered(
        bytes32 indexed contentHash,
        address indexed creator,
        string  capabilityTag,
        string  artifactType
    );

    event ArtifactCited(
        bytes32 indexed contentHash,
        address indexed citer,
        uint256 newRawCount,
        uint256 newWeightedCount
    );

    /// @dev Emitted at weightedCitationCount == CITATION_THRESHOLD_1 and CITATION_THRESHOLD_2.
    event CitationThresholdReached(
        bytes32 indexed contentHash,
        uint256 threshold
    );

    // ─── State ────────────────────────────────────────────────────────────────

    IAgentRegistry   public immutable agentRegistry;
    ITrustRegistryV3 public immutable trustRegistry;

    /// contentHash → artifact
    mapping(bytes32 => IntelligenceArtifact) private _artifacts;

    /// contentHash → exists
    mapping(bytes32 => bool) private _exists;

    /// capabilityTag → ordered list of contentHashes
    mapping(string => bytes32[]) private _byCapability;

    /// contentHash → citer → hasCited
    mapping(bytes32 => mapping(address => bool)) private _cited;

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _agentRegistry, address _trustRegistry) {
        if (_agentRegistry == address(0)) revert ZeroAddress();
        if (_trustRegistry == address(0)) revert ZeroAddress();
        agentRegistry = IAgentRegistry(_agentRegistry);
        trustRegistry = ITrustRegistryV3(_trustRegistry);
    }

    // ─── Writes ───────────────────────────────────────────────────────────────

    /**
     * @notice Register a new intelligence artifact. Caller must be a registered agent.
     *
     * @param p  RegisterParams struct — avoids stack-too-deep with 12 fields.
     */
    function register(RegisterParams calldata p) external {
        // Checks
        if (!agentRegistry.isRegistered(msg.sender))      revert NotRegistered();
        if (p.contentHash == bytes32(0))                  revert EmptyContentHash();
        if (bytes(p.endpoint).length == 0)                revert EmptyEndpoint();
        if (bytes(p.preview).length > MAX_PREVIEW_LENGTH) revert PreviewTooLong();
        if (_exists[p.contentHash])                       revert HashAlreadyRegistered();

        // Effects
        _exists[p.contentHash] = true;
        _byCapability[p.capabilityTag].push(p.contentHash);

        IntelligenceArtifact storage a = _artifacts[p.contentHash];
        a.contentHash         = p.contentHash;
        a.creator             = msg.sender;
        a.squadId             = p.squadId;
        a.capabilityTag       = p.capabilityTag;
        a.artifactType        = p.artifactType;
        a.endpoint            = p.endpoint;
        a.preview             = p.preview;
        a.timestamp           = block.timestamp;
        a.trainingDataHash    = p.trainingDataHash;
        a.baseModel           = p.baseModel;
        a.evalHash            = p.evalHash;
        a.parentHash          = p.parentHash;
        a.revenueShareHash    = p.revenueShareHash;
        a.revenueSplitAddress = p.revenueSplitAddress;
        // citationCount and weightedCitationCount default to 0

        emit ArtifactRegistered(p.contentHash, msg.sender, p.capabilityTag, p.artifactType);
    }

    /**
     * @notice Record a citation of an artifact. msg.sender is the citer.
     *         No delegated citation is permitted.
     *
     *         Raw citationCount always increments.
     *         weightedCitationCount increments only when citer trust score >= MIN_CITER_TRUST.
     *         One citation per citer per artifact (dedup enforced).
     *
     * @param contentHash The artifact being cited.
     */
    function recordCitation(bytes32 contentHash) external {
        // Checks
        if (!agentRegistry.isRegistered(msg.sender)) revert NotRegistered();
        if (!_exists[contentHash])                   revert ArtifactNotFound();
        if (_cited[contentHash][msg.sender])         revert AlreadyCited();

        // Effects — dedup write BEFORE external call (strict CEI)
        _cited[contentHash][msg.sender] = true;

        uint256 citerScore = trustRegistry.getGlobalScore(msg.sender);

        IntelligenceArtifact storage a = _artifacts[contentHash];
        uint256 newRaw      = ++a.citationCount;
        uint256 newWeighted = a.weightedCitationCount;

        if (citerScore >= MIN_CITER_TRUST) {
            newWeighted = ++a.weightedCitationCount;
        }

        emit ArtifactCited(contentHash, msg.sender, newRaw, newWeighted);

        if (newWeighted == CITATION_THRESHOLD_1 || newWeighted == CITATION_THRESHOLD_2) {
            emit CitationThresholdReached(contentHash, newWeighted);
        }
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    /**
     * @notice Returns the full artifact struct for a given contentHash.
     */
    function getArtifact(bytes32 contentHash)
        external
        view
        returns (IntelligenceArtifact memory)
    {
        if (!_exists[contentHash]) revert ArtifactNotFound();
        return _artifacts[contentHash];
    }

    /**
     * @notice Returns all contentHashes registered under a capability tag.
     */
    function getByCapability(string calldata tag)
        external
        view
        returns (bytes32[] memory)
    {
        return _byCapability[tag];
    }

    /**
     * @notice Returns true if `agent` has already cited `contentHash`.
     */
    function hasCited(bytes32 contentHash, address agent)
        external
        view
        returns (bool)
    {
        return _cited[contentHash][agent];
    }
}
