import { expect } from "chai";
import hre from "hardhat";

describe("SettlementCoordinator", function () {
  let coordinator: any;
  let fromWallet: any;
  let toWallet: any;
  let intentId: string;
  let expiresAt: number;

  beforeEach(async function () {
    [fromWallet, toWallet] = await hre.ethers.getSigners();
    const factory = await hre.ethers.getContractFactory("SettlementCoordinator");
    coordinator = await factory.deploy();
    await coordinator.waitForDeployment();
    intentId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("intent-1"));
    expiresAt = Math.floor(Date.now() / 1000) + 3600;
  });

  describe("propose", function () {
    it("should create a proposal", async function () {
      const tx = await coordinator.propose(
        fromWallet.address,
        toWallet.address,
        hre.ethers.parseEther("0.5"),
        hre.ethers.ZeroAddress,
        intentId,
        expiresAt
      );
      const receipt = await tx.wait();
      expect(receipt).to.not.be.null;
    });

    it("should emit ProposalCreated event", async function () {
      await expect(
        coordinator.propose(
          fromWallet.address,
          toWallet.address,
          hre.ethers.parseEther("0.5"),
          hre.ethers.ZeroAddress,
          intentId,
          expiresAt
        )
      ).to.emit(coordinator, "ProposalCreated");
    });
  });

  describe("accept", function () {
    let proposalId: string;

    beforeEach(async function () {
      const tx = await coordinator.propose(
        fromWallet.address,
        toWallet.address,
        hre.ethers.parseEther("0.5"),
        hre.ethers.ZeroAddress,
        intentId,
        expiresAt
      );
      const receipt = await tx.wait();
      const iface = new hre.ethers.Interface([
        "event ProposalCreated(bytes32 indexed proposalId, address indexed from, address indexed to, uint256 amount, address token)",
      ]);
      for (const log of receipt!.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === "ProposalCreated") {
            proposalId = parsed.args.proposalId;
          }
        } catch {}
      }
    });

    it("should allow toWallet to accept", async function () {
      await expect(coordinator.connect(toWallet).accept(proposalId))
        .to.emit(coordinator, "ProposalAccepted")
        .withArgs(proposalId);
    });

    it("should not allow fromWallet to accept", async function () {
      await expect(
        coordinator.connect(fromWallet).accept(proposalId)
      ).to.be.revertedWith("SettlementCoordinator: not recipient");
    });
  });

  describe("reject", function () {
    let proposalId: string;

    beforeEach(async function () {
      const tx = await coordinator.propose(
        fromWallet.address,
        toWallet.address,
        hre.ethers.parseEther("0.5"),
        hre.ethers.ZeroAddress,
        intentId,
        expiresAt
      );
      const receipt = await tx.wait();
      const iface = new hre.ethers.Interface([
        "event ProposalCreated(bytes32 indexed proposalId, address indexed from, address indexed to, uint256 amount, address token)",
      ]);
      for (const log of receipt!.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === "ProposalCreated") {
            proposalId = parsed.args.proposalId;
          }
        } catch {}
      }
    });

    it("should allow toWallet to reject with reason", async function () {
      await expect(
        coordinator.connect(toWallet).reject(proposalId, "SENDER_TRUST_INSUFFICIENT")
      )
        .to.emit(coordinator, "ProposalRejected")
        .withArgs(proposalId, "SENDER_TRUST_INSUFFICIENT");
    });
  });

  describe("execute", function () {
    let proposalId: string;
    const amount = hre.ethers.parseEther("0.5");

    beforeEach(async function () {
      const tx = await coordinator.propose(
        fromWallet.address,
        toWallet.address,
        amount,
        hre.ethers.ZeroAddress,
        intentId,
        expiresAt
      );
      const receipt = await tx.wait();
      const iface = new hre.ethers.Interface([
        "event ProposalCreated(bytes32 indexed proposalId, address indexed from, address indexed to, uint256 amount, address token)",
      ]);
      for (const log of receipt!.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === "ProposalCreated") {
            proposalId = parsed.args.proposalId;
          }
        } catch {}
      }
      await coordinator.connect(toWallet).accept(proposalId);
    });

    it("should execute and transfer funds", async function () {
      const balBefore = await hre.ethers.provider.getBalance(toWallet.address);
      await coordinator.connect(fromWallet).execute(proposalId, { value: amount });
      const balAfter = await hre.ethers.provider.getBalance(toWallet.address);
      expect(balAfter - balBefore).to.equal(amount);
    });

    it("should emit ProposalExecuted", async function () {
      await expect(
        coordinator.connect(fromWallet).execute(proposalId, { value: amount })
      )
        .to.emit(coordinator, "ProposalExecuted")
        .withArgs(proposalId, amount);
    });

    it("should not allow double execution", async function () {
      await coordinator.connect(fromWallet).execute(proposalId, { value: amount });
      await expect(
        coordinator.connect(fromWallet).execute(proposalId, { value: amount })
      ).to.be.revertedWith("SettlementCoordinator: not accepted");
    });
  });
});
