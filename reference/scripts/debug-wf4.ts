import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const feeData = await ethers.provider.getFeeData();
  const GP = (feeData.gasPrice ?? 6000000n) * 2n;
  const WF_ADDR = "0xbC73FBf023fc34b18a33D201e1ba339986EcE0Ee";
  const wf = await ethers.getContractAt("WalletFactory", WF_ADDR, deployer);

  // Try to deploy from the b1c address (already has ETH, nonce=1)
  const b1cKey = "0x"; // we don't have the key
  
  // Instead, let's try from deployer directly to see if it works
  let dNonce = await ethers.provider.getTransactionCount(deployer.address, "pending");
  console.log("Deployer nonce:", dNonce);
  
  console.log("Trying createWallet from deployer...");
  try {
    const tx = await wf.connect(deployer).createWallet({ nonce: dNonce++, gasPrice: GP, gasLimit: 800000n });
    const receipt = await tx.wait(1);
    console.log("SUCCESS! gasUsed:", receipt.gasUsed.toString(), "hash:", receipt.hash);
    // Parse WalletCreated event
    for (const log of receipt.logs) {
      try {
        const p = wf.interface.parseLog({ topics: log.topics, data: log.data });
        if (p?.name === "WalletCreated") {
          console.log("  owner:", p.args[0]);
          console.log("  wallet:", p.args[1]);
        }
      } catch {}
    }
  } catch(e: any) {
    console.log("FAILED:", e.message?.slice(0, 200));
    const errData = (e as any).data ?? (e as any).info?.error?.data ?? "n/a";
    console.log("error data:", errData);
    
    // Try to estimate gas to see if the error is gas-related
    try {
      const gas = await wf.createWallet.estimateGas();
      console.log("estimateGas:", gas.toString());
    } catch(e2: any) {
      console.log("estimateGas failed:", e2.message?.slice(0, 200));
      const d2 = (e2 as any).data ?? (e2 as any).info?.error?.data ?? "n/a";
      console.log("estimateGas error data:", d2);
    }
  }
}

main().catch(e => { console.error(e.message?.slice(0, 300)); process.exit(1); });
