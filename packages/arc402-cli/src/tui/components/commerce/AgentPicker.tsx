import React, { useState, useEffect } from "react";
import { Text } from "../../../renderer/index.js";
import { useInput } from "ink";
import type { DiscoverAgent } from "./DiscoverList";

export interface AgentPickerProps {
  agents: DiscoverAgent[];
  onSelect: (agent: DiscoverAgent | null) => void;
}

export function AgentPicker({ agents, onSelect }: AgentPickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(agents.length - 1, i + 1));
    } else if (key.return) {
      onSelect(agents[selectedIndex] ?? null);
    } else if (key.escape || input === "q") {
      onSelect(null);
    }
  });

  return (
    <Text>
      {agents.map((agent, i) => {
        const isLast = i === agents.length - 1;
        const border = isLast ? "└─" : "├─";
        const isSelected = i === selectedIndex;
        const statusBadge = agent.endpointStatus === "online" ? "◉" : agent.endpointStatus === "offline" ? "⊘" : "○";
        const price = agent.priceLabel ?? "?";
        const line = `  #${agent.rank}  ${border} ${agent.name.padEnd(20)} trust ${String(agent.trustScore).padStart(4)}   ${price.padEnd(12)} ${statusBadge}`;
        return (
          <Text key={agent.wallet} color={isSelected ? "cyan" : undefined} bold={isSelected}>
            {isSelected ? "▶ " : "  "}{line.trimStart()}{"\n"}
          </Text>
        );
      })}
      {"\n"}
      <Text dimColor>↑↓ select · Enter pick · Esc cancel</Text>
    </Text>
  );
}
