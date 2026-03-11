// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/X402Interceptor.sol";
import "../contracts/ARC402Wallet.sol";
import "../contracts/ARC402Registry.sol";
import "../contracts/PolicyEngine.sol";
import "../contracts/TrustRegistry.sol";
import "../contracts/IntentAttestation.sol";
import "../contracts/SettlementCoordinator.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─── Mock ARC402Wallet ────────────────────────────────────────────────────────

contract MockARC402Wallet {
    address public lastToken;
    address public lastRecipient;
    uint256 public lastAmount;
    string public lastCategory;
    bytes32 public lastAttestationId;
    uint256 public callCount;

    bool public shouldRevert;
    string public revertMessage;

    function setRevert(bool _shouldRevert, string memory _msg) external {
        shouldRevert = _shouldRevert;
        revertMessage = _msg;
    }

    function executeTokenSpend(
        address token,
        address recipient,
        uint256 amount,
        string calldata category,
        bytes32 attestationId
    ) external {
        if (shouldRevert) revert(revertMessage);
        lastToken = token;
        lastRecipient = recipient;
        lastAmount = amount;
        lastCategory = category;
        lastAttestationId = attestationId;
        callCount++;
    }
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

contract X402InterceptorTest is Test {

    X402Interceptor public interceptor;
    MockARC402Wallet public mockWallet;

    address public usdcToken  = address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48); // canonical USDC addr (mock)
    address public recipient  = address(0xBEEF);
    address public caller     = address(0xCAFE);

    bytes32 constant ATTESTATION_ID = keccak256("intent-001");
    uint256 constant AMOUNT         = 100_000_000; // 100 USDC (6 decimals)
    string  constant REQUEST_URL    = "https://api.example.com/data";

    // ─── Setup ────────────────────────────────────────────────────────────────

    function setUp() public {
        mockWallet  = new MockARC402Wallet();
        interceptor = new X402Interceptor(address(mockWallet), usdcToken);
    }

    // ─── Constructor tests ────────────────────────────────────────────────────

    /// @dev Immutable state set correctly
    function test_constructor_setsImmutables() public view {
        assertEq(interceptor.arc402Wallet(), address(mockWallet));
        assertEq(interceptor.usdcToken(), usdcToken);
    }

    /// @dev Zero wallet address must revert
    function test_constructor_revert_zeroWallet() public {
        vm.expectRevert("X402: zero wallet address");
        new X402Interceptor(address(0), usdcToken);
    }

    /// @dev Zero token address must revert
    function test_constructor_revert_zeroToken() public {
        vm.expectRevert("X402: zero token address");
        new X402Interceptor(address(mockWallet), address(0));
    }

    // ─── executeX402Payment — happy path ─────────────────────────────────────

    /// @dev Happy path: payment routed to mock wallet with correct args
    function test_executeX402Payment_happyPath() public {
        vm.prank(caller);
        interceptor.executeX402Payment(recipient, AMOUNT, ATTESTATION_ID, REQUEST_URL);

        assertEq(mockWallet.lastToken(),         usdcToken);
        assertEq(mockWallet.lastRecipient(),     recipient);
        assertEq(mockWallet.lastAmount(),        AMOUNT);
        assertEq(mockWallet.lastCategory(),      "api_call");
        assertEq(mockWallet.lastAttestationId(), ATTESTATION_ID);
        assertEq(mockWallet.callCount(),         1);
    }

    /// @dev Event is emitted with correct indexed and non-indexed fields
    function test_executeX402Payment_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit X402Interceptor.X402PaymentExecuted(recipient, AMOUNT, ATTESTATION_ID, REQUEST_URL);

        interceptor.executeX402Payment(recipient, AMOUNT, ATTESTATION_ID, REQUEST_URL);
    }

    /// @dev Multiple sequential payments each reach the wallet
    function test_executeX402Payment_multiplePayments() public {
        interceptor.executeX402Payment(recipient, AMOUNT, ATTESTATION_ID, REQUEST_URL);
        interceptor.executeX402Payment(recipient, AMOUNT * 2, keccak256("intent-002"), REQUEST_URL);

        assertEq(mockWallet.callCount(), 2);
        assertEq(mockWallet.lastAmount(), AMOUNT * 2);
    }

    /// @dev Any caller can invoke (no access control on X402Interceptor itself)
    function test_executeX402Payment_anyCallerAllowed() public {
        address[] memory callers = new address[](3);
        callers[0] = address(0x1111);
        callers[1] = address(0x2222);
        callers[2] = address(0x3333);

        for (uint256 i = 0; i < callers.length; i++) {
            vm.prank(callers[i]);
            interceptor.executeX402Payment(recipient, AMOUNT, ATTESTATION_ID, REQUEST_URL);
        }

        assertEq(mockWallet.callCount(), 3);
    }

    /// @dev Zero amount is forwarded (validation is wallet's responsibility)
    function test_executeX402Payment_zeroAmount() public {
        interceptor.executeX402Payment(recipient, 0, ATTESTATION_ID, REQUEST_URL);
        assertEq(mockWallet.lastAmount(), 0);
    }

    /// @dev Empty URL string is valid (audit trail may be empty for direct calls)
    function test_executeX402Payment_emptyUrl() public {
        interceptor.executeX402Payment(recipient, AMOUNT, ATTESTATION_ID, "");
        assertEq(mockWallet.callCount(), 1);
    }

    // ─── executeX402Payment — revert propagation ──────────────────────────────

    /// @dev If the wallet reverts (e.g. policy denied), the error bubbles up
    function test_executeX402Payment_revert_walletReverts() public {
        mockWallet.setRevert(true, "PolicyEngine: spend denied");

        vm.expectRevert(bytes("PolicyEngine: spend denied"));
        interceptor.executeX402Payment(recipient, AMOUNT, ATTESTATION_ID, REQUEST_URL);
    }

    /// @dev Fuzz: payment always forwards amount correctly
    function testFuzz_executeX402Payment_amountForwarded(uint128 amount) public {
        interceptor.executeX402Payment(recipient, uint256(amount), ATTESTATION_ID, REQUEST_URL);
        assertEq(mockWallet.lastAmount(), uint256(amount));
    }

    // ─── Policy enforcement in payment path ───────────────────────────────────

    /**
     * @notice Deploys a mock wallet that enforces a per-tx spending cap, proving that
     *         policy enforcement lives in the payment path and is not bypassed by the
     *         interceptor.
     *
     * Architecture note: X402Interceptor is stateless — it routes every call through
     * arc402Wallet.executeTokenSpend(). Policy validation (spend limits, context checks)
     * is the wallet's responsibility. This test verifies that when a wallet enforces a
     * policy limit, the interceptor faithfully propagates the revert rather than
     * silently succeeding or swallowing the error.
     */
    function test_Interceptor_ChecksPolicyBeforePaying() public {
        // Deploy a policy-enforcing mock wallet with a 0.01 ETH (10_000 USDC-equivalent)
        // per-transaction spending cap.
        uint256 policyMaxPerTx = 0.01 ether; // 10_000_000 in 6-decimal USDC terms; use wei here
        PolicyEnforcingMockWallet policyWallet = new PolicyEnforcingMockWallet(policyMaxPerTx);
        X402Interceptor policyInterceptor = new X402Interceptor(address(policyWallet), usdcToken);

        // Open context on the wallet (required for executeTokenSpend)
        policyWallet.openContext();

        // Amount that exceeds the policy cap
        uint256 overLimit = policyMaxPerTx + 1;

        // The interceptor MUST revert because the wallet rejects the spend
        vm.expectRevert(bytes("PolicyEngine: spend exceeds per-tx limit"));
        policyInterceptor.executeX402Payment(recipient, overLimit, ATTESTATION_ID, REQUEST_URL);

        // Confirm no spend was recorded — policy blocked it before any state change
        assertEq(policyWallet.spendCount(), 0);
    }

    /**
     * @notice Verifies that an inflated price (above the policy limit) causes a clean
     *         revert rather than a partial or silent execution.
     *
     *         This guards against scenarios where a malicious 402 response inflates the
     *         price field. The payment MUST either succeed in full or revert — never
     *         partially execute.
     */
    function test_Interceptor_RejectsInflatedPrice() public {
        uint256 policyMaxPerTx = 100_000_000; // 100 USDC (6 decimals)
        PolicyEnforcingMockWallet policyWallet = new PolicyEnforcingMockWallet(policyMaxPerTx);
        X402Interceptor policyInterceptor = new X402Interceptor(address(policyWallet), usdcToken);
        policyWallet.openContext();

        // Inflated price: 10× the policy limit
        uint256 inflatedPrice = policyMaxPerTx * 10;

        vm.expectRevert(bytes("PolicyEngine: spend exceeds per-tx limit"));
        policyInterceptor.executeX402Payment(recipient, inflatedPrice, ATTESTATION_ID, REQUEST_URL);

        // Wallet untouched — no successful spend recorded
        assertEq(policyWallet.spendCount(), 0);

        // Confirm a valid (within-limit) payment still works
        policyInterceptor.executeX402Payment(recipient, policyMaxPerTx, ATTESTATION_ID, REQUEST_URL);
        assertEq(policyWallet.spendCount(), 1);
    }
}

// ─── Policy-Enforcing Mock Wallet ─────────────────────────────────────────────

/**
 * @notice A mock wallet that mirrors the real ARC402Wallet's policy enforcement
 *         interface. It rejects any spend that exceeds the configured per-tx limit,
 *         exactly as the real PolicyEngine would. Using a mock here keeps the test
 *         isolated from real infrastructure complexity while still proving the
 *         interceptor routes through the wallet's enforcement layer.
 */
contract PolicyEnforcingMockWallet {
    uint256 public immutable maxSpendPerTx;
    bool public contextOpen;
    uint256 public spendCount;

    constructor(uint256 _maxSpendPerTx) {
        maxSpendPerTx = _maxSpendPerTx;
    }

    /// @notice Simulates ARC402Wallet.openContext()
    function openContext() external {
        contextOpen = true;
    }

    /// @notice Mirrors ARC402Wallet.executeTokenSpend() with policy enforcement
    function executeTokenSpend(
        address, /* token */
        address, /* recipient */
        uint256 amount,
        string calldata, /* category */
        bytes32  /* attestationId */
    ) external {
        require(contextOpen, "ARC402: no active context");
        require(amount <= maxSpendPerTx, "PolicyEngine: spend exceeds per-tx limit");
        spendCount++;
    }
}

// ─── Mock USDC for integration tests ─────────────────────────────────────────

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {
        _mint(msg.sender, 1_000_000 * 10**6);
    }
    function decimals() public pure override returns (uint8) { return 6; }
}

// ─── Integration tests: real ARC402Wallet + X402Interceptor authorization ────

/**
 * @notice Tests that verify Fix 1: X402Interceptor can call executeTokenSpend()
 *         after owner calls setAuthorizedInterceptor() on ARC402Wallet.
 *
 *         These tests use a fully-deployed ARC402Wallet (real contracts) to confirm
 *         the authorization path works end-to-end.
 */
contract X402InterceptorAuthorizationTest is Test {
    PolicyEngine        policyEngine;
    TrustRegistry       trustRegistry;
    IntentAttestation   intentAttestation;
    SettlementCoordinator settlementCoordinator;
    ARC402Registry      reg;
    ARC402Wallet        wallet;
    MockUSDC            usdc;
    X402Interceptor     interceptor;

    address walletOwner = address(this);
    address paymentRecipient = address(0xBEEF);
    address unauthorized = address(0xDEAD);

    uint256 constant USDC_AMOUNT = 5_000_000; // 5 USDC
    bytes32 constant CONTEXT_ID  = keccak256("ctx-interceptor-auth");
    bytes32 constant ATTEST_ID   = keccak256("intent-interceptor-auth");
    string  constant REQUEST_URL = "https://api.example.com/endpoint";

    function setUp() public {
        // Deploy full ARC-402 infrastructure
        policyEngine          = new PolicyEngine();
        trustRegistry         = new TrustRegistry();
        intentAttestation     = new IntentAttestation();
        settlementCoordinator = new SettlementCoordinator();
        usdc                  = new MockUSDC();

        reg = new ARC402Registry(
            address(policyEngine),
            address(trustRegistry),
            address(intentAttestation),
            address(settlementCoordinator),
            "v1.0.0"
        );

        // wallet owner = address(this) (the test contract)
        wallet = new ARC402Wallet(address(reg), walletOwner);

        // Allow wallet to update trust registry
        trustRegistry.addUpdater(address(wallet));

        // Fund wallet with USDC
        usdc.transfer(address(wallet), 100_000_000); // 100 USDC

        // Set policy for api_call category — must be called from the wallet (msg.sender = wallet)
        vm.prank(address(wallet));
        policyEngine.setCategoryLimit("api_call", 10_000_000); // 10 USDC max per spend

        // Deploy the interceptor
        interceptor = new X402Interceptor(address(wallet), address(usdc));

        // Create an intent attestation — must be called from the wallet (msg.sender = wallet)
        vm.prank(address(wallet));
        intentAttestation.attest(
            ATTEST_ID,
            "api_call",
            "x402 payment for API access",
            paymentRecipient,
            USDC_AMOUNT,
            address(usdc)
        );

        // Open a context so the wallet allows spending
        wallet.openContext(CONTEXT_ID, "api_access");
    }

    /**
     * @notice CRITICAL FIX TEST: After setAuthorizedInterceptor(), the interceptor
     *         can call executeTokenSpend() and the payment succeeds.
     */
    function test_InterceptorAuthorized_CanSpend() public {
        // Owner authorizes the interceptor
        wallet.setAuthorizedInterceptor(address(interceptor));
        assertEq(wallet.authorizedInterceptor(), address(interceptor));

        uint256 recipientBefore = usdc.balanceOf(paymentRecipient);

        // Interceptor executes the payment — must succeed (not revert)
        interceptor.executeX402Payment(paymentRecipient, USDC_AMOUNT, ATTEST_ID, REQUEST_URL);

        // Verify funds moved to recipient
        assertEq(usdc.balanceOf(paymentRecipient), recipientBefore + USDC_AMOUNT);
    }

    /**
     * @notice Unauthorized callers cannot call executeTokenSpend directly.
     *         Only owner or the authorized interceptor may call it.
     */
    function test_InterceptorUnauthorized_Reverts() public {
        // Interceptor is NOT yet authorized — any call to executeTokenSpend must revert
        vm.prank(unauthorized);
        vm.expectRevert("ARC402: not authorized");
        wallet.executeTokenSpend(
            address(usdc),
            paymentRecipient,
            USDC_AMOUNT,
            "api_call",
            ATTEST_ID
        );
    }

    /**
     * @notice setAuthorizedInterceptor reverts on zero address.
     */
    function test_SetAuthorizedInterceptor_RejectsZeroAddress() public {
        vm.expectRevert("ARC402: zero interceptor");
        wallet.setAuthorizedInterceptor(address(0));
    }

    /**
     * @notice setAuthorizedInterceptor emits InterceptorUpdated event.
     */
    function test_SetAuthorizedInterceptor_EmitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit ARC402Wallet.InterceptorUpdated(address(interceptor));
        wallet.setAuthorizedInterceptor(address(interceptor));
    }
}
