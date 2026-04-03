import { ethers } from "ethers";
import { Arc402Config } from "./config";

export interface Arc402Client {
  provider: ethers.JsonRpcProvider;
  signer: ethers.Wallet | null;
  address: string | null;
}

export async function getClient(config: Arc402Config): Promise<Arc402Client> {
  // staticNetwork prevents ethers from auto-detecting the network on init,
  // which eliminates the "JsonRpcProvider failed to detect network" retry flood.
  const chainId = config.network === "base-sepolia" ? 84532 : 8453;
  const network = new ethers.Network(config.network ?? "base-mainnet", chainId);
  const provider = new ethers.JsonRpcProvider(config.rpcUrl, network, { staticNetwork: network });

  if (config.privateKey) {
    const signer = new ethers.Wallet(config.privateKey, provider);
    const address = await signer.getAddress();
    return { provider, signer, address };
  }

  // No private key — use walletContractAddress for read-only operations
  const address = config.walletContractAddress ?? null;
  return { provider, signer: null, address };
}

export async function requireSigner(
  config: Arc402Config
): Promise<{ provider: ethers.JsonRpcProvider; signer: ethers.Wallet; address: string }> {
  const { provider, signer } = await getClient(config);
  if (!signer) {
    console.error(
      "No private key configured. Run `arc402 config init` and provide a private key."
    );
    process.exit(1);
  }
  const address = await signer.getAddress();
  return { provider, signer, address };
}
