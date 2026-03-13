// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../contracts/PolicyEngine.sol";
import "../contracts/ARC402Wallet.sol";
import "../contracts/ARC402Registry.sol";
import "../contracts/TrustRegistry.sol";
import "../contracts/IntentAttestation.sol";
import "../contracts/SettlementCoordinator.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Minimal mock token — no special approval mechanics
contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1_000_000 * 1e18);
    }
}

/// @dev Mock token with USDC-like decimals (6)
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {
        _mint(msg.sender, 1_000_000 * 1e6);
    }
    function decimals() public pure override returns (uint8) { return 6; }
}

/// @dev Target contract that exposes an approve-like call surface for testing
///      DeFi whitelist interactions in ARC402Wallet.executeContractCall.
contract ApproveTarget {
    mapping(address => mapping(address => uint256)) public allowance;

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    // Arbitrary function that is NOT approve — used for normal DeFi call tests
    function deposit() external payable {}
}

contract PolicyEngineSecurityTest is Test {
    PolicyEngine engine;

    // Full wallet stack for executeContractCall tests
    PolicyEngine walletPolicyEngine;
    TrustRegistry trustRegistry;
    IntentAttestation intentAttestation;
    SettlementCoordinator settlementCoordinator;
    ARC402Registry reg;
    ARC402Wallet wallet;
    ApproveTarget approveTarget;
    MockUSDC usdc;

    address walletOwner = address(this);
    address wallet_addr = address(0x1234);
    address owner = address(0x2222);
    string constant CAT = "claims";

    function setUp() public {
        // Standalone PolicyEngine for pure policy tests
        engine = new PolicyEngine();
        vm.prank(wallet_addr);
        engine.registerWallet(wallet_addr, owner);
        vm.prank(wallet_addr);
        engine.setCategoryLimit(CAT, 10 ether);
        vm.prank(wallet_addr);
        engine.setDailyLimit(CAT, 20 ether);

        // Full wallet stack for executeContractCall / approve bypass tests
        walletPolicyEngine = new PolicyEngine();
        trustRegistry = new TrustRegistry();
        intentAttestation = new IntentAttestation();
        settlementCoordinator = new SettlementCoordinator();
        reg = new ARC402Registry(
            address(walletPolicyEngine),
            address(trustRegistry),
            address(intentAttestation),
            address(settlementCoordinator),
            "v1.0.0"
        );
        wallet = new ARC402Wallet(address(reg), walletOwner);
        trustRegistry.addUpdater(address(wallet));
        vm.deal(address(wallet), 10 ether);

        // Register wallet with PolicyEngine (wallet self-registers, owner = walletOwner)
        vm.prank(address(wallet));
        walletPolicyEngine.registerWallet(address(wallet), walletOwner);

        // Category + DeFi access for wallet
        vm.prank(address(wallet));
        walletPolicyEngine.setCategoryLimit(CAT, 1 ether);

        vm.prank(address(wallet));
        walletPolicyEngine.enableDefiAccess(address(wallet));

        approveTarget = new ApproveTarget();
        vm.prank(address(wallet));
        walletPolicyEngine.whitelistContract(address(wallet), address(approveTarget));

        usdc = new MockUSDC();
    }

    // ─── test_Policy_BlocksUnlimitedApprove ───────────────────────────────────
    // Scenario 1: hot key calls approve(attacker, MAX_UINT256)
    // Policy should REJECT this — infinite approval exceeds any spending limit.

    function test_Policy_BlocksUnlimitedApprove() public {
        // Direct policy check: MAX_UINT256 approval must be rejected
        (bool valid, string memory reason) = engine.validateApproval(
            wallet_addr, address(usdc), type(uint256).max
        );
        assertFalse(valid);
        assertEq(reason, "PolicyEngine: infinite approval rejected");
    }

    function test_Policy_BlocksUnlimitedApprove_ViaWalletExecute() public {
        // End-to-end: executeContractCall with approve(spender, MAX_UINT256) must revert
        // Encode: approve(address(0xATTACK), type(uint256).max)
        bytes memory approveCalldata = abi.encodeWithSignature(
            "approve(address,uint256)",
            address(0xA77AC),
            type(uint256).max
        );

        ARC402Wallet.ContractCallParams memory params = ARC402Wallet.ContractCallParams({
            target: address(approveTarget),
            data: approveCalldata,
            value: 0,
            minReturnValue: 0,
            maxApprovalAmount: 0,
            approvalToken: address(0)
        });

        vm.expectRevert("PolicyEngine: infinite approval rejected");
        wallet.executeContractCall(params);
    }

    function test_Policy_AllowsFiniteApprove() public {
        // Finite, reasonable approval should pass
        (bool valid,) = engine.validateApproval(wallet_addr, address(usdc), 1 ether);
        assertTrue(valid);
    }

    // ─── test_Policy_TracksCumulativeSpend ────────────────────────────────────
    // Multiple small transactions must accumulate against the daily limit.
    // Verifies the two-bucket window correctly prevents boundary exploitation.

    function test_Policy_TracksCumulativeSpend() public {
        // Record 4 × 5 ETH = 20 ETH (at daily limit of 20 ETH)
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(wallet_addr);
            engine.recordSpend(wallet_addr, CAT, 5 ether, bytes32(0));
        }

        // Exactly at limit: 0 more should pass
        (bool atLimit,) = engine.validateSpend(wallet_addr, CAT, 1 wei, bytes32(0));
        assertFalse(atLimit, "20+1wei > 20 ether daily limit");

        // After window expires, limit resets
        vm.warp(block.timestamp + 25 hours);
        (bool reset,) = engine.validateSpend(wallet_addr, CAT, 5 ether, bytes32(0));
        assertTrue(reset, "window expired - cumulative should reset");
    }

    function test_Policy_TracksCumulativeSpend_CrossBucketBoundary() public {
        // Spend 12 ETH in bucket 0, advance to bucket 1, spend 9 more.
        // Effective = 12 + 9 = 21 > 20 daily limit.
        vm.prank(wallet_addr);
        engine.recordSpend(wallet_addr, CAT, 12 ether, bytes32(0));

        vm.warp(block.timestamp + 12 hours + 1);

        vm.prank(wallet_addr);
        engine.recordSpend(wallet_addr, CAT, 9 ether, bytes32(0));

        // 12 + 9 = 21; next spend of 1 wei would be 22 > 20 → blocked
        (bool over,) = engine.validateSpend(wallet_addr, CAT, 1 wei, bytes32(0));
        assertFalse(over, "cumulative 21 ETH > 20 daily limit across bucket boundary");
    }

    // ─── test_Policy_TokenSpecific_USDC ───────────────────────────────────────
    // USDC has 6 decimals. Policy checks must work correctly with non-18-decimal tokens.
    // Also verifies USDC-specific approval validation (infinite approval rejected).

    function test_Policy_TokenSpecific_USDC() public {
        // Infinite USDC approval must be rejected
        (bool inf, string memory infReason) = engine.validateApproval(
            wallet_addr, address(usdc), type(uint256).max
        );
        assertFalse(inf);
        assertEq(infReason, "PolicyEngine: infinite approval rejected");

        // Finite USDC approval (1000 USDC = 1_000_000_000 units at 6 decimals) should pass
        uint256 oneThousandUSDC = 1_000 * 1e6;
        (bool finite,) = engine.validateApproval(wallet_addr, address(usdc), oneThousandUSDC);
        assertTrue(finite, "1000 USDC finite approval should be valid");
    }

    function test_Policy_TokenSpecific_USDC_RecordApproval() public {
        // Record approval and verify outstanding approvals tracking
        uint256 approvalAmount = 500 * 1e6; // 500 USDC
        vm.prank(wallet_addr);
        engine.recordApproval(wallet_addr, address(usdc), approvalAmount);

        assertEq(engine.outstandingApprovals(wallet_addr, address(usdc)), approvalAmount);
    }

    // ─── test_Policy_NoBypassViaBatch ─────────────────────────────────────────
    // Verify that even if infinite approval is encoded within a contract call,
    // the wallet's executeContractCall intercepts and blocks it.
    // This is the core approve() bypass prevention test.

    function test_Policy_NoBypassViaBatch() public {
        // Attempt to call approve() with MAX_UINT256 via executeContractCall
        // (simulates a hot key trying to grant infinite allowance to a counterparty)
        address attacker = address(0xBAD);
        bytes memory infiniteApprove = abi.encodeWithSignature(
            "approve(address,uint256)",
            attacker,
            type(uint256).max
        );

        ARC402Wallet.ContractCallParams memory params = ARC402Wallet.ContractCallParams({
            target: address(approveTarget),
            data: infiniteApprove,
            value: 0,
            minReturnValue: 0,
            maxApprovalAmount: 0,
            approvalToken: address(0)
        });

        // Must revert — policy blocks infinite approval
        vm.expectRevert("PolicyEngine: infinite approval rejected");
        wallet.executeContractCall(params);

        // Finite approve (non-infinite) should pass the approval policy check
        // (the call itself will succeed if the approveTarget.approve() returns true)
        bytes memory finiteApprove = abi.encodeWithSignature(
            "approve(address,uint256)",
            attacker,
            1 ether
        );

        ARC402Wallet.ContractCallParams memory finiteParams = ARC402Wallet.ContractCallParams({
            target: address(approveTarget),
            data: finiteApprove,
            value: 0,
            minReturnValue: 0,
            maxApprovalAmount: 0,
            approvalToken: address(0)
        });

        // Finite approval passes (no policy violation)
        wallet.executeContractCall(finiteParams);
        assertEq(approveTarget.allowance(address(wallet), attacker), 1 ether);
    }

    // ─── test_Policy_FreezeBlocksApproval ─────────────────────────────────────

    function test_Policy_FreezeBlocksApproval() public {
        vm.prank(owner);
        engine.freezeSpend(wallet_addr);

        vm.expectRevert("PolicyEngine: spend frozen");
        engine.validateApproval(wallet_addr, address(usdc), 1 ether);
    }
}
