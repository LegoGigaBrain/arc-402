import React from "react";
import { Text } from "../../../renderer/index.js";
import { CommerceCard, DetailRow, Meter, Section, type StatusPillProps } from "./common";

export interface StatusCardProps {
  wallet: string;
  network: string;
  balance?: string;
  trustScore?: number;
  endpoint?: string;
  agreements?: {
    active: number;
    pendingVerification: number;
    disputed: number;
  };
  workroom?: {
    status: string;
    activeJobs?: number;
    harness?: string;
  };
  status?: StatusPillProps;
}

export function StatusCard({ wallet, network, balance, trustScore, endpoint, agreements, workroom, status }: StatusCardProps) {
  return (
    <CommerceCard eyebrow="Wallet Status" title={wallet} subtitle={network} status={status}>
      <DetailRow label="balance" value={balance ?? "n/a"} tone="success" />
      <DetailRow label="endpoint" value={endpoint ?? "n/a"} tone="muted" />
      {typeof trustScore === "number" ? <Meter label="trust" value={Math.min(100, Math.max(0, trustScore / 5))} tone="info" /> : null}
      {agreements ? (
        <Section title="agreements">
          <DetailRow label="active" value={String(agreements.active)} />
          <DetailRow label="verify" value={String(agreements.pendingVerification)} tone="warning" />
          <DetailRow label="disputed" value={String(agreements.disputed)} tone="danger" />
        </Section>
      ) : null}
      {workroom ? (
        <Section title="workroom">
          <DetailRow label="status" value={workroom.status} />
          <DetailRow label="jobs" value={String(workroom.activeJobs ?? 0)} />
          <DetailRow label="harness" value={workroom.harness ?? "n/a"} />
        </Section>
      ) : null}
      <Text dimColor>Structured for inline TUI status rendering in Phase 3.</Text>
    </CommerceCard>
  );
}
