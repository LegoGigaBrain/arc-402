import { Command } from "commander";
import { AgentRegistryClient } from "@arc402/sdk";
import { loadConfig } from "../config";
import { getClient, requireSigner } from "../client";
import { formatDate, getTrustTier } from "../utils/format";

export function registerAgentCommands(program: Command): void {
  const agent = program.command("agent").description("Agent registry operations (directory metadata; canonical capability claims live separately in CapabilityRegistry)");
  agent.command("register").requiredOption("--name <name>").requiredOption("--service-type <type>").option("--capability <caps>").option("--endpoint <url>", "Endpoint", "").option("--metadata-uri <uri>", "Metadata URI", "").action(async (opts) => {
    const config = loadConfig(); if (!config.agentRegistryAddress) throw new Error("agentRegistryAddress missing in config");
    const { signer } = await requireSigner(config); const client = new AgentRegistryClient(config.agentRegistryAddress, signer);
    await client.register({ name: opts.name, serviceType: opts.serviceType, capabilities: opts.capability ? opts.capability.split(",").map((v: string) => v.trim()) : [], endpoint: opts.endpoint, metadataURI: opts.metadataUri });
    console.log("registered");
  });
  agent.command("update").requiredOption("--name <name>").requiredOption("--service-type <type>").option("--capability <caps>").option("--endpoint <url>", "Endpoint", "").option("--metadata-uri <uri>", "Metadata URI", "").action(async (opts) => {
    const config = loadConfig(); if (!config.agentRegistryAddress) throw new Error("agentRegistryAddress missing in config");
    const { signer } = await requireSigner(config); const client = new AgentRegistryClient(config.agentRegistryAddress, signer);
    await client.update({ name: opts.name, serviceType: opts.serviceType, capabilities: opts.capability ? opts.capability.split(",").map((v: string) => v.trim()) : [], endpoint: opts.endpoint, metadataURI: opts.metadataUri });
    console.log("updated");
  });
  agent.command("heartbeat").description("Submit self-reported heartbeat data (informational, not strong ranking-grade trust)").option("--latency-ms <n>", "Observed latency", "0").action(async (opts) => {
    const config = loadConfig(); if (!config.agentRegistryAddress) throw new Error("agentRegistryAddress missing in config");
    const { signer } = await requireSigner(config); const client = new AgentRegistryClient(config.agentRegistryAddress, signer);
    await client.submitHeartbeat(Number(opts.latencyMs)); console.log("heartbeat submitted");
  });
  agent.command("heartbeat-policy").description("Configure self-reported heartbeat timing metadata").requiredOption("--interval <seconds>").requiredOption("--grace <seconds>").action(async (opts) => {
    const config = loadConfig(); if (!config.agentRegistryAddress) throw new Error("agentRegistryAddress missing in config");
    const { signer } = await requireSigner(config); const client = new AgentRegistryClient(config.agentRegistryAddress, signer);
    await client.setHeartbeatPolicy(Number(opts.interval), Number(opts.grace)); console.log("heartbeat policy updated");
  });
  agent.command("info <address>").option("--json").action(async (address, opts) => {
    const config = loadConfig(); if (!config.agentRegistryAddress) throw new Error("agentRegistryAddress missing in config");
    const { provider } = await getClient(config); const client = new AgentRegistryClient(config.agentRegistryAddress, provider);
    const [info, ops] = await Promise.all([client.getAgent(address), client.getOperationalMetrics(address)]);
    if (opts.json) return console.log(JSON.stringify({ ...info, registeredAt: Number(info.registeredAt), endpointChangedAt: Number(info.endpointChangedAt), endpointChangeCount: Number(info.endpointChangeCount), trustScore: Number(info.trustScore ?? 0n), operational: Object.fromEntries(Object.entries(ops).map(([k, v]) => [k, Number(v)])) }, null, 2));
    console.log(`${info.name} ${info.wallet}\nservice=${info.serviceType}\ntrust=${Number(info.trustScore ?? 0n)} (${getTrustTier(Number(info.trustScore ?? 0n))})\nregistered=${formatDate(Number(info.registeredAt))}\nheartbeatCount=${Number(ops.heartbeatCount)} uptimeScore=${Number(ops.uptimeScore)} responseScore=${Number(ops.responseScore)}`);
  });
  agent.command("me").action(async () => { const config = loadConfig(); const { address } = await getClient(config); if (!address) throw new Error("No wallet configured"); await program.parseAsync([process.argv[0], process.argv[1], "agent", "info", address], { from: "user" }); });
}
