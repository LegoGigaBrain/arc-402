import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  const feeData = await ethers.provider.getFeeData();
  const GP = (feeData.gasPrice ?? 6000000n) * 2n;
  let dNonce = await ethers.provider.getTransactionCount(deployer.address, "pending");

  // Try deploying ARC402Wallet directly (not via factory) to see if it works
  const REG_ADDR = "0x92E71f040742EBF7819b082cc3AAF8c611f3C281";
  const walletFactory = await ethers.getContractFactory("ARC402Wallet");
  
  try {
    console.log("Deploying ARC402Wallet directly with deployer as owner...");
    const w = await walletFactory.deploy(REG_ADDR, deployer.address, {
      nonce: dNonce++, gasPrice: GP, gasLimit: 2000000n
    });
    const receipt = await w.deploymentTransaction()?.wait(1);
    console.log("SUCCESS! Wallet at:", await w.getAddress(), "tx:", receipt?.hash);
  } catch (e: any) {
    console.log("FAILED:", e.message?.slice(0, 200));
    console.log("data:", (e as any).data);
    console.log("errorName:", (e as any).errorName);
  }
}
main().catch(e => { console.error(e.message?.slice(0,300)); process.exit(1); });
