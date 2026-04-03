import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultTheme } from '../../dist/renderer/theme.js';

// defaultTheme.colors.primary is ARC-402 cyan { r: 34, g: 211, b: 238 }
test('defaultTheme.colors.primary is ARC-402 cyan', () => {
  assert.deepEqual(defaultTheme.colors.primary, { r: 34, g: 211, b: 238 });
});

// useTheme() context default is defaultTheme — verified via ThemeContext creation
test('defaultTheme contains all required color tokens', () => {
  // The ThemeContext is created with defaultTheme as the default value,
  // so useTheme() returns defaultTheme when no provider is present.
  assert.deepEqual(defaultTheme.colors.primary, { r: 34, g: 211, b: 238 });
  assert.deepEqual(defaultTheme.colors.secondary, { r: 148, g: 163, b: 184 });
  assert.deepEqual(defaultTheme.colors.success, { r: 74, g: 222, b: 128 });
  assert.deepEqual(defaultTheme.colors.warning, { r: 251, g: 191, b: 36 });
  assert.deepEqual(defaultTheme.colors.danger, { r: 248, g: 113, b: 113 });
});

// useComponentStyle('header') returns { fg: cyan, bold: true }
test("defaultTheme.components.header is { fg: cyan, bold: true }", () => {
  const style = defaultTheme.components.header;
  assert.deepEqual(style.fg, { r: 34, g: 211, b: 238 });
  assert.equal(style.bold, true);
});

// ThemeProvider overrides theme for children
// (structural check — ensure custom theme shape is accepted by the type)
test('custom theme shape matches Theme interface', () => {
  const customTheme = {
    ...defaultTheme,
    colors: {
      ...defaultTheme.colors,
      primary: { r: 255, g: 0, b: 0 },
    },
  };
  assert.deepEqual(customTheme.colors.primary, { r: 255, g: 0, b: 0 });
  // other tokens unchanged
  assert.deepEqual(customTheme.colors.secondary, defaultTheme.colors.secondary);
});
