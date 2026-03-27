/**
 * ARC-402 File Delivery Manager
 *
 * Content-addressed file serving with keccak256 hashing.
 * Storage: ~/.arc402/deliveries/<agreement-id>/
 *
 * Root hash = keccak256(sorted concat of individual file hashes)
 * This root hash is what goes on-chain via deliver().
 *
 * PRIVACY MODEL:
 * Files are private IP between agreement parties by default.
 * Downloads require proof of party membership:
 *   - X-ARC402-Signature: EIP-191 signed message "arc402:download:<agreementId>"
 *   - X-ARC402-Signer: the wallet address (must be hirer or provider on the agreement)
 *   - OR: Bearer token (daemon API token — for local/automated access)
 * Only the hash is public (on-chain). Files are never public by default.
 * For disputes: arbitrator gets temporary access via a time-limited token.
 *
 * Upload: POST /job/:id/upload       (daemon auth — local worker only)
 * List:   GET  /job/:id/files        (party auth or daemon auth)
 * Get:    GET  /job/:id/files/:name  (party auth or daemon auth)
 * Manifest: GET /job/:id/manifest    (party auth or daemon auth)
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as http from "http";
import { ethers } from "ethers";

const DELIVERIES_DIR = path.join(os.homedir(), ".arc402", "deliveries");
const MANIFEST_FILENAME = "_manifest.json";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DeliveryFileEntry {
  name: string;
  size: number;
  hash: string; // keccak256 hex, e.g. "0xabc..."
}

export interface DeliveryManifest {
  agreement_id: string;
  files: DeliveryFileEntry[];
  root_hash: string;
  total_size: number;
  created_at: string;
  updated_at: string;
}

// ─── FileDeliveryManager ──────────────────────────────────────────────────────

/**
 * Resolves agreement parties (hirer + provider) for access control.
 * Injected by the daemon so file-delivery doesn't depend on the DB schema.
 */
export type AgreementPartyResolver = (agreementId: string) => {
  hirerAddress: string;
  providerAddress: string;
} | null;

export class FileDeliveryManager {
  private readonly maxFileSizeBytes: number;
  private readonly maxJobSizeBytes: number;
  private partyResolver: AgreementPartyResolver | null = null;
  /** Temporary arbitrator access tokens: token → { agreementId, expiresAt } */
  private readonly arbitratorTokens = new Map<string, { agreementId: string; expiresAt: number }>();

  constructor(opts: {
    maxFileSizeMb?: number;
    maxJobSizeMb?: number;
  } = {}) {
    this.maxFileSizeBytes = (opts.maxFileSizeMb ?? 100) * 1024 * 1024;
    this.maxJobSizeBytes = (opts.maxJobSizeMb ?? 500) * 1024 * 1024;
    fs.mkdirSync(DELIVERIES_DIR, { recursive: true });
  }

  setPartyResolver(resolver: AgreementPartyResolver): void {
    this.partyResolver = resolver;
  }

  /**
   * Generate a time-limited arbitrator access token for dispute resolution.
   * Valid for the specified agreement only.
   */
  generateArbitratorToken(agreementId: string, ttlSeconds: number = 86400): string {
    const token = ethers.hexlify(ethers.randomBytes(32));
    this.arbitratorTokens.set(token, {
      agreementId,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    return token;
  }

  /**
   * Verify that a request has valid party auth for a given agreement.
   * Returns true if:
   *   1. X-ARC402-Signature is a valid EIP-191 sig of "arc402:download:<agreementId>"
   *      from an address that is the hirer or provider on the agreement, OR
   *   2. Authorization: Bearer <daemon-token> (local access), OR
   *   3. X-Arbitrator-Token is a valid unexpired arbitrator token for this agreement
   */
  verifyPartyAccess(
    req: http.IncomingMessage,
    agreementId: string,
    daemonToken: string
  ): { allowed: boolean; party?: string; reason?: string } {
    // Check daemon bearer token (local/automated access)
    const authHeader = (req.headers["authorization"] ?? "") as string;
    if (authHeader.startsWith("Bearer ") && authHeader.slice(7) === daemonToken) {
      return { allowed: true, party: "daemon" };
    }

    // Check arbitrator token
    const arbToken = req.headers["x-arbitrator-token"] as string | undefined;
    if (arbToken) {
      const entry = this.arbitratorTokens.get(arbToken);
      if (entry && entry.agreementId === agreementId && entry.expiresAt > Date.now()) {
        return { allowed: true, party: "arbitrator" };
      }
      // Clean up expired
      if (entry && entry.expiresAt <= Date.now()) {
        this.arbitratorTokens.delete(arbToken);
      }
    }

    // Check party signature
    const sig = req.headers["x-arc402-signature"] as string | undefined;
    const signer = req.headers["x-arc402-signer"] as string | undefined;
    if (!sig || !signer) {
      return { allowed: false, reason: "missing_auth: provide Bearer token, X-ARC402-Signature+X-ARC402-Signer, or X-Arbitrator-Token" };
    }

    // Verify EIP-191 signature
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

    // Check if signer is a party to the agreement
    if (!this.partyResolver) {
      return { allowed: false, reason: "no_party_resolver_configured" };
    }

    const parties = this.partyResolver(agreementId);
    if (!parties) {
      return { allowed: false, reason: "agreement_not_found" };
    }

    const signerLower = signer.toLowerCase();
    if (signerLower === parties.hirerAddress.toLowerCase()) {
      return { allowed: true, party: "hirer" };
    }
    if (signerLower === parties.providerAddress.toLowerCase()) {
      return { allowed: true, party: "provider" };
    }

    // Also accept machine key EOA if the X-ARC402-Wallet header identifies a party wallet.
    // V6 smart wallets sign protocol actions via an authorized machine key (EOA),
    // so the recovered signer is the EOA, not the wallet contract address.
    const walletHeader = (req.headers["x-arc402-wallet"] as string | undefined)?.toLowerCase();
    if (walletHeader) {
      if (walletHeader === parties.hirerAddress.toLowerCase()) {
        return { allowed: true, party: "hirer" };
      }
      if (walletHeader === parties.providerAddress.toLowerCase()) {
        return { allowed: true, party: "provider" };
      }
    }

    return { allowed: false, reason: "signer_not_party_to_agreement" };
  }

  // ── Paths ────────────────────────────────────────────────────────────────

  deliveryDir(agreementId: string): string {
    return path.join(DELIVERIES_DIR, agreementId);
  }

  manifestPath(agreementId: string): string {
    return path.join(this.deliveryDir(agreementId), MANIFEST_FILENAME);
  }

  filePath(agreementId: string, filename: string): string {
    // Sanitize filename — prevent path traversal
    const safe = path.basename(filename);
    return path.join(this.deliveryDir(agreementId), safe);
  }

  // ── Hashing ──────────────────────────────────────────────────────────────

  computeFileHash(data: Buffer): string {
    return ethers.keccak256(data);
  }

  computeRootHash(fileHashes: string[]): string {
    if (fileHashes.length === 0) {
      return ethers.keccak256(new Uint8Array(0));
    }
    const sorted = [...fileHashes].sort();
    const allBytes = Buffer.concat(sorted.map(h => Buffer.from(ethers.getBytes(h))));
    return ethers.keccak256(allBytes);
  }

  // ── Manifest ─────────────────────────────────────────────────────────────

  getManifest(agreementId: string): DeliveryManifest | null {
    const mpath = this.manifestPath(agreementId);
    if (!fs.existsSync(mpath)) return null;
    try {
      return JSON.parse(fs.readFileSync(mpath, "utf-8")) as DeliveryManifest;
    } catch {
      return null;
    }
  }

  private writeManifest(agreementId: string, manifest: DeliveryManifest): void {
    const dir = this.deliveryDir(agreementId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.manifestPath(agreementId), JSON.stringify(manifest, null, 2));
  }

  private recomputeManifest(agreementId: string): DeliveryManifest {
    const dir = this.deliveryDir(agreementId);
    fs.mkdirSync(dir, { recursive: true });

    const existing = this.getManifest(agreementId);
    const now = new Date().toISOString();

    const entries = fs.readdirSync(dir)
      .filter(f => f !== MANIFEST_FILENAME)
      .map((name): DeliveryFileEntry => {
        const fp = path.join(dir, name);
        const data = fs.readFileSync(fp);
        return {
          name,
          size: data.length,
          hash: this.computeFileHash(data),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const rootHash = this.computeRootHash(entries.map(e => e.hash));
    const totalSize = entries.reduce((s, e) => s + e.size, 0);

    const manifest: DeliveryManifest = {
      agreement_id: agreementId,
      files: entries,
      root_hash: rootHash,
      total_size: totalSize,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };

    this.writeManifest(agreementId, manifest);
    return manifest;
  }

  // ── File storage ──────────────────────────────────────────────────────────

  /**
   * Store a file for an agreement. Immutable — returns existing entry if
   * the file already exists (no overwrite).
   */
  storeFile(agreementId: string, filename: string, data: Buffer): {
    entry: DeliveryFileEntry;
    manifest: DeliveryManifest;
    alreadyExisted: boolean;
  } {
    const safe = path.basename(filename);
    if (!safe || safe === MANIFEST_FILENAME) {
      throw new Error("invalid_filename");
    }

    const dir = this.deliveryDir(agreementId);
    fs.mkdirSync(dir, { recursive: true });

    const fp = path.join(dir, safe);

    // Immutable — refuse overwrite
    if (fs.existsSync(fp)) {
      const manifest = this.getManifest(agreementId) ?? this.recomputeManifest(agreementId);
      const entry = manifest.files.find(f => f.name === safe);
      if (!entry) throw new Error("manifest_inconsistent");
      return { entry, manifest, alreadyExisted: true };
    }

    // Size checks
    if (data.length > this.maxFileSizeBytes) {
      throw new Error(`file_too_large: ${data.length} bytes exceeds ${this.maxFileSizeBytes}`);
    }

    // Check total job size
    const existingManifest = this.getManifest(agreementId);
    const existingTotal = existingManifest?.total_size ?? 0;
    if (existingTotal + data.length > this.maxJobSizeBytes) {
      throw new Error(`job_too_large: total would exceed ${this.maxJobSizeBytes} bytes`);
    }

    // Write file
    fs.writeFileSync(fp, data);

    // Recompute manifest
    const manifest = this.recomputeManifest(agreementId);
    const entry = manifest.files.find(f => f.name === safe);
    if (!entry) throw new Error("manifest_inconsistent");

    return { entry, manifest, alreadyExisted: false };
  }

  /**
   * Scan a directory for output files and store all of them.
   * Returns the final manifest with root_hash.
   */
  storeDirectory(agreementId: string, sourceDir: string, excludes: string[] = []): DeliveryManifest {
    const excludeSet = new Set([...excludes, MANIFEST_FILENAME, "job.log", ".claude"]);
    const files = fs.readdirSync(sourceDir).filter(f => {
      if (excludeSet.has(f)) return false;
      const stat = fs.statSync(path.join(sourceDir, f));
      return stat.isFile();
    });

    for (const filename of files) {
      const data = fs.readFileSync(path.join(sourceDir, filename));
      try {
        this.storeFile(agreementId, filename, data);
      } catch (err) {
        // Log and skip files that are too large, etc.
        process.stderr.write(`[file-delivery] skip ${filename}: ${err}\n`);
      }
    }

    return this.recomputeManifest(agreementId);
  }

  // ── HTTP handlers ─────────────────────────────────────────────────────────

  /**
   * POST /job/:id/upload
   * Auth required. Accepts raw binary body with X-Filename header.
   * Also accepts Content-Disposition: attachment; filename="..."
   */
  async handleUpload(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    agreementId: string,
    log: (entry: Record<string, unknown>) => void
  ): Promise<void> {
    // Determine filename from headers
    const xFilename = req.headers["x-filename"] as string | undefined;
    const contentDisp = req.headers["content-disposition"] as string | undefined;

    let filename = xFilename ?? "";
    if (!filename && contentDisp) {
      const m = contentDisp.match(/filename="?([^";]+)"?/);
      if (m) filename = m[1];
    }
    if (!filename) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "missing_filename", hint: "Set X-Filename header" }));
      return;
    }

    // Stream body with size cap
    const data = await this.readUploadBody(req, res);
    if (data === null) return; // already responded

    try {
      const { entry, manifest, alreadyExisted } = this.storeFile(agreementId, filename, data);
      log({ event: "file_uploaded", agreement_id: agreementId, filename: entry.name, size: entry.size, already_existed: alreadyExisted });
      res.writeHead(alreadyExisted ? 200 : 201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        already_existed: alreadyExisted,
        file: entry,
        root_hash: manifest.root_hash,
        total_files: manifest.files.length,
      }));
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err);
      if (msg.startsWith("file_too_large") || msg.startsWith("job_too_large")) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg }));
      } else if (msg.startsWith("invalid_filename")) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_filename" }));
      } else {
        log({ event: "upload_error", agreement_id: agreementId, error: msg });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "upload_failed" }));
      }
    }
  }

  /**
   * GET /job/:id/files
   * Party-gated. Returns list of files (same as manifest but concise).
   * Requires valid party auth (signature, daemon token, or arbitrator token).
   */
  handleListFiles(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    agreementId: string,
    daemonToken: string,
    log: (entry: Record<string, unknown>) => void
  ): void {
    const access = this.verifyPartyAccess(req, agreementId, daemonToken);
    if (!access.allowed) {
      log({ event: "file_list_denied", agreement_id: agreementId, reason: access.reason });
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "access_denied", reason: access.reason }));
      return;
    }

    const manifest = this.getManifest(agreementId);
    if (!manifest) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "no_files_for_agreement" }));
      return;
    }

    log({ event: "file_list_served", agreement_id: agreementId, party: access.party });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      agreement_id: agreementId,
      files: manifest.files.map(f => ({ name: f.name, size: f.size })),
      root_hash: manifest.root_hash,
      total_files: manifest.files.length,
      total_size: manifest.total_size,
    }));
  }

  /**
   * GET /job/:id/files/:filename
   * Party-gated. Streams the file content to authenticated agreement parties.
   */
  handleDownloadFile(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    agreementId: string,
    filename: string,
    daemonToken: string,
    log: (entry: Record<string, unknown>) => void
  ): void {
    const access = this.verifyPartyAccess(req, agreementId, daemonToken);
    if (!access.allowed) {
      log({ event: "file_download_denied", agreement_id: agreementId, filename, reason: access.reason });
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "access_denied", reason: access.reason }));
      return;
    }

    const safe = path.basename(filename);
    if (!safe || safe === MANIFEST_FILENAME) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_filename" }));
      return;
    }

    const fp = this.filePath(agreementId, safe);
    if (!fs.existsSync(fp)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "file_not_found" }));
      return;
    }

    const stat = fs.statSync(fp);
    log({ event: "file_download_served", agreement_id: agreementId, filename: safe, size: stat.size, party: access.party });
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Cache-Control": "private, no-store",
    });

    const stream = fs.createReadStream(fp);
    stream.on("error", (err) => {
      log({ event: "download_error", agreement_id: agreementId, filename: safe, error: String(err) });
    });
    stream.pipe(res);
  }

  /**
   * GET /job/:id/manifest
   * Party-gated. Returns full manifest with hashes for verification.
   */
  handleManifest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    agreementId: string,
    daemonToken: string,
    log: (entry: Record<string, unknown>) => void
  ): void {
    const access = this.verifyPartyAccess(req, agreementId, daemonToken);
    if (!access.allowed) {
      log({ event: "manifest_denied", agreement_id: agreementId, reason: access.reason });
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "access_denied", reason: access.reason }));
      return;
    }

    const manifest = this.getManifest(agreementId);
    if (!manifest) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "no_manifest_for_agreement" }));
      return;
    }

    log({ event: "manifest_served", agreement_id: agreementId, party: access.party });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(manifest, null, 2));
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private readUploadBody(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<Buffer | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let aborted = false;

      req.on("data", (chunk: Buffer) => {
        if (aborted) return;
        size += chunk.length;
        if (size > this.maxFileSizeBytes) {
          aborted = true;
          req.destroy();
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "file_too_large" }));
          resolve(null);
          return;
        }
        chunks.push(chunk);
      });

      req.on("end", () => {
        if (!aborted) resolve(Buffer.concat(chunks));
      });

      req.on("error", () => {
        if (!aborted) resolve(null);
      });
    });
  }
}
