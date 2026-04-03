import { EventEmitter } from 'events';

export type KeyName =
  | 'tab' | 'shift-tab'
  | 'enter' | 'escape'
  | 'up' | 'down' | 'left' | 'right'
  | 'pgup' | 'pgdn' | 'home' | 'end'
  | 'backspace' | 'delete'
  | 'ctrl-c' | 'ctrl-d' | 'ctrl-z'
  | 'ctrl-a' | 'ctrl-e' | 'ctrl-k' | 'ctrl-u' | 'ctrl-w'
  | 'f1' | 'f2' | 'f3' | 'f4' | 'f5'
  | 'char';

export interface KeyEvent {
  key: KeyName;
  char?: string;      // only when key === 'char'
  sequence?: string;  // raw escape sequence for debugging
}

// ANSI escape sequence → key name lookup table
const ESC_SEQUENCES: Record<string, KeyName> = {
  '\x1b[A':   'up',
  '\x1b[B':   'down',
  '\x1b[C':   'right',
  '\x1b[D':   'left',
  '\x1b[5~':  'pgup',
  '\x1b[6~':  'pgdn',
  '\x1b[H':   'home',
  '\x1b[F':   'end',
  '\x1b[3~':  'delete',
  '\x1b[Z':   'shift-tab',
  '\x1bOP':   'f1',
  '\x1bOQ':   'f2',
  '\x1bOR':   'f3',
  '\x1bOS':   'f4',
  '\x1b[15~': 'f5',
};

export class InputSystem extends EventEmitter {
  private rawMode: boolean = false;
  private stdin: NodeJS.ReadStream;
  private _boundHandler: ((buf: Buffer) => void) | null = null;

  constructor(stdin: NodeJS.ReadStream = process.stdin) {
    super();
    this.stdin = stdin;
  }

  start(): void {
    if (this._boundHandler) return; // already started

    if (this.stdin.isTTY) {
      this.stdin.setRawMode(true);
      this.rawMode = true;
    }
    this.stdin.resume();

    this._boundHandler = (buf: Buffer) => {
      const events = InputSystem.parseKey(buf);
      for (const event of events) {
        this.emit('key', event);
      }
    };

    this.stdin.on('data', this._boundHandler);
  }

  stop(): void {
    if (this._boundHandler) {
      this.stdin.removeListener('data', this._boundHandler);
      this._boundHandler = null;
    }
    if (this.rawMode && this.stdin.isTTY) {
      this.stdin.setRawMode(false);
      this.rawMode = false;
    }
    this.stdin.pause();
  }

  /**
   * Parse a Buffer of raw stdin bytes into one or more KeyEvent objects.
   * Exported as a static method for testability.
   */
  static parseKey(buf: Buffer): KeyEvent[] {
    const events: KeyEvent[] = [];
    let i = 0;

    while (i < buf.length) {
      const byte = buf[i];

      // ── Escape sequences ─────────────────────────────────────────────────
      if (byte === 0x1b) {
        // Try longest match first (up to 6 bytes covers all our sequences)
        let matched = false;
        for (let len = Math.min(6, buf.length - i); len >= 2; len--) {
          const seq = buf.subarray(i, i + len).toString('binary');
          if (ESC_SEQUENCES[seq]) {
            events.push({ key: ESC_SEQUENCES[seq], sequence: seq });
            i += len;
            matched = true;
            break;
          }
        }
        if (!matched) {
          // Lone ESC
          events.push({ key: 'escape', sequence: '\x1b' });
          i++;
        }
        continue;
      }

      // ── Control characters ────────────────────────────────────────────────
      if (byte === 0x09) { events.push({ key: 'tab' });       i++; continue; }
      if (byte === 0x0d || byte === 0x0a) { events.push({ key: 'enter' }); i++; continue; }
      if (byte === 0x7f || byte === 0x08) { events.push({ key: 'backspace' }); i++; continue; }
      if (byte === 0x03) { events.push({ key: 'ctrl-c' }); i++; continue; }
      if (byte === 0x04) { events.push({ key: 'ctrl-d' }); i++; continue; }
      if (byte === 0x1a) { events.push({ key: 'ctrl-z' }); i++; continue; }
      if (byte === 0x01) { events.push({ key: 'ctrl-a' }); i++; continue; }
      if (byte === 0x05) { events.push({ key: 'ctrl-e' }); i++; continue; }
      if (byte === 0x0b) { events.push({ key: 'ctrl-k' }); i++; continue; }
      if (byte === 0x15) { events.push({ key: 'ctrl-u' }); i++; continue; }
      if (byte === 0x17) { events.push({ key: 'ctrl-w' }); i++; continue; }

      // ── Printable ASCII ───────────────────────────────────────────────────
      if (byte >= 0x20 && byte <= 0x7e) {
        const char = String.fromCharCode(byte);
        events.push({ key: 'char', char });
        i++;
        continue;
      }

      // ── Multi-byte UTF-8 ──────────────────────────────────────────────────
      let seqLen = 0;
      if ((byte & 0xe0) === 0xc0) seqLen = 2;
      else if ((byte & 0xf0) === 0xe0) seqLen = 3;
      else if ((byte & 0xf8) === 0xf0) seqLen = 4;

      if (seqLen >= 2 && i + seqLen <= buf.length) {
        const charBuf = buf.subarray(i, i + seqLen);
        const char = charBuf.toString('utf8');
        events.push({ key: 'char', char });
        i += seqLen;
        continue;
      }

      // Unknown byte — skip
      i++;
    }

    return events;
  }
}

export function createInputSystem(stdin?: NodeJS.ReadStream): InputSystem {
  return new InputSystem(stdin);
}
