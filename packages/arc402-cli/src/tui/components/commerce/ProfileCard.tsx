import React from "react";
import { Box, Text } from "../../../renderer/index.js";
import { CommerceCard, DetailRow, Meter, Section, type StatusPillProps } from "./common";

export interface ProfileCardProps {
  address: string;
  name?: string;
  serviceType?: string;
  endpoint?: string;
  isActive?: boolean;
  trustScore?: number;
  totalAgreements?: number;
  disputes?: number;
  wins?: number;
  losses?: number;
  netUsdc?: string;
  latestStatus?: string;
  capabilities?: string[];
  status?: StatusPillProps;
}

export function ProfileCard({
  address,
  name,
  serviceType,
  endpoint,
  isActive,
  trustScore,
  totalAgreements,
  disputes,
  wins,
  losses,
  netUsdc,
  latestStatus,
  capabilities = [],
  status,
}: ProfileCardProps) {
  return (
    <CommerceCard
      eyebrow="Agent Profile"
      title={name ?? address}
      subtitle={endpoint}
      status={status ?? { label: isActive ? "active" : "inactive", tone: isActive ? "success" : "muted" }}
    >
      <DetailRow label="address" value={`${address.slice(0, 6)}…${address.slice(-4)}`} tone="muted" />
      {serviceType ? <DetailRow label="service" value={serviceType} /> : null}
      {typeof trustScore === "number" ? (
        <Meter label="trust score" value={Math.min(100, trustScore / 5)} tone="info" />
      ) : null}
      {typeof totalAgreements === "number" ? (
        <DetailRow label="agreements" value={`${totalAgreements} completed · ${disputes ?? 0} disputes`} />
      ) : null}
      {wins !== undefined || losses !== undefined ? (
        <Section title="arena record">
          <DetailRow label="wins" value={String(wins ?? 0)} tone="success" />
          <DetailRow label="losses" value={String(losses ?? 0)} tone="danger" />
          {netUsdc ? (
            <DetailRow
              label="net USDC"
              value={netUsdc}
              tone={netUsdc.startsWith("-") ? "danger" : "success"}
            />
          ) : null}
        </Section>
      ) : null}
      {capabilities.length > 0 ? (
        <Section title="capabilities">
          {capabilities.map((cap, i) => (
            <Text key={i} dimColor>
              {i === capabilities.length - 1 ? "└─" : "├─"} {cap}
            </Text>
          ))}
        </Section>
      ) : null}
      {latestStatus ? <DetailRow label="latest status" value={latestStatus} tone="muted" /> : null}
    </CommerceCard>
  );
}
