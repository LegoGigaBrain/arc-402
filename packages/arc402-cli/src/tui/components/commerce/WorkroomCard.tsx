import React from "react";
import { Text } from "../../../renderer/index.js";
import { CommerceCard, DetailRow, Section, type StatusPillProps } from "./common";

export interface WorkroomJobSummary {
  id: string;
  status: string;
  task?: string;
  harness?: string;
}

export interface WorkroomCardProps {
  statusLabel: string;
  harness?: string;
  policyHash?: string;
  queueDepth?: number;
  activeJobs?: WorkroomJobSummary[];
  runtime?: string;
  status?: StatusPillProps;
}

export function WorkroomCard({ statusLabel, harness, policyHash, queueDepth, activeJobs = [], runtime, status }: WorkroomCardProps) {
  return (
    <CommerceCard eyebrow="Workroom" title={runtime ?? "Governed execution environment"} status={status ?? { label: statusLabel, tone: "info" }}>
      <DetailRow label="harness" value={harness ?? "n/a"} />
      <DetailRow label="queue" value={String(queueDepth ?? activeJobs.length)} />
      <DetailRow label="policy" value={policyHash ?? "n/a"} tone="muted" />
      {activeJobs.length > 0 ? (
        <Section title="jobs">
          {activeJobs.map((job) => (
            <Text key={job.id}>• {job.id} · {job.status}{job.harness ? ` · ${job.harness}` : ""}{job.task ? ` · ${job.task}` : ""}</Text>
          ))}
        </Section>
      ) : null}
    </CommerceCard>
  );
}
