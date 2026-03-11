/**
 * Parse a duration string like "2h", "24h", "7d" into a Unix timestamp
 * (current time + duration).
 */
export function parseDuration(duration: string): number {
  const now = Math.floor(Date.now() / 1000);
  const match = duration.match(/^(\d+)([hd])$/i);
  if (!match) {
    throw new Error(
      `Invalid duration format: "${duration}". Use e.g. 2h, 24h, 7d`
    );
  }
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit === "h") return now + value * 3600;
  if (unit === "d") return now + value * 86400;
  throw new Error(`Unknown unit: ${unit}`);
}

export function formatDeadline(deadline: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = deadline - now;
  if (diff < 0) return "EXPIRED";
  const hours = Math.floor(diff / 3600);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h remaining`;
  return `${hours}h remaining`;
}
