import chalk from "chalk";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const _pkg = require("../../package.json") as { version: string };

const ART = `
 ██████╗ ██████╗  ██████╗      ██╗  ██╗ ██████╗ ██████╗
 ██╔══██╗██╔══██╗██╔════╝      ██║  ██║██╔═══██╗╚════██╗
 ███████║██████╔╝██║     █████╗███████║██║   ██║ █████╔╝
 ██╔══██║██╔══██╗██║     ╚════╝╚════██║██║   ██║██╔═══╝
 ██║  ██║██║  ██║╚██████╗           ██║╚██████╔╝███████╗
 ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝          ╚═╝ ╚═════╝ ╚══════╝`;

const SEPARATOR = chalk.cyanBright("◈") + " " + chalk.dim("─".repeat(45));

export interface BannerConfig {
  network?: string;
  wallet?: string;
  balance?: string;
}

export function renderBanner(config?: BannerConfig): void {
  console.log(chalk.cyan(ART));
  console.log();
  console.log(" " + chalk.dim(`agent-to-agent arcing · v${_pkg.version}`));
  console.log(" " + SEPARATOR);

  if (config) {
    console.log();
    if (config.network) {
      console.log(` ${chalk.dim("Network")}   ${chalk.white(config.network)}`);
    }
    if (config.wallet) {
      console.log(` ${chalk.dim("Wallet")}    ${chalk.white(config.wallet)}`);
    }
    if (config.balance) {
      console.log(` ${chalk.dim("Balance")}   ${chalk.white(config.balance)}`);
    }
  }

  console.log();
  console.log(` ${chalk.dim("Type 'arc402 help' to get started")}`);
  console.log();
}
