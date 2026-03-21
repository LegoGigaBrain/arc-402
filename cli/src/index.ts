#!/usr/bin/env node
import { Command } from "commander";
import fs from "fs";
import path from "path";
import os from "os";
import { registerAcceptCommand } from "./commands/accept";
import { registerAgentCommands } from "./commands/agent";
import { registerAgreementsCommands } from "./commands/agreements";
import { registerArbitratorCommand } from "./commands/arbitrator";
import { registerCancelCommand } from "./commands/cancel";
import { registerChannelCommands } from "./commands/channel";
import { registerConfigCommands } from "./commands/config";
import { registerDeliverCommand } from "./commands/deliver";
import { registerDiscoverCommand } from "./commands/discover";
import { registerEndpointCommands } from "./commands/endpoint";
import { registerDisputeCommand } from "./commands/dispute";
import { registerHireCommand } from "./commands/hire";
import { registerHandshakeCommand } from "./commands/agent-handshake";
import { registerNegotiateCommands } from "./commands/negotiate";
import { registerRelayCommands } from "./commands/relay";
import { registerRemediateCommands } from "./commands/remediate";
import { registerDaemonCommands } from "./commands/daemon";
import { registerOpenShellCommands } from "./commands/openshell";
import { registerWorkroomCommands } from "./commands/workroom";
import { registerArenaHandshakeCommands } from "./commands/arena-handshake";
import { registerTrustCommand } from "./commands/trust";
import { registerWalletCommands } from "./commands/wallet";
import { renderBanner } from "./ui/banner";
import { registerOwnerCommands } from "./commands/owner";
import { registerSetupCommands } from "./commands/setup";
import { registerVerifyCommand } from "./commands/verify";
import { registerContractInteractionCommands } from "./commands/contract-interaction";
import { registerWatchtowerCommands } from "./commands/watchtower";
import { registerColdStartCommands } from "./commands/coldstart";
import { registerMigrateCommands } from "./commands/migrate";
import { registerFeedCommand } from "./commands/feed";
import { registerArenaCommands } from "./commands/arena";
import { registerWatchCommand } from "./commands/watch";
import reputation from "./commands/reputation.js";
import policy from "./commands/policy.js";
import { BannerConfig } from "./ui/banner";

// Show banner when invoked with no arguments
if (process.argv.length <= 2) {
  void (async () => {
    const CONFIG_PATH = path.join(os.homedir(), ".arc402", "config.json");
    let bannerCfg: BannerConfig | undefined;

    if (fs.existsSync(CONFIG_PATH)) {
      try {
        const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as {
          network?: string;
          walletContractAddress?: string;
          rpcUrl?: string;
        };
        bannerCfg = { network: raw.network };
        if (raw.walletContractAddress) {
          const w = raw.walletContractAddress;
          bannerCfg.wallet = `${w.slice(0, 6)}...${w.slice(-4)}`;
        }
        if (raw.rpcUrl && raw.walletContractAddress) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const ethersLib = require("ethers") as typeof import("ethers");
            const provider = new ethersLib.ethers.JsonRpcProvider(raw.rpcUrl);
            const bal = await Promise.race([
              provider.getBalance(raw.walletContractAddress),
              new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 2000)),
            ]);
            bannerCfg.balance = `${parseFloat(ethersLib.ethers.formatEther(bal)).toFixed(4)} ETH`;
          } catch { /* skip balance on error/timeout */ }
        }
      } catch { /* skip config info on parse error */ }
    }

    renderBanner(bannerCfg);
    process.exit(0);
  })();
} else {

const program = new Command();
program.name("arc402").description("ARC-402 CLI aligned to canonical-capability discovery → negotiate → hire → remediate → dispute workflow").version(require("../package.json").version);
registerConfigCommands(program);
registerHandshakeCommand(program);
registerAgentCommands(program);
registerDiscoverCommand(program);
registerEndpointCommands(program);
registerNegotiateCommands(program);
registerHireCommand(program);
registerAgreementsCommands(program);
registerAcceptCommand(program);
registerDeliverCommand(program);
registerRemediateCommands(program);
registerDisputeCommand(program);
registerArbitratorCommand(program);
registerCancelCommand(program);
registerChannelCommands(program);
registerRelayCommands(program);
registerDaemonCommands(program);
registerOpenShellCommands(program);
registerWorkroomCommands(program);
registerArenaHandshakeCommands(program);
registerTrustCommand(program);
registerWalletCommands(program);
registerOwnerCommands(program);
registerSetupCommands(program);
registerVerifyCommand(program);
registerContractInteractionCommands(program);
registerWatchtowerCommands(program);
registerColdStartCommands(program);
registerMigrateCommands(program);
registerFeedCommand(program);
registerArenaCommands(program);
registerWatchCommand(program);
program.addCommand(reputation);
program.addCommand(policy);
program.parse(process.argv);

} // end else (has arguments)
