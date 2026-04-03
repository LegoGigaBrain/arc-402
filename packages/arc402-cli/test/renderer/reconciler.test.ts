import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, Box, Text } from '../../src/renderer/ink.js';
import { PassThrough } from 'stream';

function makeMockStdout() {
  const stream = new PassThrough() as unknown as NodeJS.WriteStream & { rows: number; columns: number };
  stream.rows = 10;
  stream.columns = 40;
  return stream;
}

describe('React reconciler bridge', () => {
  it('renders <Box><Text>hello</Text></Box> without throwing', () => {
    const stdout = makeMockStdout();
    const instance = render(
      React.createElement(Box, {}, React.createElement(Text, {}, 'hello')),
      { stdout, rows: 10, cols: 40 }
    );
    expect(instance).toBeTruthy();
    instance.unmount();
  });

  it('update via instance.update() does not throw', () => {
    const stdout = makeMockStdout();
    const instance = render(
      React.createElement(Box, {}, React.createElement(Text, {}, 'hello')),
      { stdout, rows: 10, cols: 40 }
    );
    expect(() => {
      instance.update(
        React.createElement(Box, {}, React.createElement(Text, {}, 'world'))
      );
    }).not.toThrow();
    instance.unmount();
  });

  it('unmount resolves waitUntilExit()', async () => {
    const stdout = makeMockStdout();
    const instance = render(
      React.createElement(Box, {}, React.createElement(Text, {}, 'bye')),
      { stdout, rows: 10, cols: 40 }
    );
    const exitP = instance.waitUntilExit();
    instance.unmount();
    await expect(exitP).resolves.toBeUndefined();
  });
});
