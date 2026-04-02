import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const feeData = await ethers.provider.getFeeData();
  const GP = (feeData.gasPrice ?? 6000000n) * 2n;
  let dNonce = await ethers.provider.getTransactionCount(deployer.address, "pending");

  const REG_ADDR = "0x92E71f040742EBF7819b082cc3AAF8c611f3C281";
  const PE_ADDR  = "0x44102e70c2A366632d98Fe40d892a2501fC7fFF2";
  const TR_ADDR  = "0xceb1c0Ca8B72Cc00cA4eac444a5a2e5716339cBf";

  const pe = await ethers.getContractAt("PolicyEngine", PE_ADDR, deployer);
  const tr = await ethers.getContractAt("TrustRegistryV3", TR_ADDR, deployer);

  // Try: deployerIsUpdater on TR?
  const isDeployerUpdater = await tr.isAuthorizedUpdater(deployer.address);
  console.log("deployer isAuthorizedUpdater:", isDeployerUpdater);

  // The WalletFactory needs to be an updater to call initWallet
  const WF_ADDR = "0xbC73FBf023fc34b18a33D201e1ba339986EcE0Ee";
  const isWFUpdater = await tr.isAuthorizedUpdater(WF_ADDR);
  console.log("WalletFactory isAuthorizedUpdater:", isWFUpdater);

  // What is the predicted wallet address (WalletFactory nonce=2)?
  const predicted = ethers.getCreateAddress({ from: WF_ADDR, nonce: 2 });
  console.log("Predicted wallet (WF nonce=2):", predicted);

  // Try: what does staticCall from deployer return?
  const wf = await ethers.getContractAt("WalletFactory", WF_ADDR, deployer);
  try {
    const r = await wf.createWallet.staticCall();
    console.log("staticCall from deployer OK:", r);
    console.log("  matches predicted:", r.toLowerCase() === predicted.toLowerCase());
  } catch(e: any) {
    console.log("staticCall FAIL:", e.message?.slice(0,150));
  }

  // Check if PolicyEngine has the predicted wallet as already-registered
  const existingOwner = await pe.walletOwners(predicted);
  console.log("PE.walletOwners[predicted]:", existingOwner);

  // Try a fresh test EOA to simulate what b1c does
  const testEOA = new ethers.Wallet("0x0000000000000000000000000000000000000000000000000000000000000001", ethers.provider);
  console.log("\nTest EOA (key=1):", testEOA.address);
  
  // Fund test EOA slightly
  console.log("Funding test EOA...");
  const fundTx = await deployer.sendTransaction({
    to: testEOA.address, value: ethers.parseEther("0.001"),
    nonce: dNonce++, gasPrice: GP, gasLimit: 21000n
  });
  await fundTx.wait(1);
  console.log("Funded.");

  // Now try createWallet from test EOA
  try {
    const r2 = await wf.createWallet.staticCall({ from: testEOA.address });
    console.log("staticCall from testEOA OK:", r2);
  } catch(e: any) {
    console.log("staticCall from testEOA FAIL:", e.message?.slice(0,150));
  }

  // Actual tx from testEOA
  try {
    const tx = await wf.connect(testEOA).createWallet({ nonce: 0, gasPrice: GP, gasLimit: 800000n });
    const receipt = await tx.wait(1);
    console.log("createWallet from testEOA TX: SUCCESS!", receipt.hash, "gasUsed:", receipt.gasUsed.toString());
  } catch(e: any) {
    console.log("createWallet from testEOA TX FAIL:", e.message?.slice(0,200));
    const errData = (e as any).data ?? (e as any).info?.error?.data ?? "n/a";
    console.log("error data:", errData);
  }
}
main().catch(e => { console.error(e.message?.slice(0,300)); process.exit(1); });
