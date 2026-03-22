import React from "react";
import { Box } from "ink";

interface FooterProps {
  children: React.ReactNode;
}

/**
 * Fixed footer containing the input line.
 * Pinned at the bottom of the screen.
 */
export function Footer({ children }: FooterProps) {
  return (
    <Box flexShrink={0}>
      {children}
    </Box>
  );
}
