import { ethers } from "ethers";

export async function buildSigningUrl(
  action: string,
  params: Record<string, string>,
  agentPrivateKey: string,
  chainId: number
): Promise<string> {
  const created = Math.floor(Date.now() / 1000).toString();
  const nonce = params.nonce ?? "0";
  const wallet = params.wallet ?? "";
  const message = `${action}:${wallet}:${chainId}:${nonce}:${created}`;

  const signer = new ethers.Wallet(agentPrivateKey);
  const sig = await signer.signMessage(message);

  const urlParams = new URLSearchParams({
    action,
    chain: chainId.toString(),
    created,
    nonce,
    sig,
    agentAddress: signer.address,
    ...params,
  });

  return `https://arc402.xyz/sign?${urlParams.toString()}`;
}
