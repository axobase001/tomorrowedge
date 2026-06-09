import type { CockpitApprovalIntent, CockpitRunRequest, CockpitViewModel } from "../../cockpit/contracts.js";

export type CockpitSessionSummary = {
  sessionId: string;
  createdAt: string;
  eventCount: number;
  artifactCount: number;
  goal?: string;
  result?: string;
};

export type CockpitApiOptions = {
  nonce: string;
  apiBase?: string;
};

export type CockpitProviderReadiness = {
  id: string;
  enabled: boolean;
  model: string;
  baseUrl: string;
  apiKeyEnv?: string;
  keyConfigured: boolean;
  keySource: "env" | "local_env" | "not_required" | "missing";
  maskedKey?: string;
  authRequired: boolean;
};

export type CockpitRoleAssignment = {
  role: string;
  provider: string;
  model: string;
  reason?: string;
};

export type CockpitExternalAgentOption = {
  id: string;
  provider: string;
  name: string;
  roles: string[];
  capabilities: string[];
};

export type CockpitSetupStatus = {
  needsSetup: boolean;
  recommendedProvider: string;
  configPath: string;
  providers: CockpitProviderReadiness[];
  externalAgents: CockpitExternalAgentOption[];
  roleAssignments: CockpitRoleAssignment[];
  selectedProvider?: string;
  selectedModel?: string;
};

export type CockpitSetupRequest = {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKey?: string;
  bindRoles?: boolean;
};

export type CockpitProviderKeyRequest = {
  provider: string;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKey?: string;
};

export type CockpitProviderModelOption = {
  id: string;
  label: string;
  source: "catalog" | "static";
  isFree?: boolean;
  isLowCost?: boolean;
  tags?: string[];
};

export type CockpitRoleAssignmentsRequest = {
  assignments: CockpitRoleAssignment[];
};

export type CockpitProviderConnectionResult = {
  id: string;
  status: "ok" | "skipped" | "missing_key" | "failed";
  httpStatus?: number;
  url?: string;
  detail: string;
};

export async function listCockpitSessions(options: CockpitApiOptions): Promise<CockpitSessionSummary[]> {
  const response = await fetch(apiUrl("/api/sessions", options), { headers: apiHeaders(options) });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<CockpitSessionSummary[]>;
}

export async function loadCockpitSetupStatus(options: CockpitApiOptions): Promise<CockpitSetupStatus> {
  const response = await fetch(apiUrl("/api/setup/status", options), { headers: apiHeaders(options) });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<CockpitSetupStatus>;
}

export async function configureCockpitSetup(request: CockpitSetupRequest, options: CockpitApiOptions): Promise<CockpitSetupStatus> {
  const response = await fetch(apiUrl("/api/setup/configure", options), {
    method: "POST",
    headers: apiHeaders(options, { "content-type": "application/json" }),
    body: JSON.stringify(request)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<CockpitSetupStatus>;
}

export async function saveCockpitProviderKey(request: CockpitProviderKeyRequest, options: CockpitApiOptions): Promise<CockpitSetupStatus> {
  const response = await fetch(apiUrl(`/api/setup/keys/${encodeURIComponent(request.provider)}`, options), {
    method: "PUT",
    headers: apiHeaders(options, { "content-type": "application/json" }),
    body: JSON.stringify(request)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<CockpitSetupStatus>;
}

export async function deleteCockpitProviderKey(provider: string, options: CockpitApiOptions): Promise<CockpitSetupStatus> {
  const response = await fetch(apiUrl(`/api/setup/keys/${encodeURIComponent(provider)}`, options), {
    method: "DELETE",
    headers: apiHeaders(options)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<CockpitSetupStatus>;
}

export async function saveCockpitRoleAssignments(request: CockpitRoleAssignmentsRequest, options: CockpitApiOptions): Promise<CockpitSetupStatus> {
  const response = await fetch(apiUrl("/api/setup/roles", options), {
    method: "PUT",
    headers: apiHeaders(options, { "content-type": "application/json" }),
    body: JSON.stringify(request)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<CockpitSetupStatus>;
}

export async function testCockpitSetupProvider(provider: string, options: CockpitApiOptions): Promise<CockpitProviderConnectionResult> {
  const response = await fetch(apiUrl("/api/setup/test", options), {
    method: "POST",
    headers: apiHeaders(options, { "content-type": "application/json" }),
    body: JSON.stringify({ provider })
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<CockpitProviderConnectionResult>;
}

export async function listCockpitProviderModels(provider: string, options: CockpitApiOptions): Promise<CockpitProviderModelOption[]> {
  const response = await fetch(apiUrl(`/api/setup/models?provider=${encodeURIComponent(provider)}`, options), { headers: apiHeaders(options) });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<CockpitProviderModelOption[]>;
}

export async function loadCockpitViewModel(sessionId: string, options: CockpitApiOptions): Promise<CockpitViewModel> {
  const response = await fetch(apiUrl(`/api/sessions/${encodeURIComponent(sessionId)}/view-model`, options), { headers: apiHeaders(options) });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<CockpitViewModel>;
}

export async function renameCockpitSession(sessionId: string, goal: string, options: CockpitApiOptions): Promise<{ sessionId: string; goal: string; viewModel?: CockpitViewModel }> {
  const response = await fetch(apiUrl(`/api/sessions/${encodeURIComponent(sessionId)}`, options), {
    method: "PATCH",
    headers: apiHeaders(options, { "content-type": "application/json" }),
    body: JSON.stringify({ goal })
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<{ sessionId: string; goal: string; viewModel?: CockpitViewModel }>;
}

export async function deleteCockpitSession(sessionId: string, options: CockpitApiOptions): Promise<CockpitSessionSummary[]> {
  const response = await fetch(apiUrl(`/api/sessions/${encodeURIComponent(sessionId)}`, options), {
    method: "DELETE",
    headers: apiHeaders(options)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<CockpitSessionSummary[]>;
}

export async function startCockpitRun(request: CockpitRunRequest, options: CockpitApiOptions): Promise<{ sessionId: string; status: string }> {
  const response = await fetch(apiUrl("/api/runs", options), {
    method: "POST",
    headers: apiHeaders(options, { "content-type": "application/json" }),
    body: JSON.stringify(request)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<{ sessionId: string; status: string }>;
}

export async function applyCockpitApproval(intent: CockpitApprovalIntent, options: CockpitApiOptions): Promise<{ status: string; message: string; viewModel?: CockpitViewModel }> {
  const response = await fetch(apiUrl("/api/approvals", options), {
    method: "POST",
    headers: apiHeaders(options, { "content-type": "application/json" }),
    body: JSON.stringify(intent)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<{ status: string; message: string; viewModel?: CockpitViewModel }>;
}

export function cockpitLiveEventsUrl(sessionId: string, options: CockpitApiOptions): string {
  return apiUrl(`/api/runs/${encodeURIComponent(sessionId)}/events/live`, options);
}

function apiUrl(path: string, options: CockpitApiOptions): string {
  const base = options.apiBase?.replace(/\/$/, "") ?? "";
  const separator = path.includes("?") ? "&" : "?";
  return `${base}${path}${options.nonce ? `${separator}nonce=${encodeURIComponent(options.nonce)}` : ""}`;
}

function apiHeaders(options: CockpitApiOptions, extra: Record<string, string> = {}): Record<string, string> {
  return options.nonce ? { ...extra, "x-tomorrowedge-token": options.nonce } : extra;
}
