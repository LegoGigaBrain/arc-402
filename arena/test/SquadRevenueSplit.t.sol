// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/SquadRevenueSplit.sol";

// ─── Mock USDC ────────────────────────────────────────────────────────────────

contract MockUSDC {
    mapping(address => uint256) private _bal;
    mapping(address => mapping(address => uint256)) private _allowance;

    function mint(address to, uint256 amount) external {
        _bal[to] += amount;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _bal[account];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _allowance[msg.sender][spender] = amount;
        return true;
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowance[owner][spender];
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(_bal[msg.sender] >= amount, "insufficient");
        _bal[msg.sender] -= amount;
        _bal[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(_bal[from] >= amount, "insufficient");
        require(_allowance[from][msg.sender] >= amount, "allowance");
        _bal[from] -= amount;
        _allowance[from][msg.sender] -= amount;
        _bal[to] += amount;
        return true;
    }
}

// ─── Mock AgentRegistry ───────────────────────────────────────────────────────

contract MockAgentRegistrySRS {
    mapping(address => bool) private _reg;

    function setRegistered(address a, bool v) external { _reg[a] = v; }
    function isRegistered(address a) external view returns (bool) { return _reg[a]; }
}

// ─── Reentrant attacker — tries to re-enter receive() ─────────────────────────
// Target is mutable so we can set it after deploying the split (avoids forward-ref problem).

contract ReentrantAttacker {
    address payable public target;
    bool public reentryBlocked;

    constructor() {}

    function setTarget(address payable _target) external { target = _target; }

    receive() external payable {
        if (target == address(0)) return;
        // Try to re-enter the split that is currently paying us
        (bool ok,) = target.call{value: 1 wei}("");
        // If the guard works, ok == false (revert)
        if (!ok) reentryBlocked = true;
    }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

contract SquadRevenueSplitTest is Test {
    MockUSDC             public usdc;
    MockAgentRegistrySRS public agentReg;
    SquadRevenueSplit    public split;

    address public alice   = address(0xA1);
    address public bob     = address(0xB2);
    address public charlie = address(0xC3);
    address public caller  = address(0xD4);

    // 60 / 30 / 10
    address[] _recipients3;
    uint256[] _shares3;

    // 50 / 50
    address[] _recipients2;
    uint256[] _shares2;

    function setUp() public {
        usdc     = new MockUSDC();
        agentReg = new MockAgentRegistrySRS();

        _recipients3 = new address[](3);
        _recipients3[0] = alice;
        _recipients3[1] = bob;
        _recipients3[2] = charlie;

        _shares3 = new uint256[](3);
        _shares3[0] = 6_000;
        _shares3[1] = 3_000;
        _shares3[2] = 1_000;

        _recipients2 = new address[](2);
        _recipients2[0] = alice;
        _recipients2[1] = bob;

        _shares2 = new uint256[](2);
        _shares2[0] = 5_000;
        _shares2[1] = 5_000;

        split = new SquadRevenueSplit(_recipients3, _shares3, address(usdc), address(agentReg));

        // Fund caller for USDC tests
        usdc.mint(caller, 1_000_000e6);
        vm.deal(caller, 100 ether);
    }

    // ─── 1. Constructor validation ────────────────────────────────────────────

    function test_deploy_happyPath() public view {
        assertEq(split.recipientCount(), 3);
        assertEq(split.USDC(), address(usdc));
        assertEq(split.getShare(alice),   6_000);
        assertEq(split.getShare(bob),     3_000);
        assertEq(split.getShare(charlie), 1_000);
    }

    function test_deploy_recipientsAndShares() public view {
        address[] memory r = split.recipients();
        uint256[] memory s = split.shares();
        assertEq(r.length, 3);
        assertEq(s.length, 3);
        assertEq(r[0], alice);
        assertEq(s[0], 6_000);
    }

    function test_deploy_revert_zeroUSDC() public {
        vm.expectRevert(SquadRevenueSplit.ZeroAddress.selector);
        new SquadRevenueSplit(_recipients3, _shares3, address(0), address(agentReg));
    }

    function test_deploy_revert_zeroRegistry() public {
        vm.expectRevert(SquadRevenueSplit.ZeroAddress.selector);
        new SquadRevenueSplit(_recipients3, _shares3, address(usdc), address(0));
    }

    function test_deploy_revert_emptyRecipients() public {
        address[] memory r = new address[](0);
        uint256[] memory s = new uint256[](0);
        vm.expectRevert(SquadRevenueSplit.EmptyRecipients.selector);
        new SquadRevenueSplit(r, s, address(usdc), address(agentReg));
    }

    function test_deploy_revert_sharesMismatch() public {
        uint256[] memory s = new uint256[](2);
        s[0] = 5_000; s[1] = 5_000;
        vm.expectRevert(SquadRevenueSplit.SharesMismatch.selector);
        new SquadRevenueSplit(_recipients3, s, address(usdc), address(agentReg));
    }

    function test_deploy_revert_sharesNotSumTo10000() public {
        uint256[] memory s = new uint256[](3);
        s[0] = 5_000; s[1] = 3_000; s[2] = 1_000; // sums to 9000
        vm.expectRevert(SquadRevenueSplit.SharesNotSumTo10000.selector);
        new SquadRevenueSplit(_recipients3, s, address(usdc), address(agentReg));
    }

    function test_deploy_revert_zeroShare() public {
        uint256[] memory s = new uint256[](3);
        s[0] = 9_000; s[1] = 0; s[2] = 1_000;
        vm.expectRevert(SquadRevenueSplit.ZeroShare.selector);
        new SquadRevenueSplit(_recipients3, s, address(usdc), address(agentReg));
    }

    function test_deploy_revert_zeroRecipientAddress() public {
        address[] memory r = new address[](2);
        r[0] = alice; r[1] = address(0);
        uint256[] memory s = new uint256[](2);
        s[0] = 5_000; s[1] = 5_000;
        vm.expectRevert(SquadRevenueSplit.ZeroAddress.selector);
        new SquadRevenueSplit(r, s, address(usdc), address(agentReg));
    }

    function test_getShare_unknownAddress_returnsZero() public view {
        assertEq(split.getShare(address(0xDEAD)), 0);
    }

    // ─── 2. ETH distribution via receive() ───────────────────────────────────

    function test_receive_ETH_distributesCorrectly() public {
        uint256 amount = 1 ether;
        uint256 preAlice   = alice.balance;
        uint256 preBob     = bob.balance;
        uint256 preCharlie = charlie.balance;

        vm.deal(address(this), amount);
        (bool ok,) = address(split).call{value: amount}("");
        assertTrue(ok);

        assertEq(alice.balance   - preAlice,   0.6 ether);
        assertEq(bob.balance     - preBob,     0.3 ether);
        assertEq(charlie.balance - preCharlie, 0.1 ether);
    }

    function test_receive_ETH_emitsRevenueReceived() public {
        vm.deal(address(this), 1 ether);
        vm.expectEmit(false, false, false, true);
        emit SquadRevenueSplit.RevenueReceived(1 ether, address(0));
        (bool ok,) = address(split).call{value: 1 ether}("");
        assertTrue(ok);
    }

    function test_receive_ETH_emitsETHDistributed_perRecipient() public {
        uint256 amount = 1 ether;
        vm.deal(address(this), amount);

        vm.expectEmit(true, false, false, true);
        emit SquadRevenueSplit.ETHDistributed(alice, 0.6 ether);
        vm.expectEmit(true, false, false, true);
        emit SquadRevenueSplit.ETHDistributed(bob, 0.3 ether);
        vm.expectEmit(true, false, false, true);
        emit SquadRevenueSplit.ETHDistributed(charlie, 0.1 ether);

        (bool ok,) = address(split).call{value: amount}("");
        assertTrue(ok);
    }

    function test_receive_ETH_zeroValue_reverts() public {
        vm.expectRevert(SquadRevenueSplit.ZeroAmount.selector);
        (bool _ok,) = address(split).call{value: 0}("");
        (_ok); // silence unused-return warning; expectRevert validates the revert
    }

    function test_receive_ETH_50_50_split() public {
        SquadRevenueSplit split2 = new SquadRevenueSplit(
            _recipients2, _shares2, address(usdc), address(agentReg)
        );
        vm.deal(address(this), 2 ether);
        (bool ok,) = address(split2).call{value: 2 ether}("");
        assertTrue(ok);
        assertEq(alice.balance, 1 ether);
        assertEq(bob.balance,   1 ether);
    }

    function test_receive_ETH_dustGoesToLastRecipient() public {
        // 1 wei split 60/30/10 → 0, 0, 1 (all dust to last)
        SquadRevenueSplit split2 = new SquadRevenueSplit(
            _recipients2, _shares2, address(usdc), address(agentReg)
        );
        vm.deal(address(this), 1 wei);
        (bool ok,) = address(split2).call{value: 1 wei}("");
        assertTrue(ok);
        // 50% of 1 wei = 0, last gets 1
        assertEq(bob.balance, 1 wei);
    }

    function test_receive_ETH_contractBalanceZeroAfterDistribution() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(split).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(split).balance, 0);
    }

    // ─── 3. USDC distribution via receiveUSDC() ──────────────────────────────

    function test_receiveUSDC_distributesCorrectly() public {
        uint256 amount = 1_000e6; // 1000 USDC

        vm.startPrank(caller);
        usdc.approve(address(split), amount);
        split.receiveUSDC(amount);
        vm.stopPrank();

        assertEq(usdc.balanceOf(alice),   600e6);
        assertEq(usdc.balanceOf(bob),     300e6);
        assertEq(usdc.balanceOf(charlie), 100e6);
    }

    function test_receiveUSDC_emitsRevenueReceived() public {
        uint256 amount = 500e6;
        vm.startPrank(caller);
        usdc.approve(address(split), amount);

        vm.expectEmit(false, false, false, true);
        emit SquadRevenueSplit.RevenueReceived(amount, address(usdc));
        split.receiveUSDC(amount);
        vm.stopPrank();
    }

    function test_receiveUSDC_emitsUSDCDistributed_perRecipient() public {
        uint256 amount = 1_000e6;
        vm.startPrank(caller);
        usdc.approve(address(split), amount);

        vm.expectEmit(true, false, false, true);
        emit SquadRevenueSplit.USDCDistributed(alice, 600e6);
        vm.expectEmit(true, false, false, true);
        emit SquadRevenueSplit.USDCDistributed(bob, 300e6);
        vm.expectEmit(true, false, false, true);
        emit SquadRevenueSplit.USDCDistributed(charlie, 100e6);

        split.receiveUSDC(amount);
        vm.stopPrank();
    }

    function test_receiveUSDC_zeroAmount_reverts() public {
        vm.expectRevert(SquadRevenueSplit.ZeroAmount.selector);
        vm.prank(caller);
        split.receiveUSDC(0);
    }

    function test_receiveUSDC_insufficientAllowance_reverts() public {
        vm.startPrank(caller);
        usdc.approve(address(split), 0); // no allowance
        vm.expectRevert(SquadRevenueSplit.TransferFailed.selector);
        split.receiveUSDC(1_000e6);
        vm.stopPrank();
    }

    function test_receiveUSDC_contractBalanceZeroAfterDistribution() public {
        uint256 amount = 1_000e6;
        vm.startPrank(caller);
        usdc.approve(address(split), amount);
        split.receiveUSDC(amount);
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(split)), 0);
    }

    // ─── 4. distribute() sweep — ETH only ────────────────────────────────────

    function test_distribute_sweepsETH() public {
        // Seed ETH into the contract without triggering receive()
        // Use vm.deal to force-set balance
        vm.deal(address(split), 1 ether);

        uint256 preAlice   = alice.balance;
        uint256 preBob     = bob.balance;
        uint256 preCharlie = charlie.balance;

        split.distribute();

        assertEq(alice.balance   - preAlice,   0.6 ether);
        assertEq(bob.balance     - preBob,     0.3 ether);
        assertEq(charlie.balance - preCharlie, 0.1 ether);
        assertEq(address(split).balance, 0);
    }

    // ─── 5. distribute() sweep — USDC only ───────────────────────────────────

    function test_distribute_sweepsUSDC() public {
        // Send USDC directly to the contract (bypassing receiveUSDC)
        usdc.mint(address(split), 2_000e6);

        split.distribute();

        assertEq(usdc.balanceOf(alice),   1_200e6);
        assertEq(usdc.balanceOf(bob),     600e6);
        assertEq(usdc.balanceOf(charlie), 200e6);
        assertEq(usdc.balanceOf(address(split)), 0);
    }

    // ─── 6. distribute() sweep — both ETH and USDC ───────────────────────────

    function test_distribute_sweepsBoth_ETH_and_USDC() public {
        vm.deal(address(split), 1 ether);
        usdc.mint(address(split), 1_000e6);

        uint256 preAliceETH   = alice.balance;
        uint256 preBobETH     = bob.balance;
        uint256 preCharlieETH = charlie.balance;

        split.distribute();

        // ETH
        assertEq(alice.balance   - preAliceETH,   0.6 ether);
        assertEq(bob.balance     - preBobETH,     0.3 ether);
        assertEq(charlie.balance - preCharlieETH, 0.1 ether);

        // USDC
        assertEq(usdc.balanceOf(alice),   600e6);
        assertEq(usdc.balanceOf(bob),     300e6);
        assertEq(usdc.balanceOf(charlie), 100e6);

        assertEq(address(split).balance, 0);
        assertEq(usdc.balanceOf(address(split)), 0);
    }

    function test_distribute_emitsBothRevenueReceivedEvents() public {
        vm.deal(address(split), 1 ether);
        usdc.mint(address(split), 500e6);

        vm.expectEmit(false, false, false, true);
        emit SquadRevenueSplit.RevenueReceived(1 ether, address(0));
        vm.expectEmit(false, false, false, true);
        emit SquadRevenueSplit.RevenueReceived(500e6, address(usdc));

        split.distribute();
    }

    function test_distribute_nothingToDistribute_reverts() public {
        vm.expectRevert(SquadRevenueSplit.NothingToDistribute.selector);
        split.distribute();
    }

    // ─── 7. Reentrancy guard ─────────────────────────────────────────────────

    function test_reentrancy_guard_ETH() public {
        // Deploy attacker first (target not set yet)
        ReentrantAttacker attacker = new ReentrantAttacker();

        // Deploy split with attacker as a recipient
        address[] memory r = new address[](2);
        uint256[] memory s = new uint256[](2);
        r[0] = address(attacker); r[1] = bob;
        s[0] = 5_000;             s[1] = 5_000;
        SquadRevenueSplit splitR = new SquadRevenueSplit(r, s, address(usdc), address(agentReg));

        // Now wire the attacker to target splitR
        attacker.setTarget(payable(address(splitR)));

        // Fund the attacker so it can attempt the re-entry call
        vm.deal(address(attacker), 1 wei);

        // Trigger distribution — attacker.receive() will try to re-enter splitR
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(splitR).call{value: 1 ether}("");
        assertTrue(ok); // outer call succeeds — attacker's re-entry is silently blocked

        // Guard confirmed the re-entry was blocked
        assertTrue(attacker.reentryBlocked());

        // All ETH distributed, nothing stuck in the contract
        assertEq(address(splitR).balance, 0);
    }

    // ─── 8. Single-recipient edge case ───────────────────────────────────────

    function test_singleRecipient_ETH_getsAll() public {
        address[] memory r = new address[](1);
        uint256[] memory s = new uint256[](1);
        r[0] = alice; s[0] = 10_000;

        SquadRevenueSplit splitSolo = new SquadRevenueSplit(r, s, address(usdc), address(agentReg));

        uint256 pre = alice.balance;
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(splitSolo).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(alice.balance - pre, 1 ether);
    }

    function test_singleRecipient_USDC_getsAll() public {
        address[] memory r = new address[](1);
        uint256[] memory s = new uint256[](1);
        r[0] = alice; s[0] = 10_000;

        SquadRevenueSplit splitSolo = new SquadRevenueSplit(r, s, address(usdc), address(agentReg));

        usdc.mint(caller, 500e6);
        vm.startPrank(caller);
        usdc.approve(address(splitSolo), 500e6);
        splitSolo.receiveUSDC(500e6);
        vm.stopPrank();

        assertEq(usdc.balanceOf(alice), 500e6);
    }
}
