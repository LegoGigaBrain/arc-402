/**
 * Discovery tool — arc402_discover
 * Queries ARC402RegistryV3 and AgentRegistry to find hireable agents.
 */
import { Type } from "@sinclair/typebox";
import { ethers } from "ethers";
import type { PluginApi, ToolResult } from "./hire.js";
import type { ResolvedConfig } from "../config.js";

const AGENT_REGISTRY_ABI = [
  "function findByCapability(string capability) external view returns (tuple(address wallet, string name, string[] capabilities, string serviceType, string endpoint, string metadataURI, bool active, uint256 registeredAt)[])",
  "function listAgents(uint256 offset, uint256 limit) external view returns (tuple(address wallet, string name, string[] capabilities, string serviceType, string endpoint, string metadataURI, bool active, uint256 registeredAt)[])",
  "function getAgent(address wallet) external view returns (tuple(address wallet, string name, string[] capabilities, string serviceType, string endpoint, string metadataURI, bool active, uint256 registeredAt))",
];

const REGISTRY_V3_ABI = [
  "function getAgent(address wallet) external view returns (tuple(address wallet, string name, string endpoint, bool active, uint256 registeredAt, uint256 trustScore, string[] capabilities))",
  "function listAgents(uint256 offset, uint256 limit) external view returns (tuple(address wallet, string name, string endpoint, bool active, uint256 registeredAt, uint256 trustScore, string[] capabilities)[])",
];

export function registerDiscoverTool(api: PluginApi, getConfig: () => ResolvedConfig) {
  api.registerTool({
    name: "arc402_discover",
    description:
      "Find agents available for hire — queries ARC402RegistryV3 on Base mainnet. Filter by capability, service type, or GPU.",
    parameters: Type.Object({
      capability: Type.Optional(Type.String({ description: "Capability filter (e.g. ai.code, ai.image, compute.gpu)" })),
      serviceType: Type.Optional(Type.String({ description: "Service type filter (e.g. ai.assistant, compute)" })),
      gpu: Type.Optional(Type.String({ description: "GPU spec filter (e.g. nvidia-h100-80gb)" })),
      limit: Type.Optional(Type.Number({ description: "Max results (default 20)" })),
    }),
    async execute(_id, params) {
      const cfg = getConfig();
      const rpcProvider = new ethers.JsonRpcProvider(cfg.rpcUrl);

      const limit = params.limit ?? 20;

      if (params.capability) {
        // Use AgentRegistry.findByCapability for targeted search
        const contract = new ethers.Contract(cfg.contracts.agentRegistry, AGENT_REGISTRY_ABI, rpcProvider);
        const agents = await contract.findByCapability(params.capability);
        const filtered = agents
          .filter((a: { active: boolean }) => a.active)
          .slice(0, limit)
          .map(formatAgent);
        return ok({ agents: filtered, count: filtered.length, filter: { capability: params.capability } });
      }

      // General listing from RegistryV3
      const contract = new ethers.Contract(cfg.contracts.registryV3, REGISTRY_V3_ABI, rpcProvider);
      const agents = await contract.listAgents(0, limit);
      let filtered = agents.filter((a: { active: boolean }) => a.active);

      if (params.serviceType) {
        filtered = filtered.filter((a: { capabilities: string[] }) =>
          a.capabilities.some((c: string) => c.includes(params.serviceType!)),
        );
      }
      if (params.gpu) {
        filtered = filtered.filter((a: { capabilities: string[] }) =>
          a.capabilities.some((c: string) => c.includes("compute") || c.includes("gpu")),
        );
      }

      return ok({
        agents: filtered.slice(0, limit).map(formatAgent),
        count: filtered.length,
        filter: { serviceType: params.serviceType, gpu: params.gpu },
      });
    },
  });
}

function formatAgent(a: {
  wallet: string;
  name: string;
  endpoint: string;
  capabilities: string[];
  serviceType?: string;
  trustScore?: bigint;
  active: boolean;
  registeredAt: bigint;
}) {
  return {
    wallet: a.wallet,
    name: a.name,
    endpoint: a.endpoint,
    capabilities: a.capabilities,
    serviceType: a.serviceType ?? null,
    trustScore: a.trustScore !== undefined ? Number(a.trustScore) : null,
    active: a.active,
    registeredAt: new Date(Number(a.registeredAt) * 1000).toISOString(),
  };
}

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
