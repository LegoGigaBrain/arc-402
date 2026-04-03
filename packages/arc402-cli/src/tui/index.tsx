import React from "react";
import { render, ScreenManager } from "../renderer/index.js";
import { App } from "./App";
import fs from "fs";
import path from "path";
import os from "os";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require("../../package.json") as { version: string };

const CONFIG_PATH = path.join(os.homedir(), ".arc402", "config.json");

interface Config {
  network?: string;
  walletContractAddress?: string;
  rpcUrl?: string;
}

async function loadConfig(): Promise<Config> {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as Config;
  } catch {
    return {};
  }
}

async function getBalance(
  rpcUrl: string,
  address: string
): Promise<string | undefined> {
  let provider: import("ethers").JsonRpcProvider | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ethersLib = require("ethers") as typeof import("ethers");
    // Silence ethers' internal polling noise during TUI launch
    provider = new ethersLib.ethers.JsonRpcProvider(rpcUrl);
    const bal = await Promise.race([
      provider.getBalance(address),
      new Promise<never>((_, r) =>
        setTimeout(() => r(new Error("timeout")), 2000)
      ),
    ]);
    return `${parseFloat(ethersLib.ethers.formatEther(bal)).toFixed(4)} ETH`;
  } catch {
    return undefined;
  } finally {
    // Destroy provider to stop internal polling — prevents output flood in TUI
    try { provider?.destroy(); } catch { /* ignore */ }
  }
}

export async function launchTUI(): Promise<void> {
  const config = await loadConfig();

  let walletDisplay: string | undefined;
  if (config.walletContractAddress) {
    const w = config.walletContractAddress;
    walletDisplay = `${w.slice(0, 6)}...${w.slice(-4)}`;
  }

  let balance: string | undefined;
  if (config.rpcUrl && config.walletContractAddress) {
    // Suppress stderr during balance fetch — ethers retries flood the terminal
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array, ...args: unknown[]) => {
      const str = typeof chunk === 'string' ? chunk : chunk.toString();
      if (str.includes('JsonRpcProvider') || str.includes('retry in')) return true;
      return (origStderr as (...a: unknown[]) => boolean)(chunk, ...args);
    };
    balance = await getBalance(config.rpcUrl, config.walletContractAddress);
    process.stderr.write = origStderr; // restore
  }

  const screen = new ScreenManager();
  screen.enter();

  // Register cleanup (ScreenManager registers SIGINT/SIGTERM internally,
  // but also wire process-level signals to be safe)
  process.on('SIGINT', () => { screen.exit(); process.exit(0); });
  process.on('SIGTERM', () => { screen.exit(); process.exit(0); });

  const { waitUntilExit } = render(
    <App
      version={pkg.version}
      network={config.network}
      wallet={walletDisplay}
      balance={balance}
    />
  );

  await waitUntilExit();
  screen.exit();
}
