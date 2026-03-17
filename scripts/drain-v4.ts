/**
 * drain-v4.ts
 * Drains ETH from v4 wallet (0xb4aF8760) to owner (0x7745772d) via WalletConnect.
 * Steps: openContext → attest → executeSpend → closeContext
 */
import { ethers } from "ethers";
import { SignClient } from "@walletconnect/sign-client";
import { KeyValueStorage } from "@walletconnect/keyvaluestorage";
import qrcode from "qrcode-terminal";
import path from "path";
import os from "os";
import * as fs from "fs";

const V4_WALLET    = "0xb4aF8760d349a6A4C8495Ae4da9089bC84994eE6";
const OWNER        = "0x7745772d67Cd52c1F38706bF5550AdcD925c7c00";
const INTENT_ATTEST = "0x7ad8db6C5f394542E8e9658F86C85cC99Cf6D460";
const CHAIN_ID     = 8453;
const RPC          = "https://mainnet.base.org";

// Leave 0.00005 ETH for gas
const DRAIN_AMOUNT = ethers.parseEther("0.00045");

const WALLET_ABI = [
  "function openContext(bytes32 contextId, string calldata taskType) external",
  "function executeSpend(address payable recipient, uint256 amount, string calldata category, bytes32 attestationId) external",
  "function closeContext() external",
];

const ATTEST_ABI = [
  "function attest(bytes32 attestationId, string calldata action, string calldata reason, address recipient, uint256 amount, address token, uint256 expiresAt) external",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const balance = await provider.getBalance(V4_WALLET);
  console.log(`v4 balance: ${ethers.formatEther(balance)} ETH`);

  if (balance < DRAIN_AMOUNT) {
    console.error("Insufficient balance");
    process.exit(1);
  }

  // Load config for machine key
  const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".arc402/config.json"), "utf8"));
  const machineKey = new ethers.Wallet(config.machineKeyPrivateKey, provider);
  console.log(`Machine key: ${machineKey.address}`);

  // WalletConnect setup
  const projectId = config.walletConnectProjectId;
  const storagePath = path.join(os.homedir(), ".arc402/wc-storage.json");
  const client = await SignClient.init({
    projectId,
    metadata: { name: "ARC-402 Drain v4", description: "Drain v4 wallet ETH to owner", url: "https://app.arc402.xyz", icons: [] },
    storage: new KeyValueStorage({ database: storagePath }),
  });

  const { uri, approval } = await client.connect({
    requiredNamespaces: {
      eip155: {
        methods: ["eth_sendTransaction"],
        chains: [`eip155:${CHAIN_ID}`],
        events: ["chainChanged", "accountsChanged"],
      },
    },
  });

  console.log("\nScan this QR in MetaMask (make sure you're on Base):\n");
  qrcode.generate(uri!, { small: true });
  console.log(`\nMetaMask deep link:\nmetamask://wc?uri=${encodeURIComponent(uri!)}\n`);
  console.log("Waiting for MetaMask approval...");

  const session = await approval();
  console.log("✓ MetaMask connected");

  // Build transactions
  const walletIface = new ethers.Interface(WALLET_ABI);
  const attestIface = new ethers.Interface(ATTEST_ABI);

  const contextId = ethers.keccak256(ethers.toUtf8Bytes(`drain-${Date.now()}`));
  const attestationId = ethers.keccak256(ethers.toUtf8Bytes(`attest-${Date.now()}`));
  const expiry = Math.floor(Date.now() / 1000) + 600; // 10 min

  const account = session.namespaces.eip155.accounts[0].split(":")[2];
  console.log(`Owner address: ${account}`);

  async function sendTx(to: string, data: string, description: string) {
    console.log(`\nSending tx: ${description}`);
    const result = await client.request({
      topic: session.topic,
      chainId: `eip155:${CHAIN_ID}`,
      request: {
        method: "eth_sendTransaction",
        params: [{ from: account, to, data, gas: "0x30D40" }],
      },
    });
    console.log(`✓ ${description}: ${result}`);
    // Wait for confirmation
    const receipt = await provider.waitForTransaction(result as string, 1, 60000);
    console.log(`  Confirmed in block ${receipt?.blockNumber}`);
    return result;
  }

  // Step 1: machine key opens context (no WalletConnect needed)
  console.log("\nStep 1: Opening context (machine key)...");
  const walletContract = new ethers.Contract(V4_WALLET, WALLET_ABI, machineKey);
  const openTx = await walletContract.openContext(contextId, "drain");
  await openTx.wait();
  console.log(`✓ Context opened: ${openTx.hash}`);

  // Step 2: owner creates attestation via WalletConnect
  await sendTx(
    INTENT_ATTEST,
    attestIface.encodeFunctionData("attest", [
      attestationId,
      "spend",
      "drain v4 to owner",
      OWNER,
      DRAIN_AMOUNT,
      ethers.ZeroAddress, // ETH not ERC20
      expiry,
    ]),
    "Create spend attestation"
  );

  // Step 3: machine key executes spend
  console.log("\nStep 3: Executing spend (machine key)...");
  const spendTx = await walletContract.executeSpend(OWNER, DRAIN_AMOUNT, "general", attestationId);
  await spendTx.wait();
  console.log(`✓ ETH sent to owner: ${spendTx.hash}`);

  // Step 4: close context
  const closeTx = await walletContract.closeContext();
  await closeTx.wait();
  console.log(`✓ Context closed: ${closeTx.hash}`);

  const newBalance = await provider.getBalance(V4_WALLET);
  console.log(`\nv4 remaining balance: ${ethers.formatEther(newBalance)} ETH`);
  console.log(`Done. ${ethers.formatEther(DRAIN_AMOUNT)} ETH sent to ${OWNER}`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
