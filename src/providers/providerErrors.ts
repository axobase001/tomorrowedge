import { redactText } from "../safety/secretScanner.js";

export type ProviderErrorCategory =
  | "rate_limited"
  | "quota_exhausted"
  | "upstream_unavailable"
  | "invalid_model"
  | "invalid_key"
  | "network"
  | "timeout"
  | "configuration"
  | "unknown";

export type ProviderErrorDiagnostic = {
  category: ProviderErrorCategory;
  message: string;
  retryable: boolean;
  skipLiveCalls: boolean;
  statusCode?: number;
};

export function redactProviderError(error: unknown): string {
  return redactText(providerErrorText(error));
}

export function classifyProviderError(error: unknown): ProviderErrorDiagnostic {
  const raw = providerErrorText(error);
  const lower = raw.toLowerCase();
  const statusCode = extractStatusCode(raw);
  const message = redactText(raw);

  if (/disabled because api key or base url is missing|not configured|provider .* unavailable|missing .*api key|base url is missing/i.test(raw)) {
    return diagnostic("configuration", message, false, true, statusCode);
  }
  if (statusCode === 401 || /\bunauthorized\b|invalid api key|invalid key|api key is invalid|no auth credentials|authentication/i.test(lower)) {
    return diagnostic("invalid_key", message, false, true, statusCode);
  }
  if (statusCode === 403 && /api key|auth|forbidden|permission|organization|project/i.test(lower)) {
    return diagnostic("invalid_key", message, false, true, statusCode);
  }
  if (statusCode === 429 && /quota|insufficient[_ -]?quota|credits?|free-models-per-day|daily.*limit|exhausted|out of balance/i.test(lower)) {
    return diagnostic("quota_exhausted", message, false, true, statusCode);
  }
  if (statusCode === 429 || /rate[- ]?limit|too many requests|free-models-per-minute|requests per/i.test(lower)) {
    return diagnostic("rate_limited", message, true, true, statusCode);
  }
  if (
    (statusCode !== undefined && [400, 404].includes(statusCode) && /model|endpoint/i.test(lower)) ||
    /invalid model|model .*not found|unknown model|no endpoints? found|not a valid model|model id/i.test(lower)
  ) {
    return diagnostic("invalid_model", message, false, true, statusCode);
  }
  if (/timed out|timeout|aborted/i.test(lower)) {
    return diagnostic("timeout", message, true, true, statusCode);
  }
  if (/network|fetch failed|econnreset|etimedout|econnrefused|enotfound|socket/i.test(lower)) {
    return diagnostic("network", message, true, true, statusCode);
  }
  if ((statusCode !== undefined && statusCode >= 500) || /upstream|service unavailable|temporarily unavailable|overloaded|bad gateway|gateway timeout/i.test(lower)) {
    return diagnostic("upstream_unavailable", message, true, true, statusCode);
  }
  return diagnostic("unknown", message, false, false, statusCode);
}

function diagnostic(
  category: ProviderErrorCategory,
  message: string,
  retryable: boolean,
  skipLiveCalls: boolean,
  statusCode?: number
): ProviderErrorDiagnostic {
  return { category, message, retryable, skipLiveCalls, statusCode };
}

function providerErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function extractStatusCode(raw: string): number | undefined {
  const patterns = [
    /request failed:\s*(\d{3})/i,
    /\bHTTP\s+(\d{3})\b/i,
    /\bstatus(?:Code|\s+code)?["']?\s*[:=]\s*["']?(\d{3})/i,
    /"status"\s*:\s*(\d{3})/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(raw);
    if (match) return Number(match[1]);
  }
  return undefined;
}
