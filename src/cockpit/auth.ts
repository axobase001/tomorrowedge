import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { log } from "../utils/logger.js";

export function isAuthorizedCockpitRequest(request: IncomingMessage, nonce: string): boolean {
  const provided = request.headers["x-tomorrowedge-token"]
    ?? request.headers.authorization?.replace(/^Bearer\s+/i, "")
    ?? nonceFromCookie(request)
    ?? "";
  const presented = Array.isArray(provided) ? provided[0] : provided;
  if (!presented) return false;
  const presentedBuffer = Buffer.from(presented, "utf8");
  const nonceBuffer = Buffer.from(nonce, "utf8");
  if (presentedBuffer.byteLength !== nonceBuffer.byteLength) return false;
  return timingSafeEqual(presentedBuffer, nonceBuffer);
}

function nonceFromCookie(request: IncomingMessage): string | undefined {
  const cookie = request.headers.cookie;
  if (!cookie || Array.isArray(cookie)) return undefined;
  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey !== "tomorrowedge_nonce") continue;
    const encoded = rawValue.join("=");
    if (!encoded) return undefined;
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return undefined;
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
  } catch (error) {
    log("warn", `Invalid cockpit Origin header ignored: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
