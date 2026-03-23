/**
 * File delivery routes — GET /job/:id/files, /job/:id/files/:name, /job/:id/manifest
 *                       POST /job/:id/upload
 *
 * Replaces FileDeliveryManager HTTP surface from the daemon.
 * Files are stored under ~/.arc402/jobs/:id/files/
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import type { PluginApi } from "../tools/hire.js";
import type { ResolvedConfig } from "../config.js";

const JOBS_DIR = path.join(os.homedir(), ".arc402", "jobs");

interface FileEntry {
  name: string;
  size: number;
  hash: string;
  uploadedAt: string;
}

interface DeliveryManifest {
  jobId: string;
  agreementId: string;
  files: FileEntry[];
  rootHash: string;
  createdAt: string;
}

function jobDir(jobId: string): string {
  return path.join(JOBS_DIR, jobId, "files");
}

function manifestPath(jobId: string): string {
  return path.join(JOBS_DIR, jobId, "manifest.json");
}

function ensureJobDir(jobId: string): void {
  fs.mkdirSync(jobDir(jobId), { recursive: true });
}

function safeJobId(id: string): string {
  // Sanitize: allow hex, alphanumeric, dashes
  return id.replace(/[^a-zA-Z0-9\-_]/g, "");
}

export function registerDeliveryRoutes(api: PluginApi, _getConfig: () => ResolvedConfig) {
  // List files for a job
  api.registerHttpRoute({
    method: "GET",
    path: "/job/:id/files",
    handler: (req, res) => {
      const jobId = safeJobId(req.params["id"] ?? "");
      const dir = jobDir(jobId);

      if (!fs.existsSync(dir)) {
        res.status(404).json({ error: "Job not found", jobId });
        return;
      }

      const files = fs.readdirSync(dir).map((name) => {
        const fullPath = path.join(dir, name);
        const stat = fs.statSync(fullPath);
        const content = fs.readFileSync(fullPath);
        const hash = "0x" + crypto.createHash("sha256").update(content).digest("hex");
        return { name, size: stat.size, hash, modifiedAt: stat.mtime.toISOString() };
      });

      res.json({ jobId, files, count: files.length });
    },
  });

  // Download a specific file
  api.registerHttpRoute({
    method: "GET",
    path: "/job/:id/files/:name",
    handler: (req, res) => {
      const jobId = safeJobId(req.params["id"] ?? "");
      const fileName = path.basename(req.params["name"] ?? "");
      const filePath = path.join(jobDir(jobId), fileName);

      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: "File not found", jobId, fileName });
        return;
      }

      const content = fs.readFileSync(filePath);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send(content);
    },
  });

  // Get delivery manifest
  api.registerHttpRoute({
    method: "GET",
    path: "/job/:id/manifest",
    handler: (req, res) => {
      const jobId = safeJobId(req.params["id"] ?? "");
      const mp = manifestPath(jobId);

      if (!fs.existsSync(mp)) {
        // Auto-generate from current files
        const dir = jobDir(jobId);
        if (!fs.existsSync(dir)) {
          res.status(404).json({ error: "Job not found", jobId });
          return;
        }

        const files: FileEntry[] = fs.readdirSync(dir).map((name) => {
          const fullPath = path.join(dir, name);
          const stat = fs.statSync(fullPath);
          const content = fs.readFileSync(fullPath);
          const hash = "0x" + crypto.createHash("sha256").update(content).digest("hex");
          return { name, size: stat.size, hash, uploadedAt: stat.mtime.toISOString() };
        });

        const rootHash = computeRootHash(files.map((f) => f.hash));
        const manifest: DeliveryManifest = {
          jobId,
          agreementId: jobId, // agreementId stored as jobId by convention
          files,
          rootHash,
          createdAt: new Date().toISOString(),
        };
        res.json(manifest);
        return;
      }

      const manifest = JSON.parse(fs.readFileSync(mp, "utf-8")) as DeliveryManifest;
      res.json(manifest);
    },
  });

  // Upload files to a job
  api.registerHttpRoute({
    method: "POST",
    path: "/job/:id/upload",
    handler: async (req, res) => {
      const jobId = safeJobId(req.params["id"] ?? "");
      ensureJobDir(jobId);

      const body = req.body as { fileName?: string; content?: string; base64?: string } | undefined;
      if (!body?.fileName) {
        res.status(400).json({ error: "Missing fileName in request body" });
        return;
      }

      const fileName = path.basename(body.fileName);
      const filePath = path.join(jobDir(jobId), fileName);

      let fileContent: Buffer;
      if (body.base64) {
        fileContent = Buffer.from(body.base64, "base64");
      } else if (body.content) {
        fileContent = Buffer.from(body.content, "utf-8");
      } else {
        res.status(400).json({ error: "Missing content or base64 in request body" });
        return;
      }

      fs.writeFileSync(filePath, fileContent);
      const hash = "0x" + crypto.createHash("sha256").update(fileContent).digest("hex");

      res.json({
        status: "uploaded",
        jobId,
        fileName,
        size: fileContent.length,
        hash,
        timestamp: new Date().toISOString(),
      });
    },
  });
}

function computeRootHash(hashes: string[]): string {
  if (hashes.length === 0) return "0x" + "0".repeat(64);
  const combined = hashes.join("");
  return "0x" + crypto.createHash("sha256").update(combined).digest("hex");
}
