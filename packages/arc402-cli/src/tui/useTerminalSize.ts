import { useState, useEffect } from "react";

interface TerminalSize {
  rows: number;
  columns: number;
}

/**
 * Returns current terminal dimensions and re-renders reactively on resize.
 * Safe fallback: 24 rows × 80 columns if stdout is unavailable (e.g. piped).
 */
export function useTerminalSize(): TerminalSize {
  const stdout = process.stdout;

  const [size, setSize] = useState<TerminalSize>({
    rows: stdout?.rows ?? 24,
    columns: stdout?.columns ?? 80,
  });

  useEffect(() => {
    if (!stdout) return;

    const handleResize = () => {
      setSize({
        rows: stdout.rows ?? 24,
        columns: stdout.columns ?? 80,
      });
    };

    stdout.on("resize", handleResize);
    return () => {
      stdout.off("resize", handleResize);
    };
  }, []);

  return size;
}
