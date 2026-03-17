/**
 * register-agent-userop.ts
 * Register GigaBrain in AgentRegistry via ERC-4337 UserOperation.
 * Machine key signs → Pimlico bundler → EntryPoint executes → wallet is msg.sender.
 */

import { ethers } from "ethers";
import { loadConfig } from "../src/config";
import { BundlerClient, buildUserOp } from "../src/bundler";
import { ARC402_WALLET_EXECUTE_ABI, AGENT_REGISTRY_ABI } from "../src/abis";

const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const CHAIN_ID = 8453;

// EntryPoint v0.7 nonce getter ABI
const EP_ABI = [
  "function getNonce(address sender, uint192 key) external view returns (uint256)",
  "function depositTo(address account) external payable",
  "function balanceOf(address account) external view returns (uint256)",
];

async function main() {
  const config = loadConfig();
  if (!config.walletContractAddress) throw new Error("walletContractAddress not in config");
  if (!config.privateKey) throw new Error("privateKey not in config");

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const machineKey = new ethers.Wallet(config.privateKey, provider);
  const walletAddress = config.walletContractAddress;

  const agentRegistryAddress =
    config.agentRegistryV2Address ??
    "0xD5c2851B00090c92Ba7F4723FB548bb30C9B6865";

  console.log("Wallet:         ", walletAddress);
  console.log("Machine key:    ", machineKey.address);
  console.log("AgentRegistry:  ", agentRegistryAddress);

  // ── 1. Check ETH balance ───────────────────────────────────────────────────
  const balance = await provider.getBalance(walletAddress);
  console.log("Wallet balance: ", ethers.formatEther(balance), "ETH");
  if (balance < ethers.parseEther("0.0005")) {
    throw new Error("Wallet balance too low — need at least 0.0005 ETH");
  }

  // ── 2. Get nonce from EntryPoint ───────────────────────────────────────────
  const ep = new ethers.Contract(ENTRY_POINT, EP_ABI, provider);
  const nonce: bigint = await ep.getNonce(walletAddress, 0);
  console.log("Nonce:          ", nonce.toString());

  // ── 3. Encode AgentRegistry.register() calldata ───────────────────────────
  const registryIface = new ethers.Interface(AGENT_REGISTRY_ABI);
  const registerCalldata = registryIface.encodeFunctionData("register", [
    "GigaBrain",           // name
    [],                    // capabilities (empty for now)
    "ai.assistant",        // serviceType
    "https://gigabrain.arc402.xyz",  // endpoint
    "",                    // metadataURI
  ]);

  // ── 4. Encode ARC402Wallet.executeContractCall() — this is the UserOp callData ──
  const walletIface = new ethers.Interface(ARC402_WALLET_EXECUTE_ABI);
  const userOpCallData = walletIface.encodeFunctionData("executeContractCall", [{
    target: agentRegistryAddress,
    data: registerCalldata,
    value: BigInt(0),
    minReturnValue: BigInt(0),
    maxApprovalAmount: BigInt(0),
    approvalToken: ethers.ZeroAddress,
  }]);

  console.log("UserOp callData built ✓");

  // ── 5. Build UserOp — fetch live gas price from Pimlico ───────────────────
  // Declare bundlerUrl here so it's available for gas price fetch AND sending
  const bundlerUrl = (config as unknown as Record<string, unknown>)["bundlerUrl"] as string | undefined ?? "https://public.pimlico.io/v2/8453/rpc";
  const gasPriceRes = await fetch(bundlerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "pimlico_getUserOperationGasPrice", params: [] }),
  });
  const gasPriceJson = await gasPriceRes.json() as { result?: { fast?: { maxFeePerGas: string; maxPriorityFeePerGas: string } } };
  const fast = gasPriceJson.result?.fast;
  if (!fast) throw new Error("Could not fetch gas price from bundler");
  console.log("Gas price (fast): maxFee=", fast.maxFeePerGas, "maxPriority=", fast.maxPriorityFeePerGas);

  const userOp = await buildUserOp(userOpCallData, walletAddress, nonce, config);
  // Override with bundler-recommended gas prices
  userOp.maxFeePerGas = fast.maxFeePerGas;
  userOp.maxPriorityFeePerGas = fast.maxPriorityFeePerGas;
  // Bump callGasLimit — executeContractCall + AgentRegistry.register needs ~330k
  userOp.callGasLimit = ethers.toBeHex(500_000);
  userOp.verificationGasLimit = ethers.toBeHex(200_000);

  // ── 6. Sign UserOp with machine key ───────────────────────────────────────
  // ERC-4337 v0.7: hash = keccak256(abi.encode(userOpHash, entryPoint, chainId))
  // where userOpHash = keccak256(packed(userOp fields))
  const packedFields = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address","uint256","bytes32","bytes32","bytes32","uint256","bytes32","bytes32"],
    [
      userOp.sender,
      BigInt(userOp.nonce),
      ethers.keccak256(ethers.concat(
        userOp.factory ? [userOp.factory, userOp.factoryData ?? "0x"] : []
      )),
      ethers.keccak256(userOp.callData),
      ethers.concat([
        ethers.zeroPadValue(ethers.toBeHex(userOp.callGasLimit), 16),
        ethers.zeroPadValue(ethers.toBeHex(userOp.verificationGasLimit), 16),
      ]),
      BigInt(userOp.preVerificationGas),
      ethers.concat([
        ethers.zeroPadValue(ethers.toBeHex(userOp.maxPriorityFeePerGas), 16),
        ethers.zeroPadValue(ethers.toBeHex(userOp.maxFeePerGas), 16),
      ]),
      ethers.keccak256(
        userOp.paymaster
          ? ethers.concat([
              userOp.paymaster,
              ethers.zeroPadValue(ethers.toBeHex(userOp.paymasterVerificationGasLimit ?? "0x0"), 16),
              ethers.zeroPadValue(ethers.toBeHex(userOp.paymasterPostOpGasLimit ?? "0x0"), 16),
              userOp.paymasterData ?? "0x",
            ])
          : "0x"
      ),
    ]
  );
  const userOpHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32","address","uint256"],
      [
        ethers.keccak256(packedFields),
        ENTRY_POINT,
        CHAIN_ID,
      ]
    )
  );
  console.log("UserOp hash:    ", userOpHash);

  // validateUserOp uses toEthSignedMessageHash — sign the eth-prefixed hash
  const signature = await machineKey.signMessage(ethers.getBytes(userOpHash));
  userOp.signature = signature;
  console.log("Signed ✓");

  // ── 7. Send to bundler ─────────────────────────────────────────────────────
  const bundler = new BundlerClient(bundlerUrl, ENTRY_POINT, CHAIN_ID);

  console.log("Sending UserOperation to bundler...");
  let opHash: string;
  try {
    opHash = await bundler.sendUserOperation(userOp);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Bundler rejected UserOp: ${msg}`);
  }
  console.log("UserOp hash:    ", opHash);
  console.log("Waiting for confirmation (up to 60s)...");

  const receipt = await bundler.getUserOperationReceipt(opHash);
  if (!receipt.success) {
    throw new Error(`UserOp failed on-chain. Tx: ${receipt.receipt.transactionHash}`);
  }
  console.log("✓ AgentRegistry.register() confirmed");
  console.log("  Tx:", receipt.receipt.transactionHash);

  // ── 8. Claim subdomain ─────────────────────────────────────────────────────
  console.log("\nClaiming gigabrain.arc402.xyz...");
  const res = await fetch("https://api.arc402.xyz/register-subdomain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subdomain: "gigabrain",
      walletAddress,
      tunnelTarget: "https://gigabrain.arc402.xyz",
    }),
  });
  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    console.error("✗ Subdomain claim failed:", body["error"] ?? body);
    process.exit(1);
  }
  console.log("✓ Subdomain claimed:", body["subdomain"]);
  console.log("\nAll done. GigaBrain is registered and live.");
}

main().catch(e => { console.error(e); process.exit(1); });
