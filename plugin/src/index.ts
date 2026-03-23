/**
 * ARC-402 OpenClaw Plugin — entry point
 *
 * One install gives every agent the full ARC-402 protocol stack:
 *   - Native agent tools (hire, compute, subscribe, discover, wallet)
 *   - HTTP routes that replace the standalone daemon
 *   - Event hooks for protocol lifecycle events
 *   - Bundled SKILL.md for agent training
 *
 * Install: openclaw plugins install @arc402/openclaw-plugin
 */
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { resolveConfig } from "./config.js";
import type { PluginConfig } from "./config.js";

import { registerHireTools } from "./tools/hire.js";
import { registerComputeTools } from "./tools/compute.js";
import { registerSubscribeTools } from "./tools/subscribe.js";
import { registerDiscoverTool } from "./tools/discover.js";
import { registerWalletTools } from "./tools/wallet.js";

import { registerHealthRoutes } from "./routes/health.js";
import { registerHireRoutes } from "./routes/hire.js";
import { registerDeliveryRoutes } from "./routes/delivery.js";
import { registerComputeRoutes } from "./routes/compute.js";
import { registerDisputeRoutes } from "./routes/dispute.js";

import { registerHooks } from "./hooks/index.js";

export default definePluginEntry({
  id: "arc402",
  name: "ARC-402 Protocol",
  description: "Agent-to-agent commerce on Base — hire, deliver, compute, subscribe",

  register(api) {
    // Lazy config resolution — reads from openclaw.plugin.json configSchema at runtime
    const getConfig = () => resolveConfig(api.getConfig<PluginConfig>());

    // ── Agent Tools ────────────────────────────────────────────────────────────
    // arc402_hire, arc402_accept, arc402_deliver, arc402_verify
    registerHireTools(api, getConfig);

    // arc402_compute_hire, arc402_compute_end, arc402_compute_status
    registerComputeTools(api, getConfig);

    // arc402_subscribe, arc402_cancel, arc402_top_up
    registerSubscribeTools(api, getConfig);

    // arc402_discover — queries ARC402RegistryV3 + AgentRegistry
    registerDiscoverTool(api, getConfig);

    // arc402_wallet_status, arc402_wallet_deploy
    registerWalletTools(api, getConfig);

    // ── HTTP Routes (daemon surface — runs inside OpenClaw gateway) ────────────
    // GET /health, /agent, /status, /capabilities
    registerHealthRoutes(api, getConfig);

    // POST /hire, /hire/accepted, /delivery, /delivery/accepted
    registerHireRoutes(api, getConfig);

    // GET /job/:id/files, /job/:id/files/:name, /job/:id/manifest
    // POST /job/:id/upload
    registerDeliveryRoutes(api, getConfig);

    // POST /compute/propose, /compute/accept, /compute/start, /compute/end
    // GET /compute/status/:sessionId, /compute/sessions
    registerComputeRoutes(api, getConfig);

    // POST /dispute, /dispute/resolved
    // GET /disputes
    registerDisputeRoutes(api);

    // ── Event Hooks ────────────────────────────────────────────────────────────
    // arc402:hire_received, arc402:delivery_received, arc402:dispute_raised,
    // arc402:compute_event, arc402:hire_accepted, arc402:payment_released
    registerHooks(api, getConfig);

    // ── SKILL.md is bundled in skill/ and auto-discovered by OpenClaw ──────────
  },
});
