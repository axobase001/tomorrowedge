import type { CockpitProviderConnectionResult } from "./api.js";
import type { Translator } from "./i18n.js";

export function formatProviderConnectionMessage(result: CockpitProviderConnectionResult, t: Translator): string {
  switch (result.reason) {
    case "provider_disabled":
      return t("providerTest.providerDisabled");
    case "offline_provider":
      return t("providerTest.offlineProvider");
    case "base_url_missing":
      return t("providerTest.baseUrlMissing");
    case "missing_key":
      return t("providerTest.missingKey", { env: result.apiKeyEnv ?? "API key" });
    case "model_missing":
      return t("providerTest.modelMissing");
    case "invalid_authentication":
      return t("providerTest.invalidAuth", { env: result.apiKeyEnv ?? "API key" });
    case "invalid_model":
      return t("providerTest.invalidModel", { model: result.testedModel ?? "selected model" });
    case "endpoint_not_found":
      return t("providerTest.endpointNotFound");
    case "rate_limited":
      return t("providerTest.rateLimited");
    case "quota_exhausted":
      return t("providerTest.quotaExceeded");
    case "upstream_unavailable":
      return t("providerTest.upstreamUnavailable");
    case "connection_failed":
      return t("providerTest.connectionFailed", { message: result.detail });
    case "http_error":
      return t("providerTest.httpError", { status: String(result.httpStatus ?? "unknown") });
    default:
      return result.detail;
  }
}
