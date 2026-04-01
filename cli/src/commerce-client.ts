import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DAEMON_DIR, DAEMON_TOML, loadDaemonConfig } from "./daemon/config";

export interface X402PaymentRequirement {
  receiver?: string;
  amount?: string;
  currency?: string;
  network?: string;
  description?: string;
}

export interface SubscriptionOfferHint {
  plan?: string;
  rate?: string;
  endpoint?: string;
}

export interface CommerceGatewayInspection {
  url: string;
  status: number;
  ok: boolean;
  paymentRequired: boolean;
  paymentOptions: string[];
  x402?: X402PaymentRequirement;
  subscription?: SubscriptionOfferHint;
}

export interface NewsletterIssueFetchOptions {
  signer?: string;
  signature?: string;
  apiToken?: string;
}

export interface NewsletterIssueFetchResult extends CommerceGatewayInspection {
  body?: string;
  contentType?: string;
}

export interface DaemonWalletStatus {
  ok: boolean;
  wallet: string;
  daemonId: string;
  chainId: number;
  rpcUrl: string;
  policyEngineAddress: string;
}

export interface DaemonWorkroomStatus {
  ok: boolean;
  status: string;
}

export interface DaemonHealthStatus {
  ok: boolean;
  wallet: string;
}

export interface DaemonAgreementsResponse {
  ok: boolean;
  agreements: Array<Record<string, unknown>>;
}

export interface DaemonCommerceClientOptions {
  baseUrl?: string;
  token?: string;
}

function header(headers: Headers, key: string): string | undefined {
  const value = headers.get(key);
  return value === null || value.trim() === "" ? undefined : value.trim();
}

export function parseCommerceHeaders(url: string, status: number, headers: Headers): CommerceGatewayInspection {
  const paymentOptions = (header(headers, "x-payment-options") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const x402: X402PaymentRequirement = {
    receiver: header(headers, "x-x402-receiver"),
    amount: header(headers, "x-x402-amount"),
    currency: header(headers, "x-x402-currency"),
    network: header(headers, "x-x402-network"),
    description: header(headers, "x-x402-description"),
  };

  const subscription: SubscriptionOfferHint = {
    plan: header(headers, "x-subscription-plan"),
    rate: header(headers, "x-subscription-rate"),
    endpoint: header(headers, "x-subscription-endpoint"),
  };

  return {
    url,
    status,
    ok: status >= 200 && status < 300,
    paymentRequired: (header(headers, "x-payment-required") ?? "").toLowerCase() === "true" || status === 402,
    paymentOptions,
    x402: Object.values(x402).some(Boolean) ? x402 : undefined,
    subscription: Object.values(subscription).some(Boolean) ? subscription : undefined,
  };
}

export async function inspectCommerceEndpoint(
  url: string,
  init?: RequestInit
): Promise<CommerceGatewayInspection> {
  const response = await fetch(url, {
    method: init?.method ?? "GET",
    redirect: "manual",
    ...init,
  });
  return parseCommerceHeaders(url, response.status, response.headers);
}

export function buildNewsletterAccessMessage(newsletterId: string, issueHash: string): string {
  return `arc402:newsletter:${newsletterId}:${issueHash}`;
}

export async function fetchNewsletterIssue(
  baseUrl: string,
  newsletterId: string,
  issueHash: string,
  options: NewsletterIssueFetchOptions = {}
): Promise<NewsletterIssueFetchResult> {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const url = `${normalizedBase}/newsletter/${encodeURIComponent(newsletterId)}/issues/${encodeURIComponent(issueHash)}`;
  const headers: Record<string, string> = {};

  if (options.apiToken) {
    headers.Authorization = `Bearer ${options.apiToken}`;
  }
  if (options.signer) {
    headers["X-ARC402-Signer"] = options.signer;
  }
  if (options.signature) {
    headers["X-ARC402-Signature"] = options.signature;
  }

  const response = await fetch(url, { method: "GET", headers });
  const inspection = parseCommerceHeaders(url, response.status, response.headers);

  return {
    ...inspection,
    body: response.ok ? await response.text() : undefined,
    contentType: header(response.headers, "content-type"),
  };
}

const DAEMON_TOKEN_FILE = path.join(DAEMON_DIR, "daemon.token");

function trimTrailingSlash(input: string): string {
  return input.replace(/\/$/, "");
}

export function loadLocalDaemonToken(): string | undefined {
  try {
    const token = fs.readFileSync(DAEMON_TOKEN_FILE, "utf-8").trim();
    return token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}

export function resolveDaemonApiBaseUrl(explicitBaseUrl?: string): string {
  if (explicitBaseUrl && explicitBaseUrl.trim().length > 0) {
    return trimTrailingSlash(explicitBaseUrl.trim());
  }

  if (fs.existsSync(DAEMON_TOML)) {
    try {
      const daemonConfig = loadDaemonConfig();
      const port = (daemonConfig.relay.listen_port ?? 4402) + 1;
      return `http://127.0.0.1:${port}`;
    } catch {
      // Fall through to the default local API port.
    }
  }

  return "http://127.0.0.1:4403";
}

async function daemonJsonRequest<T>(
  urlPath: string,
  options: DaemonCommerceClientOptions = {}
): Promise<T> {
  const baseUrl = resolveDaemonApiBaseUrl(options.baseUrl);
  const token = options.token ?? loadLocalDaemonToken();
  const headers: Record<string, string> = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${urlPath}`, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Daemon request failed (${response.status})`);
  }

  return await response.json() as T;
}

export async function fetchDaemonHealth(
  options: DaemonCommerceClientOptions = {}
): Promise<DaemonHealthStatus> {
  return await daemonJsonRequest<DaemonHealthStatus>("/health", options);
}

export async function fetchDaemonWalletStatus(
  options: DaemonCommerceClientOptions = {}
): Promise<DaemonWalletStatus> {
  return await daemonJsonRequest<DaemonWalletStatus>("/wallet/status", options);
}

export async function fetchDaemonWorkroomStatus(
  options: DaemonCommerceClientOptions = {}
): Promise<DaemonWorkroomStatus> {
  return await daemonJsonRequest<DaemonWorkroomStatus>("/workroom/status", options);
}

export async function fetchDaemonAgreements(
  options: DaemonCommerceClientOptions = {}
): Promise<DaemonAgreementsResponse> {
  return await daemonJsonRequest<DaemonAgreementsResponse>("/agreements", options);
}

export function getDaemonTokenPath(): string {
  return path.join(os.homedir(), ".arc402", "daemon.token");
}
