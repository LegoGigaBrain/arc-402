import React from "react";
import { Box, Text } from "../../renderer/index.js";
import { Button } from "./Button.js";

export interface ConfirmPromptProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}

export function ConfirmPrompt({
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
}: ConfirmPromptProps) {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ◈ {message}
        </Text>
      </Box>
      <Box>
        <Box marginRight={2}><Button label={confirmLabel} onPress={onConfirm} variant="primary" /></Box>
        <Button label={cancelLabel} onPress={onCancel} variant="dim" />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Tab to switch · Enter to select</Text>
      </Box>
    </Box>
  );
}
