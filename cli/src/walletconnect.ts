import { SignClient } from "@walletconnect/sign-client";
import qrcode from "qrcode-terminal";

export async function requestPhoneWalletSignature(
  projectId: string,
  chainId: number,
  buildTx: (account: string) => { to: string; data: string; value?: string },
  prompt: string
): Promise<{ txHash: string; account: string }> {
  const client = await SignClient.init({
    projectId,
    metadata: {
      name: "ARC-402 CLI",
      description: "ARC-402 Protocol CLI",
      url: "https://arc402.xyz",
      icons: [],
    },
  });

  const { uri, approval } = await client.connect({
    requiredNamespaces: {
      eip155: {
        methods: ["eth_sendTransaction", "personal_sign"],
        chains: [`eip155:${chainId}`],
        events: ["accountsChanged"],
      },
    },
  });

  if (!uri) throw new Error("Failed to create WalletConnect session");

  console.log(`\n${prompt}`);
  console.log("Scan with MetaMask, Rabby, or Coinbase Wallet:\n");
  qrcode.generate(uri, { small: true });
  console.log("\nWaiting for approval...");

  const session = await approval();
  const account = session.namespaces.eip155.accounts[0].split(":")[2];

  const tx = buildTx(account);
  const txHash = await client.request<string>({
    topic: session.topic,
    chainId: `eip155:${chainId}`,
    request: {
      method: "eth_sendTransaction",
      params: [{ from: account, to: tx.to, data: tx.data, value: tx.value ?? "0x0" }],
    },
  });

  await client.disconnect({ topic: session.topic, reason: { code: 0, message: "done" } });
  return { txHash, account };
}
