import { Command } from "commander";
import { c } from "../ui/colors";
import { loadConfig } from "../config";

export function registerWatchCommand(program: Command): void {
  program
    .command("watch")
    .description("Watch wallet activity in real-time")
    .action(async () => {
      const config = loadConfig();
      const wallet = config.walletContractAddress ?? "(no wallet)";
      const shortWallet = wallet.length > 10
        ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}`
        : wallet;
      const line = "─".repeat(20);

      console.log(`${c.mark}  ARC-402  Watching ${c.white(shortWallet)} ${c.dim(line)}`);
      console.log(`${c.dim("···")}  ${c.dim("waiting")}`);

      // Keep process alive
      process.stdin.resume();
    });
}
