import React from "react";
import { Text } from "../../../renderer/index.js";
import { CommerceCard, DetailRow, Section, type StatusPillProps } from "./common";

export interface SubscribeCardProps {
  provider: string;
  planId: string;
  rateLabel: string;
  months?: number;
  accessSummary?: string[];
  nextRenewalLabel?: string;
  paymentOptions?: string[];
  status?: StatusPillProps;
}

export function SubscribeCard({ provider, planId, rateLabel, months, accessSummary = [], nextRenewalLabel, paymentOptions = [], status }: SubscribeCardProps) {
  return (
    <CommerceCard eyebrow="Subscription" title={provider} subtitle={planId} status={status}>
      <DetailRow label="rate" value={rateLabel} tone="success" />
      <DetailRow label="months" value={String(months ?? 1)} />
      <DetailRow label="renewal" value={nextRenewalLabel ?? "immediate access"} tone="info" />
      <DetailRow label="payments" value={paymentOptions.length ? paymentOptions.join(", ") : "subscription"} />
      {accessSummary.length > 0 ? (
        <Section title="access">
          {accessSummary.map((item, index) => (
            <Text key={`${item}-${index}`}>• {item}</Text>
          ))}
        </Section>
      ) : null}
    </CommerceCard>
  );
}
