#!/usr/bin/env node
const { spawn } = require("child_process");
const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const DAEMON_ENTRY = path.join(REPO_ROOT, "packages", "arc402-daemon", "dist", "index.js");
const SIGNER_SOCKET_PATH = "/tmp/arc402-signer.sock";
const MACHINE_KEY = "0x59c6995e998f97a5a0044966f0945382db6d7f6850f89d0b94d55b5efd05f0d4";
const OWNER_ADDRESS = "0x1111111111111111111111111111111111111111";
const WALLET_ADDRESS = "0x2222222222222222222222222222222222222222";
const TARGET_ADDRESS = "0x3333333333333333333333333333333333333333";
const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const CHAIN_ID = 8453;

function log(message) {
  process.stdout.write(`[daemon-split-smoke] ${message}\n`);
}

function fail(message) {
  throw new Error(message);
}

function hex32(value) {
  const bigint = BigInt(value);
  return bigint.toString(16).padStart(64, "0");
}

function encodeBool(value) {
  return `0x${hex32(value ? 1 : 0)}`;
}

function encodeUint(value) {
  return `0x${hex32(value)}`;
}

function encodeAddress(value) {
  const clean = value.toLowerCase().replace(/^0x/, "");
  return `0x${clean.padStart(64, "0")}`;
}

function encodeValidateSpendOk() {
  const headBool = hex32(1);
  const headOffset = hex32(64);
  const tailLen = hex32(0);
  return `0x${headBool}${headOffset}${tailLen}`;
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate an ephemeral port"));
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function httpJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`Invalid JSON from ${url}: ${text}`);
  }
  return { response, json };
}

async function waitFor(predicate, opts) {
  const { timeoutMs, intervalMs, label } = opts;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  if (lastError instanceof Error) {
    throw new Error(`${label} timed out: ${lastError.message}`);
  }
  throw new Error(`${label} timed out`);
}

function createJsonRpcServer() {
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_json" }));
        return;
      }

      const { id, method, params = [] } = payload;
      let result;

      switch (method) {
        case "eth_chainId":
          result = "0x2105";
          break;
        case "net_version":
          result = String(CHAIN_ID);
          break;
        case "eth_blockNumber":
          result = "0x10";
          break;
        case "eth_getCode":
          result = "0x60006000";
          break;
        case "eth_getBalance":
          result = "0xde0b6b3a7640000";
          break;
        case "eth_gasPrice":
          result = "0x3b9aca00";
          break;
        case "eth_maxPriorityFeePerGas":
          result = "0x59682f00";
          break;
        case "eth_getBlockByNumber":
          result = {
            number: "0x10",
            baseFeePerGas: "0x3b9aca00",
            gasLimit: "0x1c9c380",
            gasUsed: "0x0",
            timestamp: "0x1",
            hash: "0x" + "ab".repeat(32),
            parentHash: "0x" + "cd".repeat(32),
          };
          break;
        case "eth_call": {
          const tx = params[0] || {};
          const data = String(tx.data || "").toLowerCase();
          if (data.startsWith("0x8da5cb5b")) {
            result = encodeAddress(OWNER_ADDRESS);
          } else if (data.startsWith("0x054f7d9c")) {
            result = encodeBool(false);
          } else if (data.startsWith("0x41d5b23a")) {
            result = encodeBool(true);
          } else if (data.startsWith("0x35567e1a")) {
            result = encodeUint(0);
          } else if (data.startsWith("0xc9b3f8ad")) {
            result = encodeValidateSpendOk();
          } else {
            result = "0x";
          }
          break;
        }
        default:
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Unsupported method ${method}` },
          }));
          return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
    });
  });

  return server;
}

function createBundlerServer() {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      const payload = JSON.parse(body);
      const { id, method } = payload;
      let result;

      if (method === "eth_chainId") {
        result = "0x2105";
      } else if (method === "pimlico_getUserOperationGasPrice") {
        result = {
          standard: {
            maxFeePerGas: "1000000000",
            maxPriorityFeePerGas: "1500000000",
          },
        };
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unsupported bundler method ${method}` },
        }));
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
    });
  });

  return server;
}

async function startServer(server, label) {
  const port = await getFreePort();
  await new Promise((resolve, reject) => {
    server.once("error", (error) => {
      if (error && error.code === "EPERM") {
        reject(new Error(`listener_blocked:${label}:${error.message}`));
        return;
      }
      reject(error);
    });
    server.listen(port, "127.0.0.1", () => {
      resolve();
    });
  });
  log(`${label} listening on 127.0.0.1:${port}`);
  return port;
}

function writeDaemonToml(arcDir, listenPort, rpcPort, bundlerPort) {
  const content = `# generated by scripts/daemon-split-smoke.cjs
[wallet]
contract_address = "${WALLET_ADDRESS}"
owner_address = "${OWNER_ADDRESS}"
machine_key = "env:ARC402_MACHINE_KEY"

[network]
rpc_url = "http://127.0.0.1:${rpcPort}"
chain_id = ${CHAIN_ID}
entry_point = "${ENTRY_POINT}"

[bundler]
mode = "external"
endpoint = "http://127.0.0.1:${bundlerPort}"

[relay]
enabled = false
listen_port = ${listenPort}
endpoint = "http://127.0.0.1:${listenPort + 1}"
poll_interval_seconds = 2

[watchtower]
enabled = false

[policy]
auto_accept = false
allowed_capabilities = ["smoke.test"]

[notifications]
notify_on_hire_request = false
notify_on_hire_accepted = false
notify_on_hire_rejected = false
notify_on_delivery = false
notify_on_dispute = false
notify_on_channel_challenge = false
notify_on_low_balance = false

[work]
handler = "noop"

[compute]
enabled = false

[delivery]
auto_download = false
serve_files = false

[worker]
agent_type = "codex"
max_concurrent_jobs = 1
job_timeout_seconds = 60
auto_execute = false
`;
  fs.writeFileSync(path.join(arcDir, "daemon.toml"), content, "utf8");
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function main() {
  if (!fs.existsSync(DAEMON_ENTRY)) {
    fail(`Built daemon entrypoint not found at ${DAEMON_ENTRY}. Run packages/arc402-daemon build first.`);
  }
  if (fs.existsSync(SIGNER_SOCKET_PATH)) {
    fail(`${SIGNER_SOCKET_PATH} already exists. Stop the running split daemon before using this smoke test.`);
  }

  const tempHome = await fsp.mkdtemp(path.join(os.tmpdir(), "arc402-phase6c-home-"));
  const arcDir = path.join(tempHome, ".arc402");
  await fsp.mkdir(arcDir, { recursive: true });

  const rpcServer = createJsonRpcServer();
  const bundlerServer = createBundlerServer();
  let child = null;

  try {
    const rpcPort = await startServer(rpcServer, "mock RPC");
    const bundlerPort = await startServer(bundlerServer, "mock bundler");
    const listenPort = await getFreePort();
    const apiPort = listenPort + 1;

    writeDaemonToml(arcDir, listenPort, rpcPort, bundlerPort);
    log(`temp HOME=${tempHome}`);

    let daemonOutput = "";
    child = spawn(process.execPath, [DAEMON_ENTRY, "--foreground"], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        HOME: tempHome,
        ARC402_MACHINE_KEY: MACHINE_KEY,
        ARC402_DAEMON_FOREGROUND: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      daemonOutput += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      daemonOutput += text;
      process.stderr.write(text);
    });

    child.on("exit", (code, signal) => {
      if (code !== null && code !== 0) {
        process.stderr.write(`[daemon-split-smoke] daemon exited early with code ${code}\n`);
      } else if (signal) {
        process.stderr.write(`[daemon-split-smoke] daemon exited from signal ${signal}\n`);
      }
    });

    await waitFor(async () => {
      if (child.exitCode !== null && daemonOutput.includes("listen EPERM")) {
        throw new Error(`listener_blocked:daemon:${daemonOutput.trim()}`);
      }
      const { response, json } = await httpJson(`http://127.0.0.1:${apiPort}/health`);
      if (!response.ok || !json || json.ok !== true) {
        return false;
      }
      return json;
    }, { timeoutMs: 15000, intervalMs: 250, label: "API health probe" });

    const tokenPath = path.join(arcDir, "daemon.token");
    const token = await waitFor(async () => {
      if (!fs.existsSync(tokenPath)) return false;
      const value = fs.readFileSync(tokenPath, "utf8").trim();
      return value || false;
    }, { timeoutMs: 15000, intervalMs: 250, label: "daemon token creation" });

    const { response: healthResp, json: healthJson } = await httpJson(`http://127.0.0.1:${apiPort}/health`);
    if (!healthResp.ok || healthJson.wallet !== WALLET_ADDRESS) {
      fail(`unexpected /health payload: ${JSON.stringify(healthJson)}`);
    }
    log("API health probe passed");

    const { response: walletResp, json: walletJson } = await httpJson(`http://127.0.0.1:${apiPort}/wallet/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!walletResp.ok || walletJson.wallet !== WALLET_ADDRESS || walletJson.chainId !== CHAIN_ID) {
      fail(`unexpected /wallet/status payload: ${JSON.stringify(walletJson)}`);
    }
    log("Authenticated wallet status probe passed");

    const { response: workroomResp, json: workroomJson } = await httpJson(`http://127.0.0.1:${apiPort}/workroom/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!workroomResp.ok || workroomJson.status !== "running") {
      fail(`unexpected /workroom/status payload: ${JSON.stringify(workroomJson)}`);
    }
    log("Authenticated workroom status probe passed");

    const commerceBody = {
      target: TARGET_ADDRESS,
      value: "0",
      data: "0x1234",
    };
    const { response: hireResp, json: hireJson } = await httpJson(`http://127.0.0.1:${apiPort}/hire`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(commerceBody),
    });

    if (!hireResp.ok || !hireJson.ok || typeof hireJson.signedUserOp !== "string") {
      fail(`unexpected /hire signer payload: ${JSON.stringify(hireJson)}`);
    }

    const signedUserOp = JSON.parse(hireJson.signedUserOp);
    if (signedUserOp.sender?.toLowerCase() !== WALLET_ADDRESS.toLowerCase()) {
      fail(`signed userop sender mismatch: ${JSON.stringify(signedUserOp)}`);
    }
    if (!signedUserOp.signature || signedUserOp.signature === "0x") {
      fail(`signed userop signature missing: ${JSON.stringify(signedUserOp)}`);
    }
    log("Signer round-trip probe passed");

    if (!daemonOutput.includes("[signer] Unix socket ready") || !daemonOutput.includes("[api] HTTP server ready")) {
      fail("daemon output did not show both signer and api startup markers");
    }
    log("Observed separate signer/api startup markers");
    log("Split daemon smoke passed");
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGINT");
      await new Promise((resolve) => {
        child.once("exit", resolve);
        setTimeout(() => resolve(), 5000);
      });
    }
    await closeServer(rpcServer);
    await closeServer(bundlerServer);
    try {
      await fsp.rm(tempHome, { recursive: true, force: true });
    } catch {
      // keep temp dir if removal fails
    }
    try {
      if (fs.existsSync(SIGNER_SOCKET_PATH)) {
        fs.unlinkSync(SIGNER_SOCKET_PATH);
      }
    } catch {
      // best effort
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("listener_blocked:") || message.includes("listen EPERM")) {
    process.stdout.write(`[daemon-split-smoke] SKIP: local listener binding is blocked in this environment (${message})\n`);
    process.exit(2);
  }
  process.stderr.write(`[daemon-split-smoke] FAIL: ${message}\n`);
  process.exit(1);
});
