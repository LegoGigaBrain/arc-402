import { Command } from "commander";
import { PolicyClient, TrustClient } from "@arc402/sdk";
import { ethers } from "ethers";
import { Arc402Config, getConfigPath, getUsdcAddress, loadConfig, NETWORK_DEFAULTS, saveConfig } from "../config";
import { getClient, requireSigner } from "../client";
import { getTrustTier } from "../utils/format";
import { ARC402_WALLET_GUARDIAN_ABI, POLICY_ENGINE_LIMITS_ABI, WALLET_FACTORY_ABI } from "../abis";
import { requestPhoneWalletSignature } from "../walletconnect";

const POLICY_ENGINE_DEFAULT = "0x44102e70c2A366632d98Fe40d892a2501fC7fFF2";

function parseAmount(raw: string): bigint {
  const lower = raw.toLowerCase();
  if (lower.endsWith("eth")) {
    return ethers.parseEther(lower.slice(0, -3).trim());
  }
  return BigInt(raw);
}

export function registerWalletCommands(program: Command): void {
  const wallet = program.command("wallet").description("Wallet utilities");

  // ─── status ────────────────────────────────────────────────────────────────

  wallet.command("status").description("Show address, balances, contract wallet, and trust score").option("--json").action(async (opts) => {
    const config = loadConfig();
    const { provider, address } = await getClient(config);
    if (!address) throw new Error("No wallet configured");
    const usdcAddress = getUsdcAddress(config);
    const usdc = new ethers.Contract(usdcAddress, ["function balanceOf(address owner) external view returns (uint256)"], provider);
    const trust = new TrustClient(config.trustRegistryAddress, provider);
    const [ethBalance, usdcBalance, score] = await Promise.all([
      provider.getBalance(address),
      usdc.balanceOf(address),
      trust.getScore(address),
    ]);
    const payload = {
      address,
      network: config.network,
      ethBalance: ethers.formatEther(ethBalance),
      usdcBalance: (Number(usdcBalance) / 1e6).toFixed(2),
      trustScore: score.score,
      trustTier: getTrustTier(score.score),
      walletContractAddress: config.walletContractAddress ?? null,
    };
    if (opts.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`${payload.address}\nETH=${payload.ethBalance}\nUSDC=${payload.usdcBalance}\nTrust=${payload.trustScore} ${payload.trustTier}`);
      if (payload.walletContractAddress) console.log(`Contract=${payload.walletContractAddress}`);
    }
  });

  // ─── new ───────────────────────────────────────────────────────────────────

  wallet.command("new")
    .description("Generate a fresh keypair and save to config")
    .option("--network <network>", "Network (base-mainnet or base-sepolia)", "base-sepolia")
    .action(async (opts) => {
      const network = opts.network as "base-mainnet" | "base-sepolia";
      const defaults = NETWORK_DEFAULTS[network];
      if (!defaults) {
        console.error(`Unknown network: ${network}. Use base-mainnet or base-sepolia.`);
        process.exit(1);
      }
      const generated = ethers.Wallet.createRandom();
      const config: Arc402Config = {
        network,
        rpcUrl: defaults.rpcUrl!,
        privateKey: generated.privateKey,
        trustRegistryAddress: defaults.trustRegistryAddress!,
        walletFactoryAddress: defaults.walletFactoryAddress,
      };
      saveConfig(config);
      console.log(`Address: ${generated.address}`);
      console.log(`Config saved to ${getConfigPath()}`);
      console.log(`Next: fund your wallet with ETH, then run: arc402 wallet deploy`);
    });

  // ─── import ────────────────────────────────────────────────────────────────

  wallet.command("import <privateKey>")
    .description("Import an existing private key")
    .option("--network <network>", "Network (base-mainnet or base-sepolia)", "base-sepolia")
    .action(async (privateKey, opts) => {
      const network = opts.network as "base-mainnet" | "base-sepolia";
      const defaults = NETWORK_DEFAULTS[network];
      if (!defaults) {
        console.error(`Unknown network: ${network}. Use base-mainnet or base-sepolia.`);
        process.exit(1);
      }
      let imported: ethers.Wallet;
      try {
        imported = new ethers.Wallet(privateKey);
      } catch {
        console.error("Invalid private key. Must be a 0x-prefixed hex string.");
        process.exit(1);
      }
      const config: Arc402Config = {
        network,
        rpcUrl: defaults.rpcUrl!,
        privateKey: imported.privateKey,
        trustRegistryAddress: defaults.trustRegistryAddress!,
        walletFactoryAddress: defaults.walletFactoryAddress,
      };
      saveConfig(config);
      console.log(`Address: ${imported.address}`);
      console.log(`Config saved to ${getConfigPath()}`);
      console.warn(`WARN: Store your private key safely — anyone with it controls your wallet`);
    });

  // ─── fund ──────────────────────────────────────────────────────────────────

  wallet.command("fund")
    .description("Show how to get ETH onto your wallet")
    .action(async () => {
      const config = loadConfig();
      const { provider, address } = await getClient(config);
      if (!address) throw new Error("No wallet configured");
      const ethBalance = await provider.getBalance(address);
      console.log(`\nYour wallet address:\n  ${address}`);
      console.log(`\nCurrent balance: ${ethers.formatEther(ethBalance)} ETH`);
      console.log(`\nFunding options:`);
      console.log(`  Bridge (Base mainnet): https://bridge.base.org`);
      console.log(`  Coinbase: If you use Coinbase, you can withdraw directly to Base mainnet`);
      if (config.network === "base-sepolia") {
        console.log(`  Testnet faucet: https://www.alchemy.com/faucets/base-sepolia`);
      }
    });

  // ─── balance ───────────────────────────────────────────────────────────────

  wallet.command("balance")
    .description("Check ETH balance on Base")
    .option("--json")
    .action(async (opts) => {
      const config = loadConfig();
      const { provider, address } = await getClient(config);
      if (!address) throw new Error("No wallet configured");
      const ethBalance = await provider.getBalance(address);
      const formatted = ethers.formatEther(ethBalance);
      if (opts.json) {
        console.log(JSON.stringify({ address, balance: formatted, balanceWei: ethBalance.toString() }));
      } else {
        console.log(`Balance: ${formatted} ETH`);
      }
    });

  // ─── deploy ────────────────────────────────────────────────────────────────

  wallet.command("deploy")
    .description("Deploy ARC402Wallet contract via WalletFactory (phone wallet signs via WalletConnect)")
    .action(async () => {
      const config = loadConfig();
      const factoryAddress = config.walletFactoryAddress ?? NETWORK_DEFAULTS[config.network]?.walletFactoryAddress;
      if (!factoryAddress) {
        console.error("walletFactoryAddress not found in config or NETWORK_DEFAULTS. Add walletFactoryAddress to your config.");
        process.exit(1);
      }
      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const factoryInterface = new ethers.Interface(WALLET_FACTORY_ABI);

      if (config.walletConnectProjectId) {
        const { txHash, account } = await requestPhoneWalletSignature(
          config.walletConnectProjectId,
          chainId,
          (ownerAccount) => ({
            to: factoryAddress,
            data: factoryInterface.encodeFunctionData("createWallet", [ownerAccount]),
            value: "0x0",
          }),
          "Approve ARC402Wallet deployment — you will be set as owner"
        );
        console.log(`\nTransaction submitted: ${txHash}`);
        console.log("Waiting for confirmation...");
        const receipt = await provider.waitForTransaction(txHash);
        if (!receipt) {
          console.error("Transaction not confirmed. Check on-chain.");
          process.exit(1);
        }
        let walletAddress: string | null = null;
        const factoryContract = new ethers.Contract(factoryAddress, WALLET_FACTORY_ABI, provider);
        for (const log of receipt.logs) {
          try {
            const parsed = factoryContract.interface.parseLog(log);
            if (parsed?.name === "WalletCreated") {
              walletAddress = parsed.args.wallet as string;
              break;
            }
          } catch { /* skip unparseable logs */ }
        }
        if (!walletAddress) {
          console.error("Could not find WalletCreated event in receipt. Check the transaction on-chain.");
          process.exit(1);
        }
        config.walletContractAddress = walletAddress;
        config.ownerAddress = account;
        saveConfig(config);
        console.log(`ARC402Wallet deployed at: ${walletAddress}`);
        console.log(`Owner: ${account} (your phone wallet)`);
        console.log(`Your wallet contract is ready for policy enforcement`);
      } else {
        console.warn("⚠ WalletConnect not configured. Using stored private key (insecure).");
        console.warn("  Run `arc402 config set walletConnectProjectId <id>` to enable phone wallet signing.");
        const { signer, address } = await requireSigner(config);
        const factory = new ethers.Contract(factoryAddress, WALLET_FACTORY_ABI, signer);
        console.log(`Deploying ARC402Wallet via factory at ${factoryAddress}...`);
        const tx = await factory.createWallet(address);
        const receipt = await tx.wait();
        let walletAddress: string | null = null;
        for (const log of receipt.logs) {
          try {
            const parsed = factory.interface.parseLog(log);
            if (parsed?.name === "WalletCreated") {
              walletAddress = parsed.args.wallet as string;
              break;
            }
          } catch { /* skip unparseable logs */ }
        }
        if (!walletAddress) {
          console.error("Could not find WalletCreated event in receipt. Check the transaction on-chain.");
          process.exit(1);
        }
        config.walletContractAddress = walletAddress;
        saveConfig(config);
        console.log(`ARC402Wallet deployed at: ${walletAddress}`);
        console.log(`Your wallet contract is ready for policy enforcement`);
      }
    });

  // ─── send ──────────────────────────────────────────────────────────────────

  wallet.command("send <address> <amount>")
    .description("Send ETH from configured wallet (amount: '0.001eth' or wei)")
    .option("--json")
    .action(async (to, amountRaw, opts) => {
      const config = loadConfig();
      const { signer } = await requireSigner(config);
      const value = parseAmount(amountRaw);
      const tx = await signer.sendTransaction({ to, value });
      if (opts.json) {
        console.log(JSON.stringify({ txHash: tx.hash, to, amount: ethers.formatEther(value) }));
      } else {
        console.log(`Tx hash: ${tx.hash}`);
      }
    });

  // ─── policy ────────────────────────────────────────────────────────────────

  const walletPolicy = wallet.command("policy").description("View and set spending policy on ARC402Wallet");

  walletPolicy.command("show")
    .description("List current spending limits")
    .action(async () => {
      const config = loadConfig();
      const policyAddress = config.policyEngineAddress ?? POLICY_ENGINE_DEFAULT;
      const { provider, address } = await getClient(config);
      if (!address) throw new Error("No wallet configured");
      const contract = new ethers.Contract(policyAddress, POLICY_ENGINE_LIMITS_ABI, provider);
      const categories: string[] = await contract.getCategories(address);
      if (categories.length === 0) {
        console.log("No spending limits configured");
        return;
      }
      const limits = await Promise.all(
        categories.map(async (cat) => {
          const limit: bigint = await contract.getSpendLimit(address, cat);
          return { category: cat, limit: ethers.formatEther(limit) };
        })
      );
      limits.forEach(({ category, limit }) => console.log(`${category}: ${limit} ETH`));
    });

  walletPolicy.command("set-limit")
    .description("Set a spending limit for a category (phone wallet signs via WalletConnect)")
    .requiredOption("--category <cat>", "Category name (e.g. code.review)")
    .requiredOption("--amount <eth>", "Limit in ETH (e.g. 0.1)")
    .action(async (opts) => {
      const config = loadConfig();
      const policyAddress = config.policyEngineAddress ?? POLICY_ENGINE_DEFAULT;
      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const amount = ethers.parseEther(opts.amount);
      const policyInterface = new ethers.Interface(POLICY_ENGINE_LIMITS_ABI);

      if (config.walletConnectProjectId) {
        const walletAddr = config.walletContractAddress;
        if (!walletAddr) {
          console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
          process.exit(1);
        }
        const provider = new ethers.JsonRpcProvider(config.rpcUrl);
        const { txHash } = await requestPhoneWalletSignature(
          config.walletConnectProjectId,
          chainId,
          (account) => ({
            to: policyAddress,
            data: policyInterface.encodeFunctionData("setSpendLimit", [walletAddr, opts.category, amount]),
            value: "0x0",
          }),
          `Approve spend limit: ${opts.category} → ${opts.amount} ETH`
        );
        console.log(`\nTransaction submitted: ${txHash}`);
        await provider.waitForTransaction(txHash);
        console.log(`Spend limit for ${opts.category} set to ${opts.amount} ETH`);
      } else {
        console.warn("⚠ WalletConnect not configured. Using stored private key (insecure).");
        console.warn("  Run `arc402 config set walletConnectProjectId <id>` to enable phone wallet signing.");
        const { signer, address } = await requireSigner(config);
        const contract = new ethers.Contract(policyAddress, POLICY_ENGINE_LIMITS_ABI, signer);
        await (await contract.setSpendLimit(address, opts.category, amount)).wait();
        console.log(`Spend limit for ${opts.category} set to ${opts.amount} ETH`);
      }
    });

  // ─── freeze / unfreeze ─────────────────────────────────────────────────────

  wallet.command("freeze <walletAddress>")
    .description("Freeze spend for a wallet. Callable by the wallet, its owner, or an authorized freeze agent. Use immediately if suspicious activity is detected.")
    .action(async (walletAddress) => {
      const config = loadConfig();
      if (!config.policyEngineAddress) throw new Error("policyEngineAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new PolicyClient(config.policyEngineAddress, signer);
      await client.freezeSpend(walletAddress);
      console.log(`wallet ${walletAddress} spend frozen`);
    });

  wallet.command("unfreeze <walletAddress>")
    .description("Unfreeze spend for a wallet. Only callable by the wallet or its registered owner.")
    .action(async (walletAddress) => {
      const config = loadConfig();
      if (!config.policyEngineAddress) throw new Error("policyEngineAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new PolicyClient(config.policyEngineAddress, signer);
      await client.unfreeze(walletAddress);
      console.log(`wallet ${walletAddress} spend unfrozen`);
    });
}
