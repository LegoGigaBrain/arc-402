import { ethers } from "hardhat";
async function main() {
  const [deployer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(deployer.address);
  const pending = await ethers.provider.getTransactionCount(deployer.address, "pending");
  const latest  = await ethers.provider.getTransactionCount(deployer.address, "latest");
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(bal), "ETH");
  console.log("Nonce (latest):", latest, "  nonce (pending):", pending);
}
main().catch(console.error);
