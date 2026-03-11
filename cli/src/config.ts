import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface Arc402Config {
  network: "base-mainnet" | "base-sepolia";
  rpcUrl: string;
  privateKey?: string;
  agentRegistryAddress: string;
  serviceAgreementAddress: string;
  trustRegistryAddress: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".arc402");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export function loadConfig(): Arc402Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(
      "No config found. Run `arc402 config init` to set up your configuration."
    );
    process.exit(1);
  }
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(raw) as Arc402Config;
}

export function saveConfig(config: Arc402Config): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_PATH);
}

export const NETWORK_DEFAULTS: Record<
  string,
  Partial<Arc402Config> & { usdcAddress: string }
> = {
  "base-mainnet": {
    rpcUrl: "https://mainnet.base.org",
    agentRegistryAddress: "0x0000000000000000000000000000000000000000",
    serviceAgreementAddress: "0x0000000000000000000000000000000000000000",
    trustRegistryAddress: "0x0000000000000000000000000000000000000000",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  "base-sepolia": {
    rpcUrl: "https://sepolia.base.org",
    agentRegistryAddress: "0x0000000000000000000000000000000000000000", // TBD — not yet deployed
    serviceAgreementAddress: "0x0000000000000000000000000000000000000000", // TBD — not yet deployed
    trustRegistryAddress: "0xdA1D377991B2E580991B0DD381CdD635dd71aC39",
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
};

export function getUsdcAddress(config: Arc402Config): string {
  return NETWORK_DEFAULTS[config.network]?.usdcAddress ?? "";
}
