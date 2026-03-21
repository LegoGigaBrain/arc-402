#!/usr/bin/env node
import { createProgram } from "./program";
import { startREPL } from "./repl";

const printMode = process.argv.includes("--print");

if (printMode) {
  // --print mode: skip REPL entirely, suppress ANSI/spinners, run command, exit.
  // Used by OpenClaw agents running arc402 commands via ACP.
  process.argv = process.argv.filter((a) => a !== "--print");
  process.env["NO_COLOR"] = "1";
  process.env["FORCE_COLOR"] = "0";
  process.env["ARC402_PRINT"] = "1";
  const program = createProgram();
  void program.parseAsync(process.argv).then(() => process.exit(0)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
} else if (process.argv.length <= 2) {
  // No subcommand — enter interactive REPL
  void startREPL();
} else {
  // One-shot mode — arc402 wallet deploy still works as usual
  const program = createProgram();
  program.parse(process.argv);
}
