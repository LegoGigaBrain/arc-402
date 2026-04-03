import React from 'react';
import * as inkPkg from 'ink';
import { reconciler, setOnCommit } from './reconciler.js';
import { DOMNode, createNode } from './dom.js';
import { Frame, createFrame } from './cell.js';
import { diff } from './diff.js';
import { writePatches } from './terminal.js';
import { createRenderLoop } from './loop.js';
import type { BoxStyle } from './layout.js';
import type { Color } from './cell.js';

// useApp is safe to re-export (no problematic internal types)
export const useApp = inkPkg.useApp;
// Note: useInput, useFocus, useFocusManager, useStdout must be imported
// directly from 'ink' in components that need them — ink@3 type exports
// are incomplete and cause TS4023 errors when re-exported.

export interface RenderOptions {
  stdout?: NodeJS.WriteStream;
  rows?: number;
  cols?: number;
}

export interface RenderInstance {
  update(node: React.ReactElement): void;
  unmount(): void;
  waitUntilExit(): Promise<void>;
}

export function render(node: React.ReactElement, options: RenderOptions = {}): RenderInstance {
  const stdout = options.stdout ?? process.stdout;
  const rows = options.rows ?? (stdout as NodeJS.WriteStream & { rows?: number }).rows ?? 24;
  const cols = options.cols ?? (stdout as NodeJS.WriteStream & { columns?: number }).columns ?? 80;

  let frontFrame: Frame = createFrame(rows, cols);
  const container: DOMNode = createNode('root');

  const { schedule } = createRenderLoop(() => {
    // Phase 4 stub — full render implementation in Phase 6
    const backFrame = createFrame(rows, cols);
    const patches = diff(frontFrame, backFrame);
    writePatches(patches, stdout);
    frontFrame = backFrame;
  });

  setOnCommit(schedule);

  // react-reconciler v0.26 createContainer(containerInfo, tag, hydrate, hydrationCallbacks)
  const fiberRoot = reconciler.createContainer(container, 0, false, null);

  reconciler.updateContainer(node, fiberRoot, null, null);

  let exitResolve!: () => void;
  const exitPromise = new Promise<void>(resolve => { exitResolve = resolve; });

  return {
    update(newNode: React.ReactElement) {
      reconciler.updateContainer(newNode, fiberRoot, null, null);
    },
    unmount() {
      reconciler.updateContainer(null, fiberRoot, null, null);
      exitResolve();
    },
    waitUntilExit() {
      return exitPromise;
    },
  };
}

// Box props — accepts both a style object and flat ink-style layout props
export interface BoxProps extends BoxStyle {
  style?: BoxStyle;
  children?: React.ReactNode;
}

// Box and Text delegate directly to ink's real components.
// This makes components imported from renderer/index.ts work correctly
// when ink's render() is used (which is the current state while the
// custom cell-buffer renderer is being completed).
export function Box({ style, children, ...flatProps }: BoxProps) {
  // Merge flat layout props with style object, pass as ink-compatible props
  const merged = { ...flatProps, ...style };
  return React.createElement(inkPkg.Box, merged as React.ComponentProps<typeof inkPkg.Box>, children);
}

export interface TextProps {
  color?: Color | string;
  bold?: boolean;
  dim?: boolean;
  dimColor?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  children?: React.ReactNode;
}

export function Text({ color, bold, dim, dimColor, italic, underline, inverse, children }: TextProps) {
  const resolvedColor = color && typeof color === 'object'
    ? `rgb(${(color as Color).r},${(color as Color).g},${(color as Color).b})`
    : color as string | undefined;
  const resolvedDim = dim ?? dimColor;
  return React.createElement(inkPkg.Text, {
    color: resolvedColor, bold, dimColor: resolvedDim, italic, underline, inverse
  } as React.ComponentProps<typeof inkPkg.Text>, children);
}
