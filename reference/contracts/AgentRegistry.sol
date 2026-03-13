// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IAgentRegistry.sol";
import "./ITrustRegistry.sol";

/**
 * @title AgentRegistry
 * @notice ARC-402 agent discovery and capability registry.
 *         Agents self-register their wallet, capabilities, service type, and endpoint.
 *         Trust scores are read from the shared TrustRegistry.
 * STATUS: DRAFT — not audited, do not use in production
 */
contract AgentRegistry is IAgentRegistry {

    // ─── State ───────────────────────────────────────────────────────────────

    ITrustRegistry public immutable trustRegistry;

    uint64 public constant DEFAULT_HEARTBEAT_INTERVAL = 1 hours;
    uint64 public constant DEFAULT_HEARTBEAT_GRACE_PERIOD = 15 minutes;
    uint32 public constant MAX_SCORE = 100;

    mapping(address => AgentInfo) private _agents;
    mapping(address => OperationalMetrics) private _operationalMetrics;
    mapping(address => bool) private _registered;

    address[] private _agentList;

    // ─── Events ──────────────────────────────────────────────────────────────

    event AgentRegistered(address indexed wallet, string name, string serviceType, uint256 timestamp);
    event AgentUpdated(address indexed wallet, string name, string serviceType);
    event AgentDeactivated(address indexed wallet);
    event AgentReactivated(address indexed wallet);
    /// @notice Emitted whenever an agent changes their endpoint.
    event EndpointChanged(address indexed wallet, string oldEndpoint, string newEndpoint, uint256 changeCount);
    event HeartbeatSubmitted(
        address indexed wallet,
        uint256 timestamp,
        uint256 latency,
        uint256 heartbeatCount,
        uint256 uptimeScore,
        uint256 responseScore
    );
    event HeartbeatPolicyUpdated(address indexed wallet, uint256 interval, uint256 gracePeriod);

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _trustRegistry) {
        require(_trustRegistry != address(0), "AgentRegistry: zero trust registry");
        trustRegistry = ITrustRegistry(_trustRegistry);
    }

    // ─── Registration ────────────────────────────────────────────────────────

    /**
     * @notice Register msg.sender as an agent.
     * @dev Reverts if already registered. Name and serviceType must be non-empty.
     */
    function register(
        string calldata name,
        string[] calldata capabilities,
        string calldata serviceType,
        string calldata endpoint,
        string calldata metadataURI
    ) external override {
        require(!_registered[msg.sender], "AgentRegistry: already registered");
        require(bytes(name).length > 0 && bytes(name).length <= 64, "AgentRegistry: invalid name length");
        require(bytes(serviceType).length > 0 && bytes(serviceType).length <= 64, "AgentRegistry: serviceType too long");
        require(bytes(endpoint).length <= 256, "AgentRegistry: endpoint too long");
        require(bytes(metadataURI).length <= 256, "AgentRegistry: metadataURI too long");
        require(capabilities.length <= 20, "AgentRegistry: too many capabilities");
        for (uint256 i = 0; i < capabilities.length; i++) {
            require(bytes(capabilities[i]).length <= 64, "AgentRegistry: capability too long");
        }

        _registered[msg.sender] = true;
        _agentList.push(msg.sender);

        AgentInfo storage info = _agents[msg.sender];
        info.wallet = msg.sender;
        info.name = name;
        info.serviceType = serviceType;
        info.endpoint = endpoint;
        info.metadataURI = metadataURI;
        info.active = true;
        info.registeredAt = block.timestamp;
        info.endpointChangedAt = 0;
        info.endpointChangeCount = 0;
        for (uint256 i = 0; i < capabilities.length; i++) {
            info.capabilities.push(capabilities[i]);
        }

        OperationalMetrics storage ops = _operationalMetrics[msg.sender];
        ops.heartbeatInterval = DEFAULT_HEARTBEAT_INTERVAL;
        ops.heartbeatGracePeriod = DEFAULT_HEARTBEAT_GRACE_PERIOD;
        ops.uptimeScore = MAX_SCORE;
        ops.responseScore = MAX_SCORE;

        emit AgentRegistered(msg.sender, name, serviceType, block.timestamp);
    }

    /**
     * @notice Update an existing registration.
     * @dev Reverts if not registered or not active.
     */
    function update(
        string calldata name,
        string[] calldata capabilities,
        string calldata serviceType,
        string calldata endpoint,
        string calldata metadataURI
    ) external override {
        require(_registered[msg.sender], "AgentRegistry: not registered");
        require(_agents[msg.sender].active, "AgentRegistry: agent not active");
        require(bytes(name).length > 0 && bytes(name).length <= 64, "AgentRegistry: invalid name length");
        require(bytes(serviceType).length > 0 && bytes(serviceType).length <= 64, "AgentRegistry: serviceType too long");
        require(bytes(endpoint).length <= 256, "AgentRegistry: endpoint too long");
        require(bytes(metadataURI).length <= 256, "AgentRegistry: metadataURI too long");
        require(capabilities.length <= 20, "AgentRegistry: too many capabilities");
        for (uint256 i = 0; i < capabilities.length; i++) {
            require(bytes(capabilities[i]).length <= 64, "AgentRegistry: capability too long");
        }

        AgentInfo storage info = _agents[msg.sender];
        info.name = name;
        info.serviceType = serviceType;
        info.metadataURI = metadataURI;

        if (keccak256(bytes(endpoint)) != keccak256(bytes(info.endpoint))) {
            string memory oldEndpoint = info.endpoint;
            info.endpoint = endpoint;
            info.endpointChangedAt = block.timestamp;
            info.endpointChangeCount += 1;
            emit EndpointChanged(msg.sender, oldEndpoint, endpoint, info.endpointChangeCount);
        }

        delete info.capabilities;
        for (uint256 i = 0; i < capabilities.length; i++) {
            info.capabilities.push(capabilities[i]);
        }

        emit AgentUpdated(msg.sender, name, serviceType);
    }

    /**
     * @notice Deactivate the caller's registration.
     * @dev Reverts if not registered.
     */
    function deactivate() external override {
        require(_registered[msg.sender], "AgentRegistry: not registered");
        require(_agents[msg.sender].active, "AgentRegistry: already inactive");
        _agents[msg.sender].active = false;
        emit AgentDeactivated(msg.sender);
    }

    /**
     * @notice Reactivate the caller's registration.
     * @dev Reverts if not registered or already active.
     */
    function reactivate() external {
        require(_registered[msg.sender], "AgentRegistry: not registered");
        require(!_agents[msg.sender].active, "AgentRegistry: already active");
        _agents[msg.sender].active = true;
        emit AgentReactivated(msg.sender);
    }

    /**
     * @notice Agent self-reports a heartbeat and rolling latency sample.
     * @dev This is intentionally lightweight: it stores only coarse rolling metrics,
     *      enough for future discovery weighting without introducing centralized monitors.
     */
    function submitHeartbeat(uint32 latencyMs) external {
        require(_registered[msg.sender], "AgentRegistry: not registered");
        require(_agents[msg.sender].active, "AgentRegistry: agent not active");

        OperationalMetrics storage ops = _operationalMetrics[msg.sender];
        _applyMissedHeartbeats(ops);

        if (ops.lastHeartbeatAt == 0) {
            ops.rollingLatency = latencyMs;
        } else {
            ops.rollingLatency = uint64((uint256(ops.rollingLatency) * 3 + latencyMs) / 4);
        }

        ops.lastHeartbeatAt = uint64(block.timestamp);
        ops.heartbeatCount += 1;
        ops.uptimeScore = _increaseScore(ops.uptimeScore, 2);
        ops.responseScore = _latencyToScore(ops.rollingLatency);

        emit HeartbeatSubmitted(
            msg.sender,
            block.timestamp,
            latencyMs,
            ops.heartbeatCount,
            ops.uptimeScore,
            ops.responseScore
        );
    }

    function setHeartbeatPolicy(uint64 interval, uint64 gracePeriod) external {
        require(_registered[msg.sender], "AgentRegistry: not registered");
        require(_agents[msg.sender].active, "AgentRegistry: agent not active");
        require(interval >= 5 minutes && interval <= 7 days, "AgentRegistry: invalid interval");
        require(gracePeriod <= interval, "AgentRegistry: grace exceeds interval");

        OperationalMetrics storage ops = _operationalMetrics[msg.sender];
        ops.heartbeatInterval = interval;
        ops.heartbeatGracePeriod = gracePeriod;

        emit HeartbeatPolicyUpdated(msg.sender, interval, gracePeriod);
    }

    // ─── Queries ─────────────────────────────────────────────────────────────

    /**
     * @notice Returns full AgentInfo for a wallet. Reverts if not registered.
     */
    function getAgent(address wallet) external view override returns (AgentInfo memory) {
        require(_registered[wallet], "AgentRegistry: not registered");
        return _agents[wallet];
    }

    function getOperationalMetrics(address wallet) external view override returns (OperationalMetrics memory) {
        require(_registered[wallet], "AgentRegistry: not registered");

        OperationalMetrics memory ops = _operationalMetrics[wallet];
        if (ops.lastHeartbeatAt == 0) return ops;

        uint256 missed = _missedHeartbeats(ops, block.timestamp);
        if (missed > 0) {
            ops.missedHeartbeatCount += uint32(missed);
            uint256 penalty = missed * 10;
            ops.uptimeScore = uint32(penalty >= ops.uptimeScore ? 0 : ops.uptimeScore - penalty);
        }
        ops.responseScore = _latencyToScore(ops.rollingLatency);
        return ops;
    }

    /**
     * @notice Returns true if the wallet has ever registered.
     */
    function isRegistered(address wallet) external view override returns (bool) {
        return _registered[wallet];
    }

    /**
     * @notice Returns true if the wallet is registered and currently active.
     */
    function isActive(address wallet) external view override returns (bool) {
        return _registered[wallet] && _agents[wallet].active;
    }

    /**
     * @notice Returns the capability list for a registered agent.
     */
    function getCapabilities(address wallet) external view returns (string[] memory) {
        require(_registered[wallet], "AgentRegistry: not registered");
        return _agents[wallet].capabilities;
    }

    /**
     * @notice Reads the trust score from the shared TrustRegistry.
     *         Returns 0 if the wallet is not initialized in the trust registry.
     */
    function getTrustScore(address wallet) external view returns (uint256) {
        try trustRegistry.getScore(wallet) returns (uint256 score) {
            return score;
        } catch {
            return 0;
        }
    }

    /**
     * @notice Returns the endpoint stability score for an agent (0–100).
     */
    function getEndpointStability(address wallet) external view returns (uint256 score) {
        require(_registered[wallet], "AgentRegistry: not registered");
        AgentInfo storage info = _agents[wallet];
        if (info.endpointChangeCount == 0) return 100;

        uint256 daysSinceChange = (block.timestamp - info.endpointChangedAt) / 1 days;
        if (daysSinceChange >= 90) {
            score = 70;
        } else if (daysSinceChange >= 30) {
            score = 50;
        } else if (daysSinceChange >= 7) {
            score = 30;
        } else {
            score = 10;
        }

        uint256 extra = info.endpointChangeCount > 1 ? info.endpointChangeCount - 1 : 0;
        for (uint256 i = 0; i < extra && score > 5; i++) {
            score = score / 2;
        }
        if (score < 5) score = 5;
    }

    /// @notice Protocol version tag (Spec 20).
    function protocolVersion() external pure returns (string memory) {
        return "1.0.0";
    }

    /**
     * @notice Total number of agents ever registered (including inactive).
     */
    function agentCount() external view returns (uint256) {
        return _agentList.length;
    }

    /**
     * @notice Returns the wallet address at a given index for enumeration.
     * @dev Use agentCount() to bound iteration.
     */
    function getAgentAtIndex(uint256 index) external view returns (address) {
        require(index < _agentList.length, "AgentRegistry: index out of bounds");
        return _agentList[index];
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _applyMissedHeartbeats(OperationalMetrics storage ops) internal {
        if (ops.lastHeartbeatAt == 0) return;

        uint256 missed = _missedHeartbeats(ops, block.timestamp);
        if (missed == 0) return;

        ops.missedHeartbeatCount += uint32(missed);
        uint256 penalty = missed * 10;
        ops.uptimeScore = uint32(penalty >= ops.uptimeScore ? 0 : ops.uptimeScore - penalty);
    }

    function _missedHeartbeats(OperationalMetrics memory ops, uint256 timestamp) internal pure returns (uint256) {
        uint256 allowedGap = uint256(ops.heartbeatInterval) + uint256(ops.heartbeatGracePeriod);
        if (ops.lastHeartbeatAt == 0 || allowedGap == 0 || timestamp <= ops.lastHeartbeatAt + allowedGap) {
            return 0;
        }

        return (timestamp - ops.lastHeartbeatAt - allowedGap) / ops.heartbeatInterval + 1;
    }

    function _latencyToScore(uint256 latencyMs) internal pure returns (uint32) {
        if (latencyMs == 0 || latencyMs <= 250) return 100;
        if (latencyMs <= 500) return 90;
        if (latencyMs <= 1000) return 75;
        if (latencyMs <= 2000) return 60;
        if (latencyMs <= 5000) return 40;
        return 20;
    }

    function _increaseScore(uint32 current, uint32 amount) internal pure returns (uint32) {
        uint256 next = uint256(current) + amount;
        return uint32(next > MAX_SCORE ? MAX_SCORE : next);
    }
}
