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

        wallet = new ARC402Wallet(address(reg), address(this));

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

        // Create attestation from wallet (owner calls wallet, wallet calls intentAttestation)
        wallet.attest(ATTEST_ID, "pay_provider", "Payment for claim #1", recipient, 0.1 ether, address(0), 0);

        // Execute spend
        uint256 balanceBefore = recipient.balance;
        wallet.executeSpend(payable(recipient), 0.1 ether, "claims", ATTEST_ID);
        assertEq(recipient.balance - balanceBefore, 0.1 ether);

        // Close context — trust updates via ServiceAgreement.fulfill() only, not from wallet
        uint256 scoreBefore = wallet.getTrustScore();
        wallet.closeContext();
        uint256 scoreAfter = wallet.getTrustScore();
        assertEq(scoreAfter, scoreBefore); // score unchanged; no trust update from context lifecycle
    }

    function test_executeSpend_noContext() public {
        wallet.attest(ATTEST_ID, "pay", "Test", recipient, 0.1 ether, address(0), 0);
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
        wallet.attest(ATTEST_ID, "pay", "Test", recipient, 1 ether, address(0), 0);
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
        wallet.attest(ATTEST_ID, "api_call", "x402 payment for API access", recipient, paymentAmount, address(usdc), 0);

        // Execute token spend
        uint256 balanceBefore = usdc.balanceOf(recipient);
        wallet.executeTokenSpend(address(usdc), recipient, paymentAmount, "api_call", ATTEST_ID);
        assertEq(usdc.balanceOf(recipient) - balanceBefore, paymentAmount);
    }

    function test_executeTokenSpend_policyViolation() public {
        uint256 tooMuch = 20_000_000; // 20 USDC — exceeds 10 USDC limit
        usdc.transfer(address(wallet), tooMuch);

        wallet.openContext(CONTEXT_ID, "api_payment");

        wallet.attest(ATTEST_ID, "api_call", "x402 payment", recipient, tooMuch, address(usdc), 0);

        vm.expectRevert("PolicyEngine: amount exceeds category limit");
        wallet.executeTokenSpend(address(usdc), recipient, tooMuch, "api_call", ATTEST_ID);
    }

    function test_executeTokenSpend_invalidAttestation() public {
        wallet.openContext(CONTEXT_ID, "api_payment");
        vm.expectRevert("ARC402: invalid attestation");
        wallet.executeTokenSpend(address(usdc), recipient, 1_000_000, "api_call", bytes32(uint256(999)));
    }

    function test_executeTokenSpend_noContext() public {
        wallet.attest(ATTEST_ID, "api_call", "test", recipient, 1_000_000, address(usdc), 0);
        vm.expectRevert("ARC402: no active context");
        wallet.executeTokenSpend(address(usdc), recipient, 1_000_000, "api_call", ATTEST_ID);
    }

    // ─── Registry Upgrade Tests ───────────────────────────────────────────────

    // ─── Registry Timelock Tests ──────────────────────────────────────────────

    function _deployReg2() internal returns (ARC402Registry) {
        PolicyEngine pe2 = new PolicyEngine();
        TrustRegistry tr2 = new TrustRegistry();
        IntentAttestation ia2 = new IntentAttestation();
        SettlementCoordinator sc2 = new SettlementCoordinator();
        return new ARC402Registry(address(pe2), address(tr2), address(ia2), address(sc2), "v2.0.0");
    }

    function test_RegistryTimelock_ProposeAndExecute() public {
        ARC402Registry reg2 = _deployReg2();
        address oldReg = address(wallet.registry());

        wallet.proposeRegistryUpdate(address(reg2));
        assertEq(wallet.pendingRegistry(), address(reg2));
        // Cannot execute before timelock elapses
        vm.expectRevert("ARC402: timelock not elapsed");
        wallet.executeRegistryUpdate();

        // Warp past timelock
        vm.warp(block.timestamp + 2 days + 1);
        wallet.executeRegistryUpdate();

        assertEq(address(wallet.registry()), address(reg2));
        assertTrue(address(wallet.registry()) != oldReg);
        assertEq(wallet.pendingRegistry(), address(0));
    }

    function test_RegistryTimelock_CannotExecuteEarly() public {
        ARC402Registry reg2 = _deployReg2();
        wallet.proposeRegistryUpdate(address(reg2));
        vm.warp(block.timestamp + 1 days); // only 1 day, need 2
        vm.expectRevert("ARC402: timelock not elapsed");
        wallet.executeRegistryUpdate();
    }

    function test_RegistryTimelock_CanCancel() public {
        ARC402Registry reg2 = _deployReg2();
        wallet.proposeRegistryUpdate(address(reg2));
        assertEq(wallet.pendingRegistry(), address(reg2));
        wallet.cancelRegistryUpdate();
        assertEq(wallet.pendingRegistry(), address(0));
        // Original registry unchanged
        assertEq(address(wallet.registry()), address(reg));
    }

    function test_RegistryTimelock_OnlyOwner() public {
        ARC402Registry reg2 = _deployReg2();
        vm.prank(address(0xDEAD));
        vm.expectRevert("ARC402: not owner");
        wallet.proposeRegistryUpdate(address(reg2));
    }

    function test_RegistryTimelock_NoPendingReverts() public {
        vm.expectRevert("ARC402: no pending registry");
        wallet.executeRegistryUpdate();
        vm.expectRevert("ARC402: no pending registry");
        wallet.cancelRegistryUpdate();
    }

    // ─── Circuit Breaker Tests ────────────────────────────────────────────────

    function test_Freeze_BlocksSpend() public {
        wallet.openContext(CONTEXT_ID, "claims_processing");
        wallet.attest(ATTEST_ID, "pay_provider", "Payment", recipient, 0.1 ether, address(0), 0);

        wallet.freeze("manual emergency stop");

        vm.expectRevert("ARC402: wallet frozen");
        wallet.executeSpend(payable(recipient), 0.1 ether, "claims", ATTEST_ID);
    }

    function test_Unfreeze_RestoresSpend() public {
        wallet.openContext(CONTEXT_ID, "claims_processing");
        wallet.attest(ATTEST_ID, "pay_provider", "Payment", recipient, 0.1 ether, address(0), 0);

        wallet.freeze("manual freeze");
        wallet.unfreeze();

        uint256 balanceBefore = recipient.balance;
        wallet.executeSpend(payable(recipient), 0.1 ether, "claims", ATTEST_ID);
        assertEq(recipient.balance - balanceBefore, 0.1 ether);
    }

    function test_VelocityLimit_AutoFreeze() public {
        // Raise policy limit to allow 0.6 ETH transactions
        vm.prank(address(wallet));
        policyEngine.setCategoryLimit("claims", 2 ether);

        wallet.setVelocityLimit(1 ether);
        wallet.openContext(CONTEXT_ID, "claims_processing");

        bytes32 attest1 = keccak256("intent-vel-1");
        bytes32 attest2 = keccak256("intent-vel-2");

        // First spend: 0.6 ETH — fine
        wallet.attest(attest1, "pay", "Payment 1", recipient, 0.6 ether, address(0), 0);
        wallet.executeSpend(payable(recipient), 0.6 ether, "claims", attest1);
        assertFalse(wallet.frozen());

        // Second spend: 0.6 ETH — total 1.2 ETH > 1 ETH limit.
        // EVM note: auto-freeze sets frozen=true and returns (no revert) so the state
        // change persists. The transfer is silently blocked; wallet is now frozen.
        wallet.attest(attest2, "pay", "Payment 2", recipient, 0.6 ether, address(0), 0);
        uint256 balBefore = recipient.balance;
        wallet.executeSpend(payable(recipient), 0.6 ether, "claims", attest2); // no revert, no transfer
        assertEq(recipient.balance, balBefore); // no ETH was sent
        assertTrue(wallet.frozen()); // wallet is now frozen
    }

    function test_VelocityLimit_ResetsAfterWindow() public {
        // Raise policy limit
        vm.prank(address(wallet));
        policyEngine.setCategoryLimit("claims", 2 ether);

        wallet.setVelocityLimit(1 ether);
        wallet.openContext(CONTEXT_ID, "claims_processing");

        bytes32 attest1 = keccak256("intent-window-1");
        bytes32 attest2 = keccak256("intent-window-2");

        // First spend: 0.9 ETH (within limit)
        wallet.attest(attest1, "pay", "Payment 1", recipient, 0.9 ether, address(0), 0);
        wallet.executeSpend(payable(recipient), 0.9 ether, "claims", attest1);

        // Warp 25 hours — new window
        vm.warp(block.timestamp + 25 hours);

        // Second spend: 0.9 ETH — window reset, should succeed
        wallet.attest(attest2, "pay", "Payment 2", recipient, 0.9 ether, address(0), 0);
        uint256 balanceBefore = recipient.balance;
        wallet.executeSpend(payable(recipient), 0.9 ether, "claims", attest2);
        assertEq(recipient.balance - balanceBefore, 0.9 ether);
        assertFalse(wallet.frozen());
    }

    function test_RevertFreeze_NotOwner() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert("ARC402: not owner");
        wallet.freeze("unauthorized attempt");
    }

    function test_RevertSpend_WhenFrozen() public {
        // Trigger auto-freeze via velocity limit, then confirm subsequent spend reverts.
        vm.prank(address(wallet));
        policyEngine.setCategoryLimit("claims", 2 ether);

        wallet.setVelocityLimit(1 ether);
        wallet.openContext(CONTEXT_ID, "claims_processing");

        bytes32 attest1 = keccak256("intent-frozen-1");
        bytes32 attest2 = keccak256("intent-frozen-2");
        bytes32 attest3 = keccak256("intent-frozen-3");

        // 0.6 ETH: fine
        wallet.attest(attest1, "pay", "P1", recipient, 0.6 ether, address(0), 0);
        wallet.executeSpend(payable(recipient), 0.6 ether, "claims", attest1);

        // 0.6 ETH: velocity exceeded → freezes, no transfer (no revert — state persists)
        wallet.attest(attest2, "pay", "P2", recipient, 0.6 ether, address(0), 0);
        wallet.executeSpend(payable(recipient), 0.6 ether, "claims", attest2);
        assertTrue(wallet.frozen()); // auto-frozen

        // Wallet is now frozen — further spend must revert (wallet.attest is not gated by notFrozen)
        wallet.attest(attest3, "pay", "P3", recipient, 0.1 ether, address(0), 0);
        vm.expectRevert("ARC402: wallet frozen");
        wallet.executeSpend(payable(recipient), 0.1 ether, "claims", attest3);
    }

    // ─── Multi-Agent Settlement Tests ─────────────────────────────────────────

    function test_proposeMASSettlement_CallsCoordinator() public {
        address recipientWallet = address(0xC0FFEE);
        uint256 amount = 0.1 ether;
        bytes32 attestId = keccak256("mas-intent-1");

        wallet.openContext(CONTEXT_ID, "claims_processing");

        // Attest
        wallet.attest(attestId, "settle_claim", "MAS settlement test", recipientWallet, amount, address(0), 0);

        // Set policy limit high enough
        vm.prank(address(wallet));
        policyEngine.setCategoryLimit("claims", 1 ether);

        // Propose MAS settlement — should emit event AND create a coordinator proposal
        vm.recordLogs();
        wallet.proposeMASSettlement(recipientWallet, amount, "claims", attestId);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // Find ProposalCreated log from SettlementCoordinator
        bytes32 proposalCreatedTopic = keccak256("ProposalCreated(bytes32,address,address,uint256,address)");
        bool found = false;
        bytes32 proposalId;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == proposalCreatedTopic) {
                found = true;
                proposalId = logs[i].topics[1]; // indexed proposalId
                break;
            }
        }
        assertTrue(found, "ProposalCreated event not emitted by SettlementCoordinator");

        // Verify proposal state in SettlementCoordinator
        (
            address fromWallet,
            address toWallet,
            uint256 propAmount,
            address token,
            bytes32 intentId,
            ,
            ,
            SettlementCoordinator.ProposalStatus status,
        ) = settlementCoordinator.getProposal(proposalId);

        assertEq(fromWallet, address(wallet));
        assertEq(toWallet, recipientWallet);
        assertEq(propAmount, amount);
        assertEq(token, address(0)); // ETH settlement
        assertEq(intentId, attestId);
        assertEq(uint256(status), uint256(SettlementCoordinator.ProposalStatus.PENDING));
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

        // Switch wallet to new registry (via timelock)
        wallet.proposeRegistryUpdate(address(reg2));
        vm.warp(block.timestamp + 2 days + 1);
        wallet.executeRegistryUpdate();

        // Trust score now reads from tr2 (wallet not initialized there, score = 0)
        assertEq(wallet.getTrustScore(), 0);

        // Initialize wallet in tr2 and add updater
        tr2.initWallet(address(wallet));
        tr2.addUpdater(address(wallet));
        assertEq(wallet.getTrustScore(), 100);

        // Set a policy on pe2
        vm.prank(address(wallet));
        pe2.setCategoryLimit("claims", 1 ether);

        // Attest and spend using new infrastructure (wallet.attest() routes through ia2 via new registry)
        wallet.openContext(CONTEXT_ID, "test");
        wallet.attest(ATTEST_ID, "pay", "test", recipient, 0.5 ether, address(0), 0);
        uint256 before = recipient.balance;
        wallet.executeSpend(payable(recipient), 0.5 ether, "claims", ATTEST_ID);
        assertEq(recipient.balance - before, 0.5 ether);
    }

    // ─── New Security Tests ───────────────────────────────────────────────────

    function test_Wallet_Attest_CreatesValidAttestation() public {
        // Verify that wallet.attest() + wallet.executeSpend() works end-to-end
        // (the primary fix: wallet is msg.sender when calling intentAttestation.attest)
        wallet.openContext(CONTEXT_ID, "claims_processing");

        bytes32 id = wallet.attest(ATTEST_ID, "pay_provider", "Valid flow", recipient, 0.1 ether, address(0), 0);
        assertEq(id, ATTEST_ID);

        uint256 balanceBefore = recipient.balance;
        wallet.executeSpend(payable(recipient), 0.1 ether, "claims", ATTEST_ID);
        assertEq(recipient.balance - balanceBefore, 0.1 ether);
    }

    function test_Attestation_CannotReplay() public {
        // Use attestation once — second spend with same ID must revert
        wallet.openContext(CONTEXT_ID, "claims_processing");
        wallet.attest(ATTEST_ID, "pay_provider", "Single use", recipient, 0.1 ether, address(0), 0);

        wallet.executeSpend(payable(recipient), 0.1 ether, "claims", ATTEST_ID);

        // Attestation is now consumed — replay must fail
        vm.expectRevert("ARC402: invalid intent attestation");
        wallet.executeSpend(payable(recipient), 0.1 ether, "claims", ATTEST_ID);
    }

    function test_Attestation_WrongRecipient_Fails() public {
        // Attest for alice, attempt spend to bob — must revert
        address alice = address(0xA11CE);
        address bob = address(0xB0B);

        wallet.openContext(CONTEXT_ID, "claims_processing");
        // Attest for alice
        wallet.attest(ATTEST_ID, "pay_provider", "To alice", alice, 0.1 ether, address(0), 0);

        // Fund wallet has enough ETH; policy limit is fine
        vm.deal(address(wallet), 10 ether);

        // Attempt spend to bob — verify should fail (wrong recipient)
        vm.expectRevert("ARC402: invalid intent attestation");
        wallet.executeSpend(payable(bob), 0.1 ether, "claims", ATTEST_ID);
    }

    function test_Attestation_WrongAmount_Fails() public {
        // Attest for 0.1 ETH, attempt spend of 0.2 ETH — must revert
        wallet.openContext(CONTEXT_ID, "claims_processing");
        wallet.attest(ATTEST_ID, "pay_provider", "0.1 ether only", recipient, 0.1 ether, address(0), 0);

        vm.expectRevert("ARC402: invalid intent attestation");
        wallet.executeSpend(payable(recipient), 0.2 ether, "claims", ATTEST_ID);
    }

    // ─── Fix 2: notFrozen on proposeMASSettlement ─────────────────────────────

    /**
     * @notice Fix 2 hardening: proposeMASSettlement must revert when the wallet is frozen.
     *         Previously, the notFrozen modifier was missing, allowing a frozen wallet
     *         to still initiate MAS settlement proposals.
     */
    function test_proposeMASSettlement_RevertsWhenFrozen() public {
        address recipientWallet = address(0xC0FFEE);
        uint256 amount = 0.1 ether;
        bytes32 attestId = keccak256("mas-frozen-test");

        wallet.openContext(CONTEXT_ID, "claims_processing");

        // Attest before freezing
        wallet.attest(attestId, "settle_claim", "MAS frozen test", recipientWallet, amount, address(0), 0);

        // Freeze the wallet
        wallet.freeze("security incident");
        assertTrue(wallet.frozen());

        // proposeMASSettlement must revert because wallet is frozen
        vm.expectRevert("ARC402: wallet frozen");
        wallet.proposeMASSettlement(recipientWallet, amount, "claims", attestId);
    }

    // ─── F-21: Split ETH/ERC-20 velocity counters ────────────────────────────

    function test_VelocityLimit_ETHAndTokenSeparate() public {
        // Velocity limit: 500_000 units (applied independently to ETH wei and USDC 1e6 units)
        uint256 limit = 500_000;
        wallet.setVelocityLimit(limit);

        wallet.openContext(CONTEXT_ID, "claims_processing");

        // ETH spend: 400_000 wei — under the ETH limit
        uint256 ethAmount = 400_000;
        bytes32 ethAttest = keccak256("eth-spend-1");
        wallet.attest(ethAttest, "pay_provider", "ETH spend", recipient, ethAmount, address(0), 0);
        wallet.executeSpend(payable(recipient), ethAmount, "claims", ethAttest);
        assertEq(wallet.ethSpendingInWindow(), ethAmount);

        // Token spending window is still 0 — counters are independent
        assertEq(wallet.tokenSpendingInWindow(), 0);

        // USDC spend: 400_000 token units (0.4 USDC at 6 decimals) — under token limit
        uint256 tokenAmount = 400_000;
        bytes32 tokenAttest = keccak256("token-spend-1");
        wallet.attest(tokenAttest, "pay_api", "Token spend", recipient, tokenAmount, address(usdc), 0);
        usdc.transfer(address(wallet), tokenAmount);
        wallet.executeTokenSpend(address(usdc), recipient, tokenAmount, "claims", tokenAttest);
        assertEq(wallet.tokenSpendingInWindow(), tokenAmount);

        // Wallet not frozen — both paths stayed under their independent limits
        assertFalse(wallet.frozen());
        // ETH counter unaffected by token spend
        assertEq(wallet.ethSpendingInWindow(), ethAmount);
    }
}
