import { SignClient } from "@walletconnect/sign-client";
import { KeyValueStorage } from "@walletconnect/keyvaluestorage";
import qrcode from "qrcode-terminal";
import path from "path";
import os from "os";
import { Arc402Config } from "./config";
import { loadWCSession, saveWCSession, clearWCSession } from "./walletconnect-session";
import { sendWalletConnectApprovalButton } from "./telegram-notify";

// Suppress unhandled rejections from stale WalletConnect sessions (known SDK issue)
process.on("unhandledRejection", (reason: unknown) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  if (msg.includes("No matching key") || msg.includes("session topic doesn't exist")) return;
  console.error("Unhandled rejection:", msg);
});

export type TelegramOpts = {
  botToken: string;
  chatId: string;
  threadId?: number;
};

// Infer SignClient instance and session types from the SDK
type SignClientT = Awaited<ReturnType<typeof SignClient.init>>;
type WCSession = ReturnType<SignClientT["session"]["get"]>;

async function makeSignClient(projectId: string): Promise<SignClientT> {
  const storageDir = path.join(os.homedir(), ".arc402");
  const storagePath = path.join(storageDir, "wc-storage.json");
  return SignClient.init({
    projectId,
    metadata: {
      name: "ARC-402 CLI",
      description: "ARC-402 Protocol CLI",
      url: "https://arc402.xyz",
      icons: [],
    },
    storage: new KeyValueStorage({ database: storagePath }),
  });
}

function walletLinks(encodedUri: string) {
  return {
    "MetaMask":        `metamask://wc?uri=${encodedUri}`,
    "Rabby":           `rabby://wc?uri=${encodedUri}`,
    "Coinbase Wallet": `cbwallet://wc?uri=${encodedUri}`,
    "Trust Wallet":    `trust://wc?uri=${encodedUri}`,
    "Rainbow":         `rainbow://wc?uri=${encodedUri}`,
  };
}

/**
 * Step 1 of the two-step flow: connect the phone wallet (or resume a valid session).
 * On fresh connect, shows deep links + QR and waits for WC approval.
 * Saves session to config after a successful fresh pairing.
 */
export async function connectPhoneWallet(
  projectId: string,
  chainId: number,
  config: Arc402Config,
  opts?: { telegramOpts?: TelegramOpts; prompt?: string; hardware?: boolean }
): Promise<{ client: SignClientT; session: WCSession; account: string }> {
  const client = await makeSignClient(projectId);

  // Try to restore an existing valid session
  const stored = loadWCSession(config, chainId);
  if (stored) {
    try {
      const session = client.session.get(stored.topic);
      // Verify the session is actually alive on the relay side (MetaMask may have
      // killed it without notifying us). We do a lightweight ping; if it times out
      // or throws the session is stale — fall through to fresh pairing.
      await Promise.race([
        client.ping({ topic: stored.topic }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("ping timeout")), 5000)),
      ]);
      return { client, session, account: stored.account };
    } catch {
      // Session stale or timed out — clear locally and do fresh pairing
      clearWCSession(config);
      try {
        await client.disconnect({ topic: stored.topic, reason: { code: 6000, message: "session stale" } });
      } catch { /* best-effort — may already be gone */ }
    }
  }

  // Fresh pairing flow
  const { uri, approval } = await client.connect({
    requiredNamespaces: {
      eip155: {
        methods: ["eth_sendTransaction", "personal_sign", "wallet_switchEthereumChain"],
        chains: [`eip155:${chainId}`],
        events: ["accountsChanged"],
      },
    },
  });

  if (!uri) throw new Error("Failed to create WalletConnect session");

  const encodedUri = encodeURIComponent(uri);
  const displayPrompt = opts?.prompt ?? "Connect your phone wallet";

  if (opts?.hardware) {
    console.log("\n─────────────────────────────────────────────────────");
    console.log("Paste this URI into Ledger Live, Trezor Suite, or any WalletConnect-compatible signer:\n");
    console.log(uri);
    console.log("\n─────────────────────────────────────────────────────");
    console.log("Waiting for connection...");
  } else {
    const links = walletLinks(encodedUri);
    console.log(`\n${displayPrompt}`);
    console.log("─────────────────────────────────────");
    console.log("Tap the link for your wallet app (opens directly):\n");
    for (const [name, link] of Object.entries(links)) {
      console.log(`${name}:\n${link}\n`);
    }
    console.log("Or scan QR:");
    qrcode.generate(uri, { small: true });
    console.log("\nWaiting for approval...");
  }

  const telegramOpts = opts?.hardware ? undefined : opts?.telegramOpts;
  if (telegramOpts) {
    await sendWalletConnectApprovalButton({
      botToken: telegramOpts.botToken,
      chatId: telegramOpts.chatId,
      threadId: telegramOpts.threadId,
      prompt: displayPrompt,
      walletLinks: [
        { label: "🦊 MetaMask", url: `https://metamask.app.link/wc?uri=${encodedUri}` },
        { label: "🌈 Rainbow", url: `https://rnbwapp.com/wc?uri=${encodedUri}` },
        { label: "🔵 Trust Wallet", url: `https://link.trustwallet.com/wc?uri=${encodedUri}` },
      ],
    });
    console.log("Approval request sent to Telegram ✓");
  }

  const session = await approval();
  const account = session.namespaces.eip155.accounts[0].split(":")[2];

  // Ensure wallet is on the correct chain before sending any tx
  const hexChainId = `0x${chainId.toString(16)}`;
  const networkName = chainId === 8453 ? "Base" : chainId === 84532 ? "Base Sepolia" : `chain ${chainId}`;

  // First try adding the chain (MetaMask ignores if already added)
  if (chainId === 8453) {
    try {
      await client.request({
        topic: session.topic,
        chainId: `eip155:1`,
        request: {
          method: "wallet_addEthereumChain",
          params: [{ chainId: hexChainId, chainName: "Base", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.base.org"], blockExplorerUrls: ["https://basescan.org"] }],
        },
      });
    } catch { /* already added or unsupported */ }
  }

  // Then switch — retry up to 3 times
  let chainSwitched = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await client.request({
        topic: session.topic,
        chainId: `eip155:${chainId}`,
        request: {
          method: "wallet_switchEthereumChain",
          params: [{ chainId: hexChainId }],
        },
      });
      chainSwitched = true;
      break;
    } catch {
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  if (!chainSwitched) {
    console.log(`\n⚠ Could not auto-switch to ${networkName}. IMPORTANT: Switch to ${networkName} in your wallet NOW before approving the next transaction.`);
    console.log(`  Otherwise the transaction will go to Ethereum mainnet and fail.`);
    // Give user 5 seconds to read the warning and switch
    await new Promise(r => setTimeout(r, 5000));
  }

  // Persist session (WC sessions last 7 days by default)
  const expiry = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  saveWCSession(config, { topic: session.topic, expiry, account, chainId });

  return { client, session, account };
}

/**
 * Step 2 of the two-step flow: send a transaction with an established session.
 * Returns the transaction hash.
 */
export async function sendTransactionWithSession(
  client: SignClientT,
  session: WCSession,
  account: string,
  chainId: number,
  tx: { to: string; data: string; value?: string }
): Promise<string> {
  return client.request<string>({
    topic: session.topic,
    chainId: `eip155:${chainId}`,
    request: {
      method: "eth_sendTransaction",
      params: [{ from: account, to: tx.to, data: tx.data, value: tx.value ?? "0x0" }],
    },
  });
}

/**
 * Convenience wrapper: connect + send in one call.
 * Used by commands that haven't been split into two steps (e.g. policy set-limit).
 */
export async function requestPhoneWalletSignature(
  projectId: string,
  chainId: number,
  buildTx: (account: string) => { to: string; data: string; value?: string },
  prompt: string,
  telegramOpts?: TelegramOpts,
  config?: Arc402Config
): Promise<{ txHash: string; account: string }> {
  if (!config) {
    // Legacy path: no session persistence, disconnect after use
    const client = await makeSignClient(projectId);
    const { uri, approval } = await client.connect({
      requiredNamespaces: {
        eip155: {
          methods: ["eth_sendTransaction", "personal_sign", "wallet_switchEthereumChain"],
          chains: [`eip155:${chainId}`],
          events: ["accountsChanged"],
        },
      },
    });
    if (!uri) throw new Error("Failed to create WalletConnect session");
    const encodedUri = encodeURIComponent(uri);
    const links = walletLinks(encodedUri);
    console.log(`\n${prompt}`);
    console.log("─────────────────────────────────────");
    console.log("Tap the link for your wallet app (opens directly):\n");
    for (const [name, link] of Object.entries(links)) console.log(`${name}:\n${link}\n`);
    console.log("Or scan QR:");
    qrcode.generate(uri, { small: true });
    console.log("\nWaiting for approval...");
    if (telegramOpts) {
      await sendWalletConnectApprovalButton({
        botToken: telegramOpts.botToken,
        chatId: telegramOpts.chatId,
        threadId: telegramOpts.threadId,
        prompt,
        walletLinks: [
          { label: "🦊 MetaMask", url: `https://metamask.app.link/wc?uri=${encodedUri}` },
          { label: "🌈 Rainbow", url: `https://rnbwapp.com/wc?uri=${encodedUri}` },
          { label: "🔵 Trust Wallet", url: `https://link.trustwallet.com/wc?uri=${encodedUri}` },
        ],
      });
      console.log("Approval request sent to Telegram ✓");
    }
    const session = await approval();
    const account = session.namespaces.eip155.accounts[0].split(":")[2];
    // Switch chain — retry up to 3 times
    const hexId = `0x${chainId.toString(16)}`;
    let switched = false;
    for (let i = 0; i < 3; i++) {
      try {
        await client.request({
          topic: session.topic,
          chainId: `eip155:${chainId}`,
          request: { method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] },
        });
        switched = true;
        break;
      } catch { await new Promise(r => setTimeout(r, 1000)); }
    }
    if (!switched) {
      const net = chainId === 8453 ? "Base" : chainId === 84532 ? "Base Sepolia" : `chain ${chainId}`;
      console.log(`\n⚠ Could not auto-switch chain. Please switch to ${net} manually in your wallet before approving.`);
    }
    const tx = buildTx(account);
    const txHash = await client.request<string>({
      topic: session.topic,
      chainId: `eip155:${chainId}`,
      request: { method: "eth_sendTransaction", params: [{ from: account, to: tx.to, data: tx.data, value: tx.value ?? "0x0" }] },
    });
    await client.disconnect({ topic: session.topic, reason: { code: 0, message: "done" } });
    return { txHash, account };
  }

  const { client, session, account } = await connectPhoneWallet(projectId, chainId, config, { telegramOpts, prompt });
  const tx = buildTx(account);
  const txHash = await sendTransactionWithSession(client, session, account, chainId, tx);
  return { txHash, account };
}
