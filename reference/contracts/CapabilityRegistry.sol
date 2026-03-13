// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

interface IAgentDirectory {
    function isActive(address wallet) external view returns (bool);
}

/**
 * @title CapabilityRegistry
 * @notice Canonical capability taxonomy + agent capability claim registry for ARC-402.
 *         Governance controls top-level roots; active agents self-claim approved
 *         canonical capability strings beneath those roots.
 *
 * Canonical format:
 *   <root>.<specialization>[.<specialization>...].v<version>
 * Examples:
 *   legal.patent-analysis.us.v1
 *   compute.gpu.a100.inference.v2
 *
 * Anti-spam design:
 *   - only active agents may claim capabilities
 *   - top-level roots are governance-gated
 *   - canonical syntax is strictly validated
 *   - max 20 claimed capabilities per agent
 *   - duplicate claims are rejected
 */
contract CapabilityRegistry is Ownable2Step {
    using EnumerableSet for EnumerableSet.AddressSet;
    struct RootConfig {
        string name;
        bool active;
        uint64 createdAt;
        uint64 disabledAt;
    }

    uint256 public constant MAX_CAPABILITIES_PER_AGENT = 20;
    uint256 public constant MAX_CAPABILITY_LENGTH = 96;
    uint256 public constant MIN_SEGMENTS = 3; // root + specialization + version

    IAgentDirectory public immutable agentRegistry;

    mapping(bytes32 => RootConfig) private _roots;
    bytes32[] private _rootIds;

    mapping(address => bytes32[]) private _agentCapabilityIds;
    mapping(address => mapping(bytes32 => bool)) public hasCapability;
    mapping(bytes32 => string) private _canonicalCapability;

    // Reverse index: capabilityId → set of agent addresses that claimed it
    mapping(bytes32 => EnumerableSet.AddressSet) private _capabilityAgents;

    event RootRegistered(bytes32 indexed rootId, string root);
    event RootStatusUpdated(bytes32 indexed rootId, string root, bool active);
    event CapabilityClaimed(address indexed agent, bytes32 indexed capabilityId, string capability);
    event CapabilityRevoked(address indexed agent, bytes32 indexed capabilityId, string capability);

    constructor(address _agentRegistry, address owner_) Ownable(owner_) {
        require(_agentRegistry != address(0), "CapabilityRegistry: zero agent registry");
        require(owner_ != address(0), "CapabilityRegistry: zero owner");
        agentRegistry = IAgentDirectory(_agentRegistry);
    }

    function registerRoot(string calldata root) external onlyOwner returns (bytes32 rootId) {
        require(_isValidRoot(root), "CapabilityRegistry: invalid root");
        rootId = keccak256(bytes(root));
        RootConfig storage config = _roots[rootId];
        require(bytes(config.name).length == 0, "CapabilityRegistry: root exists");

        config.name = root;
        config.active = true;
        config.createdAt = uint64(block.timestamp);
        _rootIds.push(rootId);

        emit RootRegistered(rootId, root);
    }

    function setRootStatus(string calldata root, bool active) external onlyOwner {
        bytes32 rootId = keccak256(bytes(root));
        RootConfig storage config = _roots[rootId];
        require(bytes(config.name).length != 0, "CapabilityRegistry: unknown root");
        require(config.active != active, "CapabilityRegistry: status unchanged");

        config.active = active;
        config.disabledAt = active ? 0 : uint64(block.timestamp);
        emit RootStatusUpdated(rootId, root, active);
    }

    function claim(string calldata capability) external {
        require(agentRegistry.isActive(msg.sender), "CapabilityRegistry: inactive agent");
        require(_isValidCapability(capability), "CapabilityRegistry: invalid capability");

        bytes32 capabilityId = keccak256(bytes(capability));
        require(!hasCapability[msg.sender][capabilityId], "CapabilityRegistry: already claimed");
        require(_agentCapabilityIds[msg.sender].length < MAX_CAPABILITIES_PER_AGENT, "CapabilityRegistry: too many capabilities");

        string memory root = _extractRoot(capability);
        RootConfig storage config = _roots[keccak256(bytes(root))];
        require(config.active, "CapabilityRegistry: root not active");

        hasCapability[msg.sender][capabilityId] = true;
        _agentCapabilityIds[msg.sender].push(capabilityId);
        if (bytes(_canonicalCapability[capabilityId]).length == 0) {
            _canonicalCapability[capabilityId] = capability;
        }
        require(_capabilityAgents[capabilityId].add(msg.sender), "CapabilityRegistry: add failed");

        emit CapabilityClaimed(msg.sender, capabilityId, capability);
    }

    function revoke(string calldata capability) external {
        bytes32 capabilityId = keccak256(bytes(capability));
        require(hasCapability[msg.sender][capabilityId], "CapabilityRegistry: not claimed");

        hasCapability[msg.sender][capabilityId] = false;
        require(_capabilityAgents[capabilityId].remove(msg.sender), "CapabilityRegistry: remove failed");
        bytes32[] storage ids = _agentCapabilityIds[msg.sender];
        uint256 length = ids.length;
        for (uint256 i = 0; i < length; i++) {
            if (ids[i] == capabilityId) {
                ids[i] = ids[length - 1];
                ids.pop();
                emit CapabilityRevoked(msg.sender, capabilityId, capability);
                return;
            }
        }

        revert("CapabilityRegistry: capability missing");
    }

    function isRootActive(string calldata root) external view returns (bool) {
        return _roots[keccak256(bytes(root))].active;
    }

    function getRoot(string calldata root) external view returns (RootConfig memory) {
        return _roots[keccak256(bytes(root))];
    }

    function rootCount() external view returns (uint256) {
        return _rootIds.length;
    }

    function getRootAt(uint256 index) external view returns (RootConfig memory) {
        require(index < _rootIds.length, "CapabilityRegistry: index out of bounds");
        return _roots[_rootIds[index]];
    }

    function getCapabilities(address agent) external view returns (string[] memory capabilities) {
        bytes32[] storage ids = _agentCapabilityIds[agent];
        capabilities = new string[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            capabilities[i] = _canonicalCapability[ids[i]];
        }
    }

    function capabilityCount(address agent) external view returns (uint256) {
        return _agentCapabilityIds[agent].length;
    }

    function isCapabilityClaimed(address agent, string calldata capability) external view returns (bool) {
        return hasCapability[agent][keccak256(bytes(capability))];
    }

    /// @notice Returns all agent addresses that have claimed the given capability.
    function getAgentsWithCapability(string calldata capability) external view returns (address[] memory) {
        bytes32 capabilityId = keccak256(bytes(capability));
        return _capabilityAgents[capabilityId].values();
    }

    /// @notice Protocol version tag (Spec 20).
    function protocolVersion() external pure returns (string memory) {
        return "1.0.0";
    }

    function _isValidRoot(string calldata root) internal pure returns (bool) {
        bytes calldata data = bytes(root);
        if (data.length == 0 || data.length > 32) return false;
        for (uint256 i = 0; i < data.length; i++) {
            bytes1 char = data[i];
            bool valid = (char >= 0x61 && char <= 0x7A) || (char >= 0x30 && char <= 0x39) || char == 0x2D;
            if (!valid) return false;
        }
        return true;
    }

    function _isValidCapability(string calldata capability) internal pure returns (bool) {
        bytes calldata data = bytes(capability);
        if (data.length < 6 || data.length > MAX_CAPABILITY_LENGTH) return false;

        uint256 segmentLength = 0;
        uint256 segments = 1;
        uint256 lastDot = type(uint256).max;

        for (uint256 i = 0; i < data.length; i++) {
            bytes1 char = data[i];
            bool validChar =
                (char >= 0x61 && char <= 0x7A) ||
                (char >= 0x30 && char <= 0x39) ||
                char == 0x2D ||
                char == 0x2E;
            if (!validChar) return false;

            if (char == 0x2E) {
                if (segmentLength == 0) return false;
                segments++;
                segmentLength = 0;
                lastDot = i;
            } else {
                segmentLength++;
            }
        }

        if (segmentLength == 0 || segments < MIN_SEGMENTS || lastDot == type(uint256).max) return false;
        return _isValidVersionSegment(data, lastDot + 1);
    }

    function _isValidVersionSegment(bytes calldata data, uint256 start) internal pure returns (bool) {
        if (start >= data.length || data[start] != 0x76) return false; // 'v'
        if (start + 1 >= data.length) return false;
        for (uint256 i = start + 1; i < data.length; i++) {
            bytes1 char = data[i];
            if (char < 0x30 || char > 0x39) return false;
        }
        return true;
    }

    function _extractRoot(string calldata capability) internal pure returns (string memory) {
        bytes calldata data = bytes(capability);
        for (uint256 i = 0; i < data.length; i++) {
            if (data[i] == 0x2E) {
                bytes memory root = new bytes(i);
                for (uint256 j = 0; j < i; j++) {
                    root[j] = data[j];
                }
                return string(root);
            }
        }
        revert("CapabilityRegistry: missing root");
    }
}
