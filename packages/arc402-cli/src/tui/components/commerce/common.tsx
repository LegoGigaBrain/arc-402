import React from "react";
import { Box, Text } from "../../../renderer/index.js";

export type CommerceTone = "neutral" | "info" | "success" | "warning" | "danger" | "muted";

const TONE_COLOR: Record<CommerceTone, string> = {
  neutral: "white",
  info: "cyan",
  success: "green",
  warning: "yellow",
  danger: "red",
  muted: "gray",
};

const TONE_ICON: Record<CommerceTone, string> = {
  neutral: "•",
  info: "◈",
  success: "✓",
  warning: "⚠",
  danger: "✗",
  muted: "·",
};

export interface StatusPillProps {
  label: string;
  tone?: CommerceTone;
}

export function StatusPill({ label, tone = "neutral" }: StatusPillProps) {
  return (
    <Text color={TONE_COLOR[tone]} bold>
      {TONE_ICON[tone]} {label}
    </Text>
  );
}

export interface CommerceCardProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  status?: StatusPillProps;
  footer?: string;
  children: React.ReactNode;
}

/**
 * Shared visual language for Spec 46 Phase 2 renderers:
 * - cyan eyebrow/title for ARC-402 identity
 * - concise boxed sections instead of free-form console dumps
 * - status semantics always flow through StatusPill tones
 * - muted metadata, white primary values, deliberate spacing between blocks
 */
export function CommerceCard({ eyebrow, title, subtitle, status, footer, children }: CommerceCardProps) {
  return (
    <Box flexDirection="column">
      {eyebrow ? (
        <Text color="cyan" bold>
          ◈ {eyebrow}
        </Text>
      ) : null}
      <Text bold color="white">
        {title}
        {status ? <Text>  </Text> : null}
        {status ? <StatusPill {...status} /> : null}
      </Text>
      {subtitle ? <Text dimColor>{subtitle}</Text> : null}
      <Text dimColor>{"─".repeat(60)}</Text>
      <Box flexDirection="column" marginTop={1}>
        {children}
      </Box>
      {footer ? (
        <Box marginTop={1}>
          <Text dimColor>{footer}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export interface DetailRowProps {
  label: string;
  value: React.ReactNode;
  tone?: CommerceTone;
}

export function DetailRow({ label, value, tone = "neutral" }: DetailRowProps) {
  return (
    <Box>
      <Box width={16}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box flexGrow={1}>
        {typeof value === "string" ? <Text color={TONE_COLOR[tone]}>{value}</Text> : value}
      </Box>
    </Box>
  );
}

export interface SectionProps {
  title: string;
  children: React.ReactNode;
}

export function Section({ title, children }: SectionProps) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{title}</Text>
      <Box flexDirection="column" marginLeft={2}>
        {children}
      </Box>
    </Box>
  );
}

export interface MeterProps {
  label?: string;
  value: number;
  width?: number;
  tone?: CommerceTone;
  suffix?: string;
}

export function Meter({ label, value, width = 28, tone = "info", suffix = "%" }: MeterProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const filled = Math.round((clamped / 100) * width);
  const empty = Math.max(0, width - filled);
  return (
    <Box flexDirection="column">
      {label ? <Text dimColor>{label}</Text> : null}
      <Text color={TONE_COLOR[tone]}>
        {"█".repeat(filled)}
        <Text dimColor>{"░".repeat(empty)}</Text>
        <Text> {clamped.toFixed(1)}{suffix}</Text>
      </Text>
    </Box>
  );
}

export interface ListRowProps {
  prefix?: React.ReactNode;
  title: string;
  meta?: string;
  detail?: string;
  status?: StatusPillProps;
}

export function ListRow({ prefix, title, meta, detail, status }: ListRowProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text>{prefix ?? "  "}</Text>
        <Text bold>{title}</Text>
        {status ? <Text>  </Text> : null}
        {status ? <StatusPill {...status} /> : null}
      </Box>
      {meta ? <Text dimColor>{meta}</Text> : null}
      {detail ? <Text>{detail}</Text> : null}
    </Box>
  );
}

export function formatPercent(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(digits)}%`;
}

export function formatCountdown(minutes?: number): string {
  if (minutes === undefined || minutes === null || !Number.isFinite(minutes)) return "n/a";
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours}h ${mins}m`;
}
