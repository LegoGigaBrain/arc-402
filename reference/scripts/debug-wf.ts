import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const wf = await ethers.getContractAt("WalletFactory", "0xbC73FBf023fc34b18a33D201e1ba339986EcE0Ee", deployer);
  const total = await wf.totalWallets();
  console.log("Total wallets:", total.toString());
  
  const testWallet = ethers.Wallet.createRandom().connect(ethers.provider);
  console.log("Test wallet:", testWallet.address);
  
  try {
    const result = await wf.createWallet.staticCall({ from: testWallet.address });
    console.log("Static call OK, predicted wallet:", result);
  } catch(e: any) {
    console.log("Static call FAILED:", e.message?.slice(0, 200));
    console.log("errorName:", (e as any).errorName);
    console.log("data:", (e as any).data);
  }
  
  // Try with deployer directly
  try {
    const result2 = await wf.createWallet.staticCall();
    console.log("Static call (deployer) OK:", result2);
    
    // Check if PolicyEngine already has this address
    const pe = await ethers.getContractAt("PolicyEngine", "0x44102e70c2A366632d98Fe40d892a2501fC7fFF2", deployer);
    const owner = await pe.walletOwners(result2);
    console.log("walletOwners[predicted]:", owner, "(zero = not registered)");
  } catch(e: any) {
    console.log("Static call (deployer) FAILED:", e.message?.slice(0, 200));
    console.log("errorName:", (e as any).errorName);
  }
}

main().catch(e => { console.error(e.message?.slice(0, 300)); process.exit(1); });
