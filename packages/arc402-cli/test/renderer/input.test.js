import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Import from compiled output
const { InputSystem } = await import('../../dist/renderer/input.js');

describe('InputSystem.parseKey', () => {
  it('\\x1b[A → up', () => {
    const events = InputSystem.parseKey(Buffer.from('\x1b[A', 'binary'));
    assert.equal(events.length, 1);
    assert.equal(events[0].key, 'up');
  });

  it('\\x1b[B → down', () => {
    const events = InputSystem.parseKey(Buffer.from('\x1b[B', 'binary'));
    assert.equal(events.length, 1);
    assert.equal(events[0].key, 'down');
  });

  it('\\t → tab', () => {
    const events = InputSystem.parseKey(Buffer.from('\t', 'binary'));
    assert.equal(events.length, 1);
    assert.equal(events[0].key, 'tab');
  });

  it('\\x1b[Z → shift-tab', () => {
    const events = InputSystem.parseKey(Buffer.from('\x1b[Z', 'binary'));
    assert.equal(events.length, 1);
    assert.equal(events[0].key, 'shift-tab');
  });

  it('\\r → enter', () => {
    const events = InputSystem.parseKey(Buffer.from('\r', 'binary'));
    assert.equal(events.length, 1);
    assert.equal(events[0].key, 'enter');
  });

  it('\\x1b (lone) → escape', () => {
    const events = InputSystem.parseKey(Buffer.from('\x1b', 'binary'));
    assert.equal(events.length, 1);
    assert.equal(events[0].key, 'escape');
  });

  it('\\x7f → backspace', () => {
    const events = InputSystem.parseKey(Buffer.from('\x7f', 'binary'));
    assert.equal(events.length, 1);
    assert.equal(events[0].key, 'backspace');
  });

  it('\\x03 → ctrl-c', () => {
    const events = InputSystem.parseKey(Buffer.from('\x03', 'binary'));
    assert.equal(events.length, 1);
    assert.equal(events[0].key, 'ctrl-c');
  });

  it('"a" → char "a"', () => {
    const events = InputSystem.parseKey(Buffer.from('a'));
    assert.equal(events.length, 1);
    assert.equal(events[0].key, 'char');
    assert.equal(events[0].char, 'a');
  });

  it('multi-byte é (0xC3 0xA9) → char "é"', () => {
    const events = InputSystem.parseKey(Buffer.from([0xc3, 0xa9]));
    assert.equal(events.length, 1);
    assert.equal(events[0].key, 'char');
    assert.equal(events[0].char, 'é');
  });

  it('"hello\\r" produces 6 events', () => {
    const events = InputSystem.parseKey(Buffer.from('hello\r'));
    assert.equal(events.length, 6);
    assert.deepEqual(events.map(e => e.key), ['char','char','char','char','char','enter']);
    assert.deepEqual(
      events.slice(0, 5).map(e => e.char),
      ['h','e','l','l','o']
    );
  });
});
