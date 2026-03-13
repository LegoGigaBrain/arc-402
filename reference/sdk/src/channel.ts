import { AbstractSigner, ContractRunner, ethers } from "ethers";
import { Channel, ChannelState, ChannelStatus } from "./types";

const CHANNEL_ABI_FRAGMENT = [
  "function openSessionChannel(address provider, address token, uint256 maxAmount, uint256 ratePerCall, uint256 deadline) external payable returns (bytes32 channelId)",
  "function closeChannel(bytes32 channelId, bytes finalState) external",
  "function challengeChannel(bytes32 channelId, bytes latestState) external",
  "function finaliseChallenge(bytes32 channelId) external",
  "function reclaimExpiredChannel(bytes32 channelId) external",
  "function getChannel(bytes32 channelId) external view returns (tuple(address client, address provider, address token, uint256 depositAmount, uint256 settledAmount, uint256 lastSequenceNumber, uint256 deadline, uint256 challengeExpiry, uint8 status))",
  "function getChannelsByClient(address client) external view returns (bytes32[])",
  "function getChannelsByProvider(address provider) external view returns (bytes32[])",
  "event ChannelOpened(bytes32 indexed channelId, address indexed client, address indexed provider, address token, uint256 depositAmount, uint256 deadline)",
  "event ChannelSettled(bytes32 indexed channelId, address indexed provider, uint256 settledAmount, uint256 refundAmount)",
] as const;

export class ChannelClient {
  private contract: ethers.Contract;
  private signer: ethers.Signer | null;

  constructor(address: string, runner: ContractRunner) {
    this.contract = new ethers.Contract(address, CHANNEL_ABI_FRAGMENT, runner);
    this.signer = runner instanceof AbstractSigner ? runner as ethers.Signer : null;
  }

  async openSessionChannel(
    provider: string,
    token: string,
    maxAmount: bigint,
    ratePerCall: bigint,
    deadline: number
  ): Promise<{ channelId: string; txHash: string }> {
    const isEth = token === ethers.ZeroAddress;
    const tx = await this.contract.openSessionChannel(provider, token, maxAmount, ratePerCall, deadline, {
      value: isEth ? maxAmount : 0n
    });
    const receipt = await tx.wait();
    const iface = new ethers.Interface(CHANNEL_ABI_FRAGMENT);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === "ChannelOpened") {
          return { channelId: parsed.args.channelId, txHash: receipt.hash };
        }
      } catch {}
    }
    throw new Error("Could not parse ChannelOpened event");
  }

  async signStateUpdate(
    channelId: string,
    sequenceNumber: number,
    callCount: number,
    cumulativePayment: bigint,
    token: string
  ): Promise<ChannelState> {
    if (!this.signer) throw new Error("Signer required for signing");
    const timestamp = Math.floor(Date.now() / 1000);
    const messageHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "uint256", "uint256", "address", "uint256"],
      [channelId, sequenceNumber, callCount, cumulativePayment, token, timestamp]
    ));
    const sig = await this.signer.signMessage(ethers.getBytes(messageHash));
    // Return partial state — caller fills in counterparty sig
    return {
      channelId,
      sequenceNumber,
      callCount,
      cumulativePayment,
      token,
      timestamp,
      clientSig: sig, // caller sets correct field
    };
  }

  async verifyStateUpdate(state: ChannelState, channel: Channel): Promise<boolean> {
    const messageHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "uint256", "uint256", "address", "uint256"],
      [state.channelId, state.sequenceNumber, state.callCount, state.cumulativePayment, state.token, state.timestamp]
    ));
    try {
      if (state.clientSig) {
        const clientSigner = ethers.verifyMessage(ethers.getBytes(messageHash), state.clientSig);
        if (clientSigner.toLowerCase() !== channel.client.toLowerCase()) return false;
      }
      if (state.providerSig) {
        const providerSigner = ethers.verifyMessage(ethers.getBytes(messageHash), state.providerSig);
        if (providerSigner.toLowerCase() !== channel.provider.toLowerCase()) return false;
      }
      return !!(state.clientSig && state.providerSig);
    } catch {
      return false;
    }
  }

  encodeChannelState(state: ChannelState): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(bytes32 channelId, uint256 sequenceNumber, uint256 callCount, uint256 cumulativePayment, address token, uint256 timestamp, bytes clientSig, bytes providerSig)"],
      [{
        channelId: state.channelId,
        sequenceNumber: state.sequenceNumber,
        callCount: state.callCount,
        cumulativePayment: state.cumulativePayment,
        token: state.token,
        timestamp: state.timestamp,
        clientSig: state.clientSig ?? "0x",
        providerSig: state.providerSig ?? "0x",
      }]
    );
  }

  async closeChannel(channelId: string, finalState: ChannelState): Promise<{ txHash: string }> {
    const encoded = this.encodeChannelState(finalState);
    const tx = await this.contract.closeChannel(channelId, encoded);
    const receipt = await tx.wait();
    return { txHash: receipt.hash };
  }

  async challengeChannel(channelId: string, latestState: ChannelState): Promise<{ txHash: string }> {
    const encoded = this.encodeChannelState(latestState);
    const tx = await this.contract.challengeChannel(channelId, encoded);
    const receipt = await tx.wait();
    return { txHash: receipt.hash };
  }

  async finaliseChallenge(channelId: string): Promise<{ txHash: string }> {
    const tx = await this.contract.finaliseChallenge(channelId);
    const receipt = await tx.wait();
    return { txHash: receipt.hash };
  }

  async reclaimExpiredChannel(channelId: string): Promise<{ txHash: string }> {
    const tx = await this.contract.reclaimExpiredChannel(channelId);
    const receipt = await tx.wait();
    return { txHash: receipt.hash };
  }

  async getChannelStatus(channelId: string): Promise<Channel> {
    const raw = await this.contract.getChannel(channelId);
    const statusMap: Record<number, ChannelStatus> = {
      0: "OPEN", 1: "CLOSING", 2: "CHALLENGED", 3: "SETTLED"
    };
    return {
      client: raw.client,
      provider: raw.provider,
      token: raw.token,
      depositAmount: raw.depositAmount,
      settledAmount: raw.settledAmount,
      lastSequenceNumber: Number(raw.lastSequenceNumber),
      deadline: Number(raw.deadline),
      challengeExpiry: Number(raw.challengeExpiry),
      status: statusMap[Number(raw.status)] ?? "OPEN",
    };
  }

  async getOpenChannels(wallet: string): Promise<Channel[]> {
    const [clientIds, providerIds] = await Promise.all([
      this.contract.getChannelsByClient(wallet),
      this.contract.getChannelsByProvider(wallet),
    ]);
    const allIds = [...new Set([...clientIds, ...providerIds])];
    const channels = await Promise.all(allIds.map(id => this.getChannelStatus(id)));
    return channels.filter(ch => ch.status === "OPEN" || ch.status === "CLOSING" || ch.status === "CHALLENGED");
  }
}
