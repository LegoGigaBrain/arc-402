import { ethers } from "ethers";
import { Arc402Config } from "./config";

export interface Arc402Client {
  provider: ethers.JsonRpcProvider;
  signer: ethers.Wallet | null;
  address: string | null;
}

export async function getClient(config: Arc402Config): Promise<Arc402Client> {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);

  if (config.privateKey) {
    const signer = new ethers.Wallet(config.privateKey, provider);
    const address = await signer.getAddress();
    return { provider, signer, address };
  }

  return { provider, signer: null, address: null };
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
