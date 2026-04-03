import React from 'react';
import { useTheme, useComponentStyle } from './ThemeProvider.js';
import { Text } from './ink.js';
import type { Color } from './cell.js';
import type { Theme } from './theme.js';

interface ThemedTextProps {
  // Either use a component style token
  variant?: keyof Theme['components'];
  // Or directly specify color
  color?: Color | null;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  children: React.ReactNode;
}

export function ThemedText({ variant, color, bold, dim, italic, underline, children }: ThemedTextProps) {
  const theme = useTheme();

  let resolvedColor = color;
  let resolvedBold = bold;
  let resolvedDim = dim;

  if (variant) {
    const style = theme.components[variant] as Record<string, unknown>;
    if (resolvedColor === undefined) resolvedColor = (style.fg as Color | null | undefined) ?? null;
    if (resolvedBold === undefined && style.bold) resolvedBold = style.bold as boolean;
  }

  const colorStr = resolvedColor != null
    ? `#${resolvedColor.r.toString(16).padStart(2, '0')}${resolvedColor.g.toString(16).padStart(2, '0')}${resolvedColor.b.toString(16).padStart(2, '0')}`
    : undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return React.createElement(Text as any, {
    color: colorStr,
    bold: resolvedBold,
    dimColor: resolvedDim,
    italic,
    underline,
  }, children);
}
