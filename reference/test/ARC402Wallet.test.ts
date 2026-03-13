import { expect } from "chai";
import hre from "hardhat";

describe("ARC402Wallet", function () {
  let wallet: any;
  let policyEngine: any;
  let trustRegistry: any;
  let intentAttestation: any;
  let settlementCoordinator: any;
  let registry: any;
  let owner: any;
  let recipient: any;

  beforeEach(async function () {
    [owner, recipient] = await hre.ethers.getSigners();

    const PolicyEngine = await hre.ethers.getContractFactory("PolicyEngine");
    policyEngine = await PolicyEngine.deploy();
    await policyEngine.waitForDeployment();

    const TrustRegistry = await hre.ethers.getContractFactory("TrustRegistry");
    trustRegistry = await TrustRegistry.deploy();
    await trustRegistry.waitForDeployment();

    const IntentAttestation = await hre.ethers.getContractFactory("IntentAttestation");
    intentAttestation = await IntentAttestation.deploy();
    await intentAttestation.waitForDeployment();

    const SettlementCoordinator = await hre.ethers.getContractFactory("SettlementCoordinator");
    settlementCoordinator = await SettlementCoordinator.deploy();
    await settlementCoordinator.waitForDeployment();

    const ARC402Registry = await hre.ethers.getContractFactory("ARC402Registry");
    registry = await ARC402Registry.deploy(
      await policyEngine.getAddress(),
      await trustRegistry.getAddress(),
      await intentAttestation.getAddress(),
      await settlementCoordinator.getAddress(),
      "v1"
    );
    await registry.waitForDeployment();

    const ARC402Wallet = await hre.ethers.getContractFactory("ARC402Wallet");
    wallet = await ARC402Wallet.deploy(
      await registry.getAddress(),
      owner.address
    );
    await wallet.waitForDeployment();

    await trustRegistry.addUpdater(await wallet.getAddress());

    // Register wallet with PolicyEngine (must be called by the wallet itself)
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [await wallet.getAddress()],
    });
    await hre.network.provider.send("hardhat_setBalance", [
      await wallet.getAddress(),
      "0x1000000000000000000",
    ]);
    const walletSigner = await hre.ethers.getSigner(await wallet.getAddress());
    await policyEngine.connect(walletSigner).registerWallet(await wallet.getAddress(), owner.address);
    await policyEngine.connect(walletSigner).setCategoryLimitFor(
      await wallet.getAddress(),
      "compute",
      hre.ethers.parseEther("1")
    );
    await hre.network.provider.request({
      method: "hardhat_stopImpersonatingAccount",
      params: [await wallet.getAddress()],
    });

    await owner.sendTransaction({
      to: await wallet.getAddress(),
      value: hre.ethers.parseEther("5"),
    });
  });

  describe("openContext / closeContext", function () {
    it("should open a context", async function () {
      const contextId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("ctx1"));
      const tx = await wallet.openContext(contextId, "research");
      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1);
      const [, , , isOpen] = await wallet.getActiveContext();
      expect(isOpen).to.be.true;
    });

    it("should not allow opening a context when one is already open", async function () {
      const contextId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("ctx1"));
      await wallet.openContext(contextId, "research");
      await expect(
        wallet.openContext(hre.ethers.keccak256(hre.ethers.toUtf8Bytes("ctx2")), "research")
      ).to.be.revertedWith("ARC402: context already open");
    });

    it("should close a context", async function () {
      const contextId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("ctx1"));
      await wallet.openContext(contextId, "research");

      const tx = await wallet.closeContext();
      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1);

      const [, , , isOpen] = await wallet.getActiveContext();
      expect(isOpen).to.be.false;
    });
  });

  describe("executeSpend", function () {
    it("should execute a valid spend", async function () {
      const contextId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("ctx1"));
      await wallet.openContext(contextId, "research");

      const attestationId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("att1"));

      await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [await wallet.getAddress()],
      });
      await hre.network.provider.send("hardhat_setBalance", [
        await wallet.getAddress(),
        "0x1000000000000000000",
      ]);
      const walletSigner = await hre.ethers.getSigner(await wallet.getAddress());
      await intentAttestation.connect(walletSigner).attest(
        attestationId,
        "pay_for_data",
        "Need research data",
        recipient.address,
        hre.ethers.parseEther("0.1"),
        hre.ethers.ZeroAddress,
        0
      );
      await hre.network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [await wallet.getAddress()],
      });

      const balBefore = await hre.ethers.provider.getBalance(recipient.address);
      await expect(
        wallet.executeSpend(
          recipient.address,
          hre.ethers.parseEther("0.1"),
          "compute",
          attestationId
        )
      ).to.emit(wallet, "SpendExecuted");

      const balAfter = await hre.ethers.provider.getBalance(recipient.address);
      expect(balAfter - balBefore).to.equal(hre.ethers.parseEther("0.1"));
    });

    it("should reject spend exceeding policy limit", async function () {
      const contextId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("ctx1"));
      await wallet.openContext(contextId, "research");

      const attestationId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("att2"));
      await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [await wallet.getAddress()],
      });
      await hre.network.provider.send("hardhat_setBalance", [
        await wallet.getAddress(),
        "0x10000000000000000000",
      ]);
      const walletSigner = await hre.ethers.getSigner(await wallet.getAddress());
      await intentAttestation.connect(walletSigner).attest(
        attestationId,
        "pay_for_data",
        "Too expensive",
        recipient.address,
        hre.ethers.parseEther("2"),
        hre.ethers.ZeroAddress,
        0
      );
      await hre.network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [await wallet.getAddress()],
      });

      await expect(
        wallet.executeSpend(
          recipient.address,
          hre.ethers.parseEther("2"),
          "compute",
          attestationId
        )
      ).to.be.revertedWith("PolicyEngine: amount exceeds per-tx limit");
    });

    it("should reject spend without open context", async function () {
      const attestationId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("att3"));
      await expect(
        wallet.executeSpend(recipient.address, hre.ethers.parseEther("0.1"), "compute", attestationId)
      ).to.be.revertedWith("ARC402: no active context");
    });
  });
});
