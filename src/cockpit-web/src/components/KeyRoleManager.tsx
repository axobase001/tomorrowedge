import { useEffect, useMemo, useState } from "react";
import type {
  CockpitExternalAgentOption,
  CockpitProviderModelOption,
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
  onListProviderModels: (provider: string) => Promise<CockpitProviderModelOption[]>;
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
  onTestProvider,
  onListProviderModels
}: KeyRoleManagerProps) {
  const roleProviders = useMemo(() => setupStatus?.providers ?? [], [setupStatus]);
  const providers = useMemo(() => roleProviders.filter((provider) => provider.authRequired), [roleProviders]);
  const providerIds = providers.map((provider) => provider.id);
  const roleProviderIds = roleProviders.map((provider) => provider.id);
  const externalAgents = setupStatus?.externalAgents ?? [];
  const selectedKeyProvider = setupStatus?.selectedProvider && providers.some((item) => item.id === setupStatus.selectedProvider)
    ? setupStatus.selectedProvider
    : undefined;
  const initialProvider = selectedKeyProvider ?? setupStatus?.recommendedProvider ?? providerIds[0] ?? "openrouter";
  const [tab, setTab] = useState<"keys" | "roles">("keys");
  const [provider, setProvider] = useState(initialProvider);
  const normalizedProvider = normalizeProviderId(provider);
  const selectedProvider = providers.find((item) => item.id === normalizedProvider);
  const initialDraft = providerFormDefaults(initialProvider, providers, setupStatus?.selectedModel);
  const [model, setModel] = useState(initialDraft.model);
  const [baseUrl, setBaseUrl] = useState(initialDraft.baseUrl);
  const [apiKeyEnv, setApiKeyEnv] = useState(initialDraft.apiKeyEnv);
  const [apiKey, setApiKey] = useState("");
  const [catalogModels, setCatalogModels] = useState<CockpitProviderModelOption[]>([]);
  const [catalogMessage, setCatalogMessage] = useState("");
  const [assignments, setAssignments] = useState<CockpitRoleAssignment[]>(setupStatus?.roleAssignments ?? []);

  useEffect(() => {
    setProvider(initialProvider);
  }, [initialProvider]);

  useEffect(() => {
    setAssignments(setupStatus?.roleAssignments ?? []);
  }, [setupStatus?.roleAssignments]);

  useEffect(() => {
    const providerId = normalizeProviderId(provider);
    const nextDraft = providerFormDefaults(providerId, providers);
    setModel(nextDraft.model);
    setBaseUrl(nextDraft.baseUrl);
    setApiKeyEnv(nextDraft.apiKeyEnv);
    setApiKey("");
    setCatalogModels([]);
    setCatalogMessage("");
  }, [provider, providers]);

  const canSaveKey = canSaveProviderConfig({
    provider: normalizedProvider,
    model,
    baseUrl,
    apiKeyEnv,
    apiKey,
    keyConfigured: Boolean(selectedProvider?.keyConfigured),
    busy
  });
  const modelOptions = modelOptionIds(normalizedProvider, selectedProvider?.model, [...(selectedProvider?.models ?? []), ...catalogModels]);
  const selectedModelChoice = modelOptions.includes(model) ? model : "__custom";
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
                <article key={item.id} className={item.id === normalizedProvider ? "selected" : ""}>
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
                <input value={provider} list="keymgr-provider-options" onChange={(event) => setProvider(event.target.value)} data-testid="keymgr-provider" />
                <datalist id="keymgr-provider-options">
                  {providers.map((item) => <option key={item.id} value={item.id} label={labelProvider(item.id)} />)}
                </datalist>
              </label>
              <label>
                <span>{t("keymgr.model")}</span>
                <div className="te-model-picker">
                  <select value={selectedModelChoice} onChange={(event) => {
                    if (event.target.value !== "__custom") setModel(event.target.value);
                  }} data-testid="keymgr-model-select">
                    {modelOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                    <option value="__custom">Custom model...</option>
                  </select>
                  <input value={model} onChange={(event) => setModel(event.target.value)} data-testid="keymgr-model" />
                </div>
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
                onSaveProviderKey({ provider: normalizedProvider, model, baseUrl, apiKeyEnv, apiKey: apiKey || undefined });
                setApiKey("");
              }} data-testid="keymgr-save-key">{t("keymgr.saveKey")}</button>
              <button type="button" className="te-quiet-button" disabled={busy || !normalizedProvider} onClick={async () => {
                setCatalogMessage(t("keymgr.loadingModels"));
                try {
                  const options = await onListProviderModels(normalizedProvider);
                  setCatalogModels(options);
                  setCatalogMessage(options.length ? t("keymgr.modelsLoaded", { count: String(options.length) }) : t("keymgr.noModelsFound"));
                } catch (error) {
                  setCatalogMessage(t("keymgr.modelsFailed", { message: error instanceof Error ? error.message : String(error) }));
                }
              }} data-testid="keymgr-refresh-models">{t("keymgr.refreshModels")}</button>
              <button type="button" className="te-quiet-button" disabled={busy || !normalizedProvider || !selectedProvider} onClick={() => onTestProvider(normalizedProvider)} data-testid="keymgr-test-key">{t("keymgr.test")}</button>
              <button type="button" className="te-quiet-button" disabled={busy || !selectedProvider?.keyConfigured} onClick={() => {
                if (window.confirm(t("keymgr.removeKeyPrompt"))) onDeleteProviderKey(normalizedProvider);
              }} data-testid="keymgr-delete-key">{t("keymgr.removeKey")}</button>
            </div>
            {catalogMessage ? <p className="te-setup-message" data-testid="keymgr-models-message">{catalogMessage}</p> : null}
          </section>
        ) : (
          <section className="te-keymgr-body">
            <p>{t("keymgr.rolesIntro")}</p>
            <div className="te-role-list" data-testid="keymgr-role-list">
              {assignments.map((assignment) => (
                <div key={assignment.role} className="te-role-row">
                  <strong>{assignment.role}</strong>
                  <select value={assignment.provider} onChange={(event) => setAssignments((current) => updateAssignment(current, assignment.role, { provider: event.target.value, model: defaultModelFor(event.target.value, roleProviders, assignment.model) }))}>
                    {roleProviderOptions(roleProviderIds, externalAgents, assignment.provider).map((item) => (
                      <option key={item} value={item}>{labelProvider(item, externalAgents)}</option>
                    ))}
                  </select>
                  <select
                    value={roleModelOptionIds(assignment.provider, roleProviders, assignment.model).includes(assignment.model) ? assignment.model : "__custom"}
                    onChange={(event) => {
                      if (event.target.value !== "__custom") setAssignments((current) => updateAssignment(current, assignment.role, { model: event.target.value }));
                    }}
                    data-testid={`keymgr-role-model-select-${assignment.role}`}
                  >
                    {roleModelOptionIds(assignment.provider, roleProviders, assignment.model).map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                    <option value="__custom">Custom model...</option>
                  </select>
                  <input value={assignment.model} onChange={(event) => setAssignments((current) => updateAssignment(current, assignment.role, { model: event.target.value }))} data-testid={`keymgr-role-model-${assignment.role}`} />
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

export function providerFormDefaults(provider: string, providers: Array<{ id: string; model: string; baseUrl: string; apiKeyEnv?: string }>, selectedModel?: string): { model: string; baseUrl: string; apiKeyEnv: string } {
  const providerId = normalizeProviderId(provider);
  const selectedProvider = providers.find((item) => item.id === providerId);
  return {
    model: selectedModel ?? selectedProvider?.model ?? suggestedModelFor(providerId),
    baseUrl: selectedProvider?.baseUrl ?? defaultBaseUrlFor(providerId),
    apiKeyEnv: selectedProvider?.apiKeyEnv ?? defaultEnvFor(providerId)
  };
}

export function canSaveProviderConfig(input: { provider: string; model: string; baseUrl: string; apiKeyEnv: string; apiKey?: string; keyConfigured: boolean; busy: boolean }): boolean {
  return Boolean(input.provider && input.model.trim() && input.baseUrl.trim() && input.apiKeyEnv.trim() && (input.apiKey?.trim() || input.keyConfigured)) && !input.busy;
}

export function modelOptionIds(provider: string, configuredModel: string | undefined, catalogModels: CockpitProviderModelOption[]): string[] {
  const providerId = normalizeProviderId(provider);
  return [...new Set([
    configuredModel,
    suggestedModelFor(providerId),
    ...staticModelOptionsFor(providerId),
    ...catalogModels.map((model) => model.id)
  ].filter((item): item is string => Boolean(item)))];
}

export function roleModelOptionIds(provider: string, providers: Array<{ id: string; model: string; models?: CockpitProviderModelOption[] }>, currentModel: string): string[] {
  if (provider === "auto" || provider.startsWith("external:")) return ["auto"];
  const providerId = normalizeProviderId(provider);
  const selectedProvider = providers.find((item) => item.id === providerId);
  return modelOptionIds(providerId, selectedProvider?.model, [
    ...(selectedProvider?.models ?? []),
    ...(currentModel && currentModel !== "auto" ? [{ id: currentModel, label: currentModel, source: "config" as const }] : [])
  ]);
}

export function roleProviderOptions(providerIds: string[], externalAgents: CockpitExternalAgentOption[], currentProvider: string): string[] {
  return [...new Set([
    "auto",
    ...providerIds,
    ...externalAgents.map((agent) => agent.provider),
    currentProvider && currentProvider !== "auto" ? currentProvider : ""
  ].filter(Boolean))];
}

function defaultModelFor(provider: string, providers: Array<{ id: string; model: string; models?: CockpitProviderModelOption[] }>, fallback: string): string {
  if (provider === "auto") return "auto";
  if (provider.startsWith("external:")) return "auto";
  const selectedProvider = providers.find((item) => item.id === provider);
  return selectedProvider?.model || selectedProvider?.models?.[0]?.id || fallback || "auto";
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

function staticModelOptionsFor(provider: string): string[] {
  const providerId = normalizeProviderId(provider);
  const lookup: Record<string, string[]> = {
    openrouter: ["moonshotai/kimi-k2.6:free", "qwen/qwen3-coder:free", "deepseek/deepseek-chat-v3-0324:free"],
    deepseek: ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-pro"],
    kimi: ["kimi-k2-0711-preview", "kimi-latest"],
    mimo: ["mimo-v2.5-pro"],
    anthropic: ["claude-opus-4.1", "claude-sonnet-4.5"],
    gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
    openai_compatible: ["gpt-4o-mini", "gpt-5.2", "qwen/qwen3-coder:free"]
  };
  return lookup[providerId] ?? [];
}

function labelProvider(provider: string, externalAgents: CockpitExternalAgentOption[] = []): string {
  const externalAgent = externalAgents.find((agent) => agent.provider === provider);
  if (externalAgent) return `${externalAgent.provider} (${externalAgent.name})`;
  return provider.replace(/_/g, " ");
}

function normalizeProviderId(provider: string): string {
  return provider.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_");
}
