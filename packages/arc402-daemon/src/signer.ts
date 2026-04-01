/**
 * arc402-signer — isolated signer process (Spec 46 §16 Pattern 1).
 *
 * Started by index.ts as a child process. Machine key lives here and
 * never in the API process. Accepts requests ONLY via Unix socket.
 *
 * Per-request invariants (re-validated before every sign):
 *   1. Wallet is not frozen (ARC402Wallet.frozen())
 *   2. Machine key is still authorized (_validatePolicyBounds analog:
 *      wallet.authorizedMachineKeys(machineKeyAddress) === true)
 *   3. PolicyEngine.validateSpend.staticCall() passes for the category+amount
 *
 * Socket: /tmp/arc402-signer.sock, chmod 600 (OS-level user isolation).
 * Protocol: newline-delimited JSON (SignRequest → SignResponse).
 */
import * as net from "net";
import * as fs from "fs";
import { ethers } from "ethers";
import {
  loadDaemonConfig,
  loadMachineKey,
} from "./config";
import {
  ARC402_WALLET_MACHINE_KEY_ABI,
  ARC402_WALLET_GUARDIAN_ABI,
} from "./abis";
import { encodeWalletCall } from "./userops";

export const SIGNER_SOCKET_PATH = "/tmp/arc402-signer.sock";

// Minimal PolicyEngine ABI — only what the signer needs
const POLICY_ENGINE_VALIDATE_ABI = [
  "function validateSpend(address wallet, string category, uint256 amount, bytes32 contextId) external view returns (bool, string)",
] as const;

export interface SignRequest {
  requestId: string;
  sessionId: string;
  wallet: string;
  target: string;
  value: string;
  data: string;
  category: string;
  policyEngineAddress: string;
  rpcUrl: string;
}

export interface SignResponse {
  requestId: string;
  ok: boolean;
  signedUserOp?: string;  // JSON-serialized signed UserOp
  error?: string;
}

async function validateAndSign(
  req: SignRequest,
  machineKey: { privateKey: string; address: string },
  entryPoint: string,
  chainId: number
): Promise<SignResponse> {
  const rpcUrl = req.rpcUrl;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(machineKey.privateKey, provider);

  // ─── Re-validate: wallet not frozen ──────────────────────────────────────────
  const walletGuardian = new ethers.Contract(
    req.wallet,
    ARC402_WALLET_GUARDIAN_ABI as unknown as string[],
    provider
  );
  const frozen = await walletGuardian.frozen() as boolean;
  if (frozen) {
    return { requestId: req.requestId, ok: false, error: "wallet_frozen" };
  }

  // ─── Re-validate: machine key still authorized (_validatePolicyBounds) ────────
  const walletMachineKey = new ethers.Contract(
    req.wallet,
    ARC402_WALLET_MACHINE_KEY_ABI as unknown as string[],
    provider
  );
  const authorized = await walletMachineKey.authorizedMachineKeys(machineKey.address) as boolean;
  if (!authorized) {
    return { requestId: req.requestId, ok: false, error: "machine_key_not_authorized" };
  }

  // ─── Re-validate: PolicyEngine.validateSpend.staticCall() ────────────────────
  const peAddr = req.policyEngineAddress;
  if (peAddr && peAddr !== ethers.ZeroAddress) {
    const policyEngine = new ethers.Contract(
      peAddr,
      POLICY_ENGINE_VALIDATE_ABI as unknown as string[],
      provider
    );
    const amount = BigInt(req.value || "0");
    const [ok, reason] = await policyEngine.validateSpend.staticCall(
      req.wallet,
      req.category,
      amount,
      ethers.ZeroHash
    ) as [boolean, string];
    if (!ok) {
      return {
        requestId: req.requestId,
        ok: false,
        error: `policy_rejected: ${reason}`,
      };
    }
  }

  // ─── Build UserOp ─────────────────────────────────────────────────────────────
  const callData = encodeWalletCall(req.target, req.data, BigInt(req.value || "0"));

  const entryPointContract = new ethers.Contract(
    entryPoint,
    ["function getNonce(address sender, uint192 key) external view returns (uint256)"],
    provider
  );
  const nonce: bigint = await entryPointContract.getNonce(req.wallet, 0) as bigint;
  const feeData = await provider.getFeeData();

  const userOp = {
    sender: req.wallet,
    nonce: ethers.toBeHex(nonce),
    callData,
    callGasLimit: ethers.toBeHex(300_000),
    verificationGasLimit: ethers.toBeHex(150_000),
    preVerificationGas: ethers.toBeHex(50_000),
    maxFeePerGas: ethers.toBeHex(feeData.maxFeePerGas ?? BigInt(2_000_000_000)),
    maxPriorityFeePerGas: ethers.toBeHex(feeData.maxPriorityFeePerGas ?? BigInt(1_500_000)),
    signature: "0x",
  };

  // ─── Hash UserOp (ERC-4337 v0.7) ─────────────────────────────────────────────
  const verGasLimit = BigInt(userOp.verificationGasLimit);
  const callGasLimitBig = BigInt(userOp.callGasLimit);
  const accountGasLimits = ethers.zeroPadValue(
    ethers.toBeHex((verGasLimit << BigInt(128)) | callGasLimitBig),
    32
  );
  const maxPrioFee = BigInt(userOp.maxPriorityFeePerGas);
  const maxFee = BigInt(userOp.maxFeePerGas);
  const gasFees = ethers.zeroPadValue(
    ethers.toBeHex((maxPrioFee << BigInt(128)) | maxFee),
    32
  );

  const packedHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32"],
      [
        userOp.sender,
        BigInt(userOp.nonce),
        ethers.keccak256("0x"),              // initCode hash (no factory)
        ethers.keccak256(userOp.callData),
        accountGasLimits,
        BigInt(userOp.preVerificationGas),
        gasFees,
        ethers.keccak256("0x"),             // paymasterAndData hash (no paymaster)
      ]
    )
  );

  const userOpHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "uint256"],
      [packedHash, entryPoint, chainId]
    )
  );

  // ─── Sign ─────────────────────────────────────────────────────────────────────
  userOp.signature = await signer.signMessage(ethers.getBytes(userOpHash));

  return {
    requestId: req.requestId,
    ok: true,
    signedUserOp: JSON.stringify(userOp),
  };
}

async function main(): Promise<void> {
  const config = loadDaemonConfig();
  const machineKey = loadMachineKey(config);

  const entryPoint = config.network.entry_point;
  const chainId = config.network.chain_id;

  // Remove stale socket
  if (fs.existsSync(SIGNER_SOCKET_PATH)) {
    fs.unlinkSync(SIGNER_SOCKET_PATH);
  }

  const server = net.createServer((socket) => {
    let buf = "";

    socket.on("data", (chunk) => {
      buf += chunk.toString();
      let newlineIdx: number;
      while ((newlineIdx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, newlineIdx).trim();
        buf = buf.slice(newlineIdx + 1);
        if (!line) continue;

        let req: SignRequest;
        try {
          req = JSON.parse(line) as SignRequest;
        } catch {
          const errResp: SignResponse = { requestId: "", ok: false, error: "invalid_json" };
          socket.write(JSON.stringify(errResp) + "\n");
          continue;
        }

        validateAndSign(req, machineKey, entryPoint, chainId)
          .then((resp) => {
            socket.write(JSON.stringify(resp) + "\n");
          })
          .catch((err: unknown) => {
            const resp: SignResponse = {
              requestId: req.requestId,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            };
            socket.write(JSON.stringify(resp) + "\n");
          });
      }
    });

    socket.on("error", () => { /* client disconnected cleanly */ });
  });

  server.listen(SIGNER_SOCKET_PATH, () => {
    try {
      fs.chmodSync(SIGNER_SOCKET_PATH, 0o600);
    } catch { /* best-effort */ }
    process.stdout.write(`[signer] Unix socket ready at ${SIGNER_SOCKET_PATH}\n`);
  });

  process.on("SIGTERM", () => { server.close(); process.exit(0); });
  process.on("SIGINT",  () => { server.close(); process.exit(0); });
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `[signer] Fatal: ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  });
}
