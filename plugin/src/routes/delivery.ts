/**
 * File delivery routes — GET /job/:id/files, /job/:id/files/:name, /job/:id/manifest
 *                       POST /job/:id/upload
 *
 * Host-side file delivery for non-workroom jobs only.
 * Workroom deliveries are served by the daemon at ~/.arc402/deliveries/<id>/
 * (accessible via the Cloudflare tunnel, not these routes).
 *
 * Access control (PLG-1): all routes require party auth — either:
 *   - Authorization: Bearer <ARC402_DAEMON_TOKEN>  (local/automated access), or
 *   - X-ARC402-Signature + X-ARC402-Signer          (EIP-191 sig of
 *     "arc402:download:<agreementId>" from the hirer or provider on the agreement)
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { ethers } from "ethers";
import type { PluginApi, HttpRequest, HttpResponse } from "../tools/hire.js";
import type { ResolvedConfig } from "../config.js";

const JOBS_DIR = path.join(os.homedir(), ".arc402", "jobs");

const SERVICE_AGREEMENT_ABI = [
  "function getAgreement(bytes32 agreementId) external view returns (tuple(address client, address provider, string serviceType, string capability, bytes32 specHash, uint256 price, address token, uint256 deadline, uint8 status, bytes32 deliverableHash, uint256 createdAt))",
];

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
  // Sanitize: allow hex, alphanumeric, dashes, underscores
  return id.replace(/[^a-zA-Z0-9\-_]/g, "");
}

/**
 * Verify that a request has valid party auth for a given agreement.
 * Returns allowed=true if:
 *   1. Authorization: Bearer <ARC402_DAEMON_TOKEN> (local access), OR
 *   2. X-ARC402-Signature is a valid EIP-191 sig of "arc402:download:<agreementId>"
 *      from an address that is the hirer or provider on the agreement (on-chain check)
 */
async function verifyPartyAccess(
  req: HttpRequest,
  agreementId: string,
  cfg: ResolvedConfig,
): Promise<{ allowed: boolean; party?: string; reason?: string }> {
  // 1. Bearer daemon token (local/automated access)
  const authHeader = req.headers["authorization"] ?? "";
  const daemonToken = process.env["ARC402_DAEMON_TOKEN"];
  if (daemonToken && authHeader === `Bearer ${daemonToken}`) {
    return { allowed: true, party: "daemon" };
  }

  // 2. EIP-191 party signature
  const sig = req.headers["x-arc402-signature"];
  const signer = req.headers["x-arc402-signer"];
  if (!sig || !signer) {
    return {
      allowed: false,
      reason:
        "missing_auth: provide Authorization: Bearer <ARC402_DAEMON_TOKEN> or X-ARC402-Signature + X-ARC402-Signer headers",
    };
  }

  const message = `arc402:download:${agreementId}`;
  let recovered: string;
  try {
    recovered = ethers.verifyMessage(message, sig);
  } catch {
    return { allowed: false, reason: "invalid_signature" };
  }

  if (recovered.toLowerCase() !== signer.toLowerCase()) {
    return { allowed: false, reason: "signature_signer_mismatch" };
  }

  // 3. On-chain party check — verify signer is hirer or provider on this agreement
  try {
    const rpcProvider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    const contract = new ethers.Contract(
      cfg.contracts.serviceAgreement,
      SERVICE_AGREEMENT_ABI,
      rpcProvider,
    );
    const agreement = await contract.getAgreement(agreementId);
    const signerLow = signer.toLowerCase();
    if (signerLow === (agreement.client as string).toLowerCase()) {
      return { allowed: true, party: "hirer" };
    }
    if (signerLow === (agreement.provider as string).toLowerCase()) {
      return { allowed: true, party: "provider" };
    }
    return { allowed: false, reason: "signer_not_party_to_agreement" };
  } catch {
    return { allowed: false, reason: "agreement_lookup_failed" };
  }
}

export function registerDeliveryRoutes(api: PluginApi, getConfig: () => ResolvedConfig) {
  // List files for a job
  api.registerHttpRoute({
    method: "GET",
    path: "/job/:id/files",
    handler: async (req: HttpRequest, res: HttpResponse) => {
      const cfg = getConfig();
      const jobId = safeJobId(req.params["id"] ?? "");
      const access = await verifyPartyAccess(req, jobId, cfg);
      if (!access.allowed) {
        res.status(403).json({ error: "access_denied", reason: access.reason });
        return;
      }

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
    handler: async (req: HttpRequest, res: HttpResponse) => {
      const cfg = getConfig();
      const jobId = safeJobId(req.params["id"] ?? "");
      const access = await verifyPartyAccess(req, jobId, cfg);
      if (!access.allowed) {
        res.status(403).json({ error: "access_denied", reason: access.reason });
        return;
      }

      const fileName = path.basename(req.params["name"] ?? "");
      const filePath = path.join(jobDir(jobId), fileName);

      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: "File not found", jobId, fileName });
        return;
      }

      const content = fs.readFileSync(filePath);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.send(content);
    },
  });

  // Get delivery manifest
  api.registerHttpRoute({
    method: "GET",
    path: "/job/:id/manifest",
    handler: async (req: HttpRequest, res: HttpResponse) => {
      const cfg = getConfig();
      const jobId = safeJobId(req.params["id"] ?? "");
      const access = await verifyPartyAccess(req, jobId, cfg);
      if (!access.allowed) {
        res.status(403).json({ error: "access_denied", reason: access.reason });
        return;
      }

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

  // Upload files to a job (party auth required)
  api.registerHttpRoute({
    method: "POST",
    path: "/job/:id/upload",
    handler: async (req: HttpRequest, res: HttpResponse) => {
      const cfg = getConfig();
      const jobId = safeJobId(req.params["id"] ?? "");
      const access = await verifyPartyAccess(req, jobId, cfg);
      if (!access.allowed) {
        res.status(403).json({ error: "access_denied", reason: access.reason });
        return;
      }

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
