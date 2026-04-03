import { type Color, COLORS } from './cell.js';

export interface Theme {
  colors: {
    primary:   Color;  // #22d3ee ARC-402 cyan
    secondary: Color;  // #94a3b8 slate
    success:   Color;  // #4ade80 green
    warning:   Color;  // #fbbf24 amber
    danger:    Color;  // #f87171 red
    dim:       Color;  // #475569 muted
    white:     Color;  // null = terminal default (transparent bg)
  };
  components: {
    header:    { fg: Color; bold: boolean };
    label:     { fg: Color };
    value:     { fg: Color | null };
    badge:     { fg: Color | null; bg: Color; bold: boolean };
    separator: { fg: Color };
    prompt:    { fg: Color; bold: boolean };
    cursor:    { fg: Color | null; bg: Color };
    success:   { fg: Color };
    warning:   { fg: Color };
    danger:    { fg: Color };
  };
}

export const defaultTheme: Theme = {
  colors: {
    primary:   COLORS.cyan,
    secondary: COLORS.slate,
    success:   COLORS.green,
    warning:   COLORS.yellow,
    danger:    COLORS.red,
    dim:       COLORS.dim,
    white:     COLORS.white,
  },
  components: {
    header:    { fg: COLORS.cyan,  bold: true },
    label:     { fg: COLORS.slate },
    value:     { fg: null },
    badge:     { fg: null, bg: COLORS.cyan, bold: true },
    separator: { fg: COLORS.dim },
    prompt:    { fg: COLORS.cyan,  bold: true },
    cursor:    { fg: null, bg: COLORS.cyan },
    success:   { fg: COLORS.green },
    warning:   { fg: COLORS.yellow },
    danger:    { fg: COLORS.red },
  },
};
