/**
 * Health routes — GET /health, /agent, /status, /capabilities
 * Replaces the daemon's /health endpoint.
 */
import type { PluginApi } from "../tools/hire.js";
import type { ResolvedConfig } from "../config.js";
import { ethers } from "ethers";

const REGISTRY_V3_ABI = [
  "function getAgent(address wallet) external view returns (tuple(address wallet, string name, string endpoint, bool active, uint256 registeredAt, uint256 trustScore, string[] capabilities))",
];

export function registerHealthRoutes(api: PluginApi, getConfig: () => ResolvedConfig) {
  api.registerHttpRoute({
    method: "GET",
    path: "/health",
    handler: (_req, res) => {
      const cfg = getConfig();
      res.json({
        protocol: "arc402",
        version: "1.0.0",
        status: "ok",
        network: cfg.network,
        wallet: cfg.walletContractAddress ?? null,
        timestamp: new Date().toISOString(),
      });
    },
  });

  api.registerHttpRoute({
    method: "GET",
    path: "/agent",
    handler: async (_req, res) => {
      const cfg = getConfig();
      if (!cfg.walletContractAddress) {
        res.status(404).json({ error: "No wallet configured" });
        return;
      }

      try {
        const rpcProvider = new ethers.JsonRpcProvider(cfg.rpcUrl);
        const registry = new ethers.Contract(cfg.contracts.registryV3, REGISTRY_V3_ABI, rpcProvider);
        const agent = await registry.getAgent(cfg.walletContractAddress);
        res.json({
          wallet: agent.wallet,
          name: agent.name,
          endpoint: agent.endpoint,
          active: agent.active,
          capabilities: agent.capabilities,
          trustScore: Number(agent.trustScore),
          registeredAt: new Date(Number(agent.registeredAt) * 1000).toISOString(),
        });
      } catch (e) {
        res.status(500).json({ error: String(e) });
      }
    },
  });

  api.registerHttpRoute({
    method: "GET",
    path: "/status",
    handler: (_req, res) => {
      const cfg = getConfig();
      res.json({
        protocol: "arc402",
        version: "1.0.0",
        online: true,
        network: cfg.network,
        wallet: cfg.walletContractAddress ?? null,
        endpointHostname: cfg.endpointHostname ?? null,
        workroom: {
          enabled: cfg.workroom?.enabled ?? false,
          compute: cfg.workroom?.compute ?? false,
        },
        daemon: {
          autoAcceptHire: cfg.daemon?.autoAcceptHire ?? false,
          autoAcceptCompute: cfg.daemon?.autoAcceptCompute ?? false,
          maxConcurrentJobs: cfg.daemon?.maxConcurrentJobs ?? 3,
        },
        timestamp: new Date().toISOString(),
      });
    },
  });

  api.registerHttpRoute({
    method: "GET",
    path: "/capabilities",
    handler: async (_req, res) => {
      const cfg = getConfig();
      if (!cfg.walletContractAddress) {
        res.json({ capabilities: [], serviceTypes: [] });
        return;
      }

      try {
        const rpcProvider = new ethers.JsonRpcProvider(cfg.rpcUrl);
        const registry = new ethers.Contract(cfg.contracts.registryV3, REGISTRY_V3_ABI, rpcProvider);
        const agent = await registry.getAgent(cfg.walletContractAddress);
        res.json({ capabilities: agent.capabilities, wallet: agent.wallet });
      } catch {
        res.json({ capabilities: [], serviceTypes: [] });
      }
    },
  });
}
