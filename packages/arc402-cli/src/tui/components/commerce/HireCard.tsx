import React from "react";
import { Text } from "../../../renderer/index.js";
import { CommerceCard, DetailRow, Section, type StatusPillProps } from "./common";

export interface HireCardProps {
  providerName?: string;
  providerAddress: string;
  capability: string;
  price: string;
  deadline?: string;
  agreementId?: string;
  txHash?: string;
  notes?: string[];
  status?: StatusPillProps;
}

export function HireCard({ providerName, providerAddress, capability, price, deadline, agreementId, txHash, notes = [], status }: HireCardProps) {
  const title = providerName ? `${providerName} · ${providerAddress}` : providerAddress;
  return (
    <CommerceCard eyebrow="Hire" title={title} subtitle={capability} status={status}>
      <DetailRow label="price" value={price} tone="success" />
      <DetailRow label="deadline" value={deadline ?? "open"} />
      <DetailRow label="agreement" value={agreementId ?? "pending"} tone={agreementId ? "info" : "muted"} />
      <DetailRow label="tx" value={txHash ?? "not submitted"} tone={txHash ? "muted" : "warning"} />
      {notes.length > 0 ? (
        <Section title="operator notes">
          {notes.map((note, index) => (
            <Text key={`${note}-${index}`}>• {note}</Text>
          ))}
        </Section>
      ) : null}
    </CommerceCard>
  );
}
