import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CockpitExternalAgentOption,
  CockpitProviderApiFormat,
  CockpitProviderAuthHeader,
  CockpitProviderModelOption,
  CockpitProviderConnectionResult,
  CockpitProviderKeyRequest,
  CockpitRoleAssignment,
  CockpitSetupStatus
} from "../api.js";
import type { Translator } from "../i18n.js";
import { formatProviderConnectionMessage } from "../providerConnectionMessage.js";
import { hasProviderRuntimeErrors, numericDraft, providerRuntimeErrors } from "../providerRuntimeValidation.js";
import { ModalSurface } from "./ModalSurface.js";
import { EmptyState, LoadingState } from "./StateNotice.js";
import { staticModelIdsForProvider, suggestedModelForProvider } from "../../../providers/staticModels.js";

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
  initialTab?: "keys" | "roles";
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
  onListProviderModels,
  initialTab = "keys"
}: KeyRoleManagerProps) {
  const roleProviders = useMemo(() => setupStatus?.providers ?? [], [setupStatus]);
  const providers = useMemo(() => roleProviders.filter(isManageableProvider), [roleProviders]);
  const providerIds = providers.map((provider) => provider.id);
  const roleProviderIds = roleProviders.map((provider) => provider.id);
  const externalAgents = setupStatus?.externalAgents ?? [];
  const selectedKeyProvider = setupStatus?.selectedProvider && providers.some((item) => item.id === setupStatus.selectedProvider)
    ? setupStatus.selectedProvider
    : undefined;
  const initialProvider = selectedKeyProvider ?? setupStatus?.recommendedProvider ?? providerIds[0] ?? "openrouter";
  const [tab, setTab] = useState<"keys" | "roles">(initialTab);
  const [provider, setProvider] = useState(initialProvider);
  const normalizedProvider = normalizeProviderId(provider);
  const selectedProvider = providers.find((item) => item.id === normalizedProvider);
  const initialDraft = providerFormDefaults(initialProvider, providers, setupStatus?.selectedModel);
  const [model, setModel] = useState(initialDraft.model);
  const [baseUrl, setBaseUrl] = useState(initialDraft.baseUrl);
  const [apiKeyEnv, setApiKeyEnv] = useState(initialDraft.apiKeyEnv);
  const [apiFormat, setApiFormat] = useState<CockpitProviderApiFormat>(initialDraft.apiFormat);
  const [authHeader, setAuthHeader] = useState<CockpitProviderAuthHeader>(initialDraft.authHeader);
  const [extraHeadersText, setExtraHeadersText] = useState(initialDraft.extraHeadersText);
  const [requestTimeoutMs, setRequestTimeoutMs] = useState(String(initialDraft.requestTimeoutMs));
  const [maxRetries, setMaxRetries] = useState(String(initialDraft.maxRetries));
  const [apiKey, setApiKey] = useState("");
  const [catalogModelsByProvider, setCatalogModelsByProvider] = useState<Record<string, CockpitProviderModelOption[]>>({});
  const [catalogMessage, setCatalogMessage] = useState("");
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [assignments, setAssignments] = useState<CockpitRoleAssignment[]>(setupStatus?.roleAssignments ?? []);
  const keyCustomModelInputRef = useRef<HTMLInputElement | null>(null);
  const runtimeErrors = providerRuntimeErrors({ requestTimeoutMs, maxRetries });
  const extraHeadersDraft = parseExtraHeadersDraft(extraHeadersText);
  const authRequiresKey = authHeader !== "none";
  const isCustomProviderDraft = Boolean(normalizedProvider && !selectedProvider);

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
    setApiFormat(nextDraft.apiFormat);
    setAuthHeader(nextDraft.authHeader);
    setExtraHeadersText(nextDraft.extraHeadersText);
    setRequestTimeoutMs(String(nextDraft.requestTimeoutMs));
    setMaxRetries(String(nextDraft.maxRetries));
    setApiKey("");
    setCatalogMessage("");
  }, [provider, providers]);

  const canSaveKey = canSaveProviderConfig({
    provider: normalizedProvider,
    model,
    baseUrl,
    apiKeyEnv,
    apiKey,
    keyConfigured: Boolean(selectedProvider?.keyConfigured),
    authHeader,
    extraHeadersValid: !extraHeadersDraft.error,
    busy,
    requestTimeoutMs,
    maxRetries
  });
  const catalogModels = catalogModelsByProvider[normalizedProvider] ?? [];
  const modelOptions = modelOptionIds(normalizedProvider, selectedProvider?.model, [...(selectedProvider?.models ?? []), ...catalogModels]);
  const selectedModelChoice = modelOptions.includes(model) ? model : "__custom";
  const keyModelIsCustom = selectedModelChoice === "__custom";
  const visibleConnectionResult = tab === "keys" && connectionResult && normalizeProviderId(connectionResult.id) === normalizedProvider ? connectionResult : undefined;
  const resultTone = visibleConnectionResult?.status === "ok" ? "te-chip-green" : visibleConnectionResult?.status === "missing_key" || visibleConnectionResult?.status === "failed" ? "te-chip-red" : "te-chip-amber";
  useEffect(() => {
    if (keyModelIsCustom) keyCustomModelInputRef.current?.focus();
  }, [keyModelIsCustom]);
  const startRelayProfile = () => {
    const nextProvider = nextRelayProviderId(providerIds);
    setProvider(nextProvider);
    setModel("");
    setBaseUrl("");
    setApiKeyEnv(defaultEnvFor(nextProvider));
    setApiFormat("openai_chat");
    setAuthHeader("bearer");
    setExtraHeadersText("{}");
    setApiKey("");
    setCatalogMessage("");
  };

  return (
    <ModalSurface
      backdropClassName="te-keymgr-backdrop"
      describedBy="keymgr-intro"
      dismissOnBackdrop={false}
      labelledBy="keymgr-title"
      onDismiss={onClose}
      surfaceClassName="te-keymgr-card"
      surfaceTestId="key-role-manager"
    >
        <header className="te-keymgr-header">
          <div>
            <span className="te-chip te-chip-blue">{t("keymgr.badge")}</span>
            <h2 id="keymgr-title">{t("keymgr.title")}</h2>
          </div>
          <button type="button" className="te-quiet-button" onClick={onClose} data-testid="keymgr-close">{t("keymgr.close")}</button>
        </header>
        <nav className="te-keymgr-tabs" aria-label={t("keymgr.tabsLabel")}>
          <button type="button" className={tab === "keys" ? "active" : ""} onClick={() => setTab("keys")} data-testid="keymgr-tab-keys">{t("keymgr.tabKeys")}</button>
          <button type="button" className={tab === "roles" ? "active" : ""} onClick={() => setTab("roles")} data-testid="keymgr-tab-roles">{t("keymgr.tabRoles")}</button>
        </nav>
        {tab === "keys" ? (
          <section className="te-keymgr-body">
            <div className="te-keymgr-provider-tools">
              <p id="keymgr-intro">{t("keymgr.keysIntro")}</p>
              <button type="button" className="te-quiet-button" onClick={startRelayProfile} data-testid="keymgr-add-relay">{t("keymgr.addRelay")}</button>
            </div>
            <div className="te-keymgr-provider-list">
              {providers.length ? providers.map((item) => (
                <article key={item.id} className={item.id === normalizedProvider ? "selected" : ""}>
                  <button type="button" className="te-provider-pick" onClick={() => setProvider(item.id)}>
                    <strong>{labelProvider(item.id)}</strong>
                    <span>{item.keyConfigured ? item.maskedKey ?? item.keySource : t("keymgr.notConfigured")} - {formatProviderTransport(item)}</span>
                  </button>
                  <span className={item.keyConfigured ? "te-chip te-chip-green" : "te-chip te-chip-red"}>{item.keyConfigured ? item.keySource : t("keymgr.missing")}</span>
                </article>
              )) : (
                <EmptyState title={t("state.noProviders")} detail={t("state.noProvidersDetail")} testId="keymgr-providers-empty-state" />
              )}
            </div>
            <div className="te-keymgr-form">
              <label>
                <span>{t("keymgr.provider")}</span>
                <input value={provider} list="keymgr-provider-options" onChange={(event) => setProvider(event.target.value)} data-testid="keymgr-provider" />
                <datalist id="keymgr-provider-options">
                  {providers.map((item) => <option key={item.id} value={item.id} label={labelProvider(item.id)} />)}
                </datalist>
              </label>
              {isCustomProviderDraft ? <p className="te-keymgr-custom-banner te-keymgr-wide" data-testid="keymgr-custom-provider-note">{t("keymgr.customProviderDraft")}</p> : null}
              <label>
                <span>{t("keymgr.model")}</span>
                <div className="te-model-picker">
                  <select value={selectedModelChoice} onChange={(event) => {
                    if (event.target.value === "__custom") {
                      if (modelOptions.includes(model)) setModel("");
                    } else {
                      setModel(event.target.value);
                    }
                  }} data-testid="keymgr-model-select">
                    {modelOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                    <option value="__custom">{t("keymgr.customModel")}</option>
                  </select>
                  {keyModelIsCustom ? (
                    <input ref={keyCustomModelInputRef} value={model} onChange={(event) => setModel(event.target.value)} data-testid="keymgr-model" />
                  ) : null}
                </div>
              </label>
              <label>
                <span>{t("keymgr.baseUrl")}</span>
                <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={t("keymgr.baseUrlPlaceholder")} data-testid="keymgr-base-url" />
              </label>
              <label>
                <span>{t("keymgr.apiFormat")}</span>
                <select value={apiFormat} onChange={(event) => setApiFormat(event.target.value as CockpitProviderApiFormat)} data-testid="keymgr-api-format">
                  <option value="openai_chat">{t("keymgr.apiFormatOpenaiChat")}</option>
                  <option value="legacy_chat">{t("keymgr.apiFormatLegacyChat")}</option>
                </select>
              </label>
              <label>
                <span>{t("keymgr.authHeader")}</span>
                <select value={authHeader} onChange={(event) => setAuthHeader(event.target.value as CockpitProviderAuthHeader)} data-testid="keymgr-auth-header">
                  <option value="bearer">{t("keymgr.authBearer")}</option>
                  <option value="api-key">{t("keymgr.authApiKey")}</option>
                  <option value="none">{t("keymgr.authNone")}</option>
                </select>
              </label>
              <label>
                <span>{t("keymgr.apiKeyEnv")}</span>
                <input
                  value={apiKeyEnv}
                  onChange={(event) => setApiKeyEnv(event.target.value.toUpperCase())}
                  disabled={!authRequiresKey}
                  aria-describedby={!authRequiresKey ? "keymgr-env-help" : undefined}
                  data-testid="keymgr-env"
                />
                {!authRequiresKey ? <span className="te-field-help" id="keymgr-env-help">{t("keymgr.noAuthEnvHelp")}</span> : null}
              </label>
              <label>
                <span>{t("keymgr.requestTimeout")}</span>
                <input
                  value={requestTimeoutMs}
                  onChange={(event) => setRequestTimeoutMs(event.target.value)}
                  inputMode="numeric"
                  aria-describedby={runtimeErrors.requestTimeoutMs ? "keymgr-request-timeout-error" : undefined}
                  aria-invalid={runtimeErrors.requestTimeoutMs ? "true" : undefined}
                  data-testid="keymgr-request-timeout"
                />
                {runtimeErrors.requestTimeoutMs ? <span className="te-field-error" id="keymgr-request-timeout-error" role="alert">{t("validation.requestTimeoutPositiveInteger")}</span> : null}
              </label>
              <label>
                <span>{t("keymgr.maxRetries")}</span>
                <input
                  value={maxRetries}
                  onChange={(event) => setMaxRetries(event.target.value)}
                  inputMode="numeric"
                  aria-describedby={runtimeErrors.maxRetries ? "keymgr-max-retries-error" : undefined}
                  aria-invalid={runtimeErrors.maxRetries ? "true" : undefined}
                  data-testid="keymgr-max-retries"
                />
                {runtimeErrors.maxRetries ? <span className="te-field-error" id="keymgr-max-retries-error" role="alert">{t("validation.maxRetriesNonNegativeInteger")}</span> : null}
              </label>
              <label>
                <span>{t("keymgr.apiKey")}</span>
                <input
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  type="password"
                  disabled={!authRequiresKey}
                  placeholder={authRequiresKey ? t("keymgr.apiKeyPlaceholder") : t("keymgr.apiKeyNoAuthPlaceholder")}
                  data-testid="keymgr-key"
                />
              </label>
              <label className="te-keymgr-wide">
                <span>{t("keymgr.extraHeaders")}</span>
                <textarea
                  value={extraHeadersText}
                  onChange={(event) => setExtraHeadersText(event.target.value)}
                  rows={4}
                  aria-describedby={extraHeadersDraft.error ? "keymgr-extra-headers-error" : "keymgr-extra-headers-help"}
                  aria-invalid={extraHeadersDraft.error ? "true" : undefined}
                  placeholder={t("keymgr.extraHeadersPlaceholder")}
                  data-testid="keymgr-extra-headers"
                />
                <span className="te-field-help" id="keymgr-extra-headers-help">{t("keymgr.extraHeadersHelp")}</span>
                {extraHeadersDraft.error ? <span className="te-field-error" id="keymgr-extra-headers-error" role="alert">{t("validation.extraHeadersJson")}</span> : null}
              </label>
            </div>
            <div className="te-keymgr-actions">
              <button type="button" disabled={!canSaveKey} onClick={() => {
                onSaveProviderKey({
                  provider: normalizedProvider,
                  model,
                  baseUrl,
                  apiKeyEnv: authRequiresKey ? apiKeyEnv : undefined,
                  apiKey: authRequiresKey ? apiKey || undefined : undefined,
                  apiFormat,
                  authHeader,
                  extraHeaders: extraHeadersDraft.headers,
                  requestTimeoutMs: numericDraft(requestTimeoutMs),
                  maxRetries: numericDraft(maxRetries)
                });
                setApiKey("");
              }} data-testid="keymgr-save-key">{t("keymgr.saveKey")}</button>
              <button type="button" className="te-quiet-button" disabled={busy || catalogBusy || !normalizedProvider} onClick={async () => {
                setCatalogMessage(t("keymgr.loadingModels"));
                setCatalogBusy(true);
                try {
                  const options = await onListProviderModels(normalizedProvider);
                  setCatalogModelsByProvider((current) => ({
                    ...current,
                    [normalizedProvider]: options
                  }));
                  const stale = options.some((item) => item.stale);
                  const cached = options.some((item) => item.cached);
                  setCatalogMessage(
                    stale
                      ? t("keymgr.modelsLoadedStale", { count: String(options.length) })
                      : cached
                        ? t("keymgr.modelsLoadedCached", { count: String(options.length) })
                        : options.length
                          ? t("keymgr.modelsLoaded", { count: String(options.length) })
                          : t("keymgr.noModelsFound")
                  );
                } catch (error) {
                  setCatalogMessage(t("keymgr.modelsFailed", { message: error instanceof Error ? error.message : String(error) }));
                } finally {
                  setCatalogBusy(false);
                }
              }} data-testid="keymgr-refresh-models">{t("keymgr.refreshModels")}</button>
              <button type="button" className="te-quiet-button" disabled={busy || !normalizedProvider || !selectedProvider} onClick={() => onTestProvider(normalizedProvider)} data-testid="keymgr-test-key">{t("keymgr.test")}</button>
              <button type="button" className="te-quiet-button" disabled={busy || !selectedProvider?.keyConfigured} onClick={() => {
                if (window.confirm(t("keymgr.removeKeyPrompt"))) onDeleteProviderKey(normalizedProvider);
              }} data-testid="keymgr-delete-key">{t("keymgr.removeKey")}</button>
            </div>
            {catalogBusy ? <LoadingState label={t("keymgr.loadingModels")} testId="keymgr-models-loading" /> : null}
            {busy ? <LoadingState label={t("state.keyManagerBusy")} testId="keymgr-busy-state" /> : null}
            {catalogMessage ? <p className="te-setup-message" data-testid="keymgr-models-message">{catalogMessage}</p> : null}
          </section>
        ) : (
          <section className="te-keymgr-body">
            <p>{t("keymgr.rolesIntro")}</p>
            <div className="te-role-list" data-testid="keymgr-role-list">
              {assignments.length ? assignments.map((assignment) => {
                const roleModelOptions = roleModelOptionIds(assignment.provider, roleProviders, assignment.model, catalogModelsByProvider);
                const selectedRoleModelChoice = roleModelOptions.includes(assignment.model) ? assignment.model : "__custom";
                const roleModelIsCustom = selectedRoleModelChoice === "__custom";
                return (
                  <div key={assignment.role} className="te-role-row">
                    <strong>{assignment.role}</strong>
                    <select value={assignment.provider} onChange={(event) => setAssignments((current) => updateAssignment(current, assignment.role, { provider: event.target.value, model: defaultModelFor(event.target.value, roleProviders, assignment.model) }))}>
                      {roleProviderOptions(roleProviderIds, externalAgents, assignment.provider).map((item) => (
                        <option key={item} value={item}>{labelProvider(item, externalAgents)}</option>
                      ))}
                    </select>
                    <select
                      value={selectedRoleModelChoice}
                      onChange={(event) => {
                        if (event.target.value === "__custom") {
                          if (roleModelOptions.includes(assignment.model)) setAssignments((current) => updateAssignment(current, assignment.role, { model: "" }));
                        } else {
                          setAssignments((current) => updateAssignment(current, assignment.role, { model: event.target.value }));
                        }
                      }}
                      data-testid={`keymgr-role-model-select-${assignment.role}`}
                    >
                      {roleModelOptions.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                      <option value="__custom">{t("keymgr.customModel")}</option>
                    </select>
                    {roleModelIsCustom ? (
                      <input autoFocus value={assignment.model} onChange={(event) => setAssignments((current) => updateAssignment(current, assignment.role, { model: event.target.value }))} data-testid={`keymgr-role-model-${assignment.role}`} />
                    ) : null}
                  </div>
                );
              }) : (
                <EmptyState title={t("state.noRoleAssignments")} detail={t("state.noRoleAssignmentsDetail")} testId="keymgr-roles-empty-state" />
              )}
            </div>
            <div className="te-keymgr-actions">
              <button type="button" disabled={busy || !assignments.length} onClick={() => onSaveRoleAssignments(assignments)} data-testid="keymgr-save-roles">{t("keymgr.saveRoles")}</button>
            </div>
            {busy ? <LoadingState label={t("state.keyManagerBusy")} testId="keymgr-roles-busy-state" /> : null}
          </section>
        )}
        {message ? <p className="te-setup-message" data-testid="keymgr-message">{message}</p> : null}
        {visibleConnectionResult ? (
          <p className="te-setup-message" data-testid="keymgr-connection">
            <span className={`te-chip ${resultTone}`}>{visibleConnectionResult.status}</span> {formatProviderConnectionMessage(visibleConnectionResult, t)}
          </p>
        ) : null}
    </ModalSurface>
  );
}

function updateAssignment(assignments: CockpitRoleAssignment[], role: string, patch: Partial<CockpitRoleAssignment>): CockpitRoleAssignment[] {
  return assignments.map((assignment) => assignment.role === role ? { ...assignment, ...patch } : assignment);
}

type ProviderFormDefaults = {
  model: string;
  baseUrl: string;
  apiKeyEnv: string;
  apiFormat: CockpitProviderApiFormat;
  authHeader: CockpitProviderAuthHeader;
  extraHeadersText: string;
  requestTimeoutMs: number;
  maxRetries: number;
};

export function providerFormDefaults(
  provider: string,
  providers: Array<{
    id: string;
    model: string;
    baseUrl: string;
    apiKeyEnv?: string;
    apiFormat?: CockpitProviderApiFormat;
    authHeader?: CockpitProviderAuthHeader;
    extraHeaders?: Record<string, string>;
    requestTimeoutMs?: number;
    maxRetries?: number;
  }>,
  selectedModel?: string
): ProviderFormDefaults {
  const providerId = normalizeProviderId(provider);
  const selectedProvider = providers.find((item) => item.id === providerId);
  return {
    model: selectedModel ?? selectedProvider?.model ?? suggestedModelFor(providerId),
    baseUrl: selectedProvider?.baseUrl ?? defaultBaseUrlFor(providerId),
    apiKeyEnv: selectedProvider?.apiKeyEnv ?? defaultEnvFor(providerId),
    apiFormat: selectedProvider?.apiFormat ?? defaultApiFormatFor(providerId),
    authHeader: selectedProvider?.authHeader ?? defaultAuthHeaderFor(providerId),
    extraHeadersText: formatExtraHeaders(selectedProvider?.extraHeaders ?? {}),
    requestTimeoutMs: selectedProvider?.requestTimeoutMs ?? 60_000,
    maxRetries: selectedProvider?.maxRetries ?? 1
  };
}

export function canSaveProviderConfig(input: {
  provider: string;
  model: string;
  baseUrl: string;
  apiKeyEnv: string;
  apiKey?: string;
  keyConfigured: boolean;
  authHeader?: CockpitProviderAuthHeader;
  extraHeadersValid?: boolean;
  busy: boolean;
  requestTimeoutMs?: string;
  maxRetries?: string;
}): boolean {
  const runtimeValid = !hasProviderRuntimeErrors(providerRuntimeErrors({
    requestTimeoutMs: input.requestTimeoutMs ?? "",
    maxRetries: input.maxRetries ?? ""
  }));
  const authRequiresKey = (input.authHeader ?? "bearer") !== "none";
  const keyReady = !authRequiresKey || Boolean(input.apiKeyEnv.trim() && (input.apiKey?.trim() || input.keyConfigured));
  return Boolean(input.provider && input.model.trim() && input.baseUrl.trim() && keyReady) && runtimeValid && input.extraHeadersValid !== false && !input.busy;
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

export function roleModelOptionIds(
  provider: string,
  providers: Array<{ id: string; model: string; models?: CockpitProviderModelOption[] }>,
  _currentModel: string,
  catalogModelsByProvider: Record<string, CockpitProviderModelOption[]> = {}
): string[] {
  if (provider === "auto" || provider.startsWith("external:")) return ["auto"];
  const providerId = normalizeProviderId(provider);
  const selectedProvider = providers.find((item) => item.id === providerId);
  return modelOptionIds(providerId, selectedProvider?.model, [
    ...(selectedProvider?.models ?? []),
    ...(catalogModelsByProvider[providerId] ?? [])
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

function defaultApiFormatFor(provider: string): CockpitProviderApiFormat {
  const providerId = normalizeProviderId(provider);
  return providerId === "anthropic" ? "legacy_chat" : "openai_chat";
}

function defaultAuthHeaderFor(provider: string): CockpitProviderAuthHeader {
  const providerId = normalizeProviderId(provider);
  if (providerId === "mimo" || providerId === "anthropic" || providerId === "gemini") return "api-key";
  if (providerId === "ollama" || providerId === "mock" || providerId === "fixture") return "none";
  return "bearer";
}

function isManageableProvider(provider: { id: string; authRequired: boolean; baseUrl: string; apiKeyEnv?: string }): boolean {
  return provider.authRequired || Boolean(provider.baseUrl) || Boolean(provider.apiKeyEnv);
}

function nextRelayProviderId(existing: string[]): string {
  const ids = new Set(existing.map((item) => normalizeProviderId(item)));
  let index = 1;
  let candidate = "custom_relay";
  while (ids.has(candidate)) {
    index += 1;
    candidate = `custom_relay_${index}`;
  }
  return candidate;
}

function formatProviderTransport(provider: { apiFormat?: string; authHeader?: string; baseUrl?: string }): string {
  return [provider.apiFormat ?? "openai_chat", provider.authHeader ?? "bearer", provider.baseUrl ?? ""].filter(Boolean).join(" / ");
}

function formatExtraHeaders(headers: Record<string, string>): string {
  return Object.keys(headers).length ? JSON.stringify(headers, null, 2) : "{}";
}

function parseExtraHeadersDraft(value: string): { headers: Record<string, string>; error?: "invalid_json" | "invalid_shape" } {
  const trimmed = value.trim();
  if (!trimmed) return { headers: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { headers: {}, error: "invalid_json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { headers: {}, error: "invalid_shape" };
  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(parsed)) {
    if (typeof headerValue !== "string") return { headers: {}, error: "invalid_shape" };
    const headerName = key.trim();
    const valueText = headerValue.trim();
    if (headerName && valueText) headers[headerName] = valueText;
  }
  return { headers };
}

function suggestedModelFor(provider: string): string {
  const providerId = normalizeProviderId(provider);
  return suggestedModelForProvider(providerId);
}

function staticModelOptionsFor(provider: string): string[] {
  const providerId = normalizeProviderId(provider);
  return staticModelIdsForProvider(providerId);
}

function labelProvider(provider: string, externalAgents: CockpitExternalAgentOption[] = []): string {
  const externalAgent = externalAgents.find((agent) => agent.provider === provider);
  if (externalAgent) return `${externalAgent.provider} (${externalAgent.name})`;
  return provider.replace(/_/g, " ");
}

function normalizeProviderId(provider: string): string {
  return provider.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_");
}
