import React, { useState, useCallback, useEffect } from "react";
import { Box, Text } from "../renderer/index.js";
import { useApp } from "ink";
import { Header } from "./Header";
import { Viewport } from "./Viewport";
import { Footer } from "./Footer";
import { InputLine } from "./InputLine";
import { useCommand } from "./useCommand";
import { useChat } from "./useChat";
import { useNotifications } from "./useNotifications";
import { useDaemonEvents } from "./useDaemonEvents";
import { Toast } from "./components/Toast";
import { useScroll } from "./useScroll";
import { useTerminalSize } from "./useTerminalSize";
import { getBannerLines } from "../ui/banner";
import { executeKernelForPayload, getTuiTopLevelCommands } from "./kernel";
import { TUI_HELP_SECTIONS } from "./command-catalog";
import type { ViewportEntry } from "./Viewport";
import chalk from "chalk";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require("../../package.json") as { version: string };

const BUILTIN_CMDS = ["help", "exit", "quit", "clear", "status"];

interface AppProps {
  version: string;
  network?: string;
  wallet?: string;
  balance?: string;
}

/**
 * Root TUI component — fixed header/footer with scrollable viewport.
 */
export function App({ version, network, wallet, balance }: AppProps) {
  const { exit } = useApp();
  const [outputBuffer, setOutputBuffer] = useState<ViewportEntry[]>([
    chalk.dim("  Type 'help' to see available commands"),
    "",
  ]);
  const [isProcessing, setIsProcessing] = useState(false);

  const { execute, isRunning } = useCommand();
  const { send, isSending } = useChat();

  // Measure viewport height from actual terminal size and real header line count.
  // The separator Box rendered between Header and Viewport adds 1 row.
  // Footer (InputLine) is 1 row.
  const { rows } = useTerminalSize();
  const headerLineCount = getBannerLines({ network, wallet, balance }).length;
  const SEPARATOR_ROWS = 1;
  const FOOTER_ROWS = 1;
  const viewportHeight = Math.max(1, rows - headerLineCount - SEPARATOR_ROWS - FOOTER_ROWS);

  const { scrollOffset, isAutoScroll, scrollUp, scrollDown, snapToBottom } =
    useScroll(viewportHeight);

  const [topCmds] = useState<string[]>(() => getTuiTopLevelCommands());

  const { toasts, push: pushToast, dismiss } = useNotifications();

  useDaemonEvents((type, data) => {
    switch (type) {
      case "hire_proposed":
        pushToast(`◈ Hire received — ${String(data.from ?? "agent")} · ${String(data.amount ?? "?")} ETH`, "info");
        appendLine(chalk.cyanBright(`  ◈ Hire received — Agreement #${String(data.id ?? "?")}`));
        break;
      case "agreement_accepted":
        pushToast(`✓ Agreement #${String(data.id)} accepted`, "success");
        break;
      case "job_completed":
        pushToast(`✓ Job complete — Agreement #${String(data.id)}`, "success");
        appendLine(chalk.green(`  ✓ Job complete — Agreement #${String(data.id ?? "?")}`));
        break;
      case "job_failed":
        pushToast(`✗ Job failed — Agreement #${String(data.id)} · ${String(data.reason ?? "unknown")}`, "error");
        appendLine(chalk.red(`  ✗ Job failed — Agreement #${String(data.id ?? "?")}: ${String(data.reason ?? "")}`));
        break;
      case "security_threat":
        pushToast(`✗ Security: ${String(data.category ?? "threat")} detected — Agreement #${String(data.agreementId)}`, "error");
        break;
    }
  });

  const appendLine = useCallback((line: string) => {
    setOutputBuffer((prev) => [...prev, line]);
  }, []);

  const appendEntry = useCallback((entry: ViewportEntry) => {
    setOutputBuffer((prev) => [...prev, entry]);
  }, []);

  const handleCommand = useCallback(
    async (input: string): Promise<void> => {
      // Echo command to viewport
      appendLine(
        chalk.cyanBright("◈") +
          " " +
          chalk.dim("arc402") +
          " " +
          chalk.white(">") +
          " " +
          chalk.white(input)
      );

      // Snap to bottom on new command
      snapToBottom();
      setIsProcessing(true);

      const firstWord = input.split(/\s+/)[0];
      const allKnown = [...BUILTIN_CMDS, ...topCmds];

      // ── Built-in: exit/quit ────────────────────────────────────────────────
      if (input === "exit" || input === "quit") {
        appendLine(
          " " + chalk.cyanBright("◈") + chalk.dim(" goodbye")
        );
        setIsProcessing(false);
        setTimeout(() => exit(), 100);
        return;
      }

      // ── Built-in: clear ────────────────────────────────────────────────────
      if (input === "clear") {
        setOutputBuffer([]);
        setIsProcessing(false);
        return;
      }

      // ── Built-in: help ─────────────────────────────────────────────────────
      if (input === "help" || input === "/help") {
        const lines: string[] = [
          chalk.cyanBright("◈ ARC-402 TUI"),
          chalk.dim("  Tab to complete · ↑/↓ history · PgUp/PgDn scroll · Esc dismiss"),
          "",
        ];
        for (const section of TUI_HELP_SECTIONS) {
          lines.push(chalk.bold.white(section.label));
          for (const { cmd, desc } of section.commands) {
            lines.push(
              "  " + chalk.white(cmd.padEnd(28)) + chalk.dim(desc)
            );
          }
          lines.push("");
        }
        lines.push(chalk.cyanBright("Chat"));
        lines.push(
          "  " + chalk.white("/chat <message>".padEnd(28)) + chalk.dim("Route message to OpenClaw gateway")
        );
        lines.push(
          "  " + chalk.white("chat".padEnd(28)) + chalk.dim("Open Commerce REPL")
        );
        lines.push("");
        for (const l of lines) appendLine(l);
        setIsProcessing(false);
        return;
      }

      // ── /chat prefix or unknown command → chat ─────────────────────────────
      const isExplicitChat = input.startsWith("/chat ");
      const isChatInput =
        isExplicitChat || (!allKnown.includes(firstWord) && firstWord !== "");

      if (isChatInput) {
        const msg = isExplicitChat ? input.slice(6).trim() : input;
        if (msg) {
          await send(msg, appendLine);
        }
        appendLine("");
        setIsProcessing(false);
        return;
      }

      // ── TUI kernel — returns typed payload → rendered as Phase 2 Ink component ──
      const kernelPayload = await executeKernelForPayload(input);
      if (kernelPayload !== null) {
        appendEntry(kernelPayload);
        appendLine("");
        setIsProcessing(false);
        return;
      }

      // ── Dispatch to commander ──────────────────────────────────────────────
      await execute(input, appendLine);
      appendLine("");
      setIsProcessing(false);
    },
    [appendLine, appendEntry, execute, send, snapToBottom, topCmds, network, wallet, balance, exit]
  );

  const isDisabled = isProcessing || isRunning || isSending;

  return (
    <Box flexDirection="column" height="100%">
      {/* HEADER — fixed, never scrolls */}
      <Header
        version={version}
        network={network}
        wallet={wallet}
        balance={balance}
      />

      {/* Separator */}
      <Box>
        <Text dimColor>{"─".repeat(60)}</Text>
      </Box>

      {/* VIEWPORT — fills remaining space, renders strings + Phase 2 Ink components */}
      <Viewport
        lines={outputBuffer}
        scrollOffset={scrollOffset}
        isAutoScroll={isAutoScroll}
        viewportHeight={viewportHeight}
      />

      {/* TOAST BAR — live daemon events */}
      {toasts.length > 0 && (
        <Box flexDirection="column">
          {toasts.map((t) => (
            <Toast key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </Box>
      )}

      {/* FOOTER — fixed, input pinned */}
      <Footer>
        <InputLine onSubmit={handleCommand} isDisabled={isDisabled} />
      </Footer>
    </Box>
  );
}
