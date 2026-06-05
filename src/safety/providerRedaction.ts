import { redactText, redactValue } from "./secretScanner.js";

export type ProviderErrorCategory =
  | "rate_limited"
  | "quota_exhausted"
  | "invalid_key"
  | "invalid_model"
  | "upstream_unavailable"
  | "unknown";

export type ProviderErrorReport = {
  category: ProviderErrorCategory;
  message: string;
  retryable: boolean;
  statusCode?: number;
};

export function redactProviderError(error: unknown): ProviderErrorReport {
  const raw = error instanceof Error ? error.message : String(error);
  const message = redactText(raw);
  const statusCode = extractStatusCode(raw);
  const category = classifyProviderError(raw, statusCode);
  return {
    category,
    message,
    retryable: category === "rate_limited" || category === "upstream_unavailable",
    statusCode
  };
}

export function formatProviderError(report: ProviderErrorReport): string {
  const status = report.statusCode ? ` HTTP ${report.statusCode}` : "";
  return `${report.category}${status}: ${report.message}`;
}

export function shouldSkipAfterProviderError(category: ProviderErrorCategory): boolean {
  return category === "rate_limited" || category === "quota_exhausted";
}

export function redactSessionRecord<T>(record: T): T {
  return redactValue(record);
}

export function classifyProviderError(raw: string, statusCode?: number): ProviderErrorCategory {
  const text = raw.toLowerCase();
  if (/\bquota\b|insufficient[_ -]?quota|billing|credits?|free[_ -]?limit|usage[_ -]?limit|limit exceeded/.test(text)) {
    return "quota_exhausted";
  }
  if (statusCode === 429 || /rate[_ -]?limit|too many requests|temporarily rate-limited|throttl/.test(text)) {
    return "rate_limited";
  }
  if (statusCode === 401 || statusCode === 403 || /invalid api key|unauthori[sz]ed|forbidden|authentication/.test(text)) {
    return "invalid_key";
  }
  if (statusCode === 404 || /invalid model|model not found|no endpoints? found|unknown model/.test(text)) {
    return "invalid_model";
  }
  if ((statusCode && statusCode >= 500) || /upstream|timeout|timed out|temporarily unavailable|bad gateway|service unavailable|gateway timeout|fetch failed|econnreset|etimedout/.test(text)) {
    return "upstream_unavailable";
  }
  return "unknown";
}

function extractStatusCode(raw: string): number | undefined {
  const match = raw.match(/\b(?:HTTP\s*)?([1-5][0-9]{2})\b/i);
  if (!match) return undefined;
  return Number(match[1]);
}
