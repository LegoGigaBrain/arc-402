import { Command } from "commander";
import { PolicyClient, TrustClient } from "@arc402/sdk";
import { ethers } from "ethers";
import { getUsdcAddress, loadConfig } from "../config";
import { getClient, requireSigner } from "../client";
import { getTrustTier } from "../utils/format";

export function registerWalletCommands(program: Command): void {
  const wallet = program.command("wallet").description("Wallet utilities");
  wallet.command("status").option("--json").action(async (opts) => {
    const config = loadConfig(); const { provider, address } = await getClient(config); if (!address) throw new Error("No wallet configured");
    const usdcAddress = getUsdcAddress(config); const usdc = new ethers.Contract(usdcAddress, ["function balanceOf(address owner) external view returns (uint256)"], provider);
    const trust = new TrustClient(config.trustRegistryAddress, provider); const [ethBalance, usdcBalance, score] = await Promise.all([provider.getBalance(address), usdc.balanceOf(address), trust.getScore(address)]);
    const payload = { address, network: config.network, ethBalance: ethers.formatEther(ethBalance), usdcBalance: (Number(usdcBalance) / 1e6).toFixed(2), trustScore: score.score, trustTier: getTrustTier(score.score) };
    console.log(opts.json ? JSON.stringify(payload, null, 2) : `${payload.address}\nETH=${payload.ethBalance}\nUSDC=${payload.usdcBalance}\nTrust=${payload.trustScore} ${payload.trustTier}`);
  });

  wallet.command("freeze <walletAddress>")
    .description("Freeze spend for a wallet. Callable by the wallet, its owner, or an authorized freeze agent. Use immediately if suspicious activity is detected.")
    .action(async (walletAddress, _opts) => {
      const config = loadConfig();
      if (!config.policyEngineAddress) throw new Error("policyEngineAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new PolicyClient(config.policyEngineAddress, signer);
      await client.freezeSpend(walletAddress);
      console.log(`wallet ${walletAddress} spend frozen`);
    });

  wallet.command("unfreeze <walletAddress>")
    .description("Unfreeze spend for a wallet. Only callable by the wallet or its registered owner.")
    .action(async (walletAddress, _opts) => {
      const config = loadConfig();
      if (!config.policyEngineAddress) throw new Error("policyEngineAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new PolicyClient(config.policyEngineAddress, signer);
      await client.unfreeze(walletAddress);
      console.log(`wallet ${walletAddress} spend unfrozen`);
    });
}
