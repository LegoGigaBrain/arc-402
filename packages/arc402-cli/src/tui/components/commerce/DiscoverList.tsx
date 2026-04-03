import React from "react";
import { Text } from "../../../renderer/index.js";
import { CommerceCard, type StatusPillProps } from "./common";

export interface DiscoverAgent {
  rank: number;
  name: string;
  wallet: string;
  serviceType: string;
  trustScore: number;
  compositeScore?: number;
  endpointStatus?: "online" | "offline" | "unknown";
  capabilitySummary?: string;
  priceLabel?: string;
}

export interface DiscoverListProps {
  title?: string;
  agents: DiscoverAgent[];
  summary?: string;
  status?: StatusPillProps;
}

export function DiscoverList({ title = "Discover Results", agents, summary, status }: DiscoverListProps) {
  return (
    <CommerceCard eyebrow="Discover" title={title} subtitle={summary} status={status} footer={`${agents.length} agent${agents.length === 1 ? "" : "s"}`}>
      {agents.map((agent, i) => {
        const isLast = i === agents.length - 1;
        const border = isLast ? "└─" : "├─";
        const statusBadge = agent.endpointStatus === "online"
          ? <Text color="green">◉ online</Text>
          : agent.endpointStatus === "offline"
          ? <Text color="red">⊘ offline</Text>
          : <Text dimColor>○ unknown</Text>;
        const price = agent.priceLabel ?? "";
        const trustStr = `trust ${agent.trustScore}`;
        const priceStr = price ? `  $${price}` : "";

        return (
          <Text key={`${agent.wallet}-${agent.rank}`}>
            <Text dimColor>{`  #${agent.rank}  `}</Text>
            <Text color="yellow">{border} </Text>
            <Text color="cyan">{agent.name.padEnd(20)}</Text>
            <Text dimColor>{`${trustStr}${priceStr}   `}</Text>
            {statusBadge}
            {"\n"}
          </Text>
        );
      })}
    </CommerceCard>
  );
}
