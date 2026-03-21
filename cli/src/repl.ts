import chalk from "chalk";
import fs from "fs";
import path from "path";
import os from "os";
import { createProgram } from "./program";
import { getBannerLines, BannerConfig } from "./ui/banner";
import { c } from "./ui/colors";

// ─── Sentinel to intercept process.exit() from commands ──────────────────────

class REPLExitSignal extends Error {
  constructor(public readonly code: number = 0) {
    super("repl-exit-signal");
  }
}

// ─── Config / banner helpers ──────────────────────────────────────────────────

const CONFIG_PATH = path.join(os.homedir(), ".arc402", "config.json");

async function loadBannerConfig(): Promise<BannerConfig | undefined> {
  if (!fs.existsSync(CONFIG_PATH)) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as {
      network?: string;
      walletContractAddress?: string;
      rpcUrl?: string;
    };
    const cfg: BannerConfig = { network: raw.network };
    if (raw.walletContractAddress) {
      const w = raw.walletContractAddress;
      cfg.wallet = `${w.slice(0, 6)}...${w.slice(-4)}`;
    }
    if (raw.rpcUrl && raw.walletContractAddress) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const ethersLib = require("ethers") as typeof import("ethers");
        const provider = new ethersLib.ethers.JsonRpcProvider(raw.rpcUrl);
        const bal = await Promise.race([
          provider.getBalance(raw.walletContractAddress),
          new Promise<never>((_, r) =>
            setTimeout(() => r(new Error("timeout")), 2000)
          ),
        ]);
        cfg.balance = `${parseFloat(
          ethersLib.ethers.formatEther(bal)
        ).toFixed(4)} ETH`;
      } catch {
        /* skip balance on timeout */
      }
    }
    return cfg;
  } catch {
    return undefined;
  }
}

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const ESC = "\x1b";

const ansi = {
  clearScreen: `${ESC}[2J`,
  home: `${ESC}[H`,
  clearLine: `${ESC}[2K`,
  clearToEol: `${ESC}[K`,
  hideCursor: `${ESC}[?25l`,
  showCursor: `${ESC}[?25h`,
  move: (r: number, col: number) => `${ESC}[${r};${col}H`,
  scrollRegion: (top: number, bot: number) => `${ESC}[${top};${bot}r`,
  resetScroll: `${ESC}[r`,
};

function write(s: string): void {
  process.stdout.write(s);
}

// ─── Prompt constants ─────────────────────────────────────────────────────────

const PROMPT_TEXT =
  chalk.cyanBright("◈") +
  " " +
  chalk.dim("arc402") +
  " " +
  chalk.white(">") +
  " ";

// Visible character count of "◈ arc402 > "
const PROMPT_VIS = 11;

// ─── Known command detection ──────────────────────────────────────────────────

const BUILTIN_CMDS = ["help", "exit", "quit", "clear", "status"];

// ─── Shell-style tokenizer ────────────────────────────────────────────────────

function parseTokens(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  for (const ch of input) {
    if (inQuote) {
      if (ch === quoteChar) inQuote = false;
      else current += ch;
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

// ─── Tab completion logic ─────────────────────────────────────────────────────

function getCompletions(
  line: string,
  topCmds: string[],
  subCmds: Map<string, string[]>
): string[] {
  const allTop = [...BUILTIN_CMDS, ...topCmds];
  const trimmed = line.trimStart();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) {
    return allTop.filter((cmd) => cmd.startsWith(trimmed));
  }
  const parent = trimmed.slice(0, spaceIdx);
  const rest = trimmed.slice(spaceIdx + 1);
  const subs = subCmds.get(parent) ?? [];
  return subs.filter((s) => s.startsWith(rest)).map((s) => `${parent} ${s}`);
}

// ─── TUI class ────────────────────────────────────────────────────────────────

class TUI {
  private inputBuffer = "";
  private cursorPos = 0;
  private history: string[] = [];
  private historyIdx = -1;
  private historyTemp = "";
  private bannerLines: string[] = [];
  private topCmds: string[] = [];
  private subCmds = new Map<string, string[]>();
  private bannerCfg?: BannerConfig;
  private commandRunning = false;

  private get termRows(): number {
    return process.stdout.rows || 24;
  }
  private get termCols(): number {
    return process.stdout.columns || 80;
  }
  private get scrollTop(): number {
    // +1 for separator row after banner
    return this.bannerLines.length + 2;
  }
  private get scrollBot(): number {
    return this.termRows - 1;
  }
  private get inputRow(): number {
    return this.termRows;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.bannerCfg = await loadBannerConfig();

    // Build command metadata for completion
    const template = createProgram();
    this.topCmds = template.commands.map((cmd) => cmd.name());
    for (const cmd of template.commands) {
      if (cmd.commands.length > 0) {
        this.subCmds.set(
          cmd.name(),
          cmd.commands.map((s) => s.name())
        );
      }
    }

    // Draw initial screen
    this.setupScreen();
    this.drawInputLine();

    // Enter raw mode
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", this.boundKeyHandler);

    // Resize handler
    process.stdout.on("resize", () => {
      this.setupScreen();
      this.drawInputLine();
    });

    // SIGINT (shouldn't fire in raw mode, but just in case)
    process.on("SIGINT", () => this.exitGracefully());

    // Keep alive — process.stdin listener keeps the event loop running
    await new Promise<never>(() => {
      /* never resolves; process.exit() is called on quit */
    });
  }

  // ── Screen setup ────────────────────────────────────────────────────────────

  private setupScreen(): void {
    this.bannerLines = getBannerLines(this.bannerCfg);

    write(ansi.hideCursor);
    write(ansi.clearScreen + ansi.home);

    // Banner
    for (const line of this.bannerLines) {
      write(line + "\n");
    }

    // Separator between banner and output area
    write(chalk.dim("─".repeat(this.termCols)) + "\n");

    // Set scroll region (output area, leaves last row free for input)
    if (this.scrollTop <= this.scrollBot) {
      write(ansi.scrollRegion(this.scrollTop, this.scrollBot));
    }

    // Position cursor at top of output area
    write(ansi.move(this.scrollTop, 1));
    write(ansi.showCursor);
  }

  // ── Banner repaint (in-place, preserves output area) ────────────────────────

  private repaintBanner(): void {
    write(ansi.hideCursor);
    for (let i = 0; i < this.bannerLines.length; i++) {
      write(ansi.move(i + 1, 1) + ansi.clearToEol + this.bannerLines[i]);
    }
    // Separator
    const sepRow = this.bannerLines.length + 1;
    write(
      ansi.move(sepRow, 1) +
        ansi.clearToEol +
        chalk.dim("─".repeat(this.termCols))
    );
    write(ansi.showCursor);
  }

  // ── Input line ───────────────────────────────────────────────────────────────

  private drawInputLine(): void {
    write(ansi.move(this.inputRow, 1) + ansi.clearLine);
    write(PROMPT_TEXT + this.inputBuffer);
    // Place cursor at correct position within the input
    write(ansi.move(this.inputRow, PROMPT_VIS + 1 + this.cursorPos));
  }

  // ── Key handler ──────────────────────────────────────────────────────────────

  private readonly boundKeyHandler = (key: string): void => {
    if (this.commandRunning) return;
    this.handleKey(key);
  };

  private handleKey(key: string): void {
    // Ctrl+C
    if (key === "\u0003") {
      this.exitGracefully();
      return;
    }
    // Ctrl+L — refresh
    if (key === "\u000C") {
      this.setupScreen();
      this.drawInputLine();
      return;
    }
    // Enter
    if (key === "\r" || key === "\n") {
      void this.submit();
      return;
    }
    // Backspace
    if (key === "\u007F" || key === "\b") {
      if (this.cursorPos > 0) {
        this.inputBuffer =
          this.inputBuffer.slice(0, this.cursorPos - 1) +
          this.inputBuffer.slice(this.cursorPos);
        this.cursorPos--;
        this.drawInputLine();
      }
      return;
    }
    // Delete (forward)
    if (key === "\x1b[3~") {
      if (this.cursorPos < this.inputBuffer.length) {
        this.inputBuffer =
          this.inputBuffer.slice(0, this.cursorPos) +
          this.inputBuffer.slice(this.cursorPos + 1);
        this.drawInputLine();
      }
      return;
    }
    // Up arrow — history prev
    if (key === "\x1b[A") {
      if (this.historyIdx === -1) {
        this.historyTemp = this.inputBuffer;
        this.historyIdx = this.history.length - 1;
      } else if (this.historyIdx > 0) {
        this.historyIdx--;
      }
      if (this.historyIdx >= 0) {
        this.inputBuffer = this.history[this.historyIdx];
        this.cursorPos = this.inputBuffer.length;
        this.drawInputLine();
      }
      return;
    }
    // Down arrow — history next
    if (key === "\x1b[B") {
      if (this.historyIdx >= 0) {
        this.historyIdx++;
        if (this.historyIdx >= this.history.length) {
          this.historyIdx = -1;
          this.inputBuffer = this.historyTemp;
        } else {
          this.inputBuffer = this.history[this.historyIdx];
        }
        this.cursorPos = this.inputBuffer.length;
        this.drawInputLine();
      }
      return;
    }
    // Right arrow
    if (key === "\x1b[C") {
      if (this.cursorPos < this.inputBuffer.length) {
        this.cursorPos++;
        this.drawInputLine();
      }
      return;
    }
    // Left arrow
    if (key === "\x1b[D") {
      if (this.cursorPos > 0) {
        this.cursorPos--;
        this.drawInputLine();
      }
      return;
    }
    // Home / Ctrl+A
    if (key === "\x1b[H" || key === "\u0001") {
      this.cursorPos = 0;
      this.drawInputLine();
      return;
    }
    // End / Ctrl+E
    if (key === "\x1b[F" || key === "\u0005") {
      this.cursorPos = this.inputBuffer.length;
      this.drawInputLine();
      return;
    }
    // Ctrl+U — clear line
    if (key === "\u0015") {
      this.inputBuffer = "";
      this.cursorPos = 0;
      this.drawInputLine();
      return;
    }
    // Ctrl+K — kill to end
    if (key === "\u000B") {
      this.inputBuffer = this.inputBuffer.slice(0, this.cursorPos);
      this.drawInputLine();
      return;
    }
    // Tab — completion
    if (key === "\t") {
      this.handleTab();
      return;
    }
    // Printable characters
    if (key >= " " && !key.startsWith("\x1b")) {
      this.inputBuffer =
        this.inputBuffer.slice(0, this.cursorPos) +
        key +
        this.inputBuffer.slice(this.cursorPos);
      this.cursorPos += key.length;
      this.drawInputLine();
    }
  }

  // ── Tab completion ───────────────────────────────────────────────────────────

  private handleTab(): void {
    const completions = getCompletions(
      this.inputBuffer,
      this.topCmds,
      this.subCmds
    );
    if (completions.length === 0) return;

    if (completions.length === 1) {
      this.inputBuffer = completions[0] + " ";
      this.cursorPos = this.inputBuffer.length;
      this.drawInputLine();
      return;
    }

    // Find common prefix
    const common = completions.reduce((a, b) => {
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      return a.slice(0, i);
    });
    if (common.length > this.inputBuffer.trimStart().length) {
      this.inputBuffer = common;
      this.cursorPos = common.length;
    }

    // Show options in output area
    this.writeOutput("\n" + chalk.dim(completions.join("   ")) + "\n");
    this.drawInputLine();
  }

  // ── Write to output area ─────────────────────────────────────────────────────

  private writeOutput(text: string): void {
    // Move cursor to bottom of scroll region to ensure scroll-down works
    write(ansi.move(this.scrollBot, 1));
    write(text);
  }

  // ── Submit line ──────────────────────────────────────────────────────────────

  private async submit(): Promise<void> {
    const input = this.inputBuffer.trim();
    this.inputBuffer = "";
    this.cursorPos = 0;
    this.historyIdx = -1;

    if (!input) {
      this.drawInputLine();
      return;
    }

    // Add to history
    if (input !== this.history[this.history.length - 1]) {
      this.history.push(input);
    }

    // Echo the input into the output area
    this.writeOutput(
      "\n" + chalk.dim("◈ ") + chalk.white(input) + "\n"
    );

    // ── Built-in commands ──────────────────────────────────────────────────────

    if (input === "exit" || input === "quit") {
      this.exitGracefully();
      return;
    }

    if (input === "clear") {
      this.bannerCfg = await loadBannerConfig();
      this.setupScreen();
      this.drawInputLine();
      return;
    }

    if (input === "status") {
      await this.runStatus();
      this.afterCommand();
      return;
    }

    if (input === "help" || input === "/help") {
      await this.runHelp();
      this.afterCommand();
      return;
    }

    // ── /chat prefix — explicit chat route ────────────────────────────────────

    if (input.startsWith("/chat ") || input === "/chat") {
      const msg = input.slice(6).trim();
      if (msg) {
        this.commandRunning = true;
        await this.sendChat(msg);
        this.commandRunning = false;
      }
      this.afterCommand();
      return;
    }

    // ── Chat mode detection ────────────────────────────────────────────────────

    const firstWord = input.split(/\s+/)[0];
    const allKnown = [...BUILTIN_CMDS, ...this.topCmds];
    if (!allKnown.includes(firstWord)) {
      this.commandRunning = true;
      await this.sendChat(input);
      this.commandRunning = false;
      this.afterCommand();
      return;
    }

    // ── Dispatch to commander ──────────────────────────────────────────────────

    this.commandRunning = true;
    // Move output cursor to bottom of scroll region
    write(ansi.move(this.scrollBot, 1));

    // Suspend TUI stdin so interactive commands (prompts, readline) work cleanly
    process.stdin.removeListener("data", this.boundKeyHandler);

    const tokens = parseTokens(input);
    const prog = createProgram();
    prog.exitOverride();
    prog.configureOutput({
      writeOut: (str) => process.stdout.write(str),
      writeErr: (str) => process.stderr.write(str),
    });

    const origExit = process.exit;
    (process as NodeJS.Process).exit = ((code?: number) => {
      throw new REPLExitSignal(code ?? 0);
    }) as typeof process.exit;

    try {
      await prog.parseAsync(["node", "arc402", ...tokens]);
    } catch (err) {
      if (err instanceof REPLExitSignal) {
        // Command called process.exit() — normal
      } else {
        const e = err as { code?: string; message?: string };
        if (
          e.code === "commander.helpDisplayed" ||
          e.code === "commander.version"
        ) {
          // already written
        } else if (e.code === "commander.unknownCommand") {
          process.stdout.write(
            `\n ${c.failure} ${chalk.red(`Unknown command: ${chalk.white(tokens[0])}`)} \n`
          );
          process.stdout.write(
            chalk.dim("  Type 'help' for available commands\n")
          );
        } else if (e.code?.startsWith("commander.")) {
          process.stdout.write(
            `\n ${c.failure} ${chalk.red(e.message ?? String(err))}\n`
          );
        } else {
          process.stdout.write(
            `\n ${c.failure} ${chalk.red(e.message ?? String(err))}\n`
          );
        }
      }
    } finally {
      (process as NodeJS.Process).exit = origExit;
    }

    // Restore raw mode + our listener (interactive commands may have toggled it)
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.on("data", this.boundKeyHandler);
    this.commandRunning = false;

    this.afterCommand();
  }

  // ── OpenClaw chat ─────────────────────────────────────────────────────────────

  private async sendChat(message: string): Promise<void> {
    write(ansi.move(this.scrollBot, 1));

    let res: Response;
    try {
      res = await fetch("http://localhost:19000/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, session: "arc402-repl" }),
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
        process.stdout.write(
          "\n " +
            chalk.yellow("⚠") +
            " " +
            chalk.dim("OpenClaw gateway not running. Start with: ") +
            chalk.white("openclaw gateway start") +
            "\n"
        );
      } else {
        process.stdout.write(
          "\n " + c.failure + " " + chalk.red(msg) + "\n"
        );
      }
      return;
    }

    if (!res.body) {
      process.stdout.write(
        "\n" + chalk.dim(" ◈ ") + chalk.white("(empty response)") + "\n"
      );
      return;
    }

    process.stdout.write("\n");

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
        process.stdout.write(chalk.dim(" ◈ ") + chalk.white(line) + "\n");
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
  }

  // ── After each command: repaint banner + input ───────────────────────────────

  private afterCommand(): void {
    this.repaintBanner();
    this.drawInputLine();
  }

  // ── Built-in: status ─────────────────────────────────────────────────────────

  private async runStatus(): Promise<void> {
    write(ansi.move(this.scrollBot, 1));
    if (!fs.existsSync(CONFIG_PATH)) {
      process.stdout.write(
        chalk.dim("\n  No config found. Run 'config init' to get started.\n")
      );
      return;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as {
        network?: string;
        walletContractAddress?: string;
        rpcUrl?: string;
      };
      process.stdout.write("\n");
      if (raw.network)
        process.stdout.write(
          ` ${chalk.dim("Network")}   ${chalk.white(raw.network)}\n`
        );
      if (raw.walletContractAddress) {
        const w = raw.walletContractAddress;
        process.stdout.write(
          ` ${chalk.dim("Wallet")}    ${chalk.white(`${w.slice(0, 6)}...${w.slice(-4)}`)}\n`
        );
      }
      if (raw.rpcUrl && raw.walletContractAddress) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const ethersLib = require("ethers") as typeof import("ethers");
          const provider = new ethersLib.ethers.JsonRpcProvider(raw.rpcUrl);
          const bal = await Promise.race([
            provider.getBalance(raw.walletContractAddress),
            new Promise<never>((_, r) =>
              setTimeout(() => r(new Error("timeout")), 2000)
            ),
          ]);
          process.stdout.write(
            ` ${chalk.dim("Balance")}   ${chalk.white(
              `${parseFloat(ethersLib.ethers.formatEther(bal)).toFixed(4)} ETH`
            )}\n`
          );
        } catch {
          /* skip */
        }
      }
      process.stdout.write("\n");
    } catch {
      /* skip */
    }
  }

  // ── Built-in: help ────────────────────────────────────────────────────────────

  private async runHelp(): Promise<void> {
    write(ansi.move(this.scrollBot, 1));
    process.stdin.removeListener("data", this.boundKeyHandler);
    const prog = createProgram();
    prog.exitOverride();
    prog.configureOutput({
      writeOut: (str) => process.stdout.write(str),
      writeErr: (str) => process.stderr.write(str),
    });
    try {
      await prog.parseAsync(["node", "arc402", "--help"]);
    } catch {
      /* commander throws after printing help */
    }
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.on("data", this.boundKeyHandler);

    process.stdout.write("\n");
    process.stdout.write(chalk.cyanBright("Chat") + "\n");
    process.stdout.write(
      "  " +
        chalk.white("<message>") +
        chalk.dim("          Send message to OpenClaw gateway\n")
    );
    process.stdout.write(
      "  " +
        chalk.white("/chat <message>") +
        chalk.dim("   Explicitly route to chat\n")
    );
    process.stdout.write(
      chalk.dim(
        "  Gateway: http://localhost:19000  (openclaw gateway start)\n"
      )
    );
    process.stdout.write("\n");
  }

  // ── Exit ──────────────────────────────────────────────────────────────────────

  private exitGracefully(): void {
    write(ansi.move(this.inputRow, 1) + ansi.clearLine);
    write(" " + chalk.cyanBright("◈") + chalk.dim(" goodbye") + "\n");
    write(ansi.resetScroll);
    write(ansi.showCursor);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.exit(0);
  }
}

// ─── REPL entry point ─────────────────────────────────────────────────────────

export async function startREPL(): Promise<void> {
  if (!process.stdout.isTTY) {
    // Non-TTY (piped): fall back to minimal line-mode output
    const bannerCfg = await loadBannerConfig();
    for (const line of getBannerLines(bannerCfg)) {
      process.stdout.write(line + "\n");
    }
    process.stdout.write(
      "Interactive TUI requires a TTY. Use arc402 <command> directly.\n"
    );
    return;
  }

  const tui = new TUI();
  await tui.start();
}
