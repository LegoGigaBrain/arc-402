import { Command } from "commander";
import { PolicyClient, TrustClient } from "@arc402/sdk";
import { ethers } from "ethers";
import prompts from "prompts";
import fs from "fs";
import path from "path";
import os from "os";
import { Arc402Config, getConfigPath, getUsdcAddress, loadConfig, NETWORK_DEFAULTS, saveConfig } from "../config";
import { getClient, requireSigner } from "../client";
import { getTrustTier } from "../utils/format";
import { ARC402_WALLET_EXECUTE_ABI, ARC402_WALLET_GUARDIAN_ABI, ARC402_WALLET_OWNER_ABI, ARC402_WALLET_REGISTRY_ABI, POLICY_ENGINE_LIMITS_ABI, TRUST_REGISTRY_ABI, WALLET_FACTORY_ABI } from "../abis";
import { connectPhoneWallet, sendTransactionWithSession, requestPhoneWalletSignature } from "../walletconnect";
import { clearWCSession } from "../walletconnect-session";
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

  // ─── wc-reset ──────────────────────────────────────────────────────────────
  //
  // Clears the saved WalletConnect session from config AND wipes the WC SDK
  // storage file (~/.arc402/wc-storage.json). Use when MetaMask killed the
  // session on its end and the CLI is stuck trying to resume a dead connection.
  // Next wallet command will trigger a fresh QR pairing flow.

  wallet.command("wc-reset")
    .description("Clear stale WalletConnect session — forces a fresh QR pairing on next connection")
    .option("--json")
    .action(async (opts) => {
      const config = loadConfig();

      const hadSession = !!config.wcSession;

      // 1. Clear from config
      clearWCSession(config);

      // 2. Wipe WC SDK storage file
      const wcStoragePath = path.join(os.homedir(), ".arc402", "wc-storage.json");
      let storageWiped = false;
      try {
        if (fs.existsSync(wcStoragePath)) {
          fs.unlinkSync(wcStoragePath);
          storageWiped = true;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (opts.json) {
          console.log(JSON.stringify({ ok: false, error: `Could not delete ${wcStoragePath}: ${msg}` }));
        } else {
          console.warn(`⚠ Could not delete ${wcStoragePath}: ${msg}`);
          console.warn("  You may need to delete it manually.");
        }
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify({ ok: true, hadSession, storageWiped }));
      } else {
        console.log("✓ WalletConnect session cleared");
        if (storageWiped) console.log(`  Storage wiped: ${wcStoragePath}`);
        else console.log("  (No storage file found — already clean)");
        console.log("\nNext: run any wallet command and scan the fresh QR code.");
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
            data: factoryInterface.encodeFunctionData("createWallet", ["0x0000000071727De22E5E9d8BAf0edAc6f37da032"]),
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
              walletAddress = parsed.args.walletAddress as string;
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
        // WalletConnect approval already confirmed intent — sending automatically

        console.log("Deploying...");
        const txHash = await sendTransactionWithSession(client, session, account, chainId, {
          to: factoryAddress,
          data: factoryInterface.encodeFunctionData("createWallet", ["0x0000000071727De22E5E9d8BAf0edAc6f37da032"]),
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
              walletAddress = parsed.args.walletAddress as string;
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
        const tx = await factory.createWallet("0x0000000071727De22E5E9d8BAf0edAc6f37da032");
        const receipt = await tx.wait();
        let walletAddress: string | null = null;
        for (const log of receipt.logs) {
          try {
            const parsed = factory.interface.parseLog(log);
            if (parsed?.name === "WalletCreated") {
              walletAddress = parsed.args.walletAddress as string;
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
    .description("Show per-tx and daily spending limits for a category")
    .requiredOption("--category <cat>", "Category name (e.g. code.review)")
    .action(async (opts) => {
      const config = loadConfig();
      const policyAddress = config.policyEngineAddress ?? POLICY_ENGINE_DEFAULT;
      const walletAddr = config.walletContractAddress;
      if (!walletAddr) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const contract = new ethers.Contract(policyAddress, POLICY_ENGINE_LIMITS_ABI, provider);
      const [perTxLimit, dailyLimit]: [bigint, bigint] = await Promise.all([
        contract.categoryLimits(walletAddr, opts.category),
        contract.dailyCategoryLimit(walletAddr, opts.category),
      ]);
      console.log(`Category:  ${opts.category}`);
      console.log(`Per-tx:    ${perTxLimit === 0n ? "(not set)" : ethers.formatEther(perTxLimit) + " ETH"}`);
      console.log(`Daily:     ${dailyLimit === 0n ? "(not set)" : ethers.formatEther(dailyLimit) + " ETH"}`);
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
            data: policyInterface.encodeFunctionData("setCategoryLimitFor", [walletAddr, opts.category, amount]),
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
        await (await contract.setCategoryLimitFor(address, opts.category, amount)).wait();
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
      // WalletConnect approval already confirmed intent — sending automatically

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
      // WalletConnect approval already confirmed intent — sending automatically

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

      // WalletConnect approval already confirmed intent — sending automatically

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

  // ─── register-policy ───────────────────────────────────────────────────────
  //
  // Calls registerWallet(walletAddress, ownerAddress) on PolicyEngine via
  // executeContractCall on the ARC402Wallet. PolicyEngine requires msg.sender == wallet,
  // so this must go through the wallet contract — not called directly by the owner key.

  wallet.command("register-policy")
    .description("Register this wallet on PolicyEngine (required before spend limits can be set)")
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
      const ownerAddress = config.ownerAddress;
      if (!ownerAddress) {
        console.error("ownerAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }

      const policyAddress = config.policyEngineAddress ?? POLICY_ENGINE_DEFAULT;
      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);

      // Encode registerWallet(wallet, owner) calldata — called on PolicyEngine
      const policyInterface = new ethers.Interface([
        "function registerWallet(address wallet, address owner) external",
      ]);
      const registerCalldata = policyInterface.encodeFunctionData("registerWallet", [
        config.walletContractAddress,
        ownerAddress,
      ]);

      const executeInterface = new ethers.Interface(ARC402_WALLET_EXECUTE_ABI);

      console.log(`\nWallet:       ${config.walletContractAddress}`);
      console.log(`PolicyEngine: ${policyAddress}`);
      console.log(`Owner:        ${ownerAddress}`);

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const { txHash } = await requestPhoneWalletSignature(
        config.walletConnectProjectId,
        chainId,
        () => ({
          to: config.walletContractAddress!,
          data: executeInterface.encodeFunctionData("executeContractCall", [{
            target: policyAddress,
            data: registerCalldata,
            value: 0n,
            minReturnValue: 0n,
            maxApprovalAmount: 0n,
            approvalToken: ethers.ZeroAddress,
          }]),
          value: "0x0",
        }),
        `Approve: register wallet on PolicyEngine`,
        telegramOpts,
        config
      );

      await provider.waitForTransaction(txHash);
      console.log(`\n✓ Wallet registered on PolicyEngine`);
      console.log(`  Tx: ${txHash}`);
      console.log(`\nNext: run 'arc402 wallet policy set-limit' to configure spending limits.`);
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

  // ─── governance setup ──────────────────────────────────────────────────────
  //
  // Interactive wizard that collects velocity limit, guardian key, and category
  // limits in one session, then batches all transactions through a single
  // WalletConnect session (wallet_sendCalls if supported, else sequential).

  const governance = wallet.command("governance").description("Wallet governance management");

  governance.command("setup")
    .description("Interactive governance setup — velocity limit, guardian key, and spending limits in one WalletConnect session")
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

      const policyAddress = config.policyEngineAddress ?? POLICY_ENGINE_DEFAULT;
      const chainId = config.network === "base-mainnet" ? 8453 : 84532;

      // ── Step 1: velocity limit ────────────────────────────────────────────
      const { velocityEth } = await prompts({
        type: "text",
        name: "velocityEth",
        message: "Velocity limit (max ETH per rolling window)",
        initial: "0.05",
        validate: (v: string) => {
          try { ethers.parseEther(v); return true; } catch { return "Enter a valid ETH amount (e.g. 0.05)"; }
        },
      });
      if (velocityEth === undefined) { console.log("Aborted."); return; }

      // ── Step 2: guardian key ──────────────────────────────────────────────
      const { wantGuardian } = await prompts({
        type: "confirm",
        name: "wantGuardian",
        message: "Set guardian key?",
        initial: true,
      });
      if (wantGuardian === undefined) { console.log("Aborted."); return; }

      let guardianWallet: ethers.Wallet | null = null;
      if (wantGuardian) {
        guardianWallet = new ethers.Wallet(ethers.Wallet.createRandom().privateKey);
        console.log(`  Generated guardian address: ${guardianWallet.address}`);
      }

      // ── Step 3: spending categories ───────────────────────────────────────
      type CategoryEntry = { category: string; amountEth: string };
      const categories: CategoryEntry[] = [];

      const defaultCategories = [
        { label: "general", default: "0.02" },
        { label: "research", default: "0.05" },
        { label: "compute", default: "0.10" },
      ];

      console.log("\nSpending categories — press Enter to skip any:");

      for (const { label, default: def } of defaultCategories) {
        const { amountRaw } = await prompts({
          type: "text",
          name: "amountRaw",
          message: `  ${label} limit in ETH`,
          initial: def,
        });
        if (amountRaw === undefined) { console.log("Aborted."); return; }
        if (amountRaw.trim() !== "") {
          categories.push({ category: label, amountEth: amountRaw.trim() });
        }
      }

      // Custom categories loop
      while (true) {
        const { customName } = await prompts({
          type: "text",
          name: "customName",
          message: "  Add custom category? [name or Enter to skip]",
          initial: "",
        });
        if (customName === undefined || customName.trim() === "") break;
        const { customAmount } = await prompts({
          type: "text",
          name: "customAmount",
          message: `  ${customName.trim()} limit in ETH`,
          initial: "0.05",
          validate: (v: string) => {
            try { ethers.parseEther(v); return true; } catch { return "Enter a valid ETH amount"; }
          },
        });
        if (customAmount === undefined) { console.log("Aborted."); return; }
        categories.push({ category: customName.trim(), amountEth: customAmount.trim() });
      }

      // ── Step 4: summary ───────────────────────────────────────────────────
      console.log("\n─────────────────────────────────────────────────────");
      console.log("Changes to be made:");
      console.log(`  Wallet:         ${config.walletContractAddress}`);
      console.log(`  Velocity limit: ${velocityEth} ETH per rolling window`);
      if (guardianWallet) {
        console.log(`  Guardian key:   ${guardianWallet.address} (new — private key will be saved to config)`);
      }
      if (categories.length > 0) {
        console.log("  Spending limits:");
        for (const { category, amountEth } of categories) {
          console.log(`    ${category.padEnd(12)} ${amountEth} ETH`);
        }
      }
      console.log(`  Transactions:   ${1 + (guardianWallet ? 1 : 0) + categories.length} total`);
      console.log("─────────────────────────────────────────────────────");

      // ── Step 5: confirm ───────────────────────────────────────────────────
      const { confirmed } = await prompts({
        type: "confirm",
        name: "confirmed",
        message: "Confirm and sign with your wallet?",
        initial: true,
      });
      if (!confirmed) { console.log("Aborted."); return; }

      // ── Step 6: connect WalletConnect once, send all transactions ─────────
      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      console.log("\nConnecting wallet...");
      const { client, session, account } = await connectPhoneWallet(
        config.walletConnectProjectId,
        chainId,
        config,
        { telegramOpts, prompt: "Approve governance setup transactions on ARC402Wallet" }
      );

      const ownerInterface = new ethers.Interface(ARC402_WALLET_OWNER_ABI);
      const guardianInterface = new ethers.Interface(ARC402_WALLET_GUARDIAN_ABI);
      const policyInterface = new ethers.Interface(POLICY_ENGINE_LIMITS_ABI);

      // Build the list of calls
      type TxCall = { to: string; data: string; value: string };
      const calls: TxCall[] = [];

      // velocity limit
      calls.push({
        to: config.walletContractAddress!,
        data: ownerInterface.encodeFunctionData("setVelocityLimit", [ethers.parseEther(velocityEth)]),
        value: "0x0",
      });

      // guardian
      if (guardianWallet) {
        calls.push({
          to: config.walletContractAddress!,
          data: guardianInterface.encodeFunctionData("setGuardian", [guardianWallet.address]),
          value: "0x0",
        });
      }

      // category limits — called directly on PolicyEngine by owner key
      for (const { category, amountEth } of categories) {
        calls.push({
          to: policyAddress,
          data: policyInterface.encodeFunctionData("setCategoryLimitFor", [
            config.walletContractAddress!,
            category,
            ethers.parseEther(amountEth),
          ]),
          value: "0x0",
        });
      }

      // Try wallet_sendCalls (EIP-5792) first, fall back to sequential eth_sendTransaction
      let txHashes: string[] = [];
      let usedBatch = false;

      try {
        const batchResult = await client.request<{ id: string }>({
          topic: session.topic,
          chainId: `eip155:${chainId}`,
          request: {
            method: "wallet_sendCalls",
            params: [{
              version: "1.0",
              chainId: `0x${chainId.toString(16)}`,
              from: account,
              calls: calls.map(c => ({ to: c.to, data: c.data, value: c.value })),
            }],
          },
        });
        txHashes = [typeof batchResult === "string" ? batchResult : batchResult.id];
        usedBatch = true;
      } catch {
        // wallet_sendCalls not supported — send sequentially
        console.log("  (wallet_sendCalls not supported — sending sequentially)");
        for (let i = 0; i < calls.length; i++) {
          console.log(`  Sending transaction ${i + 1}/${calls.length}...`);
          const txHash = await sendTransactionWithSession(client, session, account, chainId, calls[i]);
          txHashes.push(txHash);
        }
      }

      // Persist guardian key if generated
      if (guardianWallet) {
        config.guardianPrivateKey = guardianWallet.privateKey;
        config.guardianAddress = guardianWallet.address;
        saveConfig(config);
      }

      console.log(`\n✓ Governance setup complete`);
      if (usedBatch) {
        console.log(`  Batch tx: ${txHashes[0]}`);
      } else {
        txHashes.forEach((h, i) => console.log(`  Tx ${i + 1}: ${h}`));
      }
      if (guardianWallet) {
        console.log(`  Guardian key saved to config — address: ${guardianWallet.address}`);
        console.log(`  WARN: Store the guardian private key separately from your hot key.`);
      }
      console.log(`\nVerify with: arc402 wallet status && arc402 wallet policy show`);
    });

  // ─── authorize-machine-key ─────────────────────────────────────────────────

  wallet.command("authorize-machine-key <key>")
    .description("Authorize a machine key (hot key) on your ARC402Wallet (phone wallet signs via WalletConnect)")
    .action(async (keyAddress: string) => {
      const config = loadConfig();
      if (!config.walletContractAddress) {
        console.error("walletContractAddress not set in config. Run `arc402 wallet deploy` first.");
        process.exit(1);
      }
      if (!config.walletConnectProjectId) {
        console.error("walletConnectProjectId not set in config.");
        process.exit(1);
      }

      let checksumKey: string;
      try {
        checksumKey = ethers.getAddress(keyAddress);
      } catch {
        console.error(`Invalid address: ${keyAddress}`);
        process.exit(1);
      }

      const chainId = config.network === "base-mainnet" ? 8453 : 84532;
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const machineKeyAbi = ["function authorizeMachineKey(address key) external", "function authorizedMachineKeys(address) external view returns (bool)"];
      const walletContract = new ethers.Contract(config.walletContractAddress, machineKeyAbi, provider);

      let alreadyAuthorized = false;
      try {
        alreadyAuthorized = await walletContract.authorizedMachineKeys(checksumKey);
      } catch { /* ignore */ }

      if (alreadyAuthorized) {
        console.log(`\n✓ ${checksumKey} is already authorized as a machine key on ${config.walletContractAddress}`);
        process.exit(0);
      }

      console.log(`\nWallet:      ${config.walletContractAddress}`);
      console.log(`Machine key: ${checksumKey}`);

      const telegramOpts = config.telegramBotToken && config.telegramChatId
        ? { botToken: config.telegramBotToken, chatId: config.telegramChatId, threadId: config.telegramThreadId }
        : undefined;

      const walletInterface = new ethers.Interface(machineKeyAbi);
      const txData = {
        to: config.walletContractAddress,
        data: walletInterface.encodeFunctionData("authorizeMachineKey", [checksumKey]),
        value: "0x0",
      };

      const { client, session, account } = await connectPhoneWallet(
        config.walletConnectProjectId,
        chainId,
        config,
        {
          telegramOpts,
          prompt: `Authorize machine key ${checksumKey} on ARC402Wallet — allows autonomous protocol ops`,
        }
      );

      console.log(`\n✓ Connected: ${account}`);
      console.log("Sending authorizeMachineKey transaction...");

      const hash = await sendTransactionWithSession(client, session, account, chainId, txData);
      console.log(`\nTransaction submitted: ${hash}`);
      console.log("Waiting for confirmation...");

      const receipt = await provider.waitForTransaction(hash, 1, 60000);
      if (!receipt || receipt.status !== 1) {
        console.error("Transaction failed.");
        process.exit(1);
      }

      const confirmed = await walletContract.authorizedMachineKeys(checksumKey);
      console.log(`\n✓ Machine key authorized: ${confirmed ? "YES" : "NO"}`);
      console.log(`  Wallet:      ${config.walletContractAddress}`);
      console.log(`  Machine key: ${checksumKey}`);
      console.log(`  Tx:          ${hash}`);

      await client.disconnect({ topic: session.topic, reason: { code: 6000, message: "done" } });
      process.exit(0);
    });
}
