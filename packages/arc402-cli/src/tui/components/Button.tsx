import React from "react";
import { Box, Text } from "../../renderer/index.js";
import { useFocus, useInput } from "ink";

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: "primary" | "danger" | "dim";
}

const VARIANT_COLORS: Record<string, string> = {
  primary: "cyan",
  danger: "red",
  dim: "gray",
};

export function Button({ label, onPress, variant = "primary" }: ButtonProps) {
  const { isFocused } = useFocus();

  useInput(
    (_input, key) => {
      if (key.return) {
        onPress();
      }
    },
    { isActive: isFocused }
  );

  const color = isFocused ? VARIANT_COLORS[variant] ?? "cyan" : "white";

  return (
    <Box>
      <Text color={color} bold={isFocused}>
        {isFocused ? "▸ " : "  "}
        {label}
      </Text>
    </Box>
  );
}
