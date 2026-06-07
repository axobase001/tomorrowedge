import { useEffect, useMemo, useState } from "react";
import type { CockpitProviderConnectionResult, CockpitSetupRequest, CockpitSetupStatus } from "../api.js";

type SetupWizardProps = {
  setupStatus?: CockpitSetupStatus;
  busy: boolean;
  message?: string;
  connectionResult?: CockpitProviderConnectionResult;
  onConfigure: (request: CockpitSetupRequest) => void;
  onTest: (provider: string) => void;
  onDismissDemo: () => void;
};

export function SetupWizard({
  setupStatus,
  busy,
  message,
  connectionResult,
  onConfigure,
  onTest,
  onDismissDemo
}: SetupWizardProps) {
  const providers = useMemo(() => setupStatus?.providers.filter((provider) => provider.authRequired) ?? [], [setupStatus]);
  const recommended = setupStatus?.recommendedProvider ?? "openrouter";
  const initialProvider = setupStatus?.selectedProvider ?? recommended;
  const [provider, setProvider] = useState(initialProvider);
  const selectedProvider = providers.find((item) => item.id === provider) ?? providers[0];
  const [model, setModel] = useState(setupStatus?.selectedModel ?? suggestedModelFor(provider));
  const [apiKeyEnv, setApiKeyEnv] = useState(selectedProvider?.apiKeyEnv ?? defaultEnvFor(provider));
  const [apiKey, setApiKey] = useState("");
  const [bindRoles, setBindRoles] = useState(true);

  useEffect(() => {
    setProvider(initialProvider);
  }, [initialProvider]);

  useEffect(() => {
    const nextProvider = providers.find((item) => item.id === provider);
    setModel((current) => current || nextProvider?.model || suggestedModelFor(provider));
    setApiKeyEnv(nextProvider?.apiKeyEnv ?? defaultEnvFor(provider));
  }, [provider, providers]);

  const canSubmit = Boolean(provider && model.trim() && apiKeyEnv.trim()) && !busy;
  const resultTone = connectionResult?.status === "ok" ? "te-chip-green" : connectionResult?.status === "missing_key" || connectionResult?.status === "failed" ? "te-chip-red" : "te-chip-amber";

  return (
    <div className="te-setup-backdrop" data-testid="setup-wizard">
      <section className="te-setup-card">
        <header>
          <div>
            <span className="te-chip te-chip-blue">First-run setup</span>
            <h2>Connect at least one model</h2>
          </div>
          <button type="button" className="te-quiet-button" onClick={onDismissDemo} data-testid="setup-dismiss-demo">Use fixture demo</button>
        </header>
        <p>
          Start with OpenRouter if you are not sure. One key can reach several model families; later you can split keys per provider for rate-limit isolation and cost tracing.
        </p>
        <div className="te-setup-grid">
          <label>
            <span>Provider</span>
            <select value={provider} onChange={(event) => setProvider(event.target.value)} data-testid="setup-provider">
              {providers.map((item) => (
                <option key={item.id} value={item.id}>{item.id === recommended ? `${item.id} (recommended)` : item.id}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Model</span>
            <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="openrouter model id" data-testid="setup-model" />
          </label>
          <label>
            <span>API key env</span>
            <input value={apiKeyEnv} onChange={(event) => setApiKeyEnv(event.target.value.toUpperCase())} placeholder="OPENROUTER_API_KEY" data-testid="setup-env" />
          </label>
          <label>
            <span>API key optional</span>
            <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" placeholder="Leave blank if the env var already exists" data-testid="setup-key" />
          </label>
        </div>
        <label className="te-setup-check">
          <input type="checkbox" checked={bindRoles} onChange={(event) => setBindRoles(event.target.checked)} />
          <span>Use this model for all roles for now. Routing presets such as cheap-first and strong-review remain optional.</span>
        </label>
        <div className="te-setup-actions">
          <button type="button" onClick={() => onConfigure({ provider, model, apiKeyEnv, apiKey, bindRoles })} disabled={!canSubmit} data-testid="setup-save">
            Save configuration
          </button>
          <button type="button" className="te-quiet-button" onClick={() => onTest(provider)} disabled={busy || !provider} data-testid="setup-test">
            Test connection
          </button>
          <span className="te-chip">manual or LLM-assisted routing after setup</span>
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
  const lookup: Record<string, string> = {
    openrouter: "OPENROUTER_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    kimi: "KIMI_API_KEY",
    mimo: "MIMO_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    gemini: "GEMINI_API_KEY",
    openai_compatible: "OPENAI_API_KEY"
  };
  return lookup[provider] ?? `${provider.toUpperCase()}_API_KEY`;
}

function suggestedModelFor(provider: string): string {
  const lookup: Record<string, string> = {
    openrouter: "moonshotai/kimi-k2:free",
    deepseek: "deepseek-chat",
    kimi: "kimi-k2-0711-preview",
    mimo: "mimo-v2.5-pro",
    anthropic: "claude-opus-4.1",
    gemini: "gemini-2.5-pro"
  };
  return lookup[provider] ?? "";
}
