import { useEffect, useMemo, useState } from "react";
import type { CockpitProviderConnectionResult, CockpitSetupRequest, CockpitSetupStatus } from "../api.js";
import type { Translator } from "../i18n.js";

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
  const [apiKey, setApiKey] = useState("");
  const [bindRoles, setBindRoles] = useState(true);

  useEffect(() => {
    setProvider(initialProvider);
  }, [initialProvider]);

  useEffect(() => {
    const providerId = normalizeProviderId(provider);
    const nextProvider = providers.find((item) => item.id === providerId);
    setModel((current) => current || nextProvider?.model || suggestedModelFor(providerId));
    setBaseUrl(nextProvider?.baseUrl ?? defaultBaseUrlFor(providerId));
    setApiKeyEnv(nextProvider?.apiKeyEnv ?? defaultEnvFor(providerId));
  }, [provider, providers]);

  const canSubmit = Boolean(normalizedProvider && model.trim() && baseUrl.trim() && apiKeyEnv.trim()) && !busy;
  const resultTone = connectionResult?.status === "ok" ? "te-chip-green" : connectionResult?.status === "missing_key" || connectionResult?.status === "failed" ? "te-chip-red" : "te-chip-amber";

  return (
    <div className="te-setup-backdrop" data-testid="setup-wizard">
      <section className="te-setup-card">
        <header>
          <div>
            <span className="te-chip te-chip-blue">{t("setup.badge")}</span>
            <h2>{t("setup.title")}</h2>
          </div>
          <button type="button" className="te-quiet-button" onClick={onDismissDemo} data-testid="setup-dismiss-demo">{t("setup.useFixture")}</button>
        </header>
        <p>
          {t("setup.intro")}
        </p>
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
            <span>{t("setup.apiKeyOptional")}</span>
            <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" placeholder={t("setup.apiKeyPlaceholder")} data-testid="setup-key" />
          </label>
        </div>
        <label className="te-setup-check">
          <input type="checkbox" checked={bindRoles} onChange={(event) => setBindRoles(event.target.checked)} />
          <span>{t("setup.bindRoles")}</span>
        </label>
        <div className="te-setup-actions">
          <button type="button" onClick={() => onConfigure({ provider: normalizedProvider, model, baseUrl, apiKeyEnv, apiKey, bindRoles })} disabled={!canSubmit} data-testid="setup-save">
            {t("setup.save")}
          </button>
          <button type="button" className="te-quiet-button" onClick={() => onTest(normalizedProvider)} disabled={busy || !normalizedProvider || !selectedProvider} data-testid="setup-test">
            {t("setup.test")}
          </button>
          <span className="te-chip">{t("setup.routingAfter")}</span>
        </div>
        {message ? <p className="te-setup-message" data-testid="setup-message">{message}</p> : null}
        {connectionResult ? (
          <p className="te-setup-message" data-testid="setup-connection">
            <span className={`te-chip ${resultTone}`}>{connectionResult.status}</span> {connectionResult.detail}
          </p>
        ) : null}
      </section>
    </div>
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
  const lookup: Record<string, string> = {
    openrouter: "moonshotai/kimi-k2.6:free",
    deepseek: "deepseek-chat",
    kimi: "kimi-k2-0711-preview",
    mimo: "mimo-v2.5-pro",
    anthropic: "claude-opus-4.1",
    gemini: "gemini-2.5-pro"
  };
  return lookup[providerId] ?? "";
}

function normalizeProviderId(provider: string): string {
  return provider.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_");
}
