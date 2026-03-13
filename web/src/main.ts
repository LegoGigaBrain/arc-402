import { ethers } from "ethers";
import { ARC402_WALLET_ABI, POLICY_ENGINE_ABI } from "./abi";

// ─── Env ──────────────────────────────────────────────────────────────────────

const WC_PROJECT_ID = import.meta.env.VITE_WC_PROJECT_ID as string | undefined;
const POLICY_ENGINE: Record<string, string> = {
  "8453": import.meta.env.VITE_POLICY_ENGINE_MAINNET ?? "",
  "84532": import.meta.env.VITE_POLICY_ENGINE_TESTNET ?? "0x44102e70c2A366632d98Fe40d892a2501fC7fFF2",
};

// ─── URL params ───────────────────────────────────────────────────────────────

interface SignParams {
  action: string;
  wallet: string;
  chain: string;
  nonce: string;
  created: string;
  sig: string;
  agentAddress: string;
  // optional action-specific params
  category?: string;
  amount?: string;
  guardian?: string;
  newOwner?: string;
}

function parseParams(): SignParams | null {
  const p = new URLSearchParams(window.location.search);
  const required = ["action", "wallet", "chain", "nonce", "created", "sig", "agentAddress"];
  for (const key of required) {
    if (!p.get(key)) return null;
  }
  return {
    action: p.get("action")!,
    wallet: p.get("wallet")!,
    chain: p.get("chain")!,
    nonce: p.get("nonce")!,
    created: p.get("created")!,
    sig: p.get("sig")!,
    agentAddress: p.get("agentAddress")!,
    category: p.get("category") ?? undefined,
    amount: p.get("amount") ?? undefined,
    guardian: p.get("guardian") ?? undefined,
    newOwner: p.get("newOwner") ?? undefined,
  };
}

// ─── Signature verification ───────────────────────────────────────────────────

function verifyRequest(params: SignParams): { ok: boolean; reason?: string } {
  const nowSec = Math.floor(Date.now() / 1000);
  const createdSec = Number(params.created);
  if (Number.isNaN(createdSec)) return { ok: false, reason: "Invalid created timestamp" };
  if (nowSec - createdSec > 1800) return { ok: false, reason: "This signing link has expired (30 minute limit)" };

  const message = `${params.action}:${params.wallet}:${params.chain}:${params.nonce}:${params.created}`;
  try {
    const recovered = ethers.verifyMessage(message, params.sig);
    if (recovered.toLowerCase() !== params.agentAddress.toLowerCase()) {
      return { ok: false, reason: "Invalid or tampered signing request" };
    }
  } catch {
    return { ok: false, reason: "Signature verification failed" };
  }
  return { ok: true };
}

// ─── Action metadata ──────────────────────────────────────────────────────────

interface ActionMeta {
  icon: string;
  text: string;
}

function getActionMeta(params: SignParams): ActionMeta {
  switch (params.action) {
    case "freeze":
      return { icon: "🔒", text: "FREEZE your agent wallet" };
    case "unfreeze":
      return { icon: "🔓", text: "UNFREEZE your agent wallet" };
    case "set-policy":
      return {
        icon: "📋",
        text: `Update spending limit: ${params.category ?? "?"} → ${params.amount ? ethers.formatEther(params.amount) + " ETH" : "?"}`,
      };
    case "set-guardian":
      return {
        icon: "🛡️",
        text: `Update emergency guardian address`,
      };
    case "transfer-ownership":
      return {
        icon: "🔑",
        text: `Transfer wallet ownership to ${params.newOwner ? shortAddr(params.newOwner) : "?"}`,
      };
    default:
      return { icon: "❓", text: `Unknown action: ${params.action}` };
  }
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function networkName(chain: string): string {
  if (chain === "8453") return "Base Mainnet";
  if (chain === "84532") return "Base Sepolia";
  return `Chain ${chain}`;
}

// ─── Transaction construction ─────────────────────────────────────────────────

interface TransactionRequest {
  to: string;
  data: string;
  value?: string;
  from?: string;
}

function buildTransaction(params: SignParams): TransactionRequest {
  const walletIface = new ethers.Interface(ARC402_WALLET_ABI);
  const policyIface = new ethers.Interface(POLICY_ENGINE_ABI);
  const policyAddr = POLICY_ENGINE[params.chain] ?? "";

  switch (params.action) {
    case "freeze":
      return { to: params.wallet, data: walletIface.encodeFunctionData("freeze", []) };
    case "unfreeze":
      return { to: params.wallet, data: walletIface.encodeFunctionData("unfreeze", []) };
    case "set-policy":
      if (!policyAddr) throw new Error(`No PolicyEngine address for chain ${params.chain}`);
      return {
        to: policyAddr,
        data: policyIface.encodeFunctionData("setSpendLimit", [
          params.wallet,
          params.category ?? "",
          params.amount ?? "0",
        ]),
      };
    case "set-guardian":
      if (!policyAddr) throw new Error(`No PolicyEngine address for chain ${params.chain}`);
      return {
        to: policyAddr,
        data: policyIface.encodeFunctionData("setGuardian", [params.wallet, params.guardian ?? ethers.ZeroAddress]),
      };
    case "transfer-ownership":
      return {
        to: params.wallet,
        data: walletIface.encodeFunctionData("transferOwnership", [params.newOwner ?? ethers.ZeroAddress]),
      };
    default:
      throw new Error(`Unknown action: ${params.action}`);
  }
}

// ─── State management ─────────────────────────────────────────────────────────

type AppState = "loading" | "confirm" | "done" | "error";

function setState(state: AppState) {
  for (const s of ["loading", "confirm", "done", "error"] as AppState[]) {
    const el = document.getElementById(`state-${s}`)!;
    if (s === state) el.classList.add("active");
    else el.classList.remove("active");
  }
}

function setConfirmStatus(msg: string, isError = false) {
  const el = document.getElementById("confirm-status")!;
  el.textContent = msg;
  el.className = `status${isError ? " error" : ""}`;
}

function showError(msg: string) {
  document.getElementById("error-message")!.textContent = msg;
  setState("error");
}

function showDone(txHash: string, chain: string) {
  const basescanBase = chain === "8453" ? "https://basescan.org/tx/" : "https://sepolia.basescan.org/tx/";
  const link = document.getElementById("basescan-link") as HTMLAnchorElement;
  link.href = basescanBase + txHash;
  setState("done");
}

// ─── Wallet connection + send ─────────────────────────────────────────────────

async function sendViaCoinbaseWallet(tx: TransactionRequest, chain: string): Promise<string> {
  const { CoinbaseWalletSDK } = await import("@coinbase/wallet-sdk");
  const sdk = new CoinbaseWalletSDK({ appName: "ARC-402" });
  const provider = sdk.makeWeb3Provider();
  await provider.request({ method: "eth_requestAccounts" });
  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  const from = accounts[0];
  const txHash = await provider.request({
    method: "eth_sendTransaction",
    params: [{ from, to: tx.to, data: tx.data, value: tx.value ?? "0x0" }],
  }) as string;
  return txHash;
}

async function sendViaWalletConnect(tx: TransactionRequest, chain: string): Promise<string> {
  if (!WC_PROJECT_ID) throw new Error("WalletConnect project ID not configured");
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  const wcProvider = await EthereumProvider.init({
    projectId: WC_PROJECT_ID,
    chains: [Number(chain)],
    showQrModal: true,
    metadata: {
      name: "ARC-402",
      description: "ARC-402 Protocol",
      url: "https://arc402.xyz",
      icons: [],
    },
  });
  await wcProvider.connect();
  const accounts = wcProvider.accounts;
  if (!accounts.length) throw new Error("No accounts connected");
  const from = accounts[0];
  const txHash = await wcProvider.request({
    method: "eth_sendTransaction",
    params: [{ from, to: tx.to, data: tx.data, value: tx.value ?? "0x0" }],
  }) as string;
  return txHash;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  setState("loading");

  const params = parseParams();
  if (!params) {
    showError("Missing required parameters. This link appears to be malformed.");
    return;
  }

  const { ok, reason } = verifyRequest(params);
  if (!ok) {
    showError(reason ?? "Invalid request");
    return;
  }

  // Populate UI
  const meta = getActionMeta(params);
  document.getElementById("action-icon")!.textContent = meta.icon;
  document.getElementById("action-text")!.textContent = meta.text;
  document.getElementById("detail-wallet")!.textContent = shortAddr(params.wallet);
  document.getElementById("detail-network")!.textContent = networkName(params.chain);
  setState("confirm");

  let tx: TransactionRequest;
  try {
    tx = buildTransaction(params);
  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : String(err));
    return;
  }

  const btnCoinbase = document.getElementById("btn-coinbase") as HTMLButtonElement;
  const btnWc = document.getElementById("btn-wc") as HTMLButtonElement;

  const handleSend = async (sender: (tx: TransactionRequest, chain: string) => Promise<string>) => {
    btnCoinbase.disabled = true;
    btnWc.disabled = true;
    setConfirmStatus("Waiting for wallet approval…");
    try {
      const txHash = await sender(tx, params.chain);
      showDone(txHash, params.chain);
    } catch (err: unknown) {
      btnCoinbase.disabled = false;
      btnWc.disabled = false;
      const msg = err instanceof Error ? err.message : String(err);
      setConfirmStatus(msg.length > 120 ? msg.slice(0, 117) + "…" : msg, true);
    }
  };

  btnCoinbase.addEventListener("click", () => handleSend(sendViaCoinbaseWallet));
  btnWc.addEventListener("click", () => handleSend(sendViaWalletConnect));
}

main().catch((err) => {
  console.error(err);
  showError(err instanceof Error ? err.message : String(err));
});
