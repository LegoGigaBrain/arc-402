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
import { spawn, type ChildProcess } from "child_process";
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
  }) {
    this.maxConcurrentJobs = opts.maxConcurrentJobs ?? 2;
    this.jobTimeoutMs = (opts.jobTimeoutSeconds ?? 3600) * 1000;
    this.agentType = opts.agentType ?? "openclaw";
    this.autoExecute = opts.autoExecute ?? true;
    this.delivery = opts.delivery;
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
      const exitCode = await this.spawnAgent(rec, logStream);
      rec.exitCode = exitCode;

      if (exitCode !== 0) {
        throw new Error(`agent exited with code ${exitCode}`);
      }

      // Collect output files and upload
      const manifest = await this.collectDeliverables(rec, logStream);
      rec.deliverableHash = manifest.root_hash;
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

    sections.push(`## Current Task
Agreement ID: ${agreementId}
Capability: ${capability}
Spec Hash: ${specHash}

${taskContent || `Complete the work specified by the capability "${capability}".`}`);

    sections.push(`## Output Instructions
Store all deliverable files in the current directory.
Write a deliverable.md summarizing your work and results.
Be thorough and professional. Your output will be hashed and delivered on-chain.`);

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
