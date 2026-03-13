import { expect } from "chai";
import hre from "hardhat";

describe("TrustRegistry", function () {
  let trustRegistry: any;
  let owner: any;
  let wallet: any;

  beforeEach(async function () {
    [owner, wallet] = await hre.ethers.getSigners();
    const factory = await hre.ethers.getContractFactory("TrustRegistry");
    trustRegistry = await factory.deploy();
    await trustRegistry.waitForDeployment();
  });

  describe("initWallet", function () {
    it("should set initial score to 100", async function () {
      await trustRegistry.initWallet(wallet.address);
      const score = await trustRegistry.getScore(wallet.address);
      expect(score).to.equal(100);
    });

    it("should not reinitialize an already initialized wallet", async function () {
      await trustRegistry.initWallet(wallet.address);
      await trustRegistry.recordSuccess(wallet.address, hre.ethers.ZeroAddress, "", 0);
      await trustRegistry.initWallet(wallet.address);
      const score = await trustRegistry.getScore(wallet.address);
      expect(score).to.equal(105);
    });
  });

  describe("recordSuccess", function () {
    it("should increment score by 5", async function () {
      await trustRegistry.initWallet(wallet.address);
      await trustRegistry.recordSuccess(wallet.address, hre.ethers.ZeroAddress, "", 0);
      const score = await trustRegistry.getScore(wallet.address);
      expect(score).to.equal(105);
    });

    it("should not exceed 1000", async function () {
      await trustRegistry.initWallet(wallet.address);
      for (let i = 0; i < 200; i++) {
        await trustRegistry.recordSuccess(wallet.address, hre.ethers.ZeroAddress, "", 0);
      }
      const score = await trustRegistry.getScore(wallet.address);
      expect(score).to.equal(1000);
    });

    it("should only be callable by authorized updater", async function () {
      await trustRegistry.initWallet(wallet.address);
      await expect(
        trustRegistry.connect(wallet).recordSuccess(wallet.address, hre.ethers.ZeroAddress, "", 0)
      ).to.be.revertedWith("TrustRegistry: not authorized updater");
    });
  });

  describe("recordAnomaly", function () {
    it("should decrement score by 20", async function () {
      await trustRegistry.initWallet(wallet.address);
      await trustRegistry.recordAnomaly(wallet.address, hre.ethers.ZeroAddress, "", 0);
      const score = await trustRegistry.getScore(wallet.address);
      expect(score).to.equal(80);
    });

    it("should not go below 0", async function () {
      await trustRegistry.initWallet(wallet.address);
      for (let i = 0; i < 10; i++) {
        await trustRegistry.recordAnomaly(wallet.address, hre.ethers.ZeroAddress, "", 0);
      }
      const score = await trustRegistry.getScore(wallet.address);
      expect(score).to.equal(0);
    });
  });

  describe("trust levels", function () {
    it("score 0-99 should be probationary", async function () {
      await trustRegistry.initWallet(wallet.address);
      for (let i = 0; i < 5; i++) {
        await trustRegistry.recordAnomaly(wallet.address, hre.ethers.ZeroAddress, "", 0);
      }
      const level = await trustRegistry.getTrustLevel(wallet.address);
      expect(level).to.equal("probationary");
    });

    it("score 100-299 should be restricted", async function () {
      await trustRegistry.initWallet(wallet.address);
      const level = await trustRegistry.getTrustLevel(wallet.address);
      expect(level).to.equal("restricted");
    });

    it("score 300-599 should be standard", async function () {
      await trustRegistry.initWallet(wallet.address);
      for (let i = 0; i < 40; i++) {
        await trustRegistry.recordSuccess(wallet.address, hre.ethers.ZeroAddress, "", 0);
      }
      const score = await trustRegistry.getScore(wallet.address);
      expect(score).to.be.gte(300);
      const level = await trustRegistry.getTrustLevel(wallet.address);
      expect(level).to.equal("standard");
    });
  });

  describe("addUpdater / removeUpdater", function () {
    it("should allow owner to add updaters", async function () {
      await trustRegistry.addUpdater(wallet.address);
      expect(await trustRegistry.isAuthorizedUpdater(wallet.address)).to.be.true;
    });

    it("should allow owner to remove updaters", async function () {
      await trustRegistry.addUpdater(wallet.address);
      await trustRegistry.removeUpdater(wallet.address);
      expect(await trustRegistry.isAuthorizedUpdater(wallet.address)).to.be.false;
    });

    it("should not allow non-owner to add updaters", async function () {
      await expect(
        trustRegistry.connect(wallet).addUpdater(wallet.address)
      ).to.be.revertedWithCustomError(trustRegistry, "OwnableUnauthorizedAccount");
    });
  });
});
