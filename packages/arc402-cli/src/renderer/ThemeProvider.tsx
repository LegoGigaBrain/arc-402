import React, { createContext, useContext } from 'react';
import { type Theme, defaultTheme } from './theme.js';

const ThemeContext = createContext<Theme>(defaultTheme);

export function ThemeProvider({ theme = defaultTheme, children }: {
  theme?: Theme;
  children: React.ReactNode;
}) {
  return React.createElement(ThemeContext.Provider, { value: theme }, children);
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export function useColor(name: keyof Theme['colors']) {
  const theme = useTheme();
  return theme.colors[name];
}

export function useComponentStyle<K extends keyof Theme['components']>(name: K) {
  const theme = useTheme();
  return theme.components[name];
}
