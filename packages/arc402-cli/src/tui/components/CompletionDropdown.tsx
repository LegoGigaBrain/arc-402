import React from "react";
import { Box, Text } from "../../renderer/index.js";

export interface CompletionDropdownProps {
  candidates: string[];
  selectedIndex: number;
  visible: boolean;
}

const MAX_VISIBLE = 8;

export function CompletionDropdown({
  candidates,
  selectedIndex,
  visible,
}: CompletionDropdownProps) {
  if (!visible || candidates.length === 0) return null;

  // Window the list if there are too many candidates
  let startIdx = 0;
  if (candidates.length > MAX_VISIBLE) {
    startIdx = Math.max(0, selectedIndex - Math.floor(MAX_VISIBLE / 2));
    startIdx = Math.min(startIdx, candidates.length - MAX_VISIBLE);
  }
  const visibleCandidates = candidates.slice(
    startIdx,
    startIdx + MAX_VISIBLE
  );

  return (
    <Box flexDirection="column" marginLeft={4}>
      <Box>
        <Text dimColor>{"┌─ completions ─"}</Text>
      </Box>
      {visibleCandidates.map((candidate, i) => {
        const actualIdx = startIdx + i;
        const isSelected = actualIdx === selectedIndex;
        return (
          <Box key={candidate}>
            <Text dimColor>{"│"}</Text>
            <Text color={isSelected ? "cyan" : "white"} bold={isSelected}>
              {isSelected ? " ▸ " : "   "}
              {candidate}
            </Text>
          </Box>
        );
      })}
      <Box>
        <Text dimColor>{"└─"}</Text>
        {candidates.length > MAX_VISIBLE && (
          <Text dimColor>{" "}({candidates.length} total)</Text>
        )}
      </Box>
    </Box>
  );
}
