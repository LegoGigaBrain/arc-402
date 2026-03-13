import { ethers } from "ethers";
import { Arc402Config } from "./config";
import { ARC402_WALLET_EXECUTE_ABI } from "./abis";

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
  return walletContract.executeContractCall({
    target: targetAddress,
    data,
    value,
    minReturnValue: 0n,
    maxApprovalAmount,
    approvalToken,
  });
}
