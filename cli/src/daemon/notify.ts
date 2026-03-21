/**
 * Multi-channel notification module for daemon events.
 * Supports Telegram, Discord webhooks, generic webhooks, and email (via nodemailer).
 */
import * as https from "https";
import * as http from "http";
import type { DaemonConfig } from "./config";

export type NotifyEvent =
  | "hire_request"
  | "hire_accepted"
  | "hire_rejected"
  | "delivery"
  | "dispute"
  | "channel_challenge"
  | "low_balance"
  | "daemon_started"
  | "daemon_stopped";

// ─── Channel interface ────────────────────────────────────────────────────────

export interface NotificationChannel {
  send(title: string, body: string): Promise<void>;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function httpPost(url: string, payload: string, extraHeaders: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...extraHeaders,
      },
    };
    const req = mod.request(options, (res) => {
      res.resume();
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ─── Telegram channel ─────────────────────────────────────────────────────────

export class TelegramChannel implements NotificationChannel {
  constructor(private botToken: string, private chatId: string) {}

  async send(title: string, body: string): Promise<void> {
    const text = body ? `<b>${title}</b>\n${body}` : `<b>${title}</b>`;
    const payload = JSON.stringify({ chat_id: this.chatId, text, parse_mode: "HTML" });
    const options: https.RequestOptions = {
      hostname: "api.telegram.org",
      port: 443,
      path: `/bot${this.botToken}/sendMessage`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };
    await new Promise<void>((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (c: Buffer) => { data += c.toString(); });
        res.on("end", () => {
          const parsed = JSON.parse(data) as { ok: boolean; description?: string };
          if (!parsed.ok) {
            reject(new Error(`Telegram API error: ${parsed.description}`));
          } else {
            resolve();
          }
        });
      });
      req.on("error", reject);
      req.write(payload);
      req.end();
    });
  }
}

// ─── Discord channel ──────────────────────────────────────────────────────────

export class DiscordChannel implements NotificationChannel {
  constructor(private webhookUrl: string) {}

  async send(title: string, body: string): Promise<void> {
    const content = body ? `**${title}**\n${body}` : `**${title}**`;
    await httpPost(this.webhookUrl, JSON.stringify({ content }), {});
  }
}

// ─── Generic webhook channel ──────────────────────────────────────────────────

export class WebhookChannel implements NotificationChannel {
  constructor(private url: string, private headers: Record<string, string> = {}) {}

  async send(title: string, body: string): Promise<void> {
    await httpPost(
      this.url,
      JSON.stringify({ title, body, timestamp: new Date().toISOString() }),
      this.headers
    );
  }
}

// ─── Email channel (optional — requires nodemailer) ───────────────────────────

export class EmailChannel implements NotificationChannel {
  constructor(private cfg: {
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPass: string;
    to: string;
  }) {}

  async send(title: string, body: string): Promise<void> {
    // nodemailer is an optional runtime dependency — load via require to skip
    // compile-time module resolution. Throws a clear message if not installed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    let nodemailer: any;
    try {
      // Using Function constructor avoids TypeScript static import analysis.
      nodemailer = (new Function("require", "return require('nodemailer')"))(require);
    } catch {
      throw new Error("nodemailer is not installed. Run: npm install nodemailer");
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const transport = nodemailer.createTransport({
      host: this.cfg.smtpHost,
      port: this.cfg.smtpPort,
      auth: { user: this.cfg.smtpUser, pass: this.cfg.smtpPass },
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await transport.sendMail({
      from: this.cfg.smtpUser,
      to: this.cfg.to,
      subject: title,
      text: body,
    });
  }
}

// ─── Notifier ─────────────────────────────────────────────────────────────────

export class Notifier {
  private channels: NotificationChannel[];
  private notifyFlags: Record<NotifyEvent, boolean>;

  constructor(
    channels: NotificationChannel[],
    flags: Partial<Record<NotifyEvent, boolean>> = {}
  ) {
    this.channels = channels;
    this.notifyFlags = {
      hire_request: flags.hire_request ?? true,
      hire_accepted: flags.hire_accepted ?? true,
      hire_rejected: flags.hire_rejected ?? true,
      delivery: flags.delivery ?? true,
      dispute: flags.dispute ?? true,
      channel_challenge: flags.channel_challenge ?? true,
      low_balance: flags.low_balance ?? true,
      daemon_started: true,
      daemon_stopped: true,
    };
  }

  isEnabled(): boolean {
    return this.channels.length > 0;
  }

  async send(event: NotifyEvent, title: string, body: string): Promise<void> {
    if (!this.notifyFlags[event]) return;
    await Promise.all(
      this.channels.map(async (ch) => {
        try {
          await ch.send(title, body);
        } catch (err) {
          process.stderr.write(`[notify] Channel send failed: ${err}\n`);
        }
      })
    );
  }

  async notifyHireRequest(hireId: string, hirerAddress: string, priceEth: string, capability: string): Promise<void> {
    const short = hirerAddress.slice(0, 10);
    await this.send("hire_request", "Hire Request", [
      `ID: ${hireId}`,
      `From: ${short}...`,
      `Capability: ${capability || "unspecified"}`,
      `Price: ${priceEth} ETH`,
      ``,
      `Approve: arc402 daemon approve ${hireId}`,
      `Reject:  arc402 daemon reject ${hireId}`,
    ].join("\n"));
  }

  async notifyHireAccepted(hireId: string, agreementId: string): Promise<void> {
    await this.send("hire_accepted", "Hire Accepted",
      `ID: ${hireId}\nAgreement: ${agreementId}`
    );
  }

  async notifyHireRejected(hireId: string, reason: string): Promise<void> {
    await this.send("hire_rejected", "Hire Rejected",
      `ID: ${hireId}\nReason: ${reason}`
    );
  }

  async notifyDelivery(agreementId: string, deliveryHash: string, userOpHash: string): Promise<void> {
    await this.send("delivery", "Delivery Submitted", [
      `Agreement: ${agreementId}`,
      `Delivery hash: ${deliveryHash.slice(0, 16)}...`,
      `UserOp: ${userOpHash.slice(0, 16)}...`,
    ].join("\n"));
  }

  async notifyDispute(agreementId: string, raisedBy: string): Promise<void> {
    await this.send("dispute", "Dispute Raised",
      `Agreement: ${agreementId}\nBy: ${raisedBy}`
    );
  }

  async notifyChannelChallenge(channelId: string, txHash: string): Promise<void> {
    await this.send("channel_challenge", "Channel Challenged",
      `Channel: ${channelId.slice(0, 16)}...\nTx: ${txHash.slice(0, 16)}...`
    );
  }

  async notifyLowBalance(balanceEth: string, thresholdEth: string): Promise<void> {
    await this.send("low_balance", "Low Balance Alert",
      `Current: ${balanceEth} ETH\nThreshold: ${thresholdEth} ETH`
    );
  }

  async notifyStarted(walletAddress: string, subsystems: string[]): Promise<void> {
    await this.send("daemon_started", "ARC-402 Daemon Started",
      `Wallet: ${walletAddress}\nSubsystems: ${subsystems.join(", ")}`
    );
  }

  async notifyStopped(): Promise<void> {
    await this.send("daemon_stopped", "ARC-402 Daemon Stopped", "");
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function buildNotifier(config: DaemonConfig): Notifier {
  const notif = config.notifications;
  const channels: NotificationChannel[] = [];

  if (notif.telegram_bot_token && notif.telegram_chat_id) {
    channels.push(new TelegramChannel(notif.telegram_bot_token, notif.telegram_chat_id));
  }
  if (notif.discord?.webhook_url) {
    channels.push(new DiscordChannel(notif.discord.webhook_url));
  }
  if (notif.webhook?.url) {
    channels.push(new WebhookChannel(notif.webhook.url, notif.webhook.headers ?? {}));
  }
  if (notif.email?.smtp_host && notif.email?.smtp_user && notif.email?.to) {
    channels.push(new EmailChannel({
      smtpHost: notif.email.smtp_host,
      smtpPort: notif.email.smtp_port,
      smtpUser: notif.email.smtp_user,
      smtpPass: notif.email.smtp_pass,
      to: notif.email.to,
    }));
  }

  return new Notifier(channels, {
    hire_request: notif.notify_on_hire_request,
    hire_accepted: notif.notify_on_hire_accepted,
    hire_rejected: notif.notify_on_hire_rejected,
    delivery: notif.notify_on_delivery,
    dispute: notif.notify_on_dispute,
    channel_challenge: notif.notify_on_channel_challenge,
    low_balance: notif.notify_on_low_balance,
  });
}
