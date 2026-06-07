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

export async function listCockpitSessions(options: CockpitApiOptions): Promise<CockpitSessionSummary[]> {
  const response = await fetch(apiUrl("/api/sessions", options), { headers: apiHeaders(options) });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<CockpitSessionSummary[]>;
}

export async function loadCockpitViewModel(sessionId: string, options: CockpitApiOptions): Promise<CockpitViewModel> {
  const response = await fetch(apiUrl(`/api/sessions/${encodeURIComponent(sessionId)}/view-model`, options), { headers: apiHeaders(options) });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<CockpitViewModel>;
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
