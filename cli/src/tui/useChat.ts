import { useState, useCallback } from "react";
import chalk from "chalk";
import { c } from "../ui/colors";

interface UseChatResult {
  send: (message: string, onLine: (line: string) => void) => Promise<void>;
  isSending: boolean;
}

/**
 * Sends messages to the OpenClaw gateway and streams responses
 * line-by-line into the viewport buffer via onLine callback.
 */
export function useChat(): UseChatResult {
  const [isSending, setIsSending] = useState(false);

  const send = useCallback(
    async (message: string, onLine: (line: string) => void): Promise<void> => {
      setIsSending(true);
      const trimmed = message.trim().slice(0, 10000);

      // Show thinking placeholder
      onLine(chalk.dim(" ◈ ") + chalk.dim("thinking..."));

      let res: Response;
      try {
        res = await fetch("http://localhost:19000/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, session: "arc402-tui" }),
          signal: AbortSignal.timeout(30000),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const isDown =
          msg.includes("ECONNREFUSED") ||
          msg.includes("fetch failed") ||
          msg.includes("ENOTFOUND") ||
          msg.includes("UND_ERR_SOCKET");
        if (isDown) {
          onLine(
            " " +
              chalk.yellow("⚠") +
              " " +
              chalk.dim("OpenClaw gateway not running. Start with: ") +
              chalk.white("openclaw gateway start")
          );
        } else {
          onLine(` ${c.failure} ${chalk.red(msg)}`);
        }
        setIsSending(false);
        return;
      }

      if (!res.body) {
        onLine(chalk.dim(" ◈ ") + chalk.white("(empty response)"));
        setIsSending(false);
        return;
      }

      const flushLine = (line: string): void => {
        // Unwrap SSE data lines
        if (line.startsWith("data: ")) {
          line = line.slice(6);
          if (line === "[DONE]") return;
          try {
            const j = JSON.parse(line) as {
              text?: string;
              content?: string;
              delta?: { text?: string };
            };
            line = j.text ?? j.content ?? j.delta?.text ?? line;
          } catch {
            /* use raw */
          }
        }
        if (line.trim()) {
          onLine(chalk.dim(" ◈ ") + chalk.white(line));
        }
      };

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) flushLine(line);
      }

      if (buffer.trim()) flushLine(buffer);

      setIsSending(false);
    },
    []
  );

  return { send, isSending };
}
