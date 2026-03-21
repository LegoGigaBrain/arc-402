import { Command } from "commander";
import { ethers } from "ethers";
import { loadConfig } from "../config";
import { requireSigner } from "../client";
import { c } from "../ui/colors";
import { renderTree } from "../ui/tree";

// Challenge-response: both agents sign a shared nonce with their agent key
// and verify each other against AgentRegistry

const AGENT_REGISTRY_ABI = [
  "function isRegistered(address wallet) view returns (bool)",
  "function getAgent(address wallet) view returns (tuple(address wallet, string endpoint, string serviceType, bool active, uint256 registeredAt))",
];

export function registerHandshakeCommand(program: Command): void {
  program
    .command("handshake <agentAddress>")
    .description("Mutual challenge-response authentication with another ARC-402 agent. Verifies both parties are registered before any negotiation begins.")
    .option("--json", "Output as machine-parseable JSON")
    .action(async (agentAddress: string, opts) => {
      const config = loadConfig();
      const { signer, provider } = await requireSigner(config);
      const myAddress = await signer.getAddress();

      // Generate shared challenge nonce
      const challengeNonce = ethers.hexlify(ethers.randomBytes(32));
      const timestamp = Math.floor(Date.now() / 1000);

      // Sign: keccak256(HANDSHAKE + myAddress + theirAddress + challengeNonce + timestamp)
      const digest = ethers.solidityPackedKeccak256(
        ["string", "address", "address", "bytes32", "uint256"],
        ["HANDSHAKE", myAddress, agentAddress, challengeNonce, timestamp]
      );
      const mySig = await signer.signMessage(ethers.getBytes(digest));

      // Fetch their endpoint from AgentRegistry to send challenge
      if (!config.agentRegistryAddress) throw new Error("agentRegistryAddress not configured");
      const registry = new ethers.Contract(config.agentRegistryAddress, AGENT_REGISTRY_ABI, provider);

      const myRegistered = await registry.isRegistered(myAddress);
      if (!myRegistered) throw new Error(`Your wallet ${myAddress} is not registered in AgentRegistry`);

      const theirAgent = await registry.getAgent(agentAddress);
      if (!theirAgent.active) throw new Error(`Agent ${agentAddress} is not active in AgentRegistry`);

      // For v1: output the signed challenge for manual relay / SDK integration
      // Full async exchange (HTTP POST to their endpoint) is in NegotiationSession flow
      const challenge = {
        type: "HANDSHAKE_CHALLENGE",
        from: myAddress,
        to: agentAddress,
        nonce: challengeNonce,
        timestamp,
        sig: mySig,
        theirEndpoint: theirAgent.endpoint,
      };

      if (opts.json) {
        console.log(JSON.stringify(challenge));
      } else {
        console.log('\n ' + c.mark + c.white(' Handshake'));
        renderTree([
          { label: 'Your identity', value: `${myAddress} (registered)` },
          { label: 'Their identity', value: `${agentAddress} (registered, active)` },
          { label: 'Their endpoint', value: theirAgent.endpoint, last: true },
        ]);
        console.log('\n ' + c.dim('Signed challenge (send to their endpoint to complete handshake):'));
        console.log(JSON.stringify(challenge, null, 2));
      }
    });
}
