import * as readline from "readline";
import { Command } from "commander";
import { PolicyClient, TrustClient } from "@arc402/sdk";
import { ethers } from "ethers";
import { Arc402Config, getConfigPath, getUsdcAddress, loadConfig, NETWORK_DEFAULTS, saveConfig } from "../config";
import { getClient, requireSigner } from "../client";
import { getTrustTier } from "../utils/format";
import { ARC402_WALLET_GUARDIAN_ABI, ARC402_WALLET_OWNER_ABI, ARC402_WALLET_REGISTRY_ABI, POLICY_ENGINE_LIMITS_ABI, TRUST_REGISTRY_ABI, WALLET_FACTORY_ABI } from "../abis";
import { connectPhoneWallet, sendTransactionWithSession, requestPhoneWalletSignature } from "../walletconnect";
import { requestCoinbaseSmartWalletSignature } from "../coinbase-smart-wallet";
import { sendTelegramMessage } from "../telegram-notify";

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

  wallet.command("status").description("Show address, balances, contract wallet, guardian, and frozen status").option("--json").action(async (opts) => {
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

    // Query contract wallet for frozen/guardian state if deployed
    let contractFrozen: boolean | null = null;
    let contractGuardian: string | null = null;
    if (config.walletContractAddress) {
      try {
        const walletContract = new ethers.Contract(config.walletContractAddress, ARC402_WALLET_GUARDIAN_ABI, provider);
        [contractFrozen, contractGuardian] = await Promise.all([
          walletContract.frozen(),
          walletContract.guardian(),
        ]);
      } catch { /* contract may not be deployed yet */ }
    }

    const payload = {
      address,
      network: config.network,
      ethBalance: ethers.formatEther(ethBalance),
      usdcBalance: (Number(usdcBalance) / 1e6).toFixed(2),
      trustScore: score.score,
      trustTier: getTrustTier(score.score),
      walletContractAddress: config.walletContractAddress ?? null,
      frozen: contractFrozen,
      guardian: contractGuardian,
      guardianAddress: config.guardianAddress ?? null,
    };
    if (opts.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`${payload.address}\nETH=${payload.ethBalance}\nUSDC=${payload.usdcBalance}\nTrust=${payload.trustScore} ${payload.trustTier}`);
      if (payload.walletContractAddress) console.log(`Contract=${payload.walletContractAddress}`);
      if (contractFrozen !== null) console.log(`Frozen=${contractFrozen}`);
      if (contractGuardian && contractGuardian !== ethers.ZeroAddress) console.log(`Guardian=${contractGuardian}`);
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

  // ─── list ──────────────────────────────────────────────────────────────────

  wallet.command("list")
    .description("List all ARC402Wallet contracts owned by the configured master key")
    .option("--owner <address>", "Master key address to query (defaults to config.ownerAddress)")
    .option("--json")
    .action(async (opts) => {
      const config = loadConfig();
      const factoryAddress = config.walletFactoryAddress ?? NETWORK_DEFAULTS[config.network]?.walletFactoryAddress;
      if (!factoryAddress) {
        console.error("walletFactoryAddress not found in config or NETWORK_DEFAULTS.");
        process.exit(1);
      }
      const ownerAddress: string = opts.owner ?? config.ownerAddress;
      if (!ownerAddress) {
        console.error("No owner address. Pass --owner <address> or set ownerAddress in config (run `arc402 wallet deploy` first).");
        process.exit(1);
      }
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const factory = new ethers.Contract(factoryAddress, WALLET_FACTORY_ABI, provider);
      const wallets: string[] = await factory.getWallets(ownerAddress);

      const results = await Promise.all(
        wallets.map(async (addr) => {
          const walletContract = new ethers.Contract(addr, ARC402_WALLET_GUARDIAN_ABI, provider);
          const trustContract = new ethers.Contract(config.trustRegistryAddress, TRUST_REGISTRY_ABI, provider);
          const [frozen, score] = await Promise.all([
            walletContract.frozen().catch(() => null),
            trustContract.getScore(addr).catch(() => BigInt(0)),
          ]);
          return { address: addr, frozen: frozen as boolean | null, score: Number(score) };
        })
      );

      if (opts.json) {
        console.log(JSON.stringify(results.map((w, i) => ({
          index: i + 1,
          address: w.address,
          active: w.address.toLowerCase() === config.walletContractAddress?.toLowerCase(),
          trustScore: w.score,
          frozen: w.frozen,
        })), null, 2));
      } else {
        const short = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-5)}`;
        console.log(`\nARC-402 Wallets owned by ${short(ownerAddress)}\n`);
        results.forEach((w, i) => {
          const active = w.address.toLowerCase() === config.walletContractAddress?.toLowerCase();
          const activeTag = active ? "  [active]" : "          ";
          console.log(`  #${i + 1}  ${w.address}${activeTag}  Trust: ${w.score}  Frozen: ${w.frozen}`);
        });
        console.log(`\n  ${results.length} wallet${results.length === 1 ? "" : "s"} total`);
      }
    });

  // ─── use ───────────────────────────────────────────────────────────────────

  wallet.command("use <address>")
    .description("Switch the active wallet contract address in config")
    .action(async (address) => {
      let checksumAddress: string;
      try {
        checksumAddress = ethers.getAddress(address);
      } catch {
        console.error(`Invalid address: ${address}`);
        process.exit(1);
      }
      const config = loadConfig();
      const factoryAddress = config.walletFactoryAddress ?? NETWORK_DEFAULTS[config.network]?.walletFactoryAddress;
      if (factoryAddress && config.ownerAddress) {
        try {
          const provider = new ethers.JsonRpcProvider(config.rpcUrl);
          const factory = new ethers.Contract(factoryAddress, WALLET_FACTORY_ABI, provider);
          const wallets: string[] = await factory.getWallets(config.ownerAddress);
          const found = wallets.some((w) => w.toLowerCase() === checksumAddress.toLowerCase());
          if (!found) {
            console.warn(`WARN: ${checksumAddress} was not found in WalletFactory wallets for owner ${config.ownerAddress}`);
            console.warn("  Proceeding anyway — use 'arc402 wallet list' to see known wallets.");
          }
        } catch { /* allow override if factory call fails */ }
      }
      config.walletContractAddress = checksumAddress;
      saveConfig(config);
      console.log(`Active wallet set to ${checksumAddress}`);
    });

  // ─── deploy ────────────────────────────────────────────────────────────────

  wallet.command("deploy")
    .description("Deploy ARC402Wallet contract via WalletFactory (phone wallet signs via WalletConnect)")
    .option("--smart-wallet", "Connect via Base Smart Wallet (Coinbase Wallet SDK) instead of WalletConnect")
    .option("--hardware", "Hardware wallet mode: show raw wc: URI only (for Ledger Live, Trezor Suite, etc.)")
    .action(async (opts) => {
      const config = loadConfig();
      const factoryAddress = config.walletFactoryAddress ?? NETWORK_DEFAULTS[config.network]?.walletFactoryAddress;
      if (!factoryAddress) {
        console.error("walletFactoryAddress not found in config or NETWORK_DEFAULTS. Add walletFactoryAddress to your config.");
        process.exit(1);
      }
      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const factoryInterface = new ethers.Interface(WALLET_FACTORY_ABI);

      if (opts.smartWallet) {
        const { txHash, account } = await requestCoinbaseSmartWalletSignature(
          chainId,
          (ownerAccount) => ({
            to: factoryAddress,
            data: factoryInterface.encodeFunctionData("createWallet", []),
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
        console.log(`Owner: ${account} (your Base Smart Wallet)`);
        console.log(`Your wallet contract is ready for policy enforcement`);
        console.log(`\nNext: run 'arc402 wallet set-guardian' to configure the emergency guardian key.`);
      } else if (config.walletConnectProjectId) {
        const telegramOpts = config.telegramBotToken && config.telegramChatId
          ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
          : undefined;

        // ── Step 1: Connect ────────────────────────────────────────────────────
        const { client, session, account } = await connectPhoneWallet(
          config.walletConnectProjectId,
          chainId,
          config,
          { telegramOpts, prompt: "Approve ARC402Wallet deployment — you will be set as owner", hardware: !!opts.hardware }
        );

        const networkName = chainId === 8453 ? "Base" : "Base Sepolia";
        const shortAddr = `${account.slice(0, 6)}...${account.slice(-5)}`;
        console.log(`\n✓ Connected: ${shortAddr} on ${networkName}`);

        if (telegramOpts) {
          // Send "connected" message with a deploy confirmation button.
          // TODO: wire up full callback_data round-trip when a persistent bot process is available.
          await sendTelegramMessage({
            botToken: telegramOpts.botToken,
            chatId: telegramOpts.chatId,
            threadId: telegramOpts.threadId,
            text: `✓ Wallet connected: ${shortAddr} — tap to deploy:`,
            buttons: [[{ text: "🚀 Deploy ARC-402 Wallet", callback_data: "arc402_deploy_confirm" }]],
          });
        }

        // ── Step 2: Confirm & Deploy ───────────────────────────────────────────
        console.log("\nPress Enter to deploy wallet, or Ctrl+C to cancel");
        await new Promise<void>((resolve) => {
          const rl = readline.createInterface({ input: process.stdin });
          const timer = setTimeout(() => { rl.close(); resolve(); }, 5 * 60 * 1000);
          rl.once("line", () => { clearTimeout(timer); rl.close(); resolve(); });
        });

        console.log("Deploying...");
        const txHash = await sendTransactionWithSession(client, session, account, chainId, {
          to: factoryAddress,
          data: factoryInterface.encodeFunctionData("createWallet", []),
          value: "0x0",
        });

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
        console.log(`\n✓ ARC402Wallet deployed at: ${walletAddress}`);
        console.log(`Owner: ${account} (your phone wallet)`);
        console.log(`Your wallet contract is ready for policy enforcement`);
        console.log(`\nNext: run 'arc402 wallet set-guardian' to configure the emergency guardian key.`);
      } else {
        console.warn("⚠ WalletConnect not configured. Using stored private key (insecure).");
        console.warn("  Run `arc402 config set walletConnectProjectId <id>` to enable phone wallet signing.");
        const { signer, address } = await requireSigner(config);
        const factory = new ethers.Contract(factoryAddress, WALLET_FACTORY_ABI, signer);
        console.log(`Deploying ARC402Wallet via factory at ${factoryAddress}...`);
        const tx = await factory.createWallet();
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

        // Generate guardian key (separate from hot key) and call setGuardian
        const guardianWallet = ethers.Wallet.createRandom();
        config.walletContractAddress = walletAddress;
        config.guardianPrivateKey = guardianWallet.privateKey;
        config.guardianAddress = guardianWallet.address;
        saveConfig(config);

        // Call setGuardian on the deployed wallet
        const walletContract = new ethers.Contract(walletAddress, ARC402_WALLET_GUARDIAN_ABI, signer);
        const setGuardianTx = await walletContract.setGuardian(guardianWallet.address);
        await setGuardianTx.wait();

        console.log(`ARC402Wallet deployed at: ${walletAddress}`);
        console.log(`Guardian key generated: ${guardianWallet.address}`);
        console.log(`Guardian private key saved to config (keep it safe — used for emergency freeze only)`);
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
          `Approve spend limit: ${opts.category} → ${opts.amount} ETH`,
          config.telegramBotToken && config.telegramChatId ? {
            botToken: config.telegramBotToken,
            chatId: config.telegramChatId,
            threadId: config.telegramThreadId,
          } : undefined,
          config
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

  walletPolicy.command("set <policyId>")
    .description("Set the active policy ID on ARC402Wallet (phone wallet signs via WalletConnect)")
    .action(async (policyId) => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId) {
        console.error("walletConnectProjectId not set in config. Run `arc402 config set walletConnectProjectId <id>`.");
        process.exit(1);
      }

      // Normalise policyId to bytes32 hex
      let policyIdHex: string;
      try {
        policyIdHex = ethers.zeroPadValue(ethers.hexlify(policyId.startsWith("0x") ? policyId : ethers.toUtf8Bytes(policyId)), 32);
      } catch {
        console.error("Invalid policyId — must be a hex string (0x…) or UTF-8 label.");
        process.exit(1);
      }

      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const ownerInterface = new ethers.Interface(ARC402_WALLET_OWNER_ABI);

      let currentPolicy = "(unknown)";
      try {
        const walletContract = new ethers.Contract(config.walletContractAddress, ARC402_WALLET_OWNER_ABI, provider);
        currentPolicy = await walletContract.activePolicyId();
      } catch { /* contract may not be deployed yet */ }

      console.log(`\nWallet:         ${config.walletContractAddress}`);
      console.log(`Current policy: ${currentPolicy}`);
      console.log(`New policy:     ${policyIdHex}`);

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const { txHash } = await requestPhoneWalletSignature(
        config.walletConnectProjectId,
        chainId,
        () => ({
          to: config.walletContractAddress!,
          data: ownerInterface.encodeFunctionData("updatePolicy", [policyIdHex]),
          value: "0x0",
        }),
        `Approve: update policy to ${policyIdHex}`,
        telegramOpts,
        config
      );

      await provider.waitForTransaction(txHash);
      console.log(`\n✓ Active policy updated`);
      console.log(`  Tx: ${txHash}`);
      console.log(`  Policy: ${policyIdHex}`);
    });

  // ─── freeze (guardian key — emergency wallet freeze) ──────────────────────
  //
  // Uses the guardian private key from config to call ARC402Wallet.freeze() or
  // ARC402Wallet.freezeAndDrain() directly on the wallet contract.
  // No human approval needed — designed for immediate AI-initiated emergency response.

  wallet.command("freeze")
    .description("Emergency freeze via guardian key. Use immediately if suspicious activity is detected. Owner must unfreeze.")
    .option("--drain", "Also drain all ETH to owner address (use when machine compromise is suspected)")
    .option("--json")
    .action(async (opts) => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.guardianPrivateKey) {
        console.error("guardianPrivateKey not set in config. Guardian key was generated during `arc402 wallet deploy`.");
        process.exit(1);
      }
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const guardianSigner = new ethers.Wallet(config.guardianPrivateKey, provider);
      const walletContract = new ethers.Contract(config.walletContractAddress, ARC402_WALLET_GUARDIAN_ABI, guardianSigner);

      let tx;
      if (opts.drain) {
        console.log("Triggering freeze-and-drain via guardian key...");
        tx = await walletContract.freezeAndDrain();
      } else {
        console.log("Triggering emergency freeze via guardian key...");
        tx = await walletContract.freeze();
      }
      const receipt = await tx.wait();

      if (opts.json) {
        console.log(JSON.stringify({ txHash: receipt.hash, walletAddress: config.walletContractAddress, drained: !!opts.drain }));
      } else {
        console.log(`Wallet ${config.walletContractAddress} is now FROZEN`);
        if (opts.drain) console.log("All ETH drained to owner.");
        console.log(`Tx: ${receipt.hash}`);
        console.log(`\nOwner must unfreeze: arc402 wallet unfreeze`);
      }
    });

  // ─── unfreeze (owner key — requires WalletConnect) ────────────────────────
  //
  // Deliberately uses WalletConnect (phone wallet) so unfreezing requires owner
  // approval from the phone. Guardian can freeze fast; only owner can unfreeze.

  wallet.command("unfreeze")
    .description("Unfreeze wallet contract via owner phone wallet (WalletConnect). Only the owner can unfreeze — guardian cannot.")
    .option("--hardware", "Hardware wallet mode: show raw wc: URI only")
    .option("--json")
    .action(async (opts) => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId) {
        console.error("walletConnectProjectId not set in config. Run `arc402 config set walletConnectProjectId <id>`.");
        process.exit(1);
      }

      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const walletInterface = new ethers.Interface(ARC402_WALLET_GUARDIAN_ABI);

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const { client, session, account } = await connectPhoneWallet(
        config.walletConnectProjectId,
        chainId,
        config,
        { telegramOpts, prompt: "Approve: unfreeze ARC402Wallet", hardware: !!opts.hardware }
      );

      const networkName = chainId === 8453 ? "Base" : "Base Sepolia";
      const shortAddr = `${account.slice(0, 6)}...${account.slice(-5)}`;
      console.log(`\n✓ Connected: ${shortAddr} on ${networkName}`);
      console.log(`\nWallet to unfreeze: ${config.walletContractAddress}`);
      console.log("\nPress Enter to send unfreeze(), or Ctrl+C to cancel");
      await new Promise<void>((resolve) => {
        const rl = readline.createInterface({ input: process.stdin });
        const timer = setTimeout(() => { rl.close(); resolve(); }, 5 * 60 * 1000);
        rl.once("line", () => { clearTimeout(timer); rl.close(); resolve(); });
      });

      console.log("Sending transaction...");
      const txHash = await sendTransactionWithSession(client, session, account, chainId, {
        to: config.walletContractAddress,
        data: walletInterface.encodeFunctionData("unfreeze", []),
        value: "0x0",
      });

      await provider.waitForTransaction(txHash);
      if (opts.json) {
        console.log(JSON.stringify({ txHash, walletAddress: config.walletContractAddress }));
      } else {
        console.log(`\n✓ Wallet ${config.walletContractAddress} unfrozen`);
        console.log(`  Tx: ${txHash}`);
      }
    });

  // ─── set-guardian ──────────────────────────────────────────────────────────
  //
  // Generates a guardian key locally, then registers it on-chain via the owner's
  // phone wallet (WalletConnect). Guardian changes require owner approval.

  wallet.command("set-guardian")
    .description("Generate a new guardian key and register it on the wallet contract (phone wallet signs via WalletConnect)")
    .option("--guardian-key <key>", "Use an existing private key as the guardian (optional)")
    .option("--hardware", "Hardware wallet mode: show raw wc: URI only")
    .action(async (opts) => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId) {
        console.error("walletConnectProjectId not set in config. Run `arc402 config set walletConnectProjectId <id>`.");
        process.exit(1);
      }

      let guardianWallet: ethers.Wallet;
      if (opts.guardianKey) {
        try {
          guardianWallet = new ethers.Wallet(opts.guardianKey);
        } catch {
          console.error("Invalid guardian key. Must be a 0x-prefixed hex string.");
          process.exit(1);
        }
      } else {
        guardianWallet = new ethers.Wallet(ethers.Wallet.createRandom().privateKey);
        console.log("Generated new guardian key.");
      }

      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const walletInterface = new ethers.Interface(ARC402_WALLET_GUARDIAN_ABI);

      console.log(`\nGuardian address: ${guardianWallet.address}`);
      console.log(`Wallet contract:  ${config.walletContractAddress}`);

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const { client, session, account } = await connectPhoneWallet(
        config.walletConnectProjectId,
        chainId,
        config,
        { telegramOpts, prompt: `Approve: set guardian to ${guardianWallet.address}`, hardware: !!opts.hardware }
      );

      const networkName = chainId === 8453 ? "Base" : "Base Sepolia";
      const shortAddr = `${account.slice(0, 6)}...${account.slice(-5)}`;
      console.log(`\n✓ Connected: ${shortAddr} on ${networkName}`);
      console.log("\nPress Enter to send setGuardian(), or Ctrl+C to cancel");
      await new Promise<void>((resolve) => {
        const rl = readline.createInterface({ input: process.stdin });
        const timer = setTimeout(() => { rl.close(); resolve(); }, 5 * 60 * 1000);
        rl.once("line", () => { clearTimeout(timer); rl.close(); resolve(); });
      });

      console.log("Sending transaction...");
      const txHash = await sendTransactionWithSession(client, session, account, chainId, {
        to: config.walletContractAddress,
        data: walletInterface.encodeFunctionData("setGuardian", [guardianWallet.address]),
        value: "0x0",
      });

      await provider.waitForTransaction(txHash);
      config.guardianPrivateKey = guardianWallet.privateKey;
      config.guardianAddress = guardianWallet.address;
      saveConfig(config);
      console.log(`\n✓ Guardian set to: ${guardianWallet.address}`);
      console.log(`  Tx: ${txHash}`);
      console.log(`  Guardian private key saved to config.`);
      console.log(`  WARN: The guardian key can freeze your wallet. Store it separately from your hot key.`);
    });

  // ─── policy-engine freeze / unfreeze (legacy — for PolicyEngine-level freeze) ──

  wallet.command("freeze-policy <walletAddress>")
    .description("Freeze PolicyEngine spend for a wallet address (authorized freeze agents only)")
    .action(async (walletAddress) => {
      const config = loadConfig();
      if (!config.policyEngineAddress) throw new Error("policyEngineAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new PolicyClient(config.policyEngineAddress, signer);
      await client.freezeSpend(walletAddress);
      console.log(`wallet ${walletAddress} spend frozen (PolicyEngine)`);
    });

  wallet.command("unfreeze-policy <walletAddress>")
    .description("Unfreeze PolicyEngine spend for a wallet. Only callable by the wallet or its registered owner.")
    .action(async (walletAddress) => {
      const config = loadConfig();
      if (!config.policyEngineAddress) throw new Error("policyEngineAddress missing in config");
      const { signer } = await requireSigner(config);
      const client = new PolicyClient(config.policyEngineAddress, signer);
      await client.unfreeze(walletAddress);
      console.log(`wallet ${walletAddress} spend unfrozen (PolicyEngine)`);
    });

  // ─── upgrade-registry ──────────────────────────────────────────────────────

  wallet.command("upgrade-registry <newRegistryAddress>")
    .description("Propose a registry upgrade on the ARC402Wallet (2-day timelock, phone wallet signs via WalletConnect)")
    .option("--dry-run", "Show calldata without connecting to wallet")
    .option("--hardware", "Hardware wallet mode: show raw wc: URI only")
    .action(async (newRegistryAddress, opts) => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId && !opts.dryRun) {
        console.error("walletConnectProjectId not set in config. Run `arc402 config set walletConnectProjectId <id>`.");
        process.exit(1);
      }

      let checksumAddress: string;
      try {
        checksumAddress = ethers.getAddress(newRegistryAddress);
      } catch {
        console.error(`Invalid address: ${newRegistryAddress}`);
        process.exit(1);
      }

      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const walletInterface = new ethers.Interface(ARC402_WALLET_REGISTRY_ABI);

      let currentRegistry = "(unknown)";
      try {
        const walletContract = new ethers.Contract(config.walletContractAddress, ARC402_WALLET_REGISTRY_ABI, provider);
        currentRegistry = await walletContract.registry();
      } catch { /* contract may not expose registry() */ }

      // Box: 54-char inner width (║ + 54 + ║ = 56 total)
      const fromPad = currentRegistry.padEnd(42);
      console.log(`\n╔══════════════════════════════════════════════════════╗`);
      console.log(`║     ARC402Wallet Registry Upgrade                    ║`);
      console.log(`╟──────────────────────────────────────────────────────╢`);
      console.log(`║  Wallet:   ${config.walletContractAddress}║`);
      console.log(`║  From:     ${fromPad}║`);
      console.log(`║  To:       ${checksumAddress}║`);
      console.log(`║  Timelock: 2 days (cancelable)                       ║`);
      console.log(`║  Action:   proposeRegistryUpdate()                   ║`);
      console.log(`╚══════════════════════════════════════════════════════╝\n`);

      const calldata = walletInterface.encodeFunctionData("proposeRegistryUpdate", [checksumAddress]);

      if (opts.dryRun) {
        console.log("Calldata (dry-run):");
        console.log(`  To:    ${config.walletContractAddress}`);
        console.log(`  Data:  ${calldata}`);
        console.log(`  Value: 0x0`);
        return;
      }

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const { client, session, account } = await connectPhoneWallet(
        config.walletConnectProjectId!,
        chainId,
        config,
        { telegramOpts, prompt: "Approve registry upgrade proposal on ARC402Wallet", hardware: !!opts.hardware }
      );

      const networkName = chainId === 8453 ? "Base" : "Base Sepolia";
      const shortAddr = `${account.slice(0, 6)}...${account.slice(-5)}`;
      console.log(`\n✓ Connected: ${shortAddr} on ${networkName}`);

      console.log("\nPress Enter to send proposeRegistryUpdate(), or Ctrl+C to cancel");
      await new Promise<void>((resolve) => {
        const rl = readline.createInterface({ input: process.stdin });
        const timer = setTimeout(() => { rl.close(); resolve(); }, 5 * 60 * 1000);
        rl.once("line", () => { clearTimeout(timer); rl.close(); resolve(); });
      });

      console.log("Sending transaction...");
      const txHash = await sendTransactionWithSession(client, session, account, chainId, {
        to: config.walletContractAddress,
        data: calldata,
        value: "0x0",
      });

      const unlockAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      console.log(`\n✓ Registry upgrade proposed`);
      console.log(`  Tx: ${txHash}`);
      console.log(`  Unlock at: ${unlockAt.toISOString()} (approximately)`);
      console.log(`\nNext steps:`);
      console.log(`  Wait 2 days, then run:`);
      console.log(`  arc402 wallet execute-registry-upgrade`);
      console.log(`\nTo cancel before execution:`);
      console.log(`  arc402 wallet cancel-registry-upgrade`);
    });

  // ─── execute-registry-upgrade ──────────────────────────────────────────────

  wallet.command("execute-registry-upgrade")
    .description("Execute a pending registry upgrade after the 2-day timelock (phone wallet signs via WalletConnect)")
    .action(async () => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId) {
        console.error("walletConnectProjectId not set in config. Run `arc402 config set walletConnectProjectId <id>`.");
        process.exit(1);
      }

      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const walletContract = new ethers.Contract(config.walletContractAddress, ARC402_WALLET_REGISTRY_ABI, provider);

      let pendingRegistry: string;
      let unlockAt: bigint;
      try {
        [pendingRegistry, unlockAt] = await Promise.all([
          walletContract.pendingRegistry(),
          walletContract.registryUpdateUnlockAt(),
        ]);
      } catch (e) {
        console.error("Failed to read pending registry from contract:", e);
        process.exit(1);
      }

      if (pendingRegistry === ethers.ZeroAddress) {
        console.log("No pending registry upgrade.");
        return;
      }

      const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
      if (unlockAt > nowSeconds) {
        const remaining = Number(unlockAt - nowSeconds);
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        console.log(`Timelock not yet elapsed.`);
        console.log(`Pending registry: ${pendingRegistry}`);
        console.log(`Unlocks in: ${hours}h ${minutes}m`);
        console.log(`Unlock at: ${new Date(Number(unlockAt) * 1000).toISOString()}`);
        return;
      }

      console.log(`Pending registry: ${pendingRegistry}`);
      console.log("Timelock elapsed — proceeding with executeRegistryUpdate()");

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const walletInterface = new ethers.Interface(ARC402_WALLET_REGISTRY_ABI);
      const { txHash } = await requestPhoneWalletSignature(
        config.walletConnectProjectId,
        chainId,
        () => ({
          to: config.walletContractAddress!,
          data: walletInterface.encodeFunctionData("executeRegistryUpdate", []),
          value: "0x0",
        }),
        "Approve registry upgrade execution on ARC402Wallet",
        telegramOpts,
        config
      );

      console.log(`\n✓ Registry upgrade executed`);
      console.log(`  Tx: ${txHash}`);
      console.log(`  New registry: ${pendingRegistry}`);
    });

  // ─── cancel-registry-upgrade ───────────────────────────────────────────────

  // ─── set-interceptor ───────────────────────────────────────────────────────

  wallet.command("set-interceptor <address>")
    .description("Set the authorized X402 interceptor address on ARC402Wallet (phone wallet signs via WalletConnect)")
    .action(async (interceptorAddress) => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId) {
        console.error("walletConnectProjectId not set in config. Run `arc402 config set walletConnectProjectId <id>`.");
        process.exit(1);
      }

      let checksumAddress: string;
      try {
        checksumAddress = ethers.getAddress(interceptorAddress);
      } catch {
        console.error(`Invalid address: ${interceptorAddress}`);
        process.exit(1);
      }

      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const ownerInterface = new ethers.Interface(ARC402_WALLET_OWNER_ABI);

      let currentInterceptor = "(unknown)";
      try {
        const walletContract = new ethers.Contract(config.walletContractAddress, ARC402_WALLET_OWNER_ABI, provider);
        currentInterceptor = await walletContract.authorizedInterceptor();
      } catch { /* contract may not be deployed yet */ }

      console.log(`\nWallet:              ${config.walletContractAddress}`);
      console.log(`Current interceptor: ${currentInterceptor}`);
      console.log(`New interceptor:     ${checksumAddress}`);

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const { txHash } = await requestPhoneWalletSignature(
        config.walletConnectProjectId,
        chainId,
        () => ({
          to: config.walletContractAddress!,
          data: ownerInterface.encodeFunctionData("setAuthorizedInterceptor", [checksumAddress]),
          value: "0x0",
        }),
        `Approve: set X402 interceptor to ${checksumAddress}`,
        telegramOpts,
        config
      );

      await provider.waitForTransaction(txHash);
      console.log(`\n✓ X402 interceptor updated`);
      console.log(`  Tx: ${txHash}`);
      console.log(`  Interceptor: ${checksumAddress}`);
    });

  // ─── set-velocity-limit ────────────────────────────────────────────────────

  wallet.command("set-velocity-limit <limit>")
    .description("Set the per-rolling-window ETH velocity limit on ARC402Wallet (limit in ETH, phone wallet signs via WalletConnect)")
    .action(async (limitEth) => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId) {
        console.error("walletConnectProjectId not set in config. Run `arc402 config set walletConnectProjectId <id>`.");
        process.exit(1);
      }

      let limitWei: bigint;
      try {
        limitWei = ethers.parseEther(limitEth);
      } catch {
        console.error(`Invalid limit: ${limitEth}. Provide a value in ETH (e.g. 0.5)`);
        process.exit(1);
      }

      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const ownerInterface = new ethers.Interface(ARC402_WALLET_OWNER_ABI);

      let currentLimit = "(unknown)";
      try {
        const walletContract = new ethers.Contract(config.walletContractAddress, ARC402_WALLET_OWNER_ABI, provider);
        const raw: bigint = await walletContract.velocityLimit();
        currentLimit = raw === 0n ? "disabled" : `${ethers.formatEther(raw)} ETH`;
      } catch { /* contract may not be deployed yet */ }

      console.log(`\nWallet:         ${config.walletContractAddress}`);
      console.log(`Current limit:  ${currentLimit}`);
      console.log(`New limit:      ${limitEth} ETH (max ETH per rolling window)`);

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const { txHash } = await requestPhoneWalletSignature(
        config.walletConnectProjectId,
        chainId,
        () => ({
          to: config.walletContractAddress!,
          data: ownerInterface.encodeFunctionData("setVelocityLimit", [limitWei]),
          value: "0x0",
        }),
        `Approve: set velocity limit to ${limitEth} ETH`,
        telegramOpts,
        config
      );

      await provider.waitForTransaction(txHash);
      console.log(`\n✓ Velocity limit updated`);
      console.log(`  Tx: ${txHash}`);
      console.log(`  New limit: ${limitEth} ETH per rolling window`);
    });

  // ─── cancel-registry-upgrade ───────────────────────────────────────────────

  wallet.command("cancel-registry-upgrade")
    .description("Cancel a pending registry upgrade before it executes (phone wallet signs via WalletConnect)")
    .action(async () => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId) {
        console.error("walletConnectProjectId not set in config. Run `arc402 config set walletConnectProjectId <id>`.");
        process.exit(1);
      }

      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const walletContract = new ethers.Contract(config.walletContractAddress, ARC402_WALLET_REGISTRY_ABI, provider);

      let pendingRegistry: string;
      try {
        pendingRegistry = await walletContract.pendingRegistry();
      } catch (e) {
        console.error("Failed to read pending registry from contract:", e);
        process.exit(1);
      }

      if (pendingRegistry === ethers.ZeroAddress) {
        console.log("No pending registry upgrade to cancel.");
        return;
      }

      console.log(`Cancelling pending registry upgrade to: ${pendingRegistry}`);

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const walletInterface = new ethers.Interface(ARC402_WALLET_REGISTRY_ABI);
      const { txHash } = await requestPhoneWalletSignature(
        config.walletConnectProjectId,
        chainId,
        () => ({
          to: config.walletContractAddress!,
          data: walletInterface.encodeFunctionData("cancelRegistryUpdate", []),
          value: "0x0",
        }),
        "Approve registry upgrade cancellation on ARC402Wallet",
        telegramOpts,
        config
      );

      console.log(`\n✓ Registry upgrade cancelled`);
      console.log(`  Tx: ${txHash}`);
    });
}
