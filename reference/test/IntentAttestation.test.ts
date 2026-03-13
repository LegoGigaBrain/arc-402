import { expect } from "chai";
import hre from "hardhat";

describe("IntentAttestation", function () {
  let attestation: any;
  let owner: any;
  let other: any;
  let attestationId: string;

  beforeEach(async function () {
    [owner, other] = await hre.ethers.getSigners();
    const factory = await hre.ethers.getContractFactory("IntentAttestation");
    attestation = await factory.deploy();
    await attestation.waitForDeployment();
    attestationId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("test-attestation-1"));
  });

  describe("attest", function () {
    it("should create an attestation", async function () {
      await attestation.attest(
        attestationId,
        "pay_for_data",
        "Need medical records for claim #4821",
        other.address,
        hre.ethers.parseEther("0.01"),
        hre.ethers.ZeroAddress,
        0
      );

      const [id, wallet, action, reason, recipient, amount] =
        await attestation.getAttestation(attestationId);
      expect(id).to.equal(attestationId);
      expect(wallet).to.equal(owner.address);
      expect(action).to.equal("pay_for_data");
      expect(reason).to.include("claim #4821");
      expect(recipient).to.equal(other.address);
      expect(amount).to.equal(hre.ethers.parseEther("0.01"));
    });

    it("should emit AttestationCreated event", async function () {
      await expect(
        attestation.attest(
          attestationId,
          "pay_for_api",
          "Research data",
          other.address,
          hre.ethers.parseEther("0.005"),
          hre.ethers.ZeroAddress,
          0
        )
      )
        .to.emit(attestation, "AttestationCreated")
        .withArgs(
          attestationId,
          owner.address,
          "pay_for_api",
          other.address,
          hre.ethers.parseEther("0.005"),
          hre.ethers.ZeroAddress,
          0
        );
    });

    it("should be immutable — cannot attest same ID twice", async function () {
      await attestation.attest(
        attestationId,
        "action1",
        "reason1",
        other.address,
        hre.ethers.parseEther("0.01"),
        hre.ethers.ZeroAddress,
        0
      );
      await expect(
        attestation.attest(
          attestationId,
          "action2",
          "reason2",
          other.address,
          hre.ethers.parseEther("0.01"),
          hre.ethers.ZeroAddress,
          0
        )
      ).to.be.revertedWith("IntentAttestation: already exists");
    });
  });

  describe("verify", function () {
    it("should return true for valid attestation", async function () {
      await attestation.attest(
        attestationId,
        "action",
        "reason",
        other.address,
        hre.ethers.parseEther("0.01"),
        hre.ethers.ZeroAddress,
        0
      );
      expect(
        await attestation.verify(
          attestationId,
          owner.address,
          other.address,
          hre.ethers.parseEther("0.01"),
          hre.ethers.ZeroAddress
        )
      ).to.be.true;
    });

    it("should return false for wrong wallet address", async function () {
      await attestation.attest(
        attestationId,
        "action",
        "reason",
        other.address,
        hre.ethers.parseEther("0.01"),
        hre.ethers.ZeroAddress,
        0
      );
      expect(
        await attestation.verify(
          attestationId,
          other.address,
          other.address,
          hre.ethers.parseEther("0.01"),
          hre.ethers.ZeroAddress
        )
      ).to.be.false;
    });

    it("should return false for non-existent attestation", async function () {
      const fakeId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("fake"));
      expect(
        await attestation.verify(
          fakeId,
          owner.address,
          other.address,
          hre.ethers.parseEther("0.01"),
          hre.ethers.ZeroAddress
        )
      ).to.be.false;
    });
  });
});
