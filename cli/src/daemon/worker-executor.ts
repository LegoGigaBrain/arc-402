/**
 * ARC-402 Worker Executor
 *
 * Spawns an agent to complete hired work inside the job directory.
 * On completion, scans the job dir for output files and uploads them to
 * FileDeliveryManager. Computes root hash for on-chain delivery.
 *
 * Supported agent runtimes:
 *   - openclaw (preferred): Full OpenClaw gateway — can spawn any ACP
 *     (Claude Code, Codex, Gemini, Pi, etc.) and orchestrate multi-agent work.
 *     Command: openclaw run '<task>' --workdir <jobDir>
 *   - claude-code: Direct Claude Code CLI.
 *     Command: claude --permission-mode bypassPermissions --print '<task>'
 *   - codex: Direct Codex CLI.
 *     Command: codex --print '<task>'
 *   - shell: Raw shell execution.
 *     Command: /bin/sh -c '<task>'
 *
 * Job directory: ~/.arc402/jobs/agreement-<id>/
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as http from "http";
import * as https from "https";
import { spawn, type ChildProcess } from "child_process";
import { ethers } from "ethers";
import { FileDeliveryManager, type DeliveryManifest } from "./file-delivery.js";
import { createJobDirectory } from "./job-lifecycle.js";

const ARC402_DIR = path.join(os.homedir(), ".arc402");
const JOBS_DIR = path.join(ARC402_DIR, "jobs");
const WORKER_DIR = process.env.ARC402_WORKER_DIR || path.join(ARC402_DIR, "worker");

// ─── Helpers: read worker context ─────────────────────────────────────────────

function readFileOrEmpty(filePath: string): string {
  try { return fs.readFileSync(filePath, "utf-8").trim(); } catch { return ""; }
}

/**
 * Read all .md files from a directory, concatenated, up to maxBytes.
 * Returns empty string if dir doesn't exist or is empty.
 */
function readDirMd(dirPath: string, maxBytes: number): string {
  if (!fs.existsSync(dirPath)) return "";
  const parts: string[] = [];
  let totalSize = 0;
  try {
    const files = fs.readdirSync(dirPath)
      .filter(f => f.endsWith(".md") || f.endsWith(".txt") || f.endsWith(".json"))
      .sort();
    for (const file of files) {
      if (file.startsWith(".")) continue;
      const content = readFileOrEmpty(path.join(dirPath, file));
      if (!content) continue;
      const entry = `### ${file}\n${content}`;
      if (totalSize + entry.length > maxBytes) break;
      parts.push(entry);
      totalSize += entry.length;
    }
  } catch { /* dir unreadable */ }
  return parts.join("\n\n");
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkerStatus = "queued" | "running" | "completed" | "failed";
export type AgentType = "openclaw" | "claude-code" | "codex" | "shell";

export interface WorkerExecution {
  agreementId: string;
  capability: string;
  specHash: string;
  jobDir: string;
  agentType: AgentType;
  pid: number | null;
  status: WorkerStatus;
  startedAt: number;
  completedAt: number | null;
  exitCode: number | null;
  deliverableHash: string | null; // root_hash after upload
  error: string | null;
}

interface ExecutionRecord extends WorkerExecution {
  process: ChildProcess | null;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

// ─── WorkerExecutor ───────────────────────────────────────────────────────────

export class WorkerExecutor {
  private readonly maxConcurrentJobs: number;
  private readonly jobTimeoutMs: number;
  private readonly agentType: AgentType;
  private readonly autoExecute: boolean;
  private readonly delivery: FileDeliveryManager;
  private readonly signer: ethers.Signer | null;
  private readonly serviceAgreementAddress: string | null;

  private readonly jobs = new Map<string, ExecutionRecord>();
  private queue: string[] = [];
  private runningCount = 0;

  // Callback invoked when a job completes with a root hash
  onJobCompleted: ((agreementId: string, rootHash: string) => void) | null = null;
  onJobFailed: ((agreementId: string, error: string) => void) | null = null;
  log: (entry: Record<string, unknown>) => void = () => {};

  constructor(opts: {
    maxConcurrentJobs?: number;
    jobTimeoutSeconds?: number;
    agentType?: AgentType;
    autoExecute?: boolean;
    delivery: FileDeliveryManager;
    signer?: ethers.Signer | null;
    serviceAgreementAddress?: string | null;
  }) {
    this.maxConcurrentJobs = opts.maxConcurrentJobs ?? 2;
    this.jobTimeoutMs = (opts.jobTimeoutSeconds ?? 3600) * 1000;
    this.agentType = opts.agentType ?? "openclaw";
    this.autoExecute = opts.autoExecute ?? true;
    this.delivery = opts.delivery;
    this.signer = opts.signer ?? null;
    this.serviceAgreementAddress = opts.serviceAgreementAddress ?? null;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Enqueue a job. If auto_execute is true, starts immediately (up to concurrency limit).
   * Returns the WorkerExecution record.
   */
  enqueue(params: {
    agreementId: string;
    capability: string;
    specHash: string;
    taskDescription?: string;
  }): WorkerExecution {
    const { agreementId, capability, specHash } = params;

    // Idempotent — return existing record if present
    const existing = this.jobs.get(agreementId);
    if (existing) return this.toPublic(existing);

    const jobDir = createJobDirectory(agreementId);

    // Write task.md to job dir
    const taskText = params.taskDescription ?? this.buildTask(capability, specHash, agreementId);
    fs.writeFileSync(path.join(jobDir, "task.md"), taskText, "utf-8");

    const record: ExecutionRecord = {
      agreementId,
      capability,
      specHash,
      jobDir,
      agentType: this.agentType,
      pid: null,
      status: "queued",
      startedAt: Date.now(),
      completedAt: null,
      exitCode: null,
      deliverableHash: null,
      error: null,
      process: null,
      timeoutHandle: null,
    };

    this.jobs.set(agreementId, record);
    this.queue.push(agreementId);

    this.log({ event: "worker_queued", agreement_id: agreementId, capability });

    if (this.autoExecute) {
      this.drainQueue();
    }

    return this.toPublic(record);
  }

  /**
   * Get current status of a job.
   */
  getStatus(agreementId: string): WorkerExecution | null {
    const rec = this.jobs.get(agreementId);
    return rec ? this.toPublic(rec) : null;
  }

  /**
   * Get all jobs (for status IPC command).
   */
  listAll(): WorkerExecution[] {
    return Array.from(this.jobs.values()).map(r => this.toPublic(r));
  }

  /**
   * Read job log contents (for worker-logs IPC command).
   */
  readLog(agreementId: string, tail = 200): string {
    const logPath = path.join(JOBS_DIR, `agreement-${agreementId}`, "job.log");
    if (!fs.existsSync(logPath)) return "(no log yet)";
    try {
      const content = fs.readFileSync(logPath, "utf-8");
      const lines = content.split("\n");
      return lines.slice(-tail).join("\n");
    } catch {
      return "(could not read log)";
    }
  }

  /**
   * Cancel a queued job. Cannot cancel running jobs.
   */
  cancel(agreementId: string): boolean {
    const rec = this.jobs.get(agreementId);
    if (!rec || rec.status !== "queued") return false;
    rec.status = "failed";
    rec.error = "cancelled";
    rec.completedAt = Date.now();
    this.queue = this.queue.filter(id => id !== agreementId);
    this.log({ event: "worker_cancelled", agreement_id: agreementId });
    return true;
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  private drainQueue(): void {
    while (this.runningCount < this.maxConcurrentJobs && this.queue.length > 0) {
      const next = this.queue.shift()!;
      const rec = this.jobs.get(next);
      if (!rec || rec.status !== "queued") continue;
      void this.runJob(rec);
    }
  }

  private async runJob(rec: ExecutionRecord): Promise<void> {
    this.runningCount++;
    rec.status = "running";
    rec.startedAt = Date.now();

    const logPath = path.join(rec.jobDir, "job.log");
    const logStream = fs.createWriteStream(logPath, { flags: "a" });

    this.log({ event: "worker_started", agreement_id: rec.agreementId, agent: rec.agentType });

    try {
      // openclaw routes through the host gateway HTTP API — no subprocess spawn
      if (rec.agentType === "openclaw") {
        await this.runViaGateway(rec, logStream);
      } else {
        const exitCode = await this.spawnAgent(rec, logStream);
        rec.exitCode = exitCode;
        if (exitCode !== 0) {
          throw new Error(`agent exited with code ${exitCode}`);
        }
      }

      // Collect output files and upload
      const manifest = await this.collectDeliverables(rec, logStream);
      rec.deliverableHash = manifest.root_hash;

      logStream.write(`[worker-executor] Deliverable ready — on-chain commit will be handled by daemon onJobCompleted\n`);

      rec.status = "completed";
      rec.completedAt = Date.now();

      this.log({
        event: "worker_completed",
        agreement_id: rec.agreementId,
        root_hash: manifest.root_hash,
        file_count: manifest.files.length,
        duration_ms: rec.completedAt - rec.startedAt,
      });

      this.onJobCompleted?.(rec.agreementId, manifest.root_hash);

    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err);
      rec.status = "failed";
      rec.error = msg;
      rec.completedAt = Date.now();
      logStream.write(`\n[worker-executor] FAILED: ${msg}\n`);
      this.log({ event: "worker_failed", agreement_id: rec.agreementId, error: msg });
      this.onJobFailed?.(rec.agreementId, msg);
    } finally {
      logStream.end();
      rec.process = null;
      if (rec.timeoutHandle) {
        clearTimeout(rec.timeoutHandle);
        rec.timeoutHandle = null;
      }
      this.runningCount--;
      this.drainQueue();
    }
  }

  /**
   * Execute a job via the host OpenClaw gateway OpenAI-compatible HTTP API.
   * Uses POST /v1/chat/completions (not /agent).
   */
  private async runViaGateway(rec: ExecutionRecord, logStream: fs.WriteStream): Promise<void> {
    const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || "http://172.17.0.1:18789";
    const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || "";
    const workerAgentId = process.env.OPENCLAW_WORKER_AGENT_ID || "arc";
    const taskText = this.buildTask(rec.capability, rec.specHash, rec.agreementId);

    logStream.write(`[worker-executor] Routing to OpenClaw gateway: ${gatewayUrl}/v1/chat/completions\n`);
    logStream.write(`[worker-executor] Agent: ${workerAgentId}\n`);
    logStream.write(`[worker-executor] Agreement: ${rec.agreementId}\n`);
    logStream.write(`[worker-executor] Capability: ${rec.capability}\n\n`);

    const payload = JSON.stringify({
      model: `openclaw:${workerAgentId}`,
      messages: [{ role: "user", content: taskText }],
      stream: false,
      metadata: {
        arc402_job_id: rec.agreementId,
        arc402_capability: rec.capability,
        arc402_job_dir: rec.jobDir,
      },
    });

    const response = await new Promise<string>((resolve, reject) => {
      const url = new URL("/v1/chat/completions", gatewayUrl);
      const isHttps = url.protocol === "https:";
      const mod = isHttps ? https : http;

      const headers: Record<string, string | number> = {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "X-ARC402-Job-Id": rec.agreementId,
        "X-ARC402-Capability": rec.capability,
      };
      if (gatewayToken) headers["Authorization"] = `Bearer ${gatewayToken}`;

      const req = mod.request({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: "POST",
        headers,
        timeout: this.jobTimeoutMs,
      }, (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Gateway returned ${res.statusCode}: ${body.slice(0, 400)}`));
          } else {
            resolve(body);
          }
        });
      });

      req.on("error", (err) => reject(new Error(`Gateway connection failed: ${err.message}`)));
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("gateway_timeout"));
      });
      req.write(payload);
      req.end();
    });

    // Parse OpenAI chat completion response
    let deliverable = response;
    try {
      const parsed = JSON.parse(response) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = parsed.choices?.[0]?.message?.content;
      if (content && content.trim()) deliverable = content;
    } catch {
      // keep raw response
    }

    logStream.write(`[worker-executor] Gateway response received (${deliverable.length} chars)\n`);
    logStream.write(`\n--- Gateway Output ---\n${deliverable}\n`);

    // Try to parse <arc402_delivery> structured file block
    let extractedDeliverable = false;
    const deliveryMatch = deliverable.match(/<arc402_delivery>\s*([\s\S]*?)\s*<\/arc402_delivery>/);
    if (deliveryMatch) {
      try {
        const parsed = JSON.parse(deliveryMatch[1]) as { files?: Array<{ name: string; content: string }> };
        if (parsed.files && Array.isArray(parsed.files)) {
          for (const file of parsed.files) {
            if (typeof file.name === "string" && typeof file.content === "string") {
              const safeName = path.basename(file.name);
              if (safeName && !safeName.startsWith(".")) {
                const filePath = path.join(rec.jobDir, safeName);
                fs.writeFileSync(filePath, file.content, "utf-8");
                logStream.write(`[worker-executor] Extracted file: ${safeName} (${file.content.length} chars)\n`);
              }
            }
          }
          extractedDeliverable = parsed.files.some(f => path.basename(f.name) === "deliverable.md");
        }
      } catch (parseErr) {
        logStream.write(`[worker-executor] Warning: failed to parse arc402_delivery block: ${parseErr}\n`);
      }
    }

    // Fallback: write deliverable.md from raw response if not extracted via delivery block
    if (!extractedDeliverable) {
      const deliverablePath = path.join(rec.jobDir, "deliverable.md");
      fs.writeFileSync(
        deliverablePath,
        `# Deliverable\n\nAgreement: ${rec.agreementId}\nCapability: ${rec.capability}\n\n---\n\n${deliverable}`,
        "utf-8"
      );
      logStream.write(`[worker-executor] Deliverable written to ${deliverablePath}\n`);
    }
  }

  private spawnAgent(rec: ExecutionRecord, logStream: fs.WriteStream): Promise<number> {
    return new Promise((resolve, reject) => {
      const { cmd, args } = this.buildCommand(rec);
      const taskText = this.buildTask(rec.capability, rec.specHash, rec.agreementId);

      logStream.write(`[worker-executor] Spawning: ${cmd} ${args.join(" ")}\n`);
      logStream.write(`[worker-executor] CWD: ${rec.jobDir}\n`);
      logStream.write(`[worker-executor] Task: ${taskText.slice(0, 200)}\n\n`);

      const child = spawn(cmd, [...args, taskText], {
        cwd: rec.jobDir,
        env: {
          ...process.env,
          // Do NOT pass ARC402_MACHINE_KEY to worker process — security boundary
          ARC402_MACHINE_KEY: undefined,
          // Job context so the agent knows its scope
          ARC402_JOB_ID: rec.agreementId,
          ARC402_WORKER_DIR: WORKER_DIR,
          ARC402_JOB_DIR: rec.jobDir,
          // Unset ANTHROPIC_API_KEY — let OAuth handle auth
          ANTHROPIC_API_KEY: undefined,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      rec.process = child;
      if (child.pid) rec.pid = child.pid;

      child.stdout?.on("data", (chunk: Buffer) => { logStream.write(chunk); });
      child.stderr?.on("data", (chunk: Buffer) => { logStream.write(chunk); });

      // Job timeout
      rec.timeoutHandle = setTimeout(() => {
        logStream.write(`\n[worker-executor] TIMEOUT after ${this.jobTimeoutMs}ms\n`);
        child.kill("SIGTERM");
        setTimeout(() => { child.kill("SIGKILL"); }, 5000);
        reject(new Error("job_timeout"));
      }, this.jobTimeoutMs);

      child.on("close", (code) => {
        resolve(code ?? 1);
      });

      child.on("error", (err) => {
        reject(new Error(`spawn_failed: ${err.message}`));
      });
    });
  }

  private buildCommand(rec: ExecutionRecord): { cmd: string; args: string[] } {
    switch (rec.agentType) {
      case "openclaw":
        // OpenClaw as the worker runtime — can spawn any ACP (Claude Code,
        // Codex, Gemini, Pi, etc.) and orchestrate multi-agent workflows.
        // This is the preferred runtime because it gives the worker full
        // agent orchestration capability instead of being locked to one CLI.
        return {
          cmd: "openclaw",
          args: ["run", "--workdir", rec.jobDir, "--"],
        };
      case "claude-code":
        return {
          cmd: "claude",
          args: ["--permission-mode", "bypassPermissions", "--print"],
        };
      case "codex":
        return {
          cmd: "codex",
          args: ["--print"],
        };
      case "shell":
        return {
          cmd: "/bin/sh",
          args: ["-c"],
        };
    }
  }

  private buildTask(capability: string, specHash: string, agreementId: string): string {
    // ── Worker context injection ──────────────────────────────────────────
    // The worker is a specialised agent with identity, expertise, and memory.
    // All of this is injected BEFORE the task so the agent operates as a
    // trained professional, not a blank slate.

    const soul = readFileOrEmpty(path.join(WORKER_DIR, "SOUL.md"));
    const identity = readFileOrEmpty(path.join(WORKER_DIR, "IDENTITY.md"));
    const learnings = readFileOrEmpty(path.join(WORKER_DIR, "memory", "learnings.md"));
    const knowledge = readDirMd(path.join(WORKER_DIR, "knowledge"), 50_000);
    const datasets = readDirMd(path.join(WORKER_DIR, "datasets"), 20_000);

    // Task from hire request (may have been written by enqueue())
    const taskFile = path.join(JOBS_DIR, `agreement-${agreementId}`, "task.md");
    const taskContent = readFileOrEmpty(taskFile);

    const sections: string[] = [];

    if (soul) sections.push(`## Your Identity & Role\n${soul}`);
    if (identity) sections.push(`## Identity Card\n${identity}`);
    if (learnings && learnings !== "# Accumulated Learnings\n\nNo learnings yet. Complete your first job to start building expertise.") {
      sections.push(`## Your Accumulated Expertise\nThese are learnings from your previous jobs. Use them.\n\n${learnings}`);
    }
    if (knowledge) sections.push(`## Domain Knowledge\nReference material for your specialisation.\n\n${knowledge}`);
    if (datasets) sections.push(`## Reference Examples\n${datasets}`);

    const taskFallback = (!taskContent && !capability)
      ? `You are a professional AI worker. The hiring agent has requested your services under capability: (unspecified). Produce a high-quality deliverable documenting your analysis and output.`
      : `Complete the work specified by the capability "${capability}".`;

    sections.push(`## Current Task
Agreement ID: ${agreementId}
Capability: ${capability}
Spec Hash: ${specHash}

${taskContent || taskFallback}`);

    sections.push(`## Output Instructions
Complete your work thoroughly and professionally. Your output will be hashed and delivered on-chain.

At the end of your response, you MUST include an <arc402_delivery> block containing ALL output files as JSON. This is how your files are transferred to the delivery system. Format:

<arc402_delivery>
{"files":[{"name":"deliverable.md","content":"# Deliverable\\n\\n..."},{"name":"report.md","content":"..."}]}
</arc402_delivery>

Rules:
- ALWAYS include \`deliverable.md\` as a summary of your work
- Include ALL substantive output files (reports, code, data, etc.)
- File content must be valid JSON string (escape newlines as \\n, quotes as \\")
- Do NOT include task.md or job.log in the delivery block`);

    return sections.join("\n\n---\n\n");
  }

  private async collectDeliverables(rec: ExecutionRecord, logStream: fs.WriteStream): Promise<DeliveryManifest> {
    logStream.write(`\n[worker-executor] Collecting deliverables from ${rec.jobDir}\n`);

    // Exclude non-deliverable files
    const excludes = ["task.md", "job.log"];

    const manifest = this.delivery.storeDirectory(rec.agreementId, rec.jobDir, excludes);

    logStream.write(`[worker-executor] Uploaded ${manifest.files.length} files, root_hash: ${manifest.root_hash}\n`);
    return manifest;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private toPublic(rec: ExecutionRecord): WorkerExecution {
    const { process: _proc, timeoutHandle: _th, ...pub } = rec;
    void _proc; void _th;
    return pub;
  }
}
