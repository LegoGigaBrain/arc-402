import chalk from "chalk";
import Table from "cli-table3";
import { AgreementStatus, IdentityTier, ReputationSignalType } from "@arc402/sdk";

export const truncateAddress = (address: string) => address.length <= 12 ? address : `${address.slice(0, 6)}...${address.slice(-4)}`;
export const formatDate = (timestamp: number) => new Date(timestamp * 1000).toLocaleString();

export function getTrustTier(score: number): string {
  if (score >= 800) return "Autonomous";
  if (score >= 600) return "Elevated";
  if (score >= 300) return "Standard";
  if (score >= 100) return "Restricted";
  return "Probationary";
}

export function agreementStatusLabel(status: AgreementStatus): string {
  return AgreementStatus[status] ?? "UNKNOWN";
}

export function colourStatus(status: AgreementStatus): string {
  const label = agreementStatusLabel(status);
  switch (status) {
    case AgreementStatus.PROPOSED:
    case AgreementStatus.REVISION_REQUESTED:
      return chalk.yellow(label);
    case AgreementStatus.ACCEPTED:
    case AgreementStatus.REVISED:
    case AgreementStatus.PENDING_VERIFICATION:
      return chalk.blue(label);
    case AgreementStatus.FULFILLED:
      return chalk.green(label);
    case AgreementStatus.DISPUTED:
    case AgreementStatus.ESCALATED_TO_HUMAN:
    case AgreementStatus.ESCALATED_TO_ARBITRATION:
      return chalk.red(label);
    default:
      return chalk.gray(label);
  }
}

export const identityTierLabel = (tier: IdentityTier) => IdentityTier[tier] ?? "NONE";
export const reputationSignalLabel = (signal: ReputationSignalType) => ReputationSignalType[signal] ?? "UNKNOWN";

export function printTable(head: string[], rows: (string | number)[][]) {
  const table = new Table({ head: head.map((value) => chalk.cyan(value)), style: { head: [], border: [] } });
  rows.forEach((row) => table.push(row));
  console.log(table.toString());
}
