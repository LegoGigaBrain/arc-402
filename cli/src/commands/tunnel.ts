import { Command } from "commander";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync, spawn } from "child_process";
import { loadConfig, saveConfig } from "../config";
import { startSpinner } from "../ui/spinner";
import { c } from "../ui/colors";

const API_BASE = "https://api.arc402.xyz";
const ARC402_DIR = path.join(os.homedir(), ".arc402");
const TUNNEL_TOKEN_PATH = path.join(ARC402_DIR, "tunnel-token");
const TUNNEL_ID_PATH = path.join(ARC402_DIR, "tunnel-id");
const TUNNEL_PID_PATH = path.join(ARC402_DIR, "tunnel.pid");

export function registerTunnelCommands(program: Command): void {
  const tunnel = program
    .command("tunnel")
    .description("Manage Cloudflare Tunnel for your agent endpoint");

  // ── arc402 tunnel setup ──────────────────────────────────────────────
  tunnel
    .command("setup")
    .description("Provision a Cloudflare Tunnel for your agent's subdomain")
    .requiredOption("--subdomain <name>", "Subdomain to provision (e.g. megabrain)")
    .action(async (opts: { subdomain: string }) => {
      const config = loadConfig();
      const subdomain = opts.subdomain.toLowerCase();

      if (!config.privateKey) {
        console.error(c.red("✗ No private key found in ~/.arc402/config.json"));
        console.error("  Run 'arc402 config set privateKey <key>' or set up your wallet first.");
        process.exit(1);
      }

      const wallet = new ethers.Wallet(config.privateKey);
      const walletAddress = config.walletContractAddress || wallet.address;

      console.log(c.dim(`Agent wallet: ${walletAddress}`));
      console.log(c.dim(`Subdomain:    ${subdomain}.arc402.xyz`));
      console.log();

      // Step 1: Check availability
      const checkSpinner = startSpinner("Checking subdomain availability…");
      let checkRes: Response;
      try {
        checkRes = await fetch(`${API_BASE}/check/${subdomain}`);
      } catch {
        checkSpinner.fail("Failed to reach api.arc402.xyz");
        process.exit(1);
      }
      const checkData = await checkRes.json() as { available?: boolean; reason?: string };

      if (!checkData.available) {
        if (fs.existsSync(TUNNEL_TOKEN_PATH)) {
          checkSpinner.succeed(`${subdomain}.arc402.xyz already registered (you have a token)`);
          console.log(c.dim("  Use 'arc402 tunnel start' to connect."));
          return;
        }
        checkSpinner.fail(`${subdomain}.arc402.xyz is already taken`);
        process.exit(1);
      }
      checkSpinner.succeed(`${subdomain}.arc402.xyz is available`);

      // Step 2: Sign the provision request
      const signSpinner = startSpinner("Signing provision request…");
      const timestamp = Math.floor(Date.now() / 1000);
      const message = `arc402-provision:${subdomain}:${timestamp}`;
      const signature = await wallet.signMessage(message);
      signSpinner.succeed("Request signed");

      // Step 3: Call the provisioner API
      const provSpinner = startSpinner("Provisioning tunnel…");
      let provRes: Response;
      try {
        provRes = await fetch(`${API_BASE}/tunnel/provision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subdomain, walletAddress, signature, timestamp }),
        });
      } catch {
        provSpinner.fail("Failed to reach provisioner API");
        process.exit(1);
      }

      const provData = await provRes.json() as {
        success?: boolean;
        error?: string;
        tunnelId?: string;
        token?: string;
        subdomain?: string;
      };

      if (!provData.success || !provData.token) {
        provSpinner.fail(`Provisioning failed: ${provData.error || "unknown error"}`);
        process.exit(1);
      }
      provSpinner.succeed(`Tunnel created: ${provData.tunnelId}`);

      // Step 4: Save tunnel token + ID
      fs.mkdirSync(ARC402_DIR, { recursive: true });
      fs.writeFileSync(TUNNEL_TOKEN_PATH, provData.token, { mode: 0o600 });
      fs.writeFileSync(TUNNEL_ID_PATH, provData.tunnelId!, { mode: 0o600 });
      console.log(c.green("✓ Tunnel token saved to ~/.arc402/tunnel-token"));

      // Step 5: Check if cloudflared is installed
      let hasCloudflared = false;
      try {
        execSync("which cloudflared", { stdio: "pipe" });
        hasCloudflared = true;
        console.log(c.green("✓ cloudflared found"));
      } catch {
        console.log(c.yellow("⚠ cloudflared not found — install it to connect:"));
        const platform = os.platform();
        if (platform === "darwin") {
          console.log(c.dim("  brew install cloudflare/cloudflare/cloudflared"));
        } else if (platform === "linux") {
          console.log(c.dim("  curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb"));
          console.log(c.dim("  sudo dpkg -i cloudflared.deb"));
        } else {
          console.log(c.dim("  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"));
        }
      }

      // Step 6: Update endpoint in config
      const fqdn = `https://${subdomain}.arc402.xyz`;
      saveConfig({ ...config, endpoint: fqdn });
      console.log(c.green(`✓ Endpoint set to ${fqdn}`));

      console.log();
      if (hasCloudflared) {
        console.log(c.white("Tunnel provisioned! Start it with:"));
        console.log(c.white("  arc402 tunnel start"));
      } else {
        console.log(c.white("Tunnel provisioned! Install cloudflared, then:"));
        console.log(c.white("  arc402 tunnel start"));
      }
    });

  // ── arc402 tunnel start ──────────────────────────────────────────────
  tunnel
    .command("start")
    .description("Start the Cloudflare Tunnel (runs cloudflared in background)")
    .option("--foreground", "Run in foreground instead of background")
    .action(async (opts: { foreground?: boolean }) => {
      if (!fs.existsSync(TUNNEL_TOKEN_PATH)) {
        console.error(c.red("✗ No tunnel token found. Run 'arc402 tunnel setup' first."));
        process.exit(1);
      }

      const token = fs.readFileSync(TUNNEL_TOKEN_PATH, "utf-8").trim();

      try {
        execSync("which cloudflared", { stdio: "pipe" });
      } catch {
        console.error(c.red("✗ cloudflared not installed. Install it and try again."));
        process.exit(1);
      }

      if (opts.foreground) {
        console.log(c.dim("Starting tunnel in foreground (Ctrl+C to stop)…"));
        const child = spawn("cloudflared", ["tunnel", "run", "--token", token], {
          stdio: "inherit",
        });
        child.on("exit", (code) => process.exit(code ?? 0));
      } else {
        console.log(c.dim("Starting tunnel in background…"));
        const child = spawn("cloudflared", ["tunnel", "run", "--token", token], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();

        fs.writeFileSync(TUNNEL_PID_PATH, String(child.pid));

        // Wait and verify
        await new Promise((r) => setTimeout(r, 3000));
        try {
          process.kill(child.pid!, 0);
          console.log(c.green(`✓ Tunnel running (PID ${child.pid})`));
        } catch {
          console.error(c.red("✗ Tunnel process died — run with --foreground to see logs"));
          process.exit(1);
        }
      }
    });

  // ── arc402 tunnel stop ───────────────────────────────────────────────
  tunnel
    .command("stop")
    .description("Stop the running Cloudflare Tunnel")
    .action(async () => {
      if (fs.existsSync(TUNNEL_PID_PATH)) {
        const pid = parseInt(fs.readFileSync(TUNNEL_PID_PATH, "utf-8").trim(), 10);
        try {
          process.kill(pid, "SIGTERM");
          fs.unlinkSync(TUNNEL_PID_PATH);
          console.log(c.green(`✓ Tunnel stopped (PID ${pid})`));
          return;
        } catch {
          fs.unlinkSync(TUNNEL_PID_PATH);
        }
      }

      // Fallback: kill any cloudflared tunnel run process
      try {
        execSync("pkill -f 'cloudflared tunnel run'", { stdio: "pipe" });
        console.log(c.green("✓ Tunnel stopped"));
      } catch {
        console.log(c.yellow("⚠ No tunnel process found"));
      }
    });

  // ── arc402 tunnel status ─────────────────────────────────────────────
  tunnel
    .command("status")
    .description("Check tunnel connection status")
    .action(async () => {
      const config = loadConfig();
      const endpoint = config.endpoint || "";
      const match = endpoint.match(/^https:\/\/([^.]+)\.arc402\.xyz/);

      if (!match) {
        console.log(c.yellow("⚠ No arc402.xyz subdomain configured"));
        console.log(c.dim("  Run 'arc402 tunnel setup --subdomain <name>' first"));
        return;
      }

      const subdomain = match[1];
      const statusSpinner = startSpinner(`Checking ${subdomain}.arc402.xyz…`);

      try {
        const res = await fetch(`${API_BASE}/tunnel/status/${subdomain}`);
        const data = await res.json() as { exists: boolean; connected: boolean; subdomain: string };

        if (data.connected) {
          statusSpinner.succeed(`${data.subdomain} — connected`);
        } else if (data.exists) {
          statusSpinner.succeed(`${data.subdomain} — DNS exists, tunnel not connected`);
          console.log(c.dim("  Run 'arc402 tunnel start' to connect"));
        } else {
          statusSpinner.fail(`${subdomain}.arc402.xyz — not provisioned`);
        }
      } catch {
        statusSpinner.fail("Failed to reach api.arc402.xyz");
      }
    });

  // ── arc402 tunnel teardown ───────────────────────────────────────────
  tunnel
    .command("teardown")
    .description("Delete your tunnel and DNS record")
    .action(async () => {
      const config = loadConfig();
      if (!config.privateKey) {
        console.error(c.red("✗ No private key found"));
        process.exit(1);
      }

      const endpoint = config.endpoint || "";
      const match = endpoint.match(/^https:\/\/([^.]+)\.arc402\.xyz/);
      if (!match) {
        console.error(c.red("✗ No arc402.xyz subdomain in config"));
        process.exit(1);
      }

      const subdomain = match[1];
      const wallet = new ethers.Wallet(config.privateKey);
      const walletAddress = config.walletContractAddress || wallet.address;
      const timestamp = Math.floor(Date.now() / 1000);
      const message = `arc402-provision:${subdomain}:${timestamp}`;
      const signature = await wallet.signMessage(message);

      const teardownSpinner = startSpinner("Deprovisioning tunnel…");
      try {
        const res = await fetch(`${API_BASE}/tunnel/deprovision`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subdomain, walletAddress, signature, timestamp }),
        });
        const data = await res.json() as { success?: boolean; error?: string };

        if (data.success) {
          [TUNNEL_TOKEN_PATH, TUNNEL_ID_PATH, TUNNEL_PID_PATH].forEach((f) => {
            try { fs.unlinkSync(f); } catch { /* ignore */ }
          });
          teardownSpinner.succeed(`${subdomain}.arc402.xyz deprovisioned`);
        } else {
          teardownSpinner.fail(data.error || "Unknown error");
        }
      } catch {
        teardownSpinner.fail("Failed to reach provisioner API");
      }
    });
}
