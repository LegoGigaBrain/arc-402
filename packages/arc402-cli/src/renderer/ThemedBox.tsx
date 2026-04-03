import React from 'react';
import { Box } from './ink.js';
import type { BoxStyle } from './layout.js';

// ThemedBox is currently a thin wrapper over Box
// In the future it can apply theme-based spacing, borders, etc.
interface ThemedBoxProps extends BoxStyle {
  children?: React.ReactNode;
}

export function ThemedBox({ children, ...style }: ThemedBoxProps) {
  // Spread BoxStyle props directly — Ink's Box accepts them as top-level props
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return React.createElement(Box as any, style, children);
}
