import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as http from "http";
import * as https from "https";
import { spawn } from "child_process";

const PID_FILE = path.join(os.homedir(), ".arc402", "relay.pid");

// ─── HTTP helper (no external deps) ──────────────────────────────────────────

function relayRequest(
  relayUrl: string,
  method: string,
  urlPath: string,
  body?: object
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlPath, relayUrl);
    const isHttps = parsed.protocol === "https:";
    const mod = isHttps ? https : http;
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + (parsed.search || ""),
      method,
      headers: {
        "Content-Type": "application/json",
        ...(bodyStr ? { "Content-Length": String(Buffer.byteLength(bodyStr)) } : {}),
      },
    };
    const req = mod.request(options, (res) => {
      let raw = "";
      res.on("data", (c: Buffer) => { raw += c.toString(); });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode ?? 0, data: raw });
        }
      });
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─── Daemon loop (runs in-process when spawned with ARC402_RELAY_DAEMON=1) ───

async function runDaemonLoop(opts: {
  relayUrl: string;
  address: string;
  pollInterval: number;
  onMessage: string;
}): Promise<void> {
  let lastSeen: string | null = null;

  const poll = async () => {
    try {
      const qs = `?address=${encodeURIComponent(opts.address)}` +
        (lastSeen ? `&since=${encodeURIComponent(lastSeen)}` : "");
      const result = await relayRequest(opts.relayUrl, "GET", `/poll${qs}`);
      const data = result.data as { messages?: Array<{ messageId: string; payload: unknown }> };
      const messages = data.messages || [];
      for (const msg of messages) {
        lastSeen = msg.messageId;
        // Spawn the handler script with message JSON on stdin
        const child = spawn(opts.onMessage, [], {
          stdio: ["pipe", "inherit", "inherit"],
          shell: true,
        });
        child.stdin.write(JSON.stringify(msg));
        child.stdin.end();
      }
    } catch {
      // Silent retry — relay may be temporarily unreachable
    }
  };

  // Initial poll immediately, then on interval
  await poll();
  setInterval(poll, opts.pollInterval);

  // Keep process alive
  process.stdin.resume();
}

// ─── Command registration ─────────────────────────────────────────────────────

export function registerRelayCommands(program: Command): void {
  const relay = program
    .command("relay")
    .description("Send and receive messages via an ARC-402 relay (Spec 21)");

  // ── relay send ──────────────────────────────────────────────────────────────
  relay
    .command("send")
    .description("Send a message to an address via the relay")
    .requiredOption("--to <address>", "Recipient address")
    .requiredOption("--payload <json>", "JSON payload string")
    .requiredOption("--relay <url>", "Relay server URL")
    .option("--json", "Machine-parseable output")
    .action(async (opts) => {
      let payload: unknown;
      try {
        payload = JSON.parse(opts.payload);
      } catch {
        console.error("Error: --payload must be valid JSON");
        process.exit(1);
      }

      const result = await relayRequest(opts.relay, "POST", "/send", {
        to: opts.to,
        payload,
      });

      if (result.status !== 200) {
        console.error(`Relay error (${result.status}): ${JSON.stringify(result.data)}`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(result.data));
      } else {
        const d = result.data as { messageId?: string };
        console.log(`Sent. messageId: ${d.messageId}`);
      }
    });

  // ── relay poll ──────────────────────────────────────────────────────────────
  relay
    .command("poll")
    .description("Poll for messages addressed to an address")
    .requiredOption("--address <address>", "Address to poll for")
    .requiredOption("--relay <url>", "Relay server URL")
    .option("--since <messageId>", "Only return messages after this messageId")
    .option("--json", "Machine-parseable output")
    .action(async (opts) => {
      const qs = `?address=${encodeURIComponent(opts.address)}` +
        (opts.since ? `&since=${encodeURIComponent(opts.since)}` : "");

      const result = await relayRequest(opts.relay, "GET", `/poll${qs}`);

      if (result.status !== 200) {
        console.error(`Relay error (${result.status}): ${JSON.stringify(result.data)}`);
        process.exit(1);
      }

      const data = result.data as { messages?: unknown[] };
      const messages = data.messages || [];

      if (opts.json) {
        console.log(JSON.stringify(data));
        return;
      }

      if (messages.length === 0) {
        console.log("No messages.");
        return;
      }

      for (const msg of messages as Array<{ messageId: string; from: string; timestamp: number }>) {
        const ts = new Date(msg.timestamp).toISOString();
        console.log(`[${ts}] ${msg.messageId.slice(0, 12)}...  from=${msg.from}`);
      }
    });

  // ── relay daemon ────────────────────────────────────────────────────────────
  const daemon = relay
    .command("daemon")
    .description("Persistent relay polling daemon");

  daemon
    .command("start")
    .description("Start the relay daemon in the background")
    .requiredOption("--relay <url>", "Relay server URL")
    .requiredOption("--address <address>", "Address to poll for messages")
    .requiredOption("--poll-interval <ms>", "Polling interval in milliseconds", "2000")
    .requiredOption("--on-message <script>", "Script to invoke for each incoming message (receives JSON on stdin)")
    .option("--json", "Machine-parseable output")
    .action((opts) => {
      // Check if already running
      if (fs.existsSync(PID_FILE)) {
        try {
          const existingPid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
          process.kill(existingPid, 0); // Check if alive
          console.error(`Daemon already running (PID ${existingPid}). Run 'arc402 relay daemon stop' first.`);
          process.exit(1);
        } catch {
          // PID file is stale — clean it up
          fs.unlinkSync(PID_FILE);
        }
      }

      // Spawn a detached child process
      const child = spawn(process.execPath, [__filename], {
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          ARC402_RELAY_DAEMON: "1",
          ARC402_RELAY_URL: opts.relay,
          ARC402_RELAY_ADDRESS: opts.address,
          ARC402_RELAY_INTERVAL: opts.pollInterval,
          ARC402_RELAY_HANDLER: opts.onMessage,
        },
      });
      child.unref();

      fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
      fs.writeFileSync(PID_FILE, String(child.pid), { mode: 0o600 });

      if (opts.json) {
        console.log(JSON.stringify({ started: true, pid: child.pid, pidFile: PID_FILE }));
      } else {
        console.log(`Daemon started (PID ${child.pid}). PID file: ${PID_FILE}`);
      }
    });

  daemon
    .command("stop")
    .description("Stop the relay daemon")
    .option("--json", "Machine-parseable output")
    .action((opts) => {
      if (!fs.existsSync(PID_FILE)) {
        if (opts.json) {
          console.log(JSON.stringify({ stopped: false, reason: "no pid file" }));
        } else {
          console.log("No running daemon found (no PID file).");
        }
        return;
      }

      const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
      try {
        process.kill(pid, "SIGTERM");
        fs.unlinkSync(PID_FILE);
        if (opts.json) {
          console.log(JSON.stringify({ stopped: true, pid }));
        } else {
          console.log(`Daemon stopped (PID ${pid}).`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (opts.json) {
          console.log(JSON.stringify({ stopped: false, pid, error: msg }));
        } else {
          console.error(`Failed to stop daemon: ${msg}`);
          // Clean up stale PID file
          fs.unlinkSync(PID_FILE);
        }
      }
    });
}

// ─── Daemon entry point ───────────────────────────────────────────────────────
// When spawned as a background process via daemon start

if (process.env.ARC402_RELAY_DAEMON === "1") {
  runDaemonLoop({
    relayUrl: process.env.ARC402_RELAY_URL || "",
    address: process.env.ARC402_RELAY_ADDRESS || "",
    pollInterval: parseInt(process.env.ARC402_RELAY_INTERVAL || "2000", 10),
    onMessage: process.env.ARC402_RELAY_HANDLER || "echo",
  }).catch((err) => {
    process.stderr.write(`Daemon error: ${err}\n`);
    process.exit(1);
  });
}
