import chalk from "chalk";
import Table from "cli-table3";

// ─── Address Truncation ───────────────────────────────────────────────────────

export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// ─── Status Colours ───────────────────────────────────────────────────────────

export type AgreementStatus =
  | "PROPOSED"
  | "ACCEPTED"
  | "FULFILLED"
  | "DISPUTED"
  | "CANCELLED";

export function colourStatus(status: string): string {
  switch (status.toUpperCase()) {
    case "PROPOSED":
      return chalk.yellow(status);
    case "ACCEPTED":
      return chalk.blue(status);
    case "FULFILLED":
      return chalk.green(status);
    case "DISPUTED":
      return chalk.red(status);
    case "CANCELLED":
      return chalk.gray(status);
    default:
      return status;
  }
}

export function statusFromNumber(n: number): string {
  const map = ["PROPOSED", "ACCEPTED", "FULFILLED", "DISPUTED", "CANCELLED"];
  return map[n] ?? "UNKNOWN";
}

// ─── Trust Tiers ─────────────────────────────────────────────────────────────

export interface TrustTier {
  label: string;
  threshold: number;
}

export function getTrustTier(score: number): string {
  if (score >= 800) return "Autonomous (800+)";
  if (score >= 600) return "Elevated (600+)";
  if (score >= 300) return "Standard (300+)";
  if (score >= 100) return "Restricted (100+)";
  return "Probationary (0-99)";
}

// ─── Table Builders ───────────────────────────────────────────────────────────

export interface AgentRow {
  address: string;
  name: string;
  capabilities: string[];
  trust: number;
  serviceType: string;
  active: boolean;
}

export function printAgentTable(agents: AgentRow[]): void {
  const table = new Table({
    head: [
      chalk.cyan("ADDRESS"),
      chalk.cyan("NAME"),
      chalk.cyan("CAPABILITIES"),
      chalk.cyan("TRUST"),
      chalk.cyan("TYPE"),
      chalk.cyan("STATUS"),
    ],
    style: { head: [], border: [] },
  });

  for (const a of agents) {
    table.push([
      truncateAddress(a.address),
      a.name,
      a.capabilities.slice(0, 3).join(", ") +
        (a.capabilities.length > 3 ? ", ..." : ""),
      String(a.trust),
      a.serviceType,
      a.active
        ? chalk.green("✓ Active")
        : chalk.gray("✗ Inactive"),
    ]);
  }

  console.log(table.toString());
}

export interface AgreementRow {
  id: number;
  counterparty: string;
  serviceType: string;
  price: bigint;
  token: string;
  deadline: number;
  status: number;
}

export function printAgreementTable(rows: AgreementRow[]): void {
  const table = new Table({
    head: [
      chalk.cyan("ID"),
      chalk.cyan("COUNTERPARTY"),
      chalk.cyan("SERVICE TYPE"),
      chalk.cyan("PRICE"),
      chalk.cyan("DEADLINE"),
      chalk.cyan("STATUS"),
    ],
    style: { head: [], border: [] },
  });

  for (const r of rows) {
    const deadline = new Date(r.deadline * 1000).toISOString().split("T")[0];
    const price =
      r.token === "0x0000000000000000000000000000000000000000"
        ? `${Number(r.price) / 1e18} ETH`
        : `${Number(r.price) / 1e6} USDC`;

    table.push([
      String(r.id),
      truncateAddress(r.counterparty),
      r.serviceType,
      price,
      deadline,
      colourStatus(statusFromNumber(r.status)),
    ]);
  }

  console.log(table.toString());
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function printSuccess(msg: string): void {
  console.log(chalk.green("✓ " + msg));
}

export function printError(msg: string): void {
  console.error(chalk.red("✗ " + msg));
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}
