import React, { useState, useEffect } from "react";
import { Box, Text } from "../../renderer/index.js";

const SPINNER_FRAMES = ["◈", "◇", "◆", "◇"];
const SPINNER_INTERVAL = 120;

export type StepStatus = "pending" | "running" | "done" | "error";

export interface StepSpinnerProps {
  step: number;
  total: number;
  label: string;
  status: StepStatus;
  detail?: string;
  error?: string;
}

export function StepSpinner({
  step,
  total,
  label,
  status,
  detail,
  error,
}: StepSpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (status !== "running") return;
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL);
    return () => clearInterval(timer);
  }, [status]);

  const prefix = `Step ${step}/${total}`;

  if (status === "pending") {
    return (
      <Box>
        <Text dimColor>  {prefix} — {label}</Text>
      </Box>
    );
  }

  if (status === "running") {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="cyan"> {SPINNER_FRAMES[frame]} {prefix} — {label}...</Text>
        </Box>
      </Box>
    );
  }

  if (status === "done") {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="green"> ✓ {prefix} — {label}</Text>
        </Box>
        {detail && (
          <Box>
            <Text dimColor>   └ {detail}</Text>
          </Box>
        )}
      </Box>
    );
  }

  // error
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="red"> ✗ {prefix} — {label}</Text>
      </Box>
      {error && (
        <Box>
          <Text color="red">   └ {error}</Text>
        </Box>
      )}
    </Box>
  );
}
