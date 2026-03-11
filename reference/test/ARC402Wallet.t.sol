// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../contracts/ARC402Wallet.sol";
import "../contracts/ARC402Registry.sol";
import "../contracts/PolicyEngine.sol";
import "../contracts/TrustRegistry.sol";
import "../contracts/IntentAttestation.sol";
import "../contracts/SettlementCoordinator.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Mock USDC for testing (6 decimals like real USDC)
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {
        _mint(msg.sender, 1_000_000 * 10**6); // 1M USDC
    }
    function decimals() public pure override returns (uint8) { return 6; }
}

contract ARC402WalletTest is Test {
    PolicyEngine policyEngine;
    TrustRegistry trustRegistry;
    IntentAttestation intentAttestation;
    SettlementCoordinator settlementCoordinator;
    ARC402Registry reg;
    ARC402Wallet wallet;
    MockUSDC usdc;

    address owner = address(this);
    address recipient = address(0xBEEF);
    bytes32 constant CONTEXT_ID = keccak256("context-1");
    bytes32 constant ATTEST_ID = keccak256("intent-1");

    function setUp() public {
        policyEngine = new PolicyEngine();
        trustRegistry = new TrustRegistry();
        intentAttestation = new IntentAttestation();
        settlementCoordinator = new SettlementCoordinator();
        usdc = new MockUSDC();

        reg = new ARC402Registry(
            address(policyEngine),
            address(trustRegistry),
            address(intentAttestation),
            address(settlementCoordinator),
            "v1.0.0"
        );

        wallet = new ARC402Wallet(address(reg));

        // Add wallet as trusted updater
        trustRegistry.addUpdater(address(wallet));

        // Fund wallet with ETH
        vm.deal(address(wallet), 10 ether);

        // Set policy for claims category
        vm.prank(address(wallet));
        policyEngine.setCategoryLimit("claims", 0.5 ether);

        // Set policy for api_call category (USDC: 10 USDC = 10_000_000 units)
        vm.prank(address(wallet));
        policyEngine.setCategoryLimit("api_call", 10_000_000);
    }

    function test_openContext() public {
        wallet.openContext(CONTEXT_ID, "claims_processing");
        (bytes32 ctxId, string memory taskType, , bool open) = wallet.getActiveContext();
        assertEq(ctxId, CONTEXT_ID);
        assertEq(taskType, "claims_processing");
        assertTrue(open);
    }

    function test_openContext_alreadyOpen() public {
        wallet.openContext(CONTEXT_ID, "claims_processing");
        vm.expectRevert("ARC402: context already open");
        wallet.openContext(keccak256("context-2"), "other");
    }

    function test_closeContext() public {
        wallet.openContext(CONTEXT_ID, "claims_processing");
        wallet.closeContext();
        (, , , bool open) = wallet.getActiveContext();
        assertFalse(open);
    }

    function test_closeContext_noContext() public {
        vm.expectRevert("ARC402: no active context");
        wallet.closeContext();
    }

    function test_fullFlow_openExecuteClose() public {
        // Open context
        wallet.openContext(CONTEXT_ID, "claims_processing");

        // Create attestation from wallet
        vm.prank(address(wallet));
        intentAttestation.attest(ATTEST_ID, "pay_provider", "Payment for claim #1", recipient, 0.1 ether, address(0));

        // Execute spend
        uint256 balanceBefore = recipient.balance;
        wallet.executeSpend(payable(recipient), 0.1 ether, "claims", ATTEST_ID);
        assertEq(recipient.balance - balanceBefore, 0.1 ether);

        // Close context - trust score should increase
        uint256 scoreBefore = wallet.getTrustScore();
        wallet.closeContext();
        uint256 scoreAfter = wallet.getTrustScore();
        assertEq(scoreAfter, scoreBefore + 5);
    }

    function test_executeSpend_noContext() public {
        vm.prank(address(wallet));
        intentAttestation.attest(ATTEST_ID, "pay", "Test", recipient, 0.1 ether, address(0));
        vm.expectRevert("ARC402: no active context");
        wallet.executeSpend(payable(recipient), 0.1 ether, "claims", ATTEST_ID);
    }

    function test_executeSpend_invalidAttestation() public {
        wallet.openContext(CONTEXT_ID, "claims_processing");
        vm.expectRevert("ARC402: invalid intent attestation");
        wallet.executeSpend(payable(recipient), 0.1 ether, "claims", bytes32(uint256(999)));
    }

    function test_executeSpend_policyViolation() public {
        wallet.openContext(CONTEXT_ID, "claims_processing");
        vm.prank(address(wallet));
        intentAttestation.attest(ATTEST_ID, "pay", "Test", recipient, 1 ether, address(0));
        vm.expectRevert("PolicyEngine: amount exceeds category limit");
        wallet.executeSpend(payable(recipient), 1 ether, "claims", ATTEST_ID);
    }

    function test_getTrustScore_initial() public {
        assertEq(wallet.getTrustScore(), 100);
    }

    // ─── ERC-20 / x402 Token Spend Tests ─────────────────────────────────────

    function test_executeTokenSpend_pass() public {
        // Fund wallet with USDC
        uint256 paymentAmount = 1_000_000; // 1 USDC
        usdc.transfer(address(wallet), 5_000_000); // 5 USDC

        // Open context
        wallet.openContext(CONTEXT_ID, "api_payment");

        // Create attestation from wallet (with USDC token address)
        vm.prank(address(wallet));
        intentAttestation.attest(ATTEST_ID, "api_call", "x402 payment for API access", recipient, paymentAmount, address(usdc));

        // Execute token spend
        uint256 balanceBefore = usdc.balanceOf(recipient);
        wallet.executeTokenSpend(address(usdc), recipient, paymentAmount, "api_call", ATTEST_ID);
        assertEq(usdc.balanceOf(recipient) - balanceBefore, paymentAmount);
    }

    function test_executeTokenSpend_policyViolation() public {
        uint256 tooMuch = 20_000_000; // 20 USDC — exceeds 10 USDC limit
        usdc.transfer(address(wallet), tooMuch);

        wallet.openContext(CONTEXT_ID, "api_payment");

        vm.prank(address(wallet));
        intentAttestation.attest(ATTEST_ID, "api_call", "x402 payment", recipient, tooMuch, address(usdc));

        vm.expectRevert("PolicyEngine: amount exceeds category limit");
        wallet.executeTokenSpend(address(usdc), recipient, tooMuch, "api_call", ATTEST_ID);
    }

    function test_executeTokenSpend_invalidAttestation() public {
        wallet.openContext(CONTEXT_ID, "api_payment");
        vm.expectRevert("ARC402: invalid attestation");
        wallet.executeTokenSpend(address(usdc), recipient, 1_000_000, "api_call", bytes32(uint256(999)));
    }

    function test_executeTokenSpend_noContext() public {
        vm.prank(address(wallet));
        intentAttestation.attest(ATTEST_ID, "api_call", "test", recipient, 1_000_000, address(usdc));
        vm.expectRevert("ARC402: no active context");
        wallet.executeTokenSpend(address(usdc), recipient, 1_000_000, "api_call", ATTEST_ID);
    }

    // ─── Registry Upgrade Tests ───────────────────────────────────────────────

    function test_setRegistry_works() public {
        // Deploy a new registry with fresh infrastructure
        PolicyEngine pe2 = new PolicyEngine();
        TrustRegistry tr2 = new TrustRegistry();
        IntentAttestation ia2 = new IntentAttestation();
        SettlementCoordinator sc2 = new SettlementCoordinator();
        ARC402Registry reg2 = new ARC402Registry(
            address(pe2),
            address(tr2),
            address(ia2),
            address(sc2),
            "v2.0.0"
        );

        address oldReg = address(wallet.registry());
        wallet.setRegistry(address(reg2));

        assertEq(address(wallet.registry()), address(reg2));
        assertTrue(address(wallet.registry()) != oldReg);
    }

    function test_setRegistry_notOwner_reverts() public {
        ARC402Registry reg2 = new ARC402Registry(
            address(policyEngine),
            address(trustRegistry),
            address(intentAttestation),
            address(settlementCoordinator),
            "v2.0.0"
        );

        vm.prank(address(0xDEAD));
        vm.expectRevert("ARC402: not owner");
        wallet.setRegistry(address(reg2));
    }

    function test_walletUsesNewRegistry() public {
        // Deploy fresh infrastructure for v2
        PolicyEngine pe2 = new PolicyEngine();
        TrustRegistry tr2 = new TrustRegistry();
        IntentAttestation ia2 = new IntentAttestation();
        SettlementCoordinator sc2b = new SettlementCoordinator();
        ARC402Registry reg2 = new ARC402Registry(
            address(pe2),
            address(tr2),
            address(ia2),
            address(sc2b),
            "v2.0.0"
        );

        // Switch wallet to new registry
        wallet.setRegistry(address(reg2));

        // Trust score now reads from tr2 (wallet not initialized there, score = 0)
        assertEq(wallet.getTrustScore(), 0);

        // Initialize wallet in tr2 and add updater
        tr2.initWallet(address(wallet));
        tr2.addUpdater(address(wallet));
        assertEq(wallet.getTrustScore(), 100);

        // Set a policy on pe2
        vm.prank(address(wallet));
        pe2.setCategoryLimit("claims", 1 ether);

        // Attest and spend using new infrastructure
        wallet.openContext(CONTEXT_ID, "test");
        vm.prank(address(wallet));
        ia2.attest(ATTEST_ID, "pay", "test", recipient, 0.5 ether, address(0));
        uint256 before = recipient.balance;
        wallet.executeSpend(payable(recipient), 0.5 ether, "claims", ATTEST_ID);
        assertEq(recipient.balance - before, 0.5 ether);
    }
}
