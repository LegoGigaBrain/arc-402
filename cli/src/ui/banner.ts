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

/** Returns banner as an array of plain lines (no trailing newlines). */
export function getBannerLines(config?: BannerConfig): string[] {
  const lines: string[] = [];
  // ART has a leading newline — skip it
  for (const l of ART.split("\n").slice(1)) {
    lines.push(chalk.cyan(l));
  }
  lines.push("");
  lines.push(" " + chalk.dim(`agent-to-agent arcing · v${_pkg.version}`));
  lines.push(" " + SEPARATOR);
  if (config) {
    lines.push("");
    if (config.network)
      lines.push(` ${chalk.dim("Network")}   ${chalk.white(config.network)}`);
    if (config.wallet)
      lines.push(` ${chalk.dim("Wallet")}    ${chalk.white(config.wallet)}`);
    if (config.balance)
      lines.push(` ${chalk.dim("Balance")}   ${chalk.white(config.balance)}`);
  }
  lines.push("");
  lines.push(` ${chalk.dim("Type 'help' to get started")}`);
  lines.push("");
  return lines;
}

export function renderBanner(config?: BannerConfig): void {
  for (const line of getBannerLines(config)) {
    console.log(line);
  }
}
