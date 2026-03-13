#!/usr/bin/env node
// ARC-402 Reference Relay Server (Spec 21)
// Pure Node.js, no external dependencies.
// Usage: node tools/relay/server.js [--port 3000] [--ttl 86400]

"use strict";

const http = require("http");
const crypto = require("crypto");

// ─── Config from CLI args ─────────────────────────────────────────────────────

let PORT = 3000;
let TTL_SECONDS = 86400; // 24 hours default

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" && args[i + 1]) PORT = parseInt(args[++i], 10);
  if (args[i] === "--ttl" && args[i + 1]) TTL_SECONDS = parseInt(args[++i], 10);
}

const VERSION = "1.0.0";

// ─── In-memory message store ──────────────────────────────────────────────────
// messages: Map<address, Array<{ messageId, to, payload, timestamp }>>

const messageStore = new Map(); // address → message[]
const messageIndex = new Map(); // messageId → { address, idx }

// Per-address rate limiting: 100 messages/minute
const rateLimits = new Map(); // address → { count, windowStart }

const RATE_LIMIT = 100;
const RATE_WINDOW_MS = 60_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowMs() {
  return Date.now();
}

function newMessageId() {
  return crypto.randomBytes(16).toString("hex");
}

function pruneExpired(address) {
  const msgs = messageStore.get(address);
  if (!msgs) return;
  const cutoff = nowMs() - TTL_SECONDS * 1000;
  const fresh = msgs.filter((m) => m.timestamp >= cutoff);
  if (fresh.length !== msgs.length) {
    messageStore.set(address, fresh);
    // Rebuild index entries — simple approach: just delete stale ones
    for (const m of msgs) {
      if (m.timestamp < cutoff) messageIndex.delete(m.messageId);
    }
  }
}

function checkRateLimit(address) {
  const now = nowMs();
  let rl = rateLimits.get(address);
  if (!rl || now - rl.windowStart >= RATE_WINDOW_MS) {
    rl = { count: 0, windowStart: now };
  }
  if (rl.count >= RATE_LIMIT) return false;
  rl.count++;
  rateLimits.set(address, rl);
  return true;
}

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function parseQuery(url) {
  const idx = url.indexOf("?");
  if (idx === -1) return {};
  const qs = url.slice(idx + 1);
  const params = {};
  for (const pair of qs.split("&")) {
    const [k, v] = pair.split("=");
    if (k) params[decodeURIComponent(k)] = v ? decodeURIComponent(v) : "";
  }
  return params;
}

function pathname(url) {
  const idx = url.indexOf("?");
  return idx === -1 ? url : url.slice(0, idx);
}

// ─── Route handlers ───────────────────────────────────────────────────────────

function handleStatus(res) {
  jsonResponse(res, 200, { healthy: true, version: VERSION, ttlSeconds: TTL_SECONDS });
}

async function handleSend(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return jsonResponse(res, 400, { error: "Invalid JSON" });
  }

  const { to, payload } = body;
  if (!to || typeof to !== "string") {
    return jsonResponse(res, 400, { error: "Missing or invalid 'to' address" });
  }
  if (payload === undefined) {
    return jsonResponse(res, 400, { error: "Missing 'payload'" });
  }

  // Determine sender address from payload if present (for rate limiting)
  let fromAddress = "unknown";
  if (payload && typeof payload === "object" && payload.from) {
    fromAddress = String(payload.from).toLowerCase();
  } else if (typeof payload === "string") {
    try {
      const p = JSON.parse(payload);
      if (p.from) fromAddress = String(p.from).toLowerCase();
    } catch { /* ignore */ }
  }

  if (!checkRateLimit(fromAddress)) {
    return jsonResponse(res, 429, { error: "Rate limit exceeded (100 messages/minute)" });
  }

  const toAddress = to.toLowerCase();
  const messageId = newMessageId();
  const timestamp = nowMs();

  const entry = { messageId, to: toAddress, from: fromAddress, payload, timestamp };

  pruneExpired(toAddress);
  if (!messageStore.has(toAddress)) messageStore.set(toAddress, []);
  const msgs = messageStore.get(toAddress);
  msgs.push(entry);
  messageIndex.set(messageId, { address: toAddress, messageId });

  jsonResponse(res, 200, { messageId });
}

function handlePoll(req, res) {
  const query = parseQuery(req.url);
  const address = (query.address || "").toLowerCase();
  const since = query.since || null;

  if (!address) {
    return jsonResponse(res, 400, { error: "Missing 'address' query parameter" });
  }

  pruneExpired(address);
  const msgs = messageStore.get(address) || [];

  let filtered;
  if (since) {
    // Find the index of the 'since' messageId and return everything after it
    const sinceIdx = msgs.findIndex((m) => m.messageId === since);
    filtered = sinceIdx === -1 ? msgs : msgs.slice(sinceIdx + 1);
  } else {
    filtered = msgs;
  }

  jsonResponse(res, 200, { messages: filtered });
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  const path = pathname(req.url || "/");

  try {
    if (req.method === "GET" && path === "/status") {
      return handleStatus(res);
    }
    if (req.method === "POST" && path === "/send") {
      return await handleSend(req, res);
    }
    if (req.method === "GET" && path === "/poll") {
      return handlePoll(req, res);
    }
    jsonResponse(res, 404, { error: "Not found" });
  } catch (err) {
    jsonResponse(res, 500, { error: String(err && err.message ? err.message : err) });
  }
});

// Periodic TTL cleanup (every 5 minutes)
setInterval(() => {
  for (const address of messageStore.keys()) {
    pruneExpired(address);
  }
}, 5 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`ARC-402 Relay v${VERSION} listening on port ${PORT} (TTL: ${TTL_SECONDS}s)`);
});

// Graceful shutdown
process.on("SIGTERM", () => { server.close(() => process.exit(0)); });
process.on("SIGINT",  () => { server.close(() => process.exit(0)); });
