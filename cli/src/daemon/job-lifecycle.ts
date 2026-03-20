/**
 * ARC-402 Job Lifecycle — Post-delivery processing.
 *
 * Handles everything that happens after a worker completes a job:
 *   1. Execution receipt generation
 *   2. Learning extraction from completed work
 *   3. Worker memory update
 *   4. Per-agreement job directory management
 *
 * These functions are called by the daemon after a successful delivery.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { readUsageReport, type AggregatedTokenUsage } from "./token-metering";

const ARC402_DIR = path.join(os.homedir(), ".arc402");
const RECEIPTS_DIR = path.join(ARC402_DIR, "receipts");
const WORKER_DIR = path.join(ARC402_DIR, "worker");
const WORKER_MEMORY_DIR = path.join(WORKER_DIR, "memory");
const WORKER_CONFIG = path.join(WORKER_DIR, "config.json");
const JOBS_DIR = path.join(ARC402_DIR, "jobs");

// ─── Execution Receipt ────────────────────────────────────────────────────────

export interface ExecutionReceipt {
  schema: "arc402.execution-receipt.v1";
  agreement_id: string;
  workroom_policy_hash: string;
  started_at: string;
  completed_at: string;
  deliverable_hash: string;
  worker_address: string;
  metrics: {
    wall_clock_seconds: number;
    network_hosts_contacted: string[];
    policy_violations_attempted: number;
  };
  token_usage: AggregatedTokenUsage | null;
  receipt_hash: string;
}

/**
 * Generate and persist an execution receipt after job delivery.
 */
export function generateReceipt(params: {
  agreementId: string;
  deliverableHash: string;
  walletAddress: string;
  startedAt: string;
  completedAt: string;
  policyFilePath?: string;
  networkHosts?: string[];
}): ExecutionReceipt {
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

  // Compute policy hash
  let policyHash = "0x0";
  const policyPath = params.policyFilePath ?? path.join(ARC402_DIR, "openshell-policy.yaml");
  if (fs.existsSync(policyPath)) {
    const content = fs.readFileSync(policyPath, "utf-8");
    policyHash = "0x" + crypto.createHash("sha256").update(content).digest("hex");
  }

  // Calculate wall clock time
  const started = new Date(params.startedAt).getTime();
  const completed = new Date(params.completedAt).getTime();
  const wallClockSeconds = Math.max(0, Math.floor((completed - started) / 1000));

  // Read token usage report (if the worker wrote one)
  const tokenUsage = readUsageReport(params.agreementId);

  const receipt: ExecutionReceipt = {
    schema: "arc402.execution-receipt.v1",
    agreement_id: params.agreementId,
    workroom_policy_hash: policyHash,
    started_at: params.startedAt,
    completed_at: params.completedAt,
    deliverable_hash: params.deliverableHash,
    worker_address: params.walletAddress,
    metrics: {
      wall_clock_seconds: wallClockSeconds,
      network_hosts_contacted: params.networkHosts ?? [],
      policy_violations_attempted: 0,
    },
    token_usage: tokenUsage,
    receipt_hash: "", // filled below
  };

  // Receipt hash = SHA-256 of the receipt content (without the hash field)
  const hashInput = JSON.stringify({ ...receipt, receipt_hash: undefined });
  receipt.receipt_hash = "0x" + crypto.createHash("sha256").update(hashInput).digest("hex");

  // Persist
  const receiptPath = path.join(RECEIPTS_DIR, `${params.agreementId}.json`);
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));

  return receipt;
}

// ─── Learning Extraction ──────────────────────────────────────────────────────

/**
 * Extract learnings from a completed job and update worker memory.
 *
 * This creates:
 *   1. A per-job memory file: memory/job-<id>.md
 *   2. Updates the cumulative learnings.md
 *   3. Updates the worker config (job count, earnings)
 */
export function extractLearnings(params: {
  agreementId: string;
  taskDescription: string;
  deliverableHash: string;
  priceEth: string;
  capability: string;
  wallClockSeconds: number;
  success: boolean;
}): void {
  fs.mkdirSync(WORKER_MEMORY_DIR, { recursive: true });

  const now = new Date().toISOString();
  const dateStr = now.split("T")[0];

  // 1. Per-job memory file
  const jobMemory = `# Job: ${params.agreementId}
*Completed: ${now}*
*Capability: ${params.capability}*
*Price: ${params.priceEth} ETH*
*Duration: ${params.wallClockSeconds}s*
*Outcome: ${params.success ? "delivered" : "failed"}*

## Task
${params.taskDescription}

## Deliverable
Hash: ${params.deliverableHash}

## Learnings
- Completed ${params.capability} task in ${params.wallClockSeconds}s
- ${params.success ? "Delivered successfully" : "Delivery failed — review required"}
`;

  const jobFile = path.join(WORKER_MEMORY_DIR, `job-${params.agreementId}.md`);
  fs.writeFileSync(jobFile, jobMemory);

  // 2. Update cumulative learnings.md
  const learningsPath = path.join(WORKER_MEMORY_DIR, "learnings.md");
  let learnings = "";
  if (fs.existsSync(learningsPath)) {
    learnings = fs.readFileSync(learningsPath, "utf-8");
  }

  const newEntry = `\n### ${dateStr} — ${params.capability} (${params.agreementId.slice(0, 8)}...)
- Duration: ${params.wallClockSeconds}s | Price: ${params.priceEth} ETH | Outcome: ${params.success ? "✓" : "✗"}
`;

  // Append to learnings
  if (learnings.includes("No learnings yet")) {
    learnings = `# Accumulated Learnings\n\n*Auto-updated after each completed job.*\n${newEntry}`;
  } else {
    learnings += newEntry;
  }
  fs.writeFileSync(learningsPath, learnings);

  // 3. Update worker config
  if (fs.existsSync(WORKER_CONFIG)) {
    try {
      const config = JSON.parse(fs.readFileSync(WORKER_CONFIG, "utf-8"));
      config.job_count = (config.job_count || 0) + 1;
      const currentEarnings = parseFloat(config.total_earned_eth || "0");
      const jobEarnings = parseFloat(params.priceEth || "0");
      config.total_earned_eth = (currentEarnings + jobEarnings).toFixed(6);
      config.last_job_at = now;
      fs.writeFileSync(WORKER_CONFIG, JSON.stringify(config, null, 2));
    } catch { /* non-fatal — config may be malformed */ }
  }
}

// ─── Per-Agreement Job Directory ──────────────────────────────────────────────

/**
 * Create an isolated job directory for a specific agreement.
 * Returns the path to the job workspace.
 */
export function createJobDirectory(agreementId: string): string {
  const jobDir = path.join(JOBS_DIR, `agreement-${agreementId}`);
  fs.mkdirSync(jobDir, { recursive: true });
  return jobDir;
}

/**
 * Clean up a job directory after settlement.
 * Preserves the receipt and job memory — only removes working files.
 */
export function cleanJobDirectory(agreementId: string): void {
  const jobDir = path.join(JOBS_DIR, `agreement-${agreementId}`);
  if (fs.existsSync(jobDir)) {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

// ─── Policy Hash ──────────────────────────────────────────────────────────────

/**
 * Compute the SHA-256 hash of the current workroom policy.
 * This hash can be registered in AgentRegistry for verifiability.
 */
export function computePolicyHash(policyFilePath?: string): string {
  const policyPath = policyFilePath ?? path.join(ARC402_DIR, "openshell-policy.yaml");
  if (!fs.existsSync(policyPath)) return "0x0";
  const content = fs.readFileSync(policyPath, "utf-8");
  return "0x" + crypto.createHash("sha256").update(content).digest("hex");
}
