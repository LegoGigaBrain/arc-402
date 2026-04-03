// ANSI sequences
const ENTER_ALT_SCREEN      = '\x1b[?1049h';
const EXIT_ALT_SCREEN       = '\x1b[?1049l';
const HIDE_CURSOR            = '\x1b[?25l';
const SHOW_CURSOR            = '\x1b[?25h';
const ENABLE_MOUSE_TRACKING  = '\x1b[?1000h\x1b[?1002h\x1b[?1015h\x1b[?1006h';
const DISABLE_MOUSE_TRACKING = '\x1b[?1000l\x1b[?1002l\x1b[?1015l\x1b[?1006l';

export interface ScreenOptions {
  stdout?: NodeJS.WriteStream;
  mouseTracking?: boolean;
}

export class ScreenManager {
  private stdout: NodeJS.WriteStream;
  private altScreenActive: boolean = false;
  private mouseTrackingActive: boolean = false;
  private originalSigintHandler?: NodeJS.SignalsListener;
  private exitHandler?: () => void;

  constructor(options: ScreenOptions = {}) {
    this.stdout = options.stdout ?? process.stdout;
  }

  enter(mouseTracking?: boolean): void {
    if (this.altScreenActive) return;

    this.stdout.write(ENTER_ALT_SCREEN);
    this.stdout.write(HIDE_CURSOR);

    if (mouseTracking) {
      this.stdout.write(ENABLE_MOUSE_TRACKING);
      this.mouseTrackingActive = true;
    }

    this.altScreenActive = true;

    // Register exit handler
    this.exitHandler = () => this.exit();
    process.on('exit', this.exitHandler);

    // SIGINT handler
    this.originalSigintHandler = process.listeners('SIGINT')[0] as NodeJS.SignalsListener | undefined;
    process.on('SIGINT', () => {
      this.exit();
      process.exit(0);
    });

    // SIGTERM handler
    process.on('SIGTERM', () => {
      this.exit();
      process.exit(0);
    });
  }

  exit(): void {
    if (!this.altScreenActive) return;

    if (this.mouseTrackingActive) {
      this.stdout.write(DISABLE_MOUSE_TRACKING);
      this.mouseTrackingActive = false;
    }

    this.stdout.write(SHOW_CURSOR);
    this.stdout.write(EXIT_ALT_SCREEN);

    this.altScreenActive = false;

    if (this.exitHandler) {
      process.off('exit', this.exitHandler);
      this.exitHandler = undefined;
    }
  }

  getSize(): { rows: number; cols: number } {
    return {
      rows: this.stdout.rows ?? 24,
      cols: this.stdout.columns ?? 80,
    };
  }

  onResize(handler: (size: { rows: number; cols: number }) => void): void {
    process.stdout.on('resize', () => handler(this.getSize()));
  }

  write(data: string): void {
    this.stdout.write(data);
  }

  get isAltScreenActive(): boolean {
    return this.altScreenActive;
  }
}
