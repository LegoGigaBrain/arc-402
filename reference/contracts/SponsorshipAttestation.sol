// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SponsorshipAttestation
 * @notice Optional opt-in registry for agency-agent associations.
 *
 *         Philosophy: The protocol is neutral on affiliation. Agents are always public.
 *         Whether an agent is "employed by" an agency is not the protocol's concern.
 *         This contract provides a voluntary mechanism for agencies that WANT to
 *         publicly signal their agent fleet — for trust premium, brand building, or
 *         verifiable accountability.
 *
 *         Agencies that want discretion simply don't use this contract. Their agents
 *         participate in the marketplace as independent wallets. No penalty. No disclosure.
 *
 *         Agencies that register publicly gain:
 *         - Collective trust signal: "Agency A vouches for these agents"
 *         - Verifiable fleet statistics queryable on-chain
 *         - Trust premium in counterparty discovery (optional policy consideration)
 *
 *         The sponsorship is sponsor-issued, not agent-accepted. For stronger trust,
 *         a future version may require agent co-signature (bilateral attestation).
 *
 * STATUS: DRAFT — not audited, do not use in production
 */
contract SponsorshipAttestation {

    // ─── Types ────────────────────────────────────────────────────────────────

    struct Attestation {
        address sponsor;     // agency wallet that issued the attestation
        address agent;       // agent wallet being attested
        uint256 issuedAt;
        uint256 expiresAt;   // 0 = no expiry
        bool revoked;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    /// @notice attestationId → attestation data
    mapping(bytes32 => Attestation) public attestations;

    /// @notice sponsor → all attestation IDs they've issued
    mapping(address => bytes32[]) private _sponsorAttestations;

    /// @notice agent → all attestation IDs pointing to them
    mapping(address => bytes32[]) private _agentAttestations;

    /// @notice Global nonce for unique attestation IDs (prevents same-block collisions).
    uint256 private _nonce;

    /// @notice sponsor → agent → active attestation ID (0 = none)
    /// @dev Prevents a sponsor from issuing multiple attestations for the same agent.
    mapping(address => mapping(address => bytes32)) public activeAttestation;

    // ─── Events ──────────────────────────────────────────────────────────────

    event AttestationPublished(
        bytes32 indexed attestationId,
        address indexed sponsor,
        address indexed agent,
        uint256 expiresAt
    );
    event AttestationRevoked(bytes32 indexed attestationId, address indexed sponsor, address indexed agent);

    // ─── Core Functions ───────────────────────────────────────────────────────

    /**
     * @notice Sponsor publishes an on-chain attestation for an agent.
     *         Use this when public affiliation is desired (brand signal, trust premium).
     *         Leave unused for private agency structures — the protocol is neutral.
     *
     * @param agent The agent wallet being attested.
     * @param expiresAt Unix timestamp after which the attestation is considered lapsed (0 = permanent).
     * @return attestationId The unique ID of the published attestation.
     */
    function publish(
        address agent,
        uint256 expiresAt
    ) external returns (bytes32 attestationId) {
        require(agent != address(0), "SponsorshipAttestation: zero agent");
        require(agent != msg.sender, "SponsorshipAttestation: self-attestation");
        require(
            expiresAt == 0 || expiresAt > block.timestamp,
            "SponsorshipAttestation: already expired"
        );
        require(
            activeAttestation[msg.sender][agent] == bytes32(0),
            "SponsorshipAttestation: active attestation exists, revoke first"
        );

        attestationId = keccak256(abi.encodePacked(msg.sender, agent, block.timestamp, _nonce++));

        attestations[attestationId] = Attestation({
            sponsor: msg.sender,
            agent: agent,
            issuedAt: block.timestamp,
            expiresAt: expiresAt,
            revoked: false
        });

        _sponsorAttestations[msg.sender].push(attestationId);
        _agentAttestations[agent].push(attestationId);
        activeAttestation[msg.sender][agent] = attestationId;

        emit AttestationPublished(attestationId, msg.sender, agent, expiresAt);
    }

    /**
     * @notice Revoke an attestation. Only the issuing sponsor can revoke.
     * @param attestationId The attestation to revoke.
     */
    function revoke(bytes32 attestationId) external {
        Attestation storage att = attestations[attestationId];
        require(att.sponsor == msg.sender, "SponsorshipAttestation: not sponsor");
        require(!att.revoked, "SponsorshipAttestation: already revoked");

        att.revoked = true;
        activeAttestation[msg.sender][att.agent] = bytes32(0);

        emit AttestationRevoked(attestationId, msg.sender, att.agent);
    }

    // ─── Queries ─────────────────────────────────────────────────────────────

    /**
     * @notice Check if an attestation is currently active (not revoked, not expired).
     */
    function isActive(bytes32 attestationId) external view returns (bool) {
        Attestation storage att = attestations[attestationId];
        if (att.sponsor == address(0)) return false;
        if (att.revoked) return false;
        if (att.expiresAt != 0 && block.timestamp > att.expiresAt) return false;
        return true;
    }

    /**
     * @notice Get the active attestation ID from a sponsor for a specific agent.
     *         Returns bytes32(0) if none exists or the active one was revoked.
     */
    function getActiveAttestation(address sponsor, address agent)
        external view returns (bytes32)
    {
        bytes32 id = activeAttestation[sponsor][agent];
        if (id == bytes32(0)) return bytes32(0);
        Attestation storage att = attestations[id];
        if (att.revoked) return bytes32(0);
        if (att.expiresAt != 0 && block.timestamp > att.expiresAt) return bytes32(0);
        return id;
    }

    /**
     * @notice Returns all attestation IDs a sponsor has ever issued.
     */
    function getSponsorAttestations(address sponsor) external view returns (bytes32[] memory) {
        return _sponsorAttestations[sponsor];
    }

    /**
     * @notice Returns all attestation IDs pointing to a specific agent.
     */
    function getAgentAttestations(address agent) external view returns (bytes32[] memory) {
        return _agentAttestations[agent];
    }

    /**
     * @notice Returns the number of active (non-revoked, non-expired) attestations
     *         a sponsor has issued. Useful for displaying "Agency A backs N agents."
     * @dev O(n) over all attestations issued. Use for display only, not gas-critical paths.
     */
    function activeSponsorCount(address sponsor) external view returns (uint256 count) {
        bytes32[] storage ids = _sponsorAttestations[sponsor];
        for (uint256 i = 0; i < ids.length; i++) {
            Attestation storage att = attestations[ids[i]];
            if (!att.revoked && (att.expiresAt == 0 || block.timestamp <= att.expiresAt)) {
                count++;
            }
        }
    }
}
