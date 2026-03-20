/**
 * ARC-402 Token Usage Metering
 *
 * Tracks LLM token consumption per agreement. The worker writes a usage report
 * file during execution; the daemon reads it after delivery and includes the
 * data in the execution receipt.
 *
 * Architecture:
 *   - Before execution: daemon creates a usage report path for the agreement
 *   - During execution: worker appends usage entries as it calls LLM APIs
 *   - After execution: daemon reads the report, aggregates totals, includes in receipt
 *
 * The worker writes entries in JSON Lines format to:
 *   /workroom/jobs/agreement-<id>/token-usage.jsonl
 *
 * Each line:
 *   {"model":"claude-sonnet-4-6","provider":"anthropic","input":1200,"output":450,"ts":"..."}
 *
 * This is non-invasive — no proxy, no network interception. The worker
 * is responsible for reporting its own usage. OpenClaw agents can do this
 * natively via session metadata.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const ARC402_DIR = path.join(os.homedir(), ".arc402");
const JOBS_DIR = path.join(ARC402_DIR, "jobs");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TokenUsageEntry {
  model: string;
  provider: string;
  input: number;
  output: number;
  ts: string;
  cost_usd?: number;
}

export interface AggregatedTokenUsage {
  total_input: number;
  total_output: number;
  total_tokens: number;
  estimated_cost_usd: number;
  models_used: string[];
  entries: number;
  by_model: Record<string, {
    input: number;
    output: number;
    calls: number;
    cost_usd: number;
  }>;
}

// ─── Known model pricing (USD per 1M tokens, as of 2026-03) ──────────────────

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-opus-4-6":     { input: 15.0,  output: 75.0  },
  "claude-sonnet-4-6":   { input: 3.0,   output: 15.0  },
  "claude-haiku-4-5":    { input: 0.8,   output: 4.0   },
  // OpenAI
  "gpt-5.4":             { input: 2.5,   output: 10.0  },
  "gpt-5.3-codex":       { input: 2.5,   output: 10.0  },
  "gpt-4o":              { input: 2.5,   output: 10.0  },
  "gpt-4o-mini":         { input: 0.15,  output: 0.6   },
  // Google
  "gemini-2.5-pro":      { input: 1.25,  output: 10.0  },
  "gemini-2.5-flash":    { input: 0.15,  output: 0.6   },
  // Defaults
  "default":             { input: 2.0,   output: 8.0   },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["default"];
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

// ─── Usage report path ────────────────────────────────────────────────────────

/**
 * Get the path where the worker should write token usage for an agreement.
 * The daemon sets this as an env var before calling exec_command.
 */
export function getUsageReportPath(agreementId: string): string {
  return path.join(JOBS_DIR, `agreement-${agreementId}`, "token-usage.jsonl");
}

/**
 * Create the parent directory and return the path.
 * Called by the daemon before spawning the worker.
 */
export function prepareUsageReport(agreementId: string): string {
  const reportPath = getUsageReportPath(agreementId);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  return reportPath;
}

// ─── Read and aggregate ───────────────────────────────────────────────────────

/**
 * Read the token usage report for an agreement and aggregate totals.
 * Returns null if no report exists.
 */
export function readUsageReport(agreementId: string): AggregatedTokenUsage | null {
  const reportPath = getUsageReportPath(agreementId);

  if (!fs.existsSync(reportPath)) return null;

  const content = fs.readFileSync(reportPath, "utf-8").trim();
  if (!content) return null;

  const lines = content.split("\n").filter(Boolean);
  const entries: TokenUsageEntry[] = [];

  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as TokenUsageEntry);
    } catch {
      // Skip malformed lines
    }
  }

  if (entries.length === 0) return null;

  // Aggregate
  const byModel: Record<string, { input: number; output: number; calls: number; cost_usd: number }> = {};
  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;

  for (const entry of entries) {
    totalInput += entry.input;
    totalOutput += entry.output;

    const model = entry.model || "unknown";
    if (!byModel[model]) {
      byModel[model] = { input: 0, output: 0, calls: 0, cost_usd: 0 };
    }
    byModel[model].input += entry.input;
    byModel[model].output += entry.output;
    byModel[model].calls += 1;

    const cost = entry.cost_usd ?? estimateCost(model, entry.input, entry.output);
    byModel[model].cost_usd += cost;
    totalCost += cost;
  }

  return {
    total_input: totalInput,
    total_output: totalOutput,
    total_tokens: totalInput + totalOutput,
    estimated_cost_usd: Math.round(totalCost * 10000) / 10000, // 4 decimal places
    models_used: Object.keys(byModel),
    entries: entries.length,
    by_model: byModel,
  };
}

// ─── CLI display helper ───────────────────────────────────────────────────────

/**
 * Format token usage for CLI display.
 */
export function formatUsageReport(usage: AggregatedTokenUsage): string {
  const lines: string[] = [];
  lines.push(`Token Usage`);
  lines.push(`───────────`);
  lines.push(`Total tokens:  ${usage.total_tokens.toLocaleString()} (${usage.total_input.toLocaleString()} in / ${usage.total_output.toLocaleString()} out)`);
  lines.push(`Est. cost:     $${usage.estimated_cost_usd.toFixed(4)}`);
  lines.push(`LLM calls:     ${usage.entries}`);
  lines.push(``);

  if (Object.keys(usage.by_model).length > 1) {
    lines.push(`By model:`);
    for (const [model, data] of Object.entries(usage.by_model)) {
      lines.push(`  ${model.padEnd(24)} ${data.calls} calls  ${(data.input + data.output).toLocaleString()} tokens  $${data.cost_usd.toFixed(4)}`);
    }
  }

  return lines.join("\n");
}
