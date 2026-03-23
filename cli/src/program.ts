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
import { registerOwnerCommands } from "./commands/owner";
import { registerSetupCommands } from "./commands/setup";
import { registerVerifyCommand } from "./commands/verify";
import { registerContractInteractionCommands } from "./commands/contract-interaction";
import { registerWatchtowerCommands } from "./commands/watchtower";
import { registerColdStartCommands } from "./commands/coldstart";
import { registerDoctorCommand } from "./commands/doctor";
import { registerMigrateCommands } from "./commands/migrate";
import { registerFeedCommand } from "./commands/feed";
import { registerArenaCommands } from "./commands/arena";
import { registerWatchCommand } from "./commands/watch";
import { registerBackupCommand } from "./commands/backup";
import { registerComputeCommands } from "./commands/compute";
import { registerTunnelCommands } from "./commands/tunnel";
import reputation from "./commands/reputation.js";
import policy from "./commands/policy.js";

export function createProgram(): Command {
  const program = new Command();
  program
    .name("arc402")
    .description(
      "ARC-402 CLI aligned to canonical-capability discovery → negotiate → hire → remediate → dispute workflow"
    )
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    .version((require("../package.json") as { version: string }).version);

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
  registerDoctorCommand(program);
  registerMigrateCommands(program);
  registerFeedCommand(program);
  registerArenaCommands(program);
  registerWatchCommand(program);
  registerBackupCommand(program);
  registerComputeCommands(program);
  registerTunnelCommands(program);
  program.addCommand(reputation);
  program.addCommand(policy);

  return program;
}
