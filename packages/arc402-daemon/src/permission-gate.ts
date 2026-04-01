import { ethers } from "ethers";

const POLICY_ENGINE_VALIDATE_ABI = [
  "function validateSpend(address wallet, string category, uint256 amount, bytes32 contextId) external view returns (bool, string)",
] as const;

const CACHE_TTL_MS = 5 * 60 * 1000;

type PermissionCategory = "hire" | "compute" | "general" | "deliver" | "verify";

export interface ToolPermissionContext {
  agreementId: string;
  walletAddress: `0x${string}`;
  policyEngineAddress: `0x${string}`;
  provider: ethers.Provider;
}

export interface ToolPermission {
  tool: string;
  input: unknown;
  context: ToolPermissionContext;
}

export type PermissionDecision =
  | { granted: true; estimatedSpend?: bigint }
  | { granted: false; reason: string; estimatedSpend?: bigint };

export interface PermissionGateDependencies {
  createPolicyEngine?: (
    address: string,
    provider: ethers.Provider
  ) => {
    validateSpend: {
      staticCall: (
        wallet: string,
        category: string,
        amount: bigint,
        contextId: string
      ) => Promise<[boolean, string]>;
    };
  };
}

interface SpendIntent {
  category: PermissionCategory;
  amount: bigint;
  reason: string;
}

interface CacheEntry {
  expiresAt: number;
  decision: PermissionDecision;
}

const decisionCache = new Map<string, CacheEntry>();
const spendAccumulator = new Map<string, bigint>();

export async function checkPermissions(
  p: ToolPermission,
  deps: PermissionGateDependencies = {}
): Promise<PermissionDecision> {
  const intent = deriveSpendIntent(p);
  if (intent.amount === 0n) {
    return { granted: true, estimatedSpend: 0n };
  }

  const jobKey = `${p.context.agreementId}:${intent.category}`;
  const currentSpend = spendAccumulator.get(jobKey) ?? 0n;
  const projectedSpend = currentSpend + intent.amount;
  const cacheKey = [
    p.context.policyEngineAddress.toLowerCase(),
    p.context.walletAddress.toLowerCase(),
    p.context.agreementId,
    intent.category,
    projectedSpend.toString(),
  ].join(":");

  const cached = decisionCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    if (cached.decision.granted) {
      spendAccumulator.set(jobKey, projectedSpend);
    }
    return cached.decision;
  }

  const pe = deps.createPolicyEngine?.(p.context.policyEngineAddress, p.context.provider) ??
    new ethers.Contract(
      p.context.policyEngineAddress,
      POLICY_ENGINE_VALIDATE_ABI as unknown as string[],
      p.context.provider
    );

  let decision: PermissionDecision;
  try {
    const [ok, reason] = await pe.validateSpend.staticCall(
      p.context.walletAddress,
      intent.category,
      projectedSpend,
      ethers.ZeroHash
    ) as [boolean, string];

    if (!ok) {
      decision = {
        granted: false,
        reason: reason || intent.reason,
        estimatedSpend: projectedSpend,
      };
    } else {
      decision = {
        granted: true,
        estimatedSpend: projectedSpend,
      };
      spendAccumulator.set(jobKey, projectedSpend);
    }
  } catch (error) {
    decision = {
      granted: false,
      reason: `policy_validation_rpc_error: ${formatRpcError(error)}`,
      estimatedSpend: projectedSpend,
    };
  }

  decisionCache.set(cacheKey, { decision, expiresAt: now + CACHE_TTL_MS });
  return decision;
}

export function resetPermissionCache(): void {
  decisionCache.clear();
  spendAccumulator.clear();
}

function deriveSpendIntent(permission: ToolPermission): SpendIntent {
  switch (permission.tool) {
    case "arc402_hire":
      return {
        category: "hire",
        amount: parseEthValue((permission.input as { price?: unknown }).price),
        reason: "hire amount would exceed PolicyEngine limits",
      };
    case "arc402_compute_hire": {
      const input = permission.input as { maxCost?: unknown; ratePerHour?: unknown; maxHours?: unknown };
      const explicitMaxCost = parseEthValue(input.maxCost);
      const computedMaxCost = parseEthValue(input.ratePerHour) * parseBigIntValue(input.maxHours);
      const amount = explicitMaxCost > 0n ? explicitMaxCost : computedMaxCost;
      return {
        category: "compute",
        amount,
        reason: "max compute cost would exceed PolicyEngine limits",
      };
    }
    case "arc402_subscribe": {
      const input = permission.input as { total?: unknown; ratePerMonth?: unknown; months?: unknown };
      const explicitTotal = parseEthValue(input.total);
      const computedTotal = parseEthValue(input.ratePerMonth) * parseBigIntValue(input.months || 1);
      const amount = explicitTotal > 0n ? explicitTotal : computedTotal;
      return {
        category: "general",
        amount,
        reason: "subscription cost would exceed PolicyEngine limits",
      };
    }
    case "arc402_deliver":
      return { category: "deliver", amount: 0n, reason: "" };
    case "arc402_verify":
      return { category: "verify", amount: 0n, reason: "" };
    default: {
      const input = permission.input as { category?: unknown; amount?: unknown; estimatedSpend?: unknown };
      const category = normalizeCategory(input.category);
      const amount = parseEthValue(input.amount) || parseEthValue(input.estimatedSpend);
      return {
        category,
        amount,
        reason: `${permission.tool} would exceed PolicyEngine limits`,
      };
    }
  }
}

function parseEthValue(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return ethers.parseEther(value.toString());
  }
  if (typeof value !== "string") return 0n;

  const trimmed = value.trim();
  if (!trimmed) return 0n;

  if (/^\d+$/.test(trimmed)) {
    return BigInt(trimmed);
  }

  try {
    return ethers.parseEther(trimmed);
  } catch {
    return 0n;
  }
}

function parseBigIntValue(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.floor(value));
  if (typeof value === "string" && value.trim()) {
    try {
      return BigInt(value.trim());
    } catch {
      return 0n;
    }
  }
  return 0n;
}

function normalizeCategory(category: unknown): PermissionCategory {
  if (category === "hire" || category === "compute" || category === "general") {
    return category;
  }
  return "general";
}

function formatRpcError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}
