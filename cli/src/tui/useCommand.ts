import { useState, useCallback } from "react";
import { createProgram } from "../program";
import chalk from "chalk";
import { c } from "../ui/colors";

interface UseCommandResult {
  execute: (input: string, onLine: (line: string) => void) => Promise<void>;
  isRunning: boolean;
}

/**
 * Dispatches parsed commands to the commander program.
 * Captures stdout/stderr by monkey-patching process.stdout.write
 * and routes all output to the viewport buffer via onLine callback.
 */
export function useCommand(): UseCommandResult {
  const [isRunning, setIsRunning] = useState(false);

  const execute = useCallback(
    async (input: string, onLine: (line: string) => void): Promise<void> => {
      setIsRunning(true);

      // Capture stdout/stderr
      const originalStdoutWrite = process.stdout.write.bind(process.stdout);
      const originalStderrWrite = process.stderr.write.bind(process.stderr);

      let captureBuffer = "";

      const flushBuffer = (): void => {
        if (!captureBuffer) return;
        const lines = captureBuffer.split("\n");
        captureBuffer = lines.pop() ?? "";
        for (const line of lines) {
          onLine(line);
        }
      };

      const capturedWrite = (
        chunk: string | Uint8Array,
        encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
        cb?: (err?: Error | null) => void
      ): boolean => {
        const str =
          typeof chunk === "string"
            ? chunk
            : Buffer.from(chunk).toString("utf8");
        captureBuffer += str;
        flushBuffer();
        // call callback if provided
        const callback =
          typeof encodingOrCb === "function" ? encodingOrCb : cb;
        if (callback) callback();
        return true;
      };

      // Monkey-patch (cast through unknown to bypass strict overload checking)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stdout as any).write = capturedWrite;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stderr as any).write = capturedWrite;

      try {
        const tokens = parseTokens(input);
        const prog = createProgram();
        prog.exitOverride();
        prog.configureOutput({
          writeOut: (str) => process.stdout.write(str),
          writeErr: (str) => process.stderr.write(str),
        });

        await prog.parseAsync(["node", "arc402", ...tokens]);
      } catch (err) {
        const e = err as { code?: string; message?: string };
        if (
          e.code === "commander.helpDisplayed" ||
          e.code === "commander.version" ||
          e.code === "commander.executeSubCommandAsync"
        ) {
          // already written or normal exit — no-op
        } else if (e.code === "commander.unknownCommand") {
          const tokens = parseTokens(input);
          onLine(
            ` ${c.failure} ${chalk.red(`Unknown command: ${chalk.white(tokens[0])}`)} `
          );
          onLine(chalk.dim("  Type 'help' for available commands"));
        } else if (e.code?.startsWith("commander.")) {
          onLine(` ${c.failure} ${chalk.red(e.message ?? String(err))}`);
        } else {
          onLine(` ${c.failure} ${chalk.red(e.message ?? String(err))}`);
        }
      } finally {
        // Flush remaining buffer
        if (captureBuffer.trim()) {
          onLine(captureBuffer);
          captureBuffer = "";
        }

        // Restore original write functions
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (process.stdout as any).write = originalStdoutWrite;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (process.stderr as any).write = originalStderrWrite;

        setIsRunning(false);
      }
    },
    []
  );

  return { execute, isRunning };
}

// Shell-style tokenizer
function parseTokens(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  let escape = false;
  for (const ch of input) {
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (inQuote) {
      if (quoteChar === '"' && ch === "\\") {
        escape = true;
      } else if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === " ") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}
