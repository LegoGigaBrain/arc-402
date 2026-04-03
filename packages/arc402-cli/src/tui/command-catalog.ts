export const BUILTIN_CMDS = ["help", "exit", "quit", "clear"] as const;

// Full TUI command surface — kernel-handled routes + legacy CLI adapter routes
export const TUI_TOP_LEVEL_COMMANDS = [
  // Kernel-extracted (Phase 2 Ink components)
  "status",
  "discover",
  "agreements",
  "workroom",
  "subscription",
  "subscribe",
  "arena",
  // Commerce write paths (legacy CLI adapter)
  "hire",
  "accept",
  "deliver",
  "verify",
  "cancel",
  "dispute",
  "negotiate",
  "trust",
  // Compute
  "compute",
  // Wallet + identity
  "wallet",
  "agent",
  "endpoint",
  // Operator
  "daemon",
  "setup",
  "doctor",
  "migrate",
  "chat",
  "feed",
  "watch",
  "job",
  "plan",
  "x402",
] as const;

// Subcommands for Tab completion
export const TUI_SUBCOMMANDS: Record<string, string[]> = {
  // Kernel routes
  workroom: ["status", "start", "stop", "init", "logs", "worker", "policy-hash", "install-service"],
  subscription: ["status", "list", "cancel", "topup"],
  arena: ["rounds", "squad", "profile", "standings", "stats", "status", "inbox", "discover", "trending", "briefing", "newsletter"],
  squad: ["list", "create", "join", "info", "contribute"],
  // Legacy routes
  compute: ["offer", "discover", "hire", "status", "end", "sessions"],
  wallet: ["deploy", "status", "authorize-machine-key", "set-guardian", "freeze", "unfreeze", "set-spend-limits"],
  agent: ["register", "update", "status", "info"],
  endpoint: ["setup", "status", "doctor", "claim", "update"],
  daemon: ["init", "start", "stop", "restart", "logs", "status", "config"],
  negotiate: ["start", "status", "accept", "reject"],
  job: ["files", "fetch", "manifest"],
  plan: ["create", "list"],
};

export const TUI_HELP_SECTIONS = [
  {
    label: "Status + Discovery",
    commands: [
      { cmd: "status", desc: "Wallet · daemon · workroom overview" },
      { cmd: "discover", desc: "Find agents by capability, trust, price" },
      { cmd: "agreements", desc: "List active/past agreements" },
      { cmd: "workroom status", desc: "Workroom container + job queue" },
    ],
  },
  {
    label: "Commerce",
    commands: [
      { cmd: "hire <endpoint>", desc: "Propose a ServiceAgreement" },
      { cmd: "accept <id>", desc: "Accept an agreement as provider" },
      { cmd: "deliver <id>", desc: "Commit deliverable on-chain" },
      { cmd: "verify <id>", desc: "Release escrow after delivery" },
      { cmd: "cancel <id>", desc: "Cancel and refund escrow" },
      { cmd: "negotiate <endpoint>", desc: "Pre-hire negotiation session" },
    ],
  },
  {
    label: "Subscriptions",
    commands: [
      { cmd: "subscribe <endpoint>", desc: "Inspect + stage subscription" },
      { cmd: "subscription status <id>", desc: "Check subscription state" },
      { cmd: "subscription list", desc: "List active subscriptions" },
      { cmd: "plan create", desc: "Publish a subscription plan" },
    ],
  },
  {
    label: "Compute",
    commands: [
      { cmd: "compute hire <provider>", desc: "Rent GPU session" },
      { cmd: "compute status <id>", desc: "Session metrics + cost" },
      { cmd: "compute end <id>", desc: "End session + settle" },
      { cmd: "compute discover", desc: "Find GPU providers" },
    ],
  },
  {
    label: "Arena",
    commands: [
      { cmd: "arena rounds", desc: "Active prediction rounds" },
      { cmd: "arena squad list", desc: "Research squads" },
      { cmd: "arena standings", desc: "Leaderboard" },
      { cmd: "arena stats", desc: "Protocol stats" },
    ],
  },
  {
    label: "Operator",
    commands: [
      { cmd: "daemon start", desc: "Start local node" },
      { cmd: "chat", desc: "Commerce REPL (harness-agnostic)" },
      { cmd: "workroom start", desc: "Start workroom container" },
      { cmd: "watch", desc: "Live event stream from daemon" },
      { cmd: "doctor", desc: "System health check" },
      { cmd: "setup", desc: "Guided first-run setup" },
    ],
  },
];
