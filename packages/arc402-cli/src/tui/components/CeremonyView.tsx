import React from "react";
import { Box, Text } from "../../renderer/index.js";
import { StepSpinner } from "./StepSpinner.js";
import type { StepStatus } from "./StepSpinner.js";

export interface CeremonyStep {
  label: string;
  status: StepStatus;
  detail?: string;
  error?: string;
}

export interface CeremonyViewProps {
  title: string;
  steps: CeremonyStep[];
}

export function CeremonyView({ title, steps }: CeremonyViewProps) {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ◈ {title}
        </Text>
      </Box>
      {steps.map((step, i) => (
        <StepSpinner
          key={i}
          step={i + 1}
          total={steps.length}
          label={step.label}
          status={step.status}
          detail={step.detail}
          error={step.error}
        />
      ))}
    </Box>
  );
}
