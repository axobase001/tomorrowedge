import { useEffect, useMemo, useState } from "react";
import type {
  CockpitProviderConnectionResult,
  CockpitProviderKeyRequest,
  CockpitRoleAssignment,
  CockpitSetupStatus
} from "../api.js";
import type { Translator } from "../i18n.js";

type KeyRoleManagerProps = {
  setupStatus?: CockpitSetupStatus;
  busy: boolean;
  message?: string;
  connectionResult?: CockpitProviderConnectionResult;
  t: Translator;
  onClose: () => void;
  onSaveProviderKey: (request: CockpitProviderKeyRequest) => void;
  onDeleteProviderKey: (provider: string) => void;
  onSaveRoleAssignments: (assignments: CockpitRoleAssignment[]) => void;
  onTestProvider: (provider: string) => void;
};

export function KeyRoleManager({
  setupStatus,
  busy,
  message,
  connectionResult,
  t,
  onClose,
  onSaveProviderKey,
  onDeleteProviderKey,
  onSaveRoleAssignments,
  onTestProvider
}: KeyRoleManagerProps) {
  const providers = useMemo(() => setupStatus?.providers.filter((provider) => provider.authRequired) ?? [], [setupStatus]);
  const providerIds = providers.map((provider) => provider.id);
  const initialProvider = setupStatus?.selectedProvider ?? setupStatus?.recommendedProvider ?? providerIds[0] ?? "openrouter";
  const [tab, setTab] = useState<"keys" | "roles">("keys");
  const [provider, setProvider] = useState(initialProvider);
  const selectedProvider = providers.find((item) => item.id === provider) ?? providers[0];
  const [model, setModel] = useState(setupStatus?.selectedModel ?? selectedProvider?.model ?? suggestedModelFor(provider));
  const [baseUrl, setBaseUrl] = useState(selectedProvider?.baseUrl ?? defaultBaseUrlFor(provider));
  const [apiKeyEnv, setApiKeyEnv] = useState(selectedProvider?.apiKeyEnv ?? defaultEnvFor(provider));
  const [apiKey, setApiKey] = useState("");
  const [assignments, setAssignments] = useState<CockpitRoleAssignment[]>(setupStatus?.roleAssignments ?? []);

  useEffect(() => {
    setProvider(initialProvider);
  }, [initialProvider]);

  useEffect(() => {
    setAssignments(setupStatus?.roleAssignments ?? []);
  }, [setupStatus?.roleAssignments]);

  useEffect(() => {
    const nextProvider = providers.find((item) => item.id === provider);
    setModel((current) => current || nextProvider?.model || suggestedModelFor(provider));
    setBaseUrl(nextProvider?.baseUrl ?? defaultBaseUrlFor(provider));
    setApiKeyEnv(nextProvider?.apiKeyEnv ?? defaultEnvFor(provider));
  }, [provider, providers]);

  const canSaveKey = Boolean(provider && model.trim() && baseUrl.trim() && apiKeyEnv.trim() && apiKey.trim()) && !busy;
  const resultTone = connectionResult?.status === "ok" ? "te-chip-green" : connectionResult?.status === "missing_key" || connectionResult?.status === "failed" ? "te-chip-red" : "te-chip-amber";

  return (
    <div className="te-keymgr-backdrop" data-testid="key-role-manager">
      <section className="te-keymgr-card">
        <header className="te-keymgr-header">
          <div>
            <span className="te-chip te-chip-blue">{t("keymgr.badge")}</span>
            <h2>{t("keymgr.title")}</h2>
          </div>
          <button type="button" className="te-quiet-button" onClick={onClose} data-testid="keymgr-close">{t("keymgr.close")}</button>
        </header>
        <nav className="te-keymgr-tabs" aria-label="Key manager tabs">
          <button type="button" className={tab === "keys" ? "active" : ""} onClick={() => setTab("keys")} data-testid="keymgr-tab-keys">{t("keymgr.tabKeys")}</button>
          <button type="button" className={tab === "roles" ? "active" : ""} onClick={() => setTab("roles")} data-testid="keymgr-tab-roles">{t("keymgr.tabRoles")}</button>
        </nav>
        {tab === "keys" ? (
          <section className="te-keymgr-body">
            <p>{t("keymgr.keysIntro")}</p>
            <div className="te-keymgr-provider-list">
              {providers.map((item) => (
                <article key={item.id} className={item.id === provider ? "selected" : ""}>
                  <button type="button" className="te-provider-pick" onClick={() => setProvider(item.id)}>
                    <strong>{labelProvider(item.id)}</strong>
                    <span>{item.keyConfigured ? item.maskedKey ?? item.keySource : t("keymgr.notConfigured")}</span>
                  </button>
                  <span className={item.keyConfigured ? "te-chip te-chip-green" : "te-chip te-chip-red"}>{item.keyConfigured ? item.keySource : t("keymgr.missing")}</span>
                </article>
              ))}
            </div>
            <div className="te-keymgr-form">
              <label>
                <span>{t("keymgr.provider")}</span>
                <select value={provider} onChange={(event) => setProvider(event.target.value)} data-testid="keymgr-provider">
                  {providers.map((item) => <option key={item.id} value={item.id}>{labelProvider(item.id)}</option>)}
                </select>
              </label>
              <label>
                <span>{t("keymgr.model")}</span>
                <input value={model} onChange={(event) => setModel(event.target.value)} data-testid="keymgr-model" />
              </label>
              <label>
                <span>{t("keymgr.baseUrl")}</span>
                <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={t("keymgr.baseUrlPlaceholder")} data-testid="keymgr-base-url" />
              </label>
              <label>
                <span>{t("keymgr.apiKeyEnv")}</span>
                <input value={apiKeyEnv} onChange={(event) => setApiKeyEnv(event.target.value.toUpperCase())} data-testid="keymgr-env" />
              </label>
              <label>
                <span>{t("keymgr.apiKey")}</span>
                <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" placeholder={t("keymgr.apiKeyPlaceholder")} data-testid="keymgr-key" />
              </label>
            </div>
            <div className="te-keymgr-actions">
              <button type="button" disabled={!canSaveKey} onClick={() => {
                onSaveProviderKey({ provider, model, baseUrl, apiKeyEnv, apiKey });
                setApiKey("");
              }} data-testid="keymgr-save-key">{t("keymgr.saveKey")}</button>
              <button type="button" className="te-quiet-button" disabled={busy || !provider} onClick={() => onTestProvider(provider)} data-testid="keymgr-test-key">{t("keymgr.test")}</button>
              <button type="button" className="te-quiet-button" disabled={busy || !selectedProvider?.keyConfigured} onClick={() => onDeleteProviderKey(provider)} data-testid="keymgr-delete-key">{t("keymgr.removeKey")}</button>
            </div>
          </section>
        ) : (
          <section className="te-keymgr-body">
            <p>{t("keymgr.rolesIntro")}</p>
            <div className="te-role-list" data-testid="keymgr-role-list">
              {assignments.map((assignment) => (
                <div key={assignment.role} className="te-role-row">
                  <strong>{assignment.role}</strong>
                  <select value={assignment.provider} onChange={(event) => setAssignments((current) => updateAssignment(current, assignment.role, { provider: event.target.value, model: defaultModelFor(event.target.value, providers, assignment.model) }))}>
                    {["auto", ...providerIds, assignment.provider.startsWith("external:") ? assignment.provider : ""].filter(Boolean).map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                  <input value={assignment.model} onChange={(event) => setAssignments((current) => updateAssignment(current, assignment.role, { model: event.target.value }))} />
                </div>
              ))}
            </div>
            <div className="te-keymgr-actions">
              <button type="button" disabled={busy || !assignments.length} onClick={() => onSaveRoleAssignments(assignments)} data-testid="keymgr-save-roles">{t("keymgr.saveRoles")}</button>
            </div>
          </section>
        )}
        {message ? <p className="te-setup-message" data-testid="keymgr-message">{message}</p> : null}
        {connectionResult ? (
          <p className="te-setup-message" data-testid="keymgr-connection">
            <span className={`te-chip ${resultTone}`}>{connectionResult.status}</span> {connectionResult.detail}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function updateAssignment(assignments: CockpitRoleAssignment[], role: string, patch: Partial<CockpitRoleAssignment>): CockpitRoleAssignment[] {
  return assignments.map((assignment) => assignment.role === role ? { ...assignment, ...patch } : assignment);
}

function defaultModelFor(provider: string, providers: Array<{ id: string; model: string }>, fallback: string): string {
  if (provider === "auto") return "auto";
  return providers.find((item) => item.id === provider)?.model || fallback || "auto";
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

function defaultBaseUrlFor(provider: string): string {
  const lookup: Record<string, string> = {
    openrouter: "https://openrouter.ai/api/v1",
    deepseek: "https://api.deepseek.com",
    kimi: "https://api.moonshot.ai/v1",
    mimo: "https://token-plan-sgp.xiaomimimo.com/v1",
    anthropic: "https://api.anthropic.com/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    openai_compatible: "https://api.openai.com/v1"
  };
  return lookup[provider] ?? "";
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

function labelProvider(provider: string): string {
  return provider.replace(/_/g, " ");
}
