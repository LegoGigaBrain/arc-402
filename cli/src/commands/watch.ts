import { Command } from "commander";
import { ethers } from "ethers";
import { loadConfig } from "../config";
import { getClient } from "../client";
import { c } from "../ui/colors";

// ─── Minimal ABIs for event watching ─────────────────────────────────────────

const AGENT_REGISTRY_WATCH_ABI = [
  "event AgentRegistered(address indexed wallet, string name, string serviceType, uint256 timestamp)",
  "event AgentUpdated(address indexed wallet, string name, string serviceType)",
  "event AgentDeactivated(address indexed wallet)",
];

const SERVICE_AGREEMENT_WATCH_ABI = [
  "event AgreementProposed(uint256 indexed id, address indexed client, address indexed provider, string serviceType, uint256 price, address token, uint256 deadline)",
  "event AgreementAccepted(uint256 indexed id, address indexed provider)",
  "event AgreementFulfilled(uint256 indexed id, address indexed provider, bytes32 deliverablesHash)",
  "event AgreementDisputed(uint256 indexed id, address indexed initiator, string reason)",
  "event AgreementCancelled(uint256 indexed id, address indexed client)",
];

const HANDSHAKE_WATCH_ABI = [
  "event HandshakeSent(uint256 indexed handshakeId, address indexed from, address indexed to, uint8 hsType, address token, uint256 amount, string note, uint256 timestamp)",
];

const DISPUTE_MODULE_WATCH_ABI = [
  "event DisputeRaised(uint256 indexed agreementId, address indexed initiator, string reason)",
  "event DisputeResolved(uint256 indexed agreementId, bool favorProvider, string resolution)",
];

const HS_TYPE_LABELS: Record<number, string> = {
  0: "Respected",
  1: "Curious",
  2: "Endorsed",
  3: "Thanked",
  4: "Collaborated",
  5: "Challenged",
  6: "Referred",
  7: "Hello",
};

function shortAddr(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
}

function nowHHMM(): string {
  const d = new Date();
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

function printEvent(label: string, detail: string, status?: "ok" | "warn" | "err"): void {
  const ts = c.dim(`[${nowHHMM()}]`);
  const col = status === "ok" ? c.green : status === "err" ? c.red : status === "warn" ? c.yellow : c.white;
  process.stdout.write(`  ${ts}  ${col(label)}  ${c.dim(detail)}\n`);
}

export function registerWatchCommand(program: Command): void {
  program
    .command("watch")
    .description("Watch wallet activity in real-time (live onchain event feed)")
    .action(async () => {
      const config = loadConfig();
      const { provider } = await getClient(config);
      const myWallet = (config.walletContractAddress ?? "").toLowerCase();
      const shortMe = myWallet ? shortAddr(config.walletContractAddress!) : "(no wallet)";

      const line = "─".repeat(22);
      console.log(`\n  ${c.mark} ${c.white("ARC-402  Live Feed")}  ${c.dim(line)}`);
      console.log(`  ${c.dim("Watching")} ${c.brightCyan(shortMe)} ${c.dim("on")} ${c.dim(config.network)}`);
      console.log(`  ${c.dim("Ctrl+C to exit")}\n`);

      // ── Build contract instances ───────────────────────────────────────────

      const contractLabels: string[] = [];

      if (config.agentRegistryAddress) contractLabels.push("AgentRegistry");
      if (config.serviceAgreementAddress) contractLabels.push("ServiceAgreement");
      if (config.handshakeAddress) contractLabels.push("Handshake");
      if (config.disputeModuleAddress) contractLabels.push("DisputeModule");

      if (contractLabels.length === 0) {
        console.log(`  ${c.warning} No contract addresses configured. Run arc402 config init.`);
        process.exit(1);
      }

      console.log(`  ${c.dim(`Monitoring ${contractLabels.length} contract${contractLabels.length !== 1 ? "s" : ""}: ${contractLabels.join(", ")}`)}\n`);

      // ── Helpers ────────────────────────────────────────────────────────────

      function isMe(addr: string): boolean {
        return myWallet !== "" && addr.toLowerCase() === myWallet;
      }

      function fmtAddr(addr: string): string {
        return isMe(addr) ? c.brightCyan("you") : c.dim(shortAddr(addr));
      }

      // ── AgentRegistry ──────────────────────────────────────────────────────

      if (config.agentRegistryAddress) {
        const reg = new ethers.Contract(config.agentRegistryAddress, AGENT_REGISTRY_WATCH_ABI, provider);

        reg.on("AgentRegistered", (wallet: string, name: string, serviceType: string) => {
          printEvent(`Agent registered: ${name}`, `${fmtAddr(wallet)}  ${c.dim(serviceType)}`, "ok");
        });

        reg.on("AgentUpdated", (wallet: string, name: string, serviceType: string) => {
          printEvent(`Agent updated: ${name}`, `${fmtAddr(wallet)}  ${c.dim(serviceType)}`);
        });

        reg.on("AgentDeactivated", (wallet: string) => {
          printEvent(`Agent deactivated`, fmtAddr(wallet), "warn");
        });
      }

      // ── ServiceAgreement ───────────────────────────────────────────────────

      if (config.serviceAgreementAddress) {
        const sa = new ethers.Contract(config.serviceAgreementAddress, SERVICE_AGREEMENT_WATCH_ABI, provider);

        sa.on("AgreementProposed", (id: bigint, client: string, agentProvider: string, serviceType: string) => {
          const involved = isMe(client) || isMe(agentProvider);
          printEvent(
            `Agreement #${id} proposed`,
            `${fmtAddr(client)} → ${fmtAddr(agentProvider)}  ${c.dim(serviceType)}`,
            involved ? "ok" : undefined
          );
        });

        sa.on("AgreementAccepted", (id: bigint, agentProvider: string) => {
          printEvent(`Agreement #${id} → ${c.green("ACCEPTED")}`, fmtAddr(agentProvider));
        });

        sa.on("AgreementFulfilled", (id: bigint, agentProvider: string, deliverablesHash: string) => {
          printEvent(
            `Agreement #${id} → ${c.green("DELIVERED")}`,
            `${fmtAddr(agentProvider)}  ${c.dim(deliverablesHash.slice(0, 10) + "...")}`,
            "ok"
          );
        });

        sa.on("AgreementDisputed", (id: bigint, initiator: string, reason: string) => {
          printEvent(
            `Agreement #${id} → ${c.red("DISPUTED")}`,
            `${fmtAddr(initiator)}  ${c.dim(reason.slice(0, 40))}`,
            "err"
          );
        });

        sa.on("AgreementCancelled", (id: bigint, client: string) => {
          printEvent(`Agreement #${id} → ${c.yellow("CANCELLED")}`, fmtAddr(client), "warn");
        });
      }

      // ── Handshake ──────────────────────────────────────────────────────────

      if (config.handshakeAddress) {
        const hs = new ethers.Contract(config.handshakeAddress, HANDSHAKE_WATCH_ABI, provider);

        hs.on("HandshakeSent", (_id: bigint, from: string, to: string, hsType: number, _token: string, _amount: bigint, note: string) => {
          const typeLabel = HS_TYPE_LABELS[hsType] ?? `type ${hsType}`;
          const toMe = isMe(to);
          const noteStr = note ? `  ${c.dim(`(${note.slice(0, 30)})`)}` : "";
          printEvent(
            `Handshake from ${fmtAddr(from)} → ${fmtAddr(to)}`,
            `${c.dim(typeLabel)}${noteStr}`,
            toMe ? "ok" : undefined
          );
        });
      }

      // ── DisputeModule ──────────────────────────────────────────────────────

      if (config.disputeModuleAddress) {
        const dm = new ethers.Contract(config.disputeModuleAddress, DISPUTE_MODULE_WATCH_ABI, provider);

        dm.on("DisputeRaised", (agreementId: bigint, initiator: string, reason: string) => {
          printEvent(
            `Dispute raised on #${agreementId}`,
            `${fmtAddr(initiator)}  ${c.dim(reason.slice(0, 40))}`,
            "err"
          );
        });

        dm.on("DisputeResolved", (agreementId: bigint, favorProvider: boolean, resolution: string) => {
          printEvent(
            `Dispute #${agreementId} → ${c.green("RESOLVED")}`,
            `${c.dim(favorProvider ? "provider wins" : "client wins")}  ${c.dim(resolution.slice(0, 30))}`,
            "ok"
          );
        });
      }

      // ── Block heartbeat (shows feed is alive) ──────────────────────────────

      let lastBlock = 0;
      provider.on("block", (blockNumber: number) => {
        if (blockNumber > lastBlock) {
          lastBlock = blockNumber;
          if (blockNumber % 10 === 0) {
            process.stdout.write(`  ${c.dim(`· block ${blockNumber}`)}\n`);
          }
        }
      });

      // ── Clean exit ─────────────────────────────────────────────────────────

      process.on("SIGINT", () => {
        console.log(`\n  ${c.dim("Feed stopped.")}`);
        provider.removeAllListeners();
        process.exit(0);
      });

      // Keep process alive
      process.stdin.resume();
    });
}
