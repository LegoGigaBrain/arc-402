#!/usr/bin/env node
import { Command } from "commander";
import { registerAcceptCommand } from "./commands/accept";
import { registerAgentCommands } from "./commands/agent";
import { registerAgreementsCommands } from "./commands/agreements";
import { registerArbitratorCommand } from "./commands/arbitrator";
import { registerCancelCommand } from "./commands/cancel";
import { registerChannelCommands } from "./commands/channel";
import { registerConfigCommands } from "./commands/config";
import { registerDeliverCommand } from "./commands/deliver";
import { registerDiscoverCommand } from "./commands/discover";
import { registerDisputeCommand } from "./commands/dispute";
import { registerHireCommand } from "./commands/hire";
import { registerHandshakeCommand } from "./commands/agent-handshake";
import { registerNegotiateCommands } from "./commands/negotiate";
import { registerRelayCommands } from "./commands/relay";
import { registerRemediateCommands } from "./commands/remediate";
import { registerDaemonCommands } from "./commands/daemon";
import { registerTrustCommand } from "./commands/trust";
import { registerWalletCommands } from "./commands/wallet";
import { renderBanner } from "./ui/banner";
import { registerOwnerCommands } from "./commands/owner";
import { registerVerifyCommand } from "./commands/verify";
import reputation from "./commands/reputation.js";
import policy from "./commands/policy.js";

// Show banner when invoked with no arguments
if (process.argv.length <= 2) {
  renderBanner();
  process.exit(0);
}

const program = new Command();
program.name("arc402").description("ARC-402 CLI aligned to canonical-capability discovery → negotiate → hire → remediate → dispute workflow").version("0.2.0");
registerConfigCommands(program);
registerHandshakeCommand(program);
registerAgentCommands(program);
registerDiscoverCommand(program);
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
registerTrustCommand(program);
registerWalletCommands(program);
registerOwnerCommands(program);
registerVerifyCommand(program);
program.addCommand(reputation);
program.addCommand(policy);
program.parse(process.argv);
