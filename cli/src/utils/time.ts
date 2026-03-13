export function parseDuration(duration: string): number {
  const now = Math.floor(Date.now() / 1000);
  const match = duration.match(/^(\d+)([hd])$/i);
  if (!match) throw new Error(`Invalid duration format: \"${duration}\". Use e.g. 2h, 24h, 7d`);
  const value = Number(match[1]);
  return now + (match[2].toLowerCase() === "d" ? value * 86400 : value * 3600);
}

export function formatDeadline(deadline: number): string {
  const diff = deadline - Math.floor(Date.now() / 1000);
  if (diff < 0) return "EXPIRED";
  const hours = Math.floor(diff / 3600);
  const days = Math.floor(hours / 24);
  return days > 0 ? `${days}d ${hours % 24}h remaining` : `${hours}h remaining`;
}
