import { ethers } from "ethers";
import { Arc402Config } from "./config";
import { ARC402_WALLET_EXECUTE_ABI } from "./abis";

// ─── ARC402Wallet custom error decoder ─────────────────────────────────────

const WALLET_CUSTOM_ERROR_IFACE = new ethers.Interface([
  "error WVel()",
  "error WCtx()",
  "error WAtt()",
  "error WAuth()",
  "error WCall()",
  "error WZero()",
  "error WFrozen()",
  "error WPending()",
  "error WLock()",
]);

const WALLET_ERROR_HELP: Record<string, string> = {
  WVel:
    "Velocity limit breached. Your wallet has been automatically frozen as a security measure.\n" +
    "  To unfreeze: arc402 wallet unfreeze\n" +
    "  To prevent this: check your spending velocity limits with arc402 wallet policy status",
  WCtx:
    "Context error: either a context is already open, or no context is open when one is required.\n" +
    "  Note: each context allows exactly one spend — a new context must be opened per payment.\n" +
    "  Check context state:  arc402 wallet check-context\n" +
    "  Close stale context:  arc402 wallet close-context",
  WAtt:
    "Attestation invalid: not found, already consumed, expired, or parameters do not match.\n" +
    "  Each attestation can only be used once. Create a new attestation for each spend.",
  WAuth:
    "Machine key not authorized on this wallet.\n" +
    "  Fix: arc402 wallet authorize-machine-key <your-machine-key-address>",
  WCall:
    "External contract call failed. The target contract reverted. Check the target address and calldata.",
  WZero:
    "Zero address not allowed for a required address parameter.",
  WFrozen:
    "Wallet is frozen and cannot process transactions.\n" +
    "  To unfreeze: arc402 wallet unfreeze (owner WalletConnect required)",
  WPending:
    "A registry upgrade is already pending. Cancel it first: arc402 wallet cancel-registry-upgrade",
  WLock:
    "Registry upgrade timelock has not elapsed yet. Check: arc402 wallet execute-registry-upgrade",
};

/**
 * Attempts to decode a known ARC402Wallet custom error from a thrown error.
 * If a recognized error is found, prints a human-readable message and exits.
 * Otherwise, rethrows the original error.
 */
export function handleWalletError(e: unknown): never {
  // Extract revert data from various ethers v6 error shapes
  let errorData: string | undefined;
  if (e && typeof e === "object") {
    const err = e as Record<string, unknown>;
    if (typeof err.data === "string") {
      errorData = err.data;
    } else if (err.error && typeof err.error === "object") {
      const inner = err.error as Record<string, unknown>;
      if (typeof inner.data === "string") errorData = inner.data;
    }
    // ethers v6 sometimes nests it in info.error.data
    if (!errorData && err.info && typeof err.info === "object") {
      const info = err.info as Record<string, unknown>;
      if (info.error && typeof info.error === "object") {
        const ie = info.error as Record<string, unknown>;
        if (typeof ie.data === "string") errorData = ie.data;
      }
    }
    // Fallback: parse from error message string
    if (!errorData && typeof err.message === "string") {
      const m = err.message.match(/"data"\s*:\s*"(0x[0-9a-fA-F]+)"/);
      if (m) errorData = m[1];
    }
  }

  if (errorData && errorData.length >= 10) {
    try {
      const decoded = WALLET_CUSTOM_ERROR_IFACE.parseError(errorData);
      if (decoded) {
        const help = WALLET_ERROR_HELP[decoded.name];
        if (help) {
          console.error(`\nError: ${decoded.name}()`);
          console.error(`  ${help.split("\n").join("\n  ")}`);
          process.exit(1);
        }
      }
    } catch { /* decoding failed — fall through to rethrow */ }
  }

  throw e;
}

// ─── Selector-based error decoder (J1-06) ────────────────────────────────────
//
// Maps known 4-byte selectors to human-readable messages for use in external error handling.

const WALLET_ERROR_SELECTOR_MAP: Record<string, string> = {
  "0x13af807f": "Context error: either a context is already open, or no context is open. Check with `arc402 wallet check-context`",
  "0x88529d53": "Attestation error: attestation not found, already used, expired, or wrong parameters",
  "0xd6636aaa": "Velocity limit breached — wallet is now frozen. Run `arc402 wallet unfreeze` to recover",
  "0xbc34a075": "Unauthorized: this operation requires owner or machine key authorization",
  "0xf5138cb6": "Contract call failed: the target contract reverted. Check that the target contract is working correctly",
  "0xd92e233d": "Zero address error: a required address parameter was address(0)",
  "0xb808d662": "Wallet is frozen. Run `arc402 wallet unfreeze` to recover (requires owner)",
};

/**
 * Decode a 4-byte ARC402Wallet custom error selector into a human-readable message.
 * Returns null if the selector is not a known wallet error.
 */
export function decodeWalletError(errorData: string): string | null {
  if (!errorData || errorData.length < 10) return null;
  const selector = errorData.slice(0, 10).toLowerCase();
  return WALLET_ERROR_SELECTOR_MAP[selector] ?? null;
}

export interface SenderInfo {
  address: string;
  useContract: boolean;
}

export function getEffectiveSender(config: Arc402Config): SenderInfo {
  if (config.walletContractAddress) {
    return { address: config.walletContractAddress, useContract: true };
  }
  const wallet = new ethers.Wallet(config.privateKey!);
  return { address: wallet.address, useContract: false };
}

export function printSenderInfo(config: Arc402Config): void {
  if (config.walletContractAddress) {
    console.log(`Using ARC402Wallet: ${config.walletContractAddress}`);
    console.log(`Policy enforcement active — transaction subject to configured limits`);
  } else {
    const wallet = new ethers.Wallet(config.privateKey!);
    console.log(`Using EOA wallet: ${wallet.address}`);
    console.log(`Tip: run \`arc402 wallet deploy\` to enable spending limits and policy enforcement`);
  }
}

/**
 * Route a write transaction through the ARC402Wallet's executeContractCall when deployed,
 * otherwise encode calldata directly against the target contract using the provided ABI.
 */
export async function executeContractWriteViaWallet(
  walletContractAddress: string,
  signer: ethers.Wallet,
  targetAddress: string,
  contractAbi: readonly string[],
  functionName: string,
  args: unknown[],
  value: bigint = 0n,
  approvalToken: string = ethers.ZeroAddress,
  maxApprovalAmount: bigint = 0n,
): Promise<ethers.ContractTransactionResponse> {
  const iface = new ethers.Interface(contractAbi);
  const data = iface.encodeFunctionData(functionName, args);
  const walletContract = new ethers.Contract(
    walletContractAddress,
    ARC402_WALLET_EXECUTE_ABI,
    signer,
  );
  try {
    return await walletContract.executeContractCall({
      target: targetAddress,
      data,
      value,
      minReturnValue: 0n,
      maxApprovalAmount,
      approvalToken,
    });
  } catch (e) {
    handleWalletError(e);
  }
}
