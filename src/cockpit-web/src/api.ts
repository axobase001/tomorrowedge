import type { CockpitRunRequest, CockpitViewModel } from "../../cockpit/contracts.js";

export async function loadCockpitViewModel(sessionId: string, nonce: string): Promise<CockpitViewModel> {
  const response = await fetch(withNonce(`/api/sessions/${encodeURIComponent(sessionId)}/view-model`, nonce));
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<CockpitViewModel>;
}

export async function startCockpitRun(request: CockpitRunRequest, nonce: string): Promise<{ sessionId: string; status: string }> {
  const response = await fetch(withNonce("/api/runs", nonce), {
    method: "POST",
    headers: { "content-type": "application/json", "x-tomorrowedge-token": nonce },
    body: JSON.stringify(request)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<{ sessionId: string; status: string }>;
}

function withNonce(url: string, nonce: string): string {
  if (!nonce) return url;
  return `${url}${url.includes("?") ? "&" : "?"}nonce=${encodeURIComponent(nonce)}`;
}
