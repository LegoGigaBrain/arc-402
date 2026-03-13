// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "./IArc402Guardian.sol";

/**
 * @title ARC402Guardian
 * @notice Circuit breaker / emergency pause contract for post-deploy vulnerability response.
 *         Owner or any security council member can pause immediately. Unpause requires
 *         a 24-hour timelock and owner-only authorization.
 *
 * STATUS: DRAFT — not audited, do not use in production
 */
contract ARC402Guardian is IArc402Guardian, Ownable2Step {

    bool public paused;
    uint256 public unpauseAvailableAt;
    uint256 public constant UNPAUSE_DELAY = 24 hours;

    address[] public guardedContracts;

    mapping(address => bool) public securityCouncil;

    event ProtocolPaused(address indexed by, string reason);
    event ProtocolUnpaused(address indexed by);
    event UnpauseScheduled(uint256 availableAt);
    event CouncilMemberAdded(address indexed member);
    event CouncilMemberRemoved(address indexed member);

    modifier onlyCouncilOrOwner() {
        require(msg.sender == owner() || securityCouncil[msg.sender], "Guardian: not authorized");
        _;
    }

    constructor() Ownable(msg.sender) {}

    /// @notice Immediately pause the protocol. Any council member or owner can call this.
    /// @param reason Human-readable reason for the pause (logged on-chain for transparency).
    function pause(string calldata reason) external onlyCouncilOrOwner {
        paused = true;
        unpauseAvailableAt = block.timestamp + UNPAUSE_DELAY;
        emit ProtocolPaused(msg.sender, reason);
        emit UnpauseScheduled(unpauseAvailableAt);
    }

    /// @notice Unpause the protocol. Only owner may unpause, and only after the 24h timelock.
    function unpause() external onlyOwner {
        require(block.timestamp >= unpauseAvailableAt, "Guardian: timelock not expired");
        paused = false;
        emit ProtocolUnpaused(msg.sender);
    }

    /// @notice Add an address to the security council.
    function addToCouncil(address member) external onlyOwner {
        require(member != address(0), "Guardian: zero address");
        securityCouncil[member] = true;
        emit CouncilMemberAdded(member);
    }

    /// @notice Remove an address from the security council.
    function removeFromCouncil(address member) external onlyOwner {
        securityCouncil[member] = false;
        emit CouncilMemberRemoved(member);
    }

    /// @notice Register a contract as guarded (informational — not enforced on-chain).
    function registerGuardedContract(address contractAddress) external onlyOwner {
        require(contractAddress != address(0), "Guardian: zero address");
        guardedContracts.push(contractAddress);
    }

    /// @notice Returns true if the protocol is currently paused.
    function isPaused() external view returns (bool) {
        return paused;
    }

    /// @notice Returns the number of registered guarded contracts.
    function guardedContractCount() external view returns (uint256) {
        return guardedContracts.length;
    }
}
