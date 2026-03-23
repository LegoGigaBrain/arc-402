/**
 * Type declarations for the OpenClaw plugin SDK.
 * The actual module is provided by the OpenClaw runtime at install time.
 */
declare module "openclaw/plugin-sdk/plugin-entry" {
  import type { PluginApi } from "./tools/hire.js";

  export interface PluginDefinition {
    id: string;
    name: string;
    description: string;
    register(api: PluginApi): void;
  }

  export function definePluginEntry(definition: PluginDefinition): PluginDefinition;
}
