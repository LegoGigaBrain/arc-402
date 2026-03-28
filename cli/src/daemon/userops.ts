/**
 * UserOperation builder and submitter for the ARC-402 daemon.
 * Wraps protocol calls (accept, fulfill) into ERC-4337 UserOperations.
 */
import { ethers } from "ethers";
import { BundlerClient } from "../bundler";
import type { UserOperation } from "../bundler";
import type { DaemonConfig } from "./config";
import { ARC402_WALLET_EXECUTE_ABI } from "../abis";

// ServiceAgreement calldata encoders
const SA_IFACE = new ethers.Interface([
  "function accept(uint256 agreementId) external",
  "function commitDeliverable(uint256 agreementId, bytes32 deliverableHash) external",
]);

// ARC402Wallet.executeContractCall param type
const WALLET_EXEC_IFACE = new ethers.Interface(ARC402_WALLET_EXECUTE_ABI as unknown as string[]);

export function encodeWalletCall(
  target: string,
  innerCalldata: string,
  value = BigInt(0)
): string {
  return WALLET_EXEC_IFACE.encodeFunctionData("executeContractCall", [{
    target,
    data: innerCalldata,
    value,
    minReturnValue: BigInt(0),
    maxApprovalAmount: BigInt(0),
    approvalToken: ethers.ZeroAddress,
  }]);
}

export function buildAcceptCalldata(
  serviceAgreementAddress: string,
  agreementId: string,
  walletAddress: string
): string {
  const inner = SA_IFACE.encodeFunctionData("accept", [BigInt(agreementId)]);
  return encodeWalletCall(serviceAgreementAddress, inner);
}

export function buildFulfillCalldata(
  serviceAgreementAddress: string,
  agreementId: string,
  deliveryHash: string,
  walletAddress: string
): string {
  const inner = SA_IFACE.encodeFunctionData("commitDeliverable", [BigInt(agreementId), deliveryHash]);
  return encodeWalletCall(serviceAgreementAddress, inner);
}

export class UserOpsManager {
  private bundlerClient: BundlerClient;
  private provider: ethers.Provider;
  private config: DaemonConfig;
  private machineKeySigner: ethers.Wallet | null;

  constructor(config: DaemonConfig, provider: ethers.Provider, machineKeySigner?: ethers.Wallet) {
    this.config = config;
    this.provider = provider;
    this.machineKeySigner = machineKeySigner ?? null;

    const bundlerUrl =
      config.bundler.endpoint || "https://api.pimlico.io/v2/base/rpc";
    this.bundlerClient = new BundlerClient(
      bundlerUrl,
      config.network.entry_point,
      config.network.chain_id
    );
  }

  private async getBundlerGasPrice(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
    try {
      const bundlerUrl = this.config.bundler.endpoint || "https://public.pimlico.io/v2/8453/rpc";
      const response = await fetch(bundlerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "pimlico_getUserOperationGasPrice",
          params: [],
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json() as {
        result?: { standard?: { maxFeePerGas: string; maxPriorityFeePerGas: string } };
        error?: unknown;
      };
      if (json.error) throw new Error(JSON.stringify(json.error));
      const standard = json.result?.standard;
      if (standard) {
        return {
          maxFeePerGas: BigInt(standard.maxFeePerGas),
          maxPriorityFeePerGas: BigInt(standard.maxPriorityFeePerGas),
        };
      }
    } catch {
      // fallback to provider fee data
    }

    const feeData = await this.provider.getFeeData();
    return {
      maxFeePerGas: feeData.maxFeePerGas ?? BigInt(2_000_000_000),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? BigInt(1_500_000),
    };
  }

  async buildUserOp(callData: string, senderWallet: string): Promise<UserOperation> {
    const entryPointContract = new ethers.Contract(
      this.config.network.entry_point,
      ["function getNonce(address sender, uint192 key) external view returns (uint256)"],
      this.provider
    );
    const nonce: bigint = await entryPointContract.getNonce(senderWallet, 0);
    const { maxFeePerGas, maxPriorityFeePerGas } = await this.getBundlerGasPrice();

    return {
      sender: senderWallet,
      nonce: ethers.toBeHex(nonce),
      callData,
      callGasLimit: ethers.toBeHex(300_000),
      verificationGasLimit: ethers.toBeHex(150_000),
      preVerificationGas: ethers.toBeHex(50_000),
      maxFeePerGas: ethers.toBeHex(maxFeePerGas),
      maxPriorityFeePerGas: ethers.toBeHex(maxPriorityFeePerGas),
      signature: "0x",
    };
  }

  private hashUserOp(userOp: UserOperation): string {
    const initCode = (userOp.factory && userOp.factoryData)
      ? ethers.concat([userOp.factory, userOp.factoryData])
      : "0x";
    const paymasterAndData = userOp.paymaster
      ? ethers.concat([
          userOp.paymaster,
          userOp.paymasterVerificationGasLimit ?? "0x",
          userOp.paymasterPostOpGasLimit ?? "0x",
          userOp.paymasterData ?? "0x",
        ])
      : "0x";

    const verGasLimit = BigInt(userOp.verificationGasLimit);
    const callGasLimit = BigInt(userOp.callGasLimit);
    const accountGasLimits = ethers.zeroPadValue(
      ethers.toBeHex((verGasLimit << BigInt(128)) | callGasLimit),
      32
    );

    const maxPrioFee = BigInt(userOp.maxPriorityFeePerGas);
    const maxFee = BigInt(userOp.maxFeePerGas);
    const gasFees = ethers.zeroPadValue(
      ethers.toBeHex((maxPrioFee << BigInt(128)) | maxFee),
      32
    );

    const packedHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32"],
      [
        userOp.sender,
        BigInt(userOp.nonce),
        ethers.keccak256(initCode),
        ethers.keccak256(userOp.callData),
        accountGasLimits,
        BigInt(userOp.preVerificationGas),
        gasFees,
        ethers.keccak256(paymasterAndData),
      ]
    ));

    return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "uint256"],
      [packedHash, this.config.network.entry_point, this.config.network.chain_id]
    ));
  }

  async submit(callData: string, senderWallet: string): Promise<string> {
    const userOp = await this.buildUserOp(callData, senderWallet);

    if (this.machineKeySigner) {
      const userOpHash = this.hashUserOp(userOp);
      userOp.signature = await this.machineKeySigner.signMessage(ethers.getBytes(userOpHash));
    }

    return this.bundlerClient.sendUserOperation(userOp);
  }

  async waitForInclusion(userOpHash: string): Promise<void> {
    await this.bundlerClient.getUserOperationReceipt(userOpHash);
  }

  async pingBundler(): Promise<boolean> {
    try {
      const bundlerUrl = this.config.bundler.endpoint || "https://api.pimlico.io/v2/base/rpc";
      const response = await fetch(bundlerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
