/**
 * Hire tools — arc402_hire, arc402_accept, arc402_deliver, arc402_verify
 */
import { Type } from "@sinclair/typebox";
import { ethers } from "ethers";
import type { ResolvedConfig } from "../config.js";

// Minimal ServiceAgreement ABI for plugin use
const SERVICE_AGREEMENT_ABI = [
  "function propose(address provider, string serviceType, string capability, bytes32 specHash, uint256 price, address token, uint256 deadline) external payable returns (bytes32 agreementId)",
  "function accept(bytes32 agreementId) external",
  "function fulfill(bytes32 agreementId, bytes32 deliverableHash) external",
  "function verify(bytes32 agreementId) external",
  "function release(bytes32 agreementId) external",
  "function dispute(bytes32 agreementId, string reason) external",
  "function getAgreement(bytes32 agreementId) external view returns (tuple(address client, address provider, string serviceType, string capability, bytes32 specHash, uint256 price, address token, uint256 deadline, uint8 status, bytes32 deliverableHash, uint256 createdAt))",
];

export function registerHireTools(api: PluginApi, getConfig: () => ResolvedConfig) {
  api.registerTool({
    name: "arc402_hire",
    description:
      "Hire an agent for a task — creates a ServiceAgreement on Base with escrow deposit. Returns agreementId.",
    parameters: Type.Object({
      provider: Type.String({ description: "Provider agent wallet address (0x...)" }),
      serviceType: Type.String({ description: "Service type (e.g. ai.code, ai.research, ai.image)" }),
      capability: Type.Optional(Type.String({ description: "Specific capability identifier" })),
      specHash: Type.Optional(Type.String({ description: "keccak256 hash of the job specification (0x...)" })),
      price: Type.String({ description: "Price in ETH (e.g. '0.01') or wei if token is set" }),
      token: Type.Optional(Type.String({ description: "ERC-20 payment token address (omit for ETH)" })),
      deadline: Type.Optional(Type.Number({ description: "Deadline as Unix timestamp (default: 24h from now)" })),
    }),
    async execute(_id, params) {
      const cfg = getConfig();
      if (!cfg.resolvedPrivateKey) {
        return err("ARC-402 plugin not configured: missing privateKey / machineKey");
      }

      const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
      const signer = new ethers.Wallet(cfg.resolvedPrivateKey, provider);
      const contract = new ethers.Contract(cfg.contracts.serviceAgreement, SERVICE_AGREEMENT_ABI, signer);

      const priceWei = ethers.parseEther(params.price);
      const deadline = params.deadline ?? Math.floor(Date.now() / 1000) + 86400;
      const token = params.token ?? ethers.ZeroAddress;
      const specHash = params.specHash ?? ethers.ZeroHash;
      const capability = params.capability ?? params.serviceType;

      const isEth = token === ethers.ZeroAddress;
      const tx = await contract.propose(
        params.provider,
        params.serviceType,
        capability,
        specHash,
        priceWei,
        token,
        deadline,
        { value: isEth ? priceWei : 0n },
      );
      const receipt = await tx.wait();

      return ok({
        agreementId: receipt.logs[0]?.topics[1] ?? "pending",
        txHash: receipt.hash,
        provider: params.provider,
        price: params.price,
        deadline: new Date(deadline * 1000).toISOString(),
        status: "proposed",
      });
    },
  });

  api.registerTool({
    name: "arc402_accept",
    description:
      "Accept an incoming hire proposal — called by the provider agent to accept a ServiceAgreement.",
    parameters: Type.Object({
      agreementId: Type.String({ description: "Agreement ID (bytes32 hex, 0x...)" }),
    }),
    async execute(_id, params) {
      const cfg = getConfig();
      if (!cfg.resolvedPrivateKey) return err("Not configured");

      const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
      const signer = new ethers.Wallet(cfg.resolvedPrivateKey, provider);
      const contract = new ethers.Contract(cfg.contracts.serviceAgreement, SERVICE_AGREEMENT_ABI, signer);

      const tx = await contract.accept(params.agreementId);
      const receipt = await tx.wait();

      return ok({ agreementId: params.agreementId, txHash: receipt.hash, status: "accepted" });
    },
  });

  api.registerTool({
    name: "arc402_deliver",
    description:
      "Mark work as delivered — submits deliverable hash on-chain to trigger payment release.",
    parameters: Type.Object({
      agreementId: Type.String({ description: "Agreement ID (bytes32 hex)" }),
      deliverableHash: Type.String({ description: "keccak256 hash of the delivered work (bytes32 hex)" }),
    }),
    async execute(_id, params) {
      const cfg = getConfig();
      if (!cfg.resolvedPrivateKey) return err("Not configured");

      const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
      const signer = new ethers.Wallet(cfg.resolvedPrivateKey, provider);
      const contract = new ethers.Contract(cfg.contracts.serviceAgreement, SERVICE_AGREEMENT_ABI, signer);

      const tx = await contract.fulfill(params.agreementId, params.deliverableHash);
      const receipt = await tx.wait();

      return ok({ agreementId: params.agreementId, txHash: receipt.hash, status: "fulfilled" });
    },
  });

  api.registerTool({
    name: "arc402_verify",
    description:
      "Verify and release payment after delivery — called by the client to accept the work and release escrow.",
    parameters: Type.Object({
      agreementId: Type.String({ description: "Agreement ID (bytes32 hex)" }),
    }),
    async execute(_id, params) {
      const cfg = getConfig();
      if (!cfg.resolvedPrivateKey) return err("Not configured");

      const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
      const signer = new ethers.Wallet(cfg.resolvedPrivateKey, provider);
      const contract = new ethers.Contract(cfg.contracts.serviceAgreement, SERVICE_AGREEMENT_ABI, signer);

      const tx = await contract.verify(params.agreementId);
      const receipt = await tx.wait();

      return ok({ agreementId: params.agreementId, txHash: receipt.hash, status: "verified", payment: "released" });
    },
  });
}

// ── Plugin API type (minimal shape expected from OpenClaw plugin-sdk) ──────────
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (id: string, params: any) => Promise<ToolResult>;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
}

export interface PluginApi {
  registerTool(def: ToolDefinition): void;
  registerHttpRoute(def: HttpRouteDefinition): void;
  registerHook(def: HookDefinition): void;
  getConfig<T = Record<string, unknown>>(): T;
}

export interface HttpRouteDefinition {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  handler: (req: HttpRequest, res: HttpResponse) => Promise<void> | void;
}

export interface HookDefinition {
  event: string;
  handler: (payload: unknown) => Promise<void> | void;
}

export interface HttpRequest {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
}

export interface HttpResponse {
  json(data: unknown): void;
  status(code: number): HttpResponse;
  send(data: string | Buffer): void;
  setHeader(name: string, value: string): void;
}

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(message: string): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }] };
}
