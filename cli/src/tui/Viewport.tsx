import React from "react";
import { Box, Text, useStdout } from "ink";

interface ViewportProps {
  lines: string[];
  scrollOffset: number;
  isAutoScroll: boolean;
}

/**
 * Scrollable output area that fills remaining terminal space.
 * Renders a window slice of the buffer, not terminal scroll.
 * scrollOffset=0 means pinned to bottom (auto-scroll).
 * Positive scrollOffset means scrolled up by that many lines.
 */
export function Viewport({ lines, scrollOffset, isAutoScroll }: ViewportProps) {
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;

  // We'll compute the viewport height: total rows minus fixed areas
  // Header is approximately bannerLines + separator (~14-16 rows)
  // Footer is 1 row
  // We'll use a reasonable estimate here; the parent App can pass exact height
  const HEADER_ROWS = 15; // approximate
  const FOOTER_ROWS = 1;
  const viewportHeight = Math.max(1, termRows - HEADER_ROWS - FOOTER_ROWS);

  // Compute the window slice
  // scrollOffset=0 → show last viewportHeight lines
  // scrollOffset=N → show lines ending viewportHeight+N from end
  const totalLines = lines.length;
  let endIdx: number;
  let startIdx: number;

  if (scrollOffset === 0) {
    // Auto-scroll: pinned to bottom
    endIdx = totalLines;
    startIdx = Math.max(0, endIdx - viewportHeight);
  } else {
    // Scrolled up: scrollOffset lines from bottom
    endIdx = Math.max(0, totalLines - scrollOffset);
    startIdx = Math.max(0, endIdx - viewportHeight);
  }

  const visibleLines = lines.slice(startIdx, endIdx);

  // Pad with empty lines if fewer than viewportHeight
  const padCount = Math.max(0, viewportHeight - visibleLines.length);
  const paddedLines = [
    ...Array(padCount).fill(""),
    ...visibleLines,
  ];

  const canScrollDown = scrollOffset > 0;

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexDirection="column" flexGrow={1}>
        {paddedLines.map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
      </Box>
      {canScrollDown && !isAutoScroll && (
        <Box justifyContent="flex-end">
          <Text dimColor>↓ more</Text>
        </Box>
      )}
    </Box>
  );
}
