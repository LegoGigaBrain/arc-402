export interface TuiRenderLineSink {
  writeLine: (line: string) => void;
}

let currentSink: TuiRenderLineSink | null = null;

export function isTuiRenderMode(): boolean {
  return process.env.ARC402_TUI_MODE === "1";
}

export function setTuiRenderSink(sink: TuiRenderLineSink | null): void {
  currentSink = sink;
}

export function getTuiRenderSink(): TuiRenderLineSink | null {
  return currentSink;
}

export function writeTuiLine(line: string): void {
  if (currentSink) {
    currentSink.writeLine(line);
    return;
  }
  console.log(line);
}

export function withTuiRenderSink<T>(sink: TuiRenderLineSink, fn: () => Promise<T>): Promise<T> {
  const previous = currentSink;
  currentSink = sink;
  return fn().finally(() => {
    currentSink = previous;
  });
}
