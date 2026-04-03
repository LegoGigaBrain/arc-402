import React from "react";
import { Text } from "../../../renderer/index.js";
import { CommerceCard, DetailRow, Section, type StatusPillProps } from "./common";

export interface SquadMember {
  agent: string;
  role?: string;
  trustScore?: number;
}

export interface SquadBriefingSummary {
  preview: string;
  publishedLabel?: string;
  tags?: string[];
}

export interface SquadCardProps {
  id: string;
  name: string;
  domainTag: string;
  statusLabel: string;
  creator?: string;
  memberCount: number;
  inviteOnly?: boolean;
  members?: SquadMember[];
  briefings?: SquadBriefingSummary[];
  status?: StatusPillProps;
}

export function SquadCard({ id, name, domainTag, statusLabel, creator, memberCount, inviteOnly, members = [], briefings = [], status }: SquadCardProps) {
  return (
    <CommerceCard eyebrow="Squad" title={name} subtitle={id} status={status ?? { label: statusLabel, tone: "info" }}>
      <DetailRow label="domain" value={domainTag} />
      <DetailRow label="members" value={String(memberCount)} />
      <DetailRow label="invite" value={inviteOnly ? "yes" : "no"} />
      <DetailRow label="creator" value={creator ?? "n/a"} tone="muted" />
      {members.length > 0 ? (
        <Section title="members">
          {members.map((member, index) => (
            <Text key={`${member.agent}-${index}`}>• {member.agent}{member.role ? ` · ${member.role}` : ""}{member.trustScore !== undefined ? ` · trust ${member.trustScore}` : ""}</Text>
          ))}
        </Section>
      ) : null}
      {briefings.length > 0 ? (
        <Section title="briefings">
          {briefings.map((briefing, index) => (
            <Text key={`${briefing.preview}-${index}`}>• {briefing.preview}{briefing.publishedLabel ? ` · ${briefing.publishedLabel}` : ""}{briefing.tags?.length ? ` · ${briefing.tags.join(", ")}` : ""}</Text>
          ))}
        </Section>
      ) : null}
    </CommerceCard>
  );
}
