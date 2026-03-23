/**
 * Event hooks — on-hire, on-deliver, on-dispute, on-compute
 * Registered via api.registerHook() to react to OpenClaw gateway events.
 */
import type { PluginApi } from "../tools/hire.js";
import type { ResolvedConfig } from "../config.js";

export function registerHooks(api: PluginApi, getConfig: () => ResolvedConfig) {
  // Fired when this agent receives a new hire proposal
  api.registerHook({
    event: "arc402:hire_received",
    handler: async (payload) => {
      const cfg = getConfig();
      const p = payload as { agreementId: string; client: string; price: string };

      if (cfg.daemon?.autoAcceptHire) {
        // Log auto-accept intent; actual on-chain accept requires the arc402_accept tool
        console.log(`[arc402] Auto-accept queued for agreement ${p.agreementId} from ${p.client} at ${p.price}`);
      } else {
        console.log(`[arc402] Hire proposal received: ${p.agreementId} — awaiting operator decision`);
      }
    },
  });

  // Fired when a delivery notification arrives
  api.registerHook({
    event: "arc402:delivery_received",
    handler: async (payload) => {
      const p = payload as { agreementId: string; deliverableHash: string; manifestUrl?: string };
      console.log(
        `[arc402] Delivery received for agreement ${p.agreementId} — hash: ${p.deliverableHash}`,
      );
    },
  });

  // Fired when a dispute is raised on an agreement
  api.registerHook({
    event: "arc402:dispute_raised",
    handler: async (payload) => {
      const p = payload as { agreementId: string; raisedBy: string; reason: string };
      console.error(
        `[arc402] DISPUTE raised on ${p.agreementId} by ${p.raisedBy}: ${p.reason}`,
      );
    },
  });

  // Fired when a compute session event occurs
  api.registerHook({
    event: "arc402:compute_event",
    handler: async (payload) => {
      const p = payload as { sessionId: string; event: string; data?: unknown };
      console.log(`[arc402] Compute session ${p.sessionId}: ${p.event}`);
    },
  });

  // Fired when a hire is accepted by provider
  api.registerHook({
    event: "arc402:hire_accepted",
    handler: async (payload) => {
      const p = payload as { agreementId: string; provider: string };
      console.log(`[arc402] Hire accepted: ${p.agreementId} by provider ${p.provider}`);
    },
  });

  // Fired when payment is released after delivery accepted
  api.registerHook({
    event: "arc402:payment_released",
    handler: async (payload) => {
      const p = payload as { agreementId: string; amount: string; recipient: string };
      console.log(`[arc402] Payment released: ${p.amount} for agreement ${p.agreementId} to ${p.recipient}`);
    },
  });
}
