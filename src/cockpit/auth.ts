import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export function isAuthorizedCockpitRequest(request: IncomingMessage, url: URL, nonce: string): boolean {
  const provided = request.headers["x-tomorrowedge-token"] ?? request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("nonce") ?? "";
  const presented = Array.isArray(provided) ? provided[0] : provided;
  if (!presented) return false;
  const presentedBuffer = Buffer.from(presented, "utf8");
  const nonceBuffer = Buffer.from(nonce, "utf8");
  if (presentedBuffer.byteLength !== nonceBuffer.byteLength) return false;
  return timingSafeEqual(presentedBuffer, nonceBuffer);
}

export function isAllowedBrowserOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (Array.isArray(origin)) return false;
  if (!origin) return true;
  const host = request.headers.host;
  if (!host || Array.isArray(host)) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === host && (parsed.protocol === "http:" || parsed.protocol === "https:");
  } catch {
    return false;
  }
}
