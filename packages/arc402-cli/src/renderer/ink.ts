import React from 'react';
import { reconciler, setOnCommit } from './reconciler.js';
import { DOMNode, createNode } from './dom.js';
import { Frame, createFrame } from './cell.js';
import { diff } from './diff.js';
import { writePatches } from './terminal.js';
import { createRenderLoop } from './loop.js';
import type { BoxStyle } from './layout.js';
import type { Color } from './cell.js';

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

// Primitive components — translated by the reconciler
export function Box({ style, children }: { style?: BoxStyle; children?: React.ReactNode }) {
  return React.createElement('arc-box', { style }, children);
}

export function Text({ color, bold, dim, dimColor, italic, underline, children }: {
  color?: Color | string;
  bold?: boolean;
  dim?: boolean;
  dimColor?: boolean;
  italic?: boolean;
  underline?: boolean;
  children?: React.ReactNode;
}) {
  // dimColor is an ink-compat alias for dim
  const resolvedDim = dim ?? dimColor;
  return React.createElement('arc-text', { color, bold, dim: resolvedDim, italic, underline }, children);
}
