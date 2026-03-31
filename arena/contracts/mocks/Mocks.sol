// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title Mocks
 * @notice Inline mock contracts for E2E testing on Base Sepolia.
 *         All mocks are deployed by the E2E test script.
 */

// ─── MockAgentRegistry ────────────────────────────────────────────────────────

contract MockAgentRegistry {
    mapping(address => bool) private _registered;

    function register(address agent) external {
        _registered[agent] = true;
    }

    function isRegistered(address agent) external view returns (bool) {
        return _registered[agent];
    }
}

// ─── MockTrustRegistry ───────────────────────────────────────────────────────

contract MockTrustRegistry {
    mapping(address => uint256) private _scores;

    function setScore(address agent, uint256 score) external {
        _scores[agent] = score;
    }

    function getGlobalScore(address agent) external view returns (uint256) {
        return _scores[agent];
    }
}

// ─── MockPolicyEngine ────────────────────────────────────────────────────────

contract MockPolicyEngine {
    // No-op: always allows all spends
    function validateSpend(address, string calldata, uint256, address) external pure {}
    function recordSpend(address, string calldata, uint256, address) external {}
}

// ─── MockWatchtowerRegistry ──────────────────────────────────────────────────

contract MockWatchtowerRegistry {
    mapping(address => bool) private _watchtowers;

    function register(address wt) external {
        _watchtowers[wt] = true;
    }

    function isWatchtower(address wt) external view returns (bool) {
        return _watchtowers[wt];
    }
}

// ─── MockERC20 (USDC-like, 6 decimals) ───────────────────────────────────────

contract MockERC20 {
    string  public name;
    string  public symbol;
    uint8   public decimals = 6;

    mapping(address => uint256)                     public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol) {
        name   = _name;
        symbol = _symbol;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "ERC20: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to]         += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from]             >= amount, "ERC20: insufficient balance");
        require(allowance[from][msg.sender] >= amount, "ERC20: insufficient allowance");
        balanceOf[from]             -= amount;
        allowance[from][msg.sender] -= amount;
        balanceOf[to]               += amount;
        return true;
    }
}
