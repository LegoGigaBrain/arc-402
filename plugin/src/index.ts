/**
 * ARC-402 OpenClaw Plugin — entry point
 *
 * HOST-SIDE remote control for the ARC-402 protocol. One install gives every
 * agent native tools for hiring, compute, subscriptions, workroom management,
 * and on-chain operations.
 *
 * ALL inbound HTTP handling (hire proposals, file delivery, compute sessions)
 * belongs exclusively to the workroom daemon running inside the governed Docker
 * container. The Cloudflare tunnel points to workroom:4402, not this host.
 *
 * Install: openclaw plugins install @arc402/arc402
 */
// Inlined from openclaw/plugin-sdk/plugin-entry to avoid runtime peer dependency issues.
// OpenClaw is not on npm — inlining the single function used avoids "Cannot find module" on install.
type PluginKind = "tool" | "provider" | "memory" | "channel" | "command" | "service";
function definePluginEntry(def: {
  id: string;
  name: string;
  description?: string;
  kind?: PluginKind;
  configSchema?: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: (api: any) => void;
}) {
  const { id, name, description, kind, configSchema, register } = def;
  return { id, name, description, ...(kind ? { kind } : {}), configSchema, register };
}
import { resolveConfig } from "./config.js";
import type { PluginConfig } from "./config.js";

import { registerHireTools } from "./tools/hire.js";
import { registerComputeTools } from "./tools/compute.js";
import { registerSubscribeTools } from "./tools/subscribe.js";
import { registerDiscoverTool } from "./tools/discover.js";
import { registerWalletTools } from "./tools/wallet.js";
import { registerNegotiateTools } from "./tools/negotiate.js";
import { registerDisputeTools } from "./tools/dispute.js";
import { registerAgentTools } from "./tools/agent.js";
import { registerEndpointTools } from "./tools/endpoint.js";
import { registerTrustTools } from "./tools/trust.js";
import { registerWorkroomTools } from "./tools/workroom.js";
import { registerArenaTools } from "./tools/arena.js";
import { registerChannelTools } from "./tools/channel.js";
import { registerSystemTools } from "./tools/system.js";

// Hooks disabled: OpenClaw plugin API does not support registerHook()
// import { registerHooks } from "./hooks/index.js";

export default definePluginEntry({
  id: "arc402",
  name: "ARC-402 Protocol",
  description: "Agent-to-agent commerce on Base — hire, deliver, compute, subscribe",

  register(api) {
    // Lazy config resolution — reads from openclaw.plugin.json configSchema at runtime
    const getConfig = () => resolveConfig((api.getConfig as <T>() => T)<PluginConfig>());

    // ── Agent Tools ────────────────────────────────────────────────────────────
    // arc402_hire, arc402_accept, arc402_deliver, arc402_verify, arc402_cancel
    registerHireTools(api, getConfig);

    // arc402_compute_hire, arc402_compute_end, arc402_compute_status,
    // arc402_compute_withdraw, arc402_compute_offer, arc402_compute_discover
    registerComputeTools(api, getConfig);

    // arc402_subscribe, arc402_subscription_cancel, arc402_top_up,
    // arc402_subscription_create, arc402_subscription_status, arc402_subscription_discover
    registerSubscribeTools(api, getConfig);

    // arc402_discover — queries ARC402RegistryV3 + AgentRegistry
    registerDiscoverTool(api, getConfig);

    // arc402_wallet_status, arc402_wallet_deploy
    registerWalletTools(api, getConfig);

    // arc402_negotiate, arc402_agreements
    registerNegotiateTools(api);

    // arc402_dispute, arc402_dispute_status, arc402_dispute_resolve
    registerDisputeTools(api);

    // arc402_agent_register, arc402_agent_update, arc402_agent_status
    registerAgentTools(api);

    // arc402_endpoint_setup, arc402_endpoint_status, arc402_endpoint_doctor
    registerEndpointTools(api);

    // arc402_trust, arc402_reputation
    registerTrustTools(api);

    // arc402_workroom_init, arc402_workroom_start, arc402_workroom_stop,
    // arc402_workroom_status, arc402_workroom_doctor, arc402_workroom_worker_init,
    // arc402_workroom_worker_status, arc402_workroom_earnings, arc402_workroom_receipts,
    // arc402_workroom_policy_reload
    registerWorkroomTools(api);

    // arc402_handshake, arc402_arena_status, arc402_feed
    registerArenaTools(api);

    // arc402_channel_open, arc402_channel_close, arc402_channel_status
    registerChannelTools(api);

    // arc402_config, arc402_setup, arc402_doctor, arc402_migrate
    registerSystemTools(api);

    // ── Event Hooks ────────────────────────────────────────────────────────────
    // arc402:hire_received, arc402:delivery_received, arc402:dispute_raised,
    // arc402:compute_event, arc402:hire_accepted, arc402:payment_released
    // registerHooks(api, getConfig); // Disabled: registerHook not in OpenClaw plugin API

    // ── SKILL.md is bundled in skill/ and auto-discovered by OpenClaw ──────────
  },
});
