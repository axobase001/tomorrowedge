import { useEffect, useMemo, useState } from "react";
import type { CockpitProviderConnectionResult, CockpitSetupRequest, CockpitSetupStatus } from "../api.js";
import type { Translator } from "../i18n.js";
import { formatProviderConnectionMessage } from "../providerConnectionMessage.js";
import { hasProviderRuntimeErrors, numericDraft, providerRuntimeErrors } from "../providerRuntimeValidation.js";
import { ModalSurface } from "./ModalSurface.js";
import { EmptyState, LoadingState } from "./StateNotice.js";
import { suggestedModelForProvider } from "../../../providers/staticModels.js";

type SetupWizardProps = {
  setupStatus?: CockpitSetupStatus;
  busy: boolean;
  message?: string;
  connectionResult?: CockpitProviderConnectionResult;
  t: Translator;
  onConfigure: (request: CockpitSetupRequest) => void;
  onTest: (provider: string) => void;
  onDismissDemo: () => void;
};

export function SetupWizard({
  setupStatus,
  busy,
  message,
  connectionResult,
  t,
  onConfigure,
  onTest,
  onDismissDemo
}: SetupWizardProps) {
  const providers = useMemo(() => setupStatus?.providers.filter((provider) => provider.authRequired) ?? [], [setupStatus]);
  const recommended = setupStatus?.recommendedProvider ?? "openrouter";
  const initialProvider = setupStatus?.selectedProvider ?? recommended;
  const [provider, setProvider] = useState(initialProvider);
  const normalizedProvider = normalizeProviderId(provider);
  const selectedProvider = providers.find((item) => item.id === normalizedProvider);
  const initialProviderDefaults = selectedProvider ?? providers[0];
  const [model, setModel] = useState(setupStatus?.selectedModel ?? suggestedModelFor(provider));
  const [baseUrl, setBaseUrl] = useState(initialProviderDefaults?.baseUrl ?? defaultBaseUrlFor(provider));
  const [apiKeyEnv, setApiKeyEnv] = useState(initialProviderDefaults?.apiKeyEnv ?? defaultEnvFor(provider));
  const [requestTimeoutMs, setRequestTimeoutMs] = useState(String(initialProviderDefaults?.requestTimeoutMs ?? 60_000));
  const [maxRetries, setMaxRetries] = useState(String(initialProviderDefaults?.maxRetries ?? 1));
  const [apiKey, setApiKey] = useState("");
  const [bindRoles, setBindRoles] = useState(true);
  const runtimeErrors = providerRuntimeErrors({ requestTimeoutMs, maxRetries });
  const hasRuntimeErrors = hasProviderRuntimeErrors(runtimeErrors);

  useEffect(() => {
    setProvider(initialProvider);
  }, [initialProvider]);

  useEffect(() => {
    const providerId = normalizeProviderId(provider);
    const nextProvider = providers.find((item) => item.id === providerId);
    setModel((current) => current || nextProvider?.model || suggestedModelFor(providerId));
    setBaseUrl(nextProvider?.baseUrl ?? defaultBaseUrlFor(providerId));
    setApiKeyEnv(nextProvider?.apiKeyEnv ?? defaultEnvFor(providerId));
    setRequestTimeoutMs(String(nextProvider?.requestTimeoutMs ?? 60_000));
    setMaxRetries(String(nextProvider?.maxRetries ?? 1));
  }, [provider, providers]);

  const canSubmit = Boolean(normalizedProvider && model.trim() && baseUrl.trim() && apiKeyEnv.trim()) && !hasRuntimeErrors && !busy;
  const resultTone = connectionResult?.status === "ok" ? "te-chip-green" : connectionResult?.status === "missing_key" || connectionResult?.status === "failed" ? "te-chip-red" : "te-chip-amber";

  return (
    <ModalSurface
      backdropClassName="te-setup-backdrop"
      describedBy="setup-intro"
      dismissOnBackdrop={false}
      labelledBy="setup-title"
      onDismiss={onDismissDemo}
      surfaceClassName="te-setup-card"
      surfaceTestId="setup-wizard"
    >
        <header>
          <div>
            <span className="te-chip te-chip-blue">{t("setup.badge")}</span>
            <h2 id="setup-title">{t("setup.title")}</h2>
          </div>
          <button type="button" className="te-quiet-button" onClick={onDismissDemo} data-testid="setup-dismiss-demo">{t("setup.useFixture")}</button>
        </header>
        <p id="setup-intro">
          {t("setup.intro")}
        </p>
        {!providers.length ? <EmptyState title={t("state.noProviders")} detail={t("state.noProvidersDetail")} testId="setup-providers-empty-state" /> : null}
        <div className="te-setup-grid">
          <label>
            <span>{t("setup.provider")}</span>
            <input value={provider} list="setup-provider-options" onChange={(event) => setProvider(event.target.value)} data-testid="setup-provider" />
            <datalist id="setup-provider-options">
              {providers.map((item) => (
                <option key={item.id} value={item.id} label={item.id === recommended ? `${item.id} (${t("setup.recommended")})` : item.id} />
              ))}
            </datalist>
          </label>
          <label>
            <span>{t("setup.model")}</span>
            <input value={model} onChange={(event) => setModel(event.target.value)} placeholder={t("setup.modelPlaceholder")} data-testid="setup-model" />
          </label>
          <label>
            <span>{t("setup.baseUrl")}</span>
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={t("setup.baseUrlPlaceholder")} data-testid="setup-base-url" />
          </label>
          <label>
            <span>{t("setup.apiKeyEnv")}</span>
            <input value={apiKeyEnv} onChange={(event) => setApiKeyEnv(event.target.value.toUpperCase())} placeholder="OPENROUTER_API_KEY" data-testid="setup-env" />
          </label>
          <label>
            <span>{t("setup.requestTimeout")}</span>
            <input
              value={requestTimeoutMs}
              onChange={(event) => setRequestTimeoutMs(event.target.value)}
              inputMode="numeric"
              aria-describedby={runtimeErrors.requestTimeoutMs ? "setup-request-timeout-error" : undefined}
              aria-invalid={runtimeErrors.requestTimeoutMs ? "true" : undefined}
              data-testid="setup-request-timeout"
            />
            {runtimeErrors.requestTimeoutMs ? <span className="te-field-error" id="setup-request-timeout-error" role="alert">{t("validation.requestTimeoutPositiveInteger")}</span> : null}
          </label>
          <label>
            <span>{t("setup.maxRetries")}</span>
            <input
              value={maxRetries}
              onChange={(event) => setMaxRetries(event.target.value)}
              inputMode="numeric"
              aria-describedby={runtimeErrors.maxRetries ? "setup-max-retries-error" : undefined}
              aria-invalid={runtimeErrors.maxRetries ? "true" : undefined}
              data-testid="setup-max-retries"
            />
            {runtimeErrors.maxRetries ? <span className="te-field-error" id="setup-max-retries-error" role="alert">{t("validation.maxRetriesNonNegativeInteger")}</span> : null}
          </label>
          <label>
            <span>{t("setup.apiKeyOptional")}</span>
            <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" placeholder={t("setup.apiKeyPlaceholder")} data-testid="setup-key" />
          </label>
        </div>
        <label className="te-setup-check">
          <input type="checkbox" checked={bindRoles} onChange={(event) => setBindRoles(event.target.checked)} />
          <span>{t("setup.bindRoles")}</span>
        </label>
        <div className="te-setup-actions">
          <button type="button" onClick={() => onConfigure({ provider: normalizedProvider, model, baseUrl, apiKeyEnv, apiKey, bindRoles, requestTimeoutMs: numericDraft(requestTimeoutMs), maxRetries: numericDraft(maxRetries) })} disabled={!canSubmit} data-testid="setup-save">
            {t("setup.save")}
          </button>
          <button type="button" className="te-quiet-button" onClick={() => onTest(normalizedProvider)} disabled={busy || !normalizedProvider || !selectedProvider} data-testid="setup-test">
            {t("setup.test")}
          </button>
          <span className="te-chip">{t("setup.routingAfter")}</span>
        </div>
        {busy ? <LoadingState label={t("state.setupBusy")} testId="setup-loading-state" /> : null}
        {message ? <p className="te-setup-message" data-testid="setup-message">{message}</p> : null}
        {connectionResult ? (
          <p className="te-setup-message" data-testid="setup-connection">
            <span className={`te-chip ${resultTone}`}>{connectionResult.status}</span> {formatProviderConnectionMessage(connectionResult, t)}
          </p>
        ) : null}
    </ModalSurface>
  );
}

function defaultEnvFor(provider: string): string {
  const providerId = normalizeProviderId(provider);
  if (!providerId) return "";
  const lookup: Record<string, string> = {
    openrouter: "OPENROUTER_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    kimi: "KIMI_API_KEY",
    mimo: "MIMO_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    gemini: "GEMINI_API_KEY",
    openai_compatible: "OPENAI_API_KEY"
  };
  const prefix = providerId.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return lookup[providerId] ?? (/^[A-Z_]/.test(prefix) ? `${prefix}_API_KEY` : `PROVIDER_${prefix}_API_KEY`);
}

function defaultBaseUrlFor(provider: string): string {
  const providerId = normalizeProviderId(provider);
  const lookup: Record<string, string> = {
    openrouter: "https://openrouter.ai/api/v1",
    deepseek: "https://api.deepseek.com",
    kimi: "https://api.moonshot.ai/v1",
    mimo: "https://token-plan-sgp.xiaomimimo.com/v1",
    anthropic: "https://api.anthropic.com/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    openai_compatible: "https://api.openai.com/v1"
  };
  return lookup[providerId] ?? "";
}

function suggestedModelFor(provider: string): string {
  const providerId = normalizeProviderId(provider);
  return suggestedModelForProvider(providerId);
}

function normalizeProviderId(provider: string): string {
  return provider.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_");
}
