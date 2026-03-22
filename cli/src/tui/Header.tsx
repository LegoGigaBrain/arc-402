import React from "react";
import { Box, Text } from "ink";
import { getBannerLines } from "../ui/banner";

interface HeaderProps {
  version: string;
  network?: string;
  wallet?: string;
  balance?: string;
}

/**
 * Fixed header showing the ASCII art banner + status info.
 * Never re-renders unless config changes.
 */
export const Header = React.memo(function Header({
  network,
  wallet,
  balance,
}: HeaderProps) {
  const bannerLines = getBannerLines({ network, wallet, balance });

  return (
    <Box flexDirection="column">
      {bannerLines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
});
