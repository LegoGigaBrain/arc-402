import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface Arc402Config {
  network: "base-mainnet" | "base-sepolia";
  rpcUrl: string;
  privateKey?: string;
  agentRegistryAddress?: string;
  serviceAgreementAddress?: string;
  disputeArbitrationAddress?: string;
  trustRegistryAddress: string;
  reputationOracleAddress?: string;
  sponsorshipAttestationAddress?: string;
  capabilityRegistryAddress?: string;
  governanceAddress?: string;
  agreementTreeAddress?: string;
  policyEngineAddress?: string;
  walletFactoryAddress?: string;
  walletContractAddress?: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".arc402");
const CONFIG_PATH = process.env.ARC402_CONFIG || path.join(CONFIG_DIR, "config.json");

export const getConfigPath = () => CONFIG_PATH;

export function loadConfig(): Arc402Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`No config found at ${CONFIG_PATH}. Run \`arc402 config init\` to set up your configuration.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as Arc402Config;
}

export function saveConfig(config: Arc402Config): void {
  const configDir = path.dirname(CONFIG_PATH);
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export const configExists = () => fs.existsSync(CONFIG_PATH);

export const NETWORK_DEFAULTS: Record<string, Partial<Arc402Config> & { usdcAddress: string }> = {
  "base-mainnet": {
    rpcUrl: "https://mainnet.base.org",
    trustRegistryAddress: "0x0000000000000000000000000000000000000000",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  "base-sepolia": {
    rpcUrl: "https://sepolia.base.org",
    trustRegistryAddress: "0xdA1D377991B2E580991B0DD381CdD635dd71aC39",
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    walletFactoryAddress: "0xD560C22aD5372Aa830ee5ffBFa4a5D9f528e7B87",
  },
};

export const getUsdcAddress = (config: Arc402Config) => NETWORK_DEFAULTS[config.network]?.usdcAddress ?? "";
