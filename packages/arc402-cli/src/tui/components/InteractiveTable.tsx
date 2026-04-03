import React, { useState } from "react";
import { Box, Text } from "../../renderer/index.js";
import { useInput } from "ink";

export interface Column {
  header: string;
  key: string;
  width?: number;
  align?: "left" | "right";
}

export interface InteractiveTableProps {
  columns: Column[];
  rows: Record<string, string>[];
  onSelect?: (row: Record<string, string>, index: number) => void;
  selectedIndex?: number;
}

const MAX_VISIBLE_ROWS = 15;

export function InteractiveTable({
  columns,
  rows,
  onSelect,
  selectedIndex: controlledIdx,
}: InteractiveTableProps) {
  const [internalIdx, setInternalIdx] = useState(0);
  const selectedIndex = controlledIdx ?? internalIdx;

  useInput((_input, key) => {
    if (key.upArrow) {
      setInternalIdx((i) => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setInternalIdx((i) => Math.min(rows.length - 1, i + 1));
    }
    if (key.return && onSelect && rows[selectedIndex]) {
      onSelect(rows[selectedIndex], selectedIndex);
    }
  });

  // Compute column widths
  const colWidths = columns.map((col) => {
    if (col.width) return col.width;
    let max = col.header.length;
    for (const row of rows) {
      const val = row[col.key] ?? "";
      if (val.length > max) max = val.length;
    }
    return Math.min(max + 2, 30);
  });

  const pad = (text: string, width: number, align: "left" | "right" = "left"): string => {
    const truncated = text.length > width ? text.slice(0, width - 1) + "…" : text;
    if (align === "right") return truncated.padStart(width);
    return truncated.padEnd(width);
  };

  // Window visible rows
  let startRow = 0;
  if (rows.length > MAX_VISIBLE_ROWS) {
    startRow = Math.max(0, selectedIndex - Math.floor(MAX_VISIBLE_ROWS / 2));
    startRow = Math.min(startRow, rows.length - MAX_VISIBLE_ROWS);
  }
  const visibleRows = rows.slice(startRow, startRow + MAX_VISIBLE_ROWS);

  // Header
  const headerLine = columns
    .map((col, i) => pad(col.header, colWidths[i], col.align))
    .join("  ");
  const separatorLine = "─".repeat(headerLine.length);

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="white">{" "}{headerLine}</Text>
      </Box>
      <Box>
        <Text dimColor> {separatorLine}</Text>
      </Box>
      {visibleRows.map((row, vi) => {
        const actualIdx = startRow + vi;
        const isSelected = actualIdx === selectedIndex;
        const line = columns
          .map((col, i) => pad(row[col.key] ?? "", colWidths[i], col.align))
          .join("  ");
        return (
          <Box key={actualIdx}>
            <Text color={isSelected ? "cyan" : "white"} bold={isSelected}>
              {isSelected ? "▸" : " "} {line}
            </Text>
          </Box>
        );
      })}
      {rows.length > MAX_VISIBLE_ROWS && (
        <Box>
          <Text dimColor>{" "}({rows.length} rows · ↑↓ navigate · Enter select)</Text>
        </Box>
      )}
      {rows.length <= MAX_VISIBLE_ROWS && rows.length > 0 && (
        <Box>
          <Text dimColor> (↑↓ navigate · Enter select)</Text>
        </Box>
      )}
    </Box>
  );
}
