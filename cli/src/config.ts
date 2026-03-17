import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface Arc402Config {
  network: "base-mainnet" | "base-sepolia";
  rpcUrl: string;
  privateKey?: string;
  guardianPrivateKey?: string;
  guardianAddress?: string;
  walletConnectProjectId?: string;
  ownerAddress?: string;
  agentRegistryAddress?: string;
  agentRegistryV2Address?: string;
  serviceAgreementAddress?: string;
  disputeArbitrationAddress?: string;
  disputeModuleAddress?: string;
  trustRegistryAddress: string;
  trustRegistryV2Address?: string;
  intentAttestationAddress?: string;
  settlementCoordinatorAddress?: string;
  sessionChannelsAddress?: string;
  reputationOracleAddress?: string;
  sponsorshipAttestationAddress?: string;
  capabilityRegistryAddress?: string;
  governanceAddress?: string;
  agreementTreeAddress?: string;
  policyEngineAddress?: string;
  walletFactoryAddress?: string;
  walletContractAddress?: string;
  watchtowerRegistryAddress?: string;
  governedTokenWhitelistAddress?: string;
  vouchingRegistryAddress?: string;
  migrationRegistryAddress?: string;
  paymasterUrl?: string;    // CDP paymaster endpoint
  cdpKeyName?: string;      // CDP API key name (org/.../apiKeys/...)
  cdpPrivateKey?: string;   // CDP EC private key — base64 DER SEC1 (store in CDP_PRIVATE_KEY env var)
  subdomainApi?: string;    // defaults to https://api.arc402.xyz
  telegramBotToken?: string;
  telegramChatId?: string;
  telegramThreadId?: number;
  wcSession?: {
    topic: string;
    expiry: number;    // Unix timestamp
    account: string;   // Phone wallet address
    chainId: number;
  };
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

// Public Base RPC — stale state, do not use for production. Alchemy recommended.
export const PUBLIC_BASE_RPC = "https://mainnet.base.org";
export const ALCHEMY_BASE_RPC = "https://base-mainnet.g.alchemy.com/v2/YIA2uRCsFI-j5pqH-aRzflrACSlV1Qrs";

/**
 * Warn at runtime if the configured RPC is the public Base endpoint.
 * Public Base RPC has delayed state propagation — use Alchemy for production.
 */
export function warnIfPublicRpc(config: Arc402Config): void {
  if (config.rpcUrl === PUBLIC_BASE_RPC || config.rpcUrl === "https://sepolia.base.org") {
    console.warn("WARN: Using public Base RPC — state reads may be stale. Set rpcUrl to an Alchemy endpoint for production.");
    console.warn(`  Recommended: arc402 config set rpcUrl ${ALCHEMY_BASE_RPC}`);
  }
}

export const NETWORK_DEFAULTS: Record<string, Partial<Arc402Config> & { usdcAddress: string }> = {
  "base-mainnet": {
    rpcUrl: ALCHEMY_BASE_RPC,
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    paymasterUrl: "https://api.developer.coinbase.com/rpc/v1/base/dca85088-a2ac-4ec3-8647-5154b150e7a9",
    // Base Mainnet deployments — v2 deployed 2026-03-15
    policyEngineAddress:           "0xAA5Ef3489C929bFB3BFf5D5FE15aa62d3763c847",
    trustRegistryAddress:          "0x22366D6dabb03062Bc0a5E893EfDff15D8E329b1",   // TrustRegistryV3 — v2
    trustRegistryV2Address:        "0xdA1D377991B2E580991B0DD381CdD635dd71aC39",   // old v2, kept for reference
    intentAttestationAddress:      "0x7ad8db6C5f394542E8e9658F86C85cC99Cf6D460",
    settlementCoordinatorAddress: "0xd52d8Be9728976E0D70C89db9F8ACeb5B5e97cA2",  // SettlementCoordinatorV2
    agentRegistryAddress:          "0xcc0D8731ccCf6CFfF4e66F6d68cA86330Ea8B622",   // ARC402RegistryV2
    agentRegistryV2Address:        "0xD5c2851B00090c92Ba7F4723FB548bb30C9B6865",   // AgentRegistry
    walletFactoryAddress:          "0x6a46e51fA3B28eBF2D1adA81a4a3CA1cEd2fC245",   // WalletFactoryV4 — deployed 2026-03-17 (passkey P256 support)
    sponsorshipAttestationAddress: "0xD6c2edE89Ea71aE19Db2Be848e172b444Ed38f22",
    serviceAgreementAddress:       "0xC98B402CAB9156da68A87a69E3B4bf167A3CCcF6",
    sessionChannelsAddress:        "0x578f8d1bd82E8D6268E329d664d663B4d985BE61",
    disputeModuleAddress:          "0x5ebd301cEF0C908AB17Fd183aD9c274E4B34e9d6",
    reputationOracleAddress:       "0x359F76a54F9A345546E430e4d6665A7dC9DaECd4",
    governanceAddress:             "0xE931DD2EEb9Af9353Dd5E2c1250492A0135E0EC4",   // ARC402Governance
    guardianAddress:               "0xED0A033B79626cdf9570B6c3baC7f699cD0032D8",   // ARC402Guardian
    walletContractAddress:         "0xfd5C8c0a08fDcdeD2fe03e0DC9FA55595667F313",   // ARC402Wallet instance
    agreementTreeAddress:          "0x6a82240512619B25583b9e95783410cf782915b1",
    capabilityRegistryAddress:     "0x7becb642668B80502dD957A594E1dD0aC414c1a3",
    disputeArbitrationAddress:     "0xF61b75E4903fbC81169FeF8b7787C13cB7750601",
    governedTokenWhitelistAddress: "0xeB58896337244Bb408362Fea727054f9e7157451",
    watchtowerRegistryAddress:     "0xbC811d1e3c5C5b67CA57df1DFb08847b1c8c458A",
    vouchingRegistryAddress:       "0x94519194Bf17865770faD59eF581feC512Ae99c9",
    migrationRegistryAddress:      "0xb60B62357b90F254f555f03B162a30E22890e3B5",
  },
  "base-sepolia": {
    rpcUrl: "https://sepolia.base.org",
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    // v2 deployment — Base Sepolia (chain 84532) — deployed 2026-03-15
    // Unchanged v1 contracts:
    policyEngineAddress:          "0x44102e70c2A366632d98Fe40d892a2501fC7fFF2",
    intentAttestationAddress:     "0x942c807Cc6E0240A061e074b61345618aBadc457",
    settlementCoordinatorAddress: "0x52b565797975781f069368Df40d6633b2aD03390",
    agentRegistryV2Address:       "0x07D526f8A8e148570509aFa249EFF295045A0cc9", // AgentRegistry
    reputationOracleAddress:      "0x410e650113fd163389C956BC7fC51c5642617187",
    walletFactoryAddress:         "0xD560C22aD5372Aa830ee5ffBFa4a5D9f528e7B87",
    sponsorshipAttestationAddress:"0xc0d927745AcF8DEeE551BE11A12c97c492DDC989",
    governanceAddress:            "0x504b3D73A8dFbcAB9551d8a11Bb0B07C90C4c926",
    guardianAddress:              "0x5c1D2cD6B9B291b436BF1b109A711F0E477EB6fe",
    walletContractAddress:        "0xc77854f9091A25eD1f35EA24E9bdFb64d0850E45",
    agreementTreeAddress:         "0x8F46F31FcEbd60f526308AD20e4a008887709720",
    capabilityRegistryAddress:    "0x6a413e74b65828A014dD8DA61861Bf9E1b6372D2",
    governedTokenWhitelistAddress:"0x64C15CA701167C7c901a8a5575a5232b37CAF213",
    watchtowerRegistryAddress:    "0x70c4E53E3A916eB8A695630f129B943af9C61C57",
    // v2 contracts (new/redeployed 2026-03-15):
    trustRegistryAddress:         "0xf2aE072BB8575c23B0efbF44bDc8188aA900cA7a", // TrustRegistryV3
    agentRegistryAddress:         "0x0461b2b7A1E50866962CB07326000A94009c58Ff", // ARC402RegistryV2
    serviceAgreementAddress:      "0xbbb1DA355D810E9baEF1a7D072B2132E4755976B",
    sessionChannelsAddress:       "0x5EF144AE2C8456d014e6E3F293c162410C043564",
    disputeModuleAddress:         "0x01866144495fBBbBB7aaD81605de051B2A62594A",
    disputeArbitrationAddress:    "0xa4f6F77927Da53a25926A5f0bffBEB0210108cA8",
    vouchingRegistryAddress:      "0x96432aDc7aC06256297AdF11B94C47f68b2F13A2",
    migrationRegistryAddress:     "0x3aeAaD32386D6fC40eeb5c2C27a5aCFE6aDf9ABD",
  },
};

export const getUsdcAddress = (config: Arc402Config) => NETWORK_DEFAULTS[config.network]?.usdcAddress ?? "";

export function getSubdomainApi(config: Arc402Config): string {
  return config.subdomainApi ?? "https://api.arc402.xyz";
}
