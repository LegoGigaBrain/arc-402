export const BUILTIN_CMDS = ["help", "exit", "quit", "clear", "status"] as const;

export const TUI_TOP_LEVEL_COMMANDS = [
  "status",
  "discover",
  "agreements",
  "workroom",
  "subscription",
  "subscribe",
  "arena",
] as const;

export const TUI_SUBCOMMANDS: Record<string, string[]> = {
  workroom: ["status", "worker"],
  subscription: ["status", "list", "cancel", "topup"],
  arena: ["rounds", "squad"],
  squad: ["list", "info"],
};
