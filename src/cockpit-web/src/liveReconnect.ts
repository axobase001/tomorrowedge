const reconnectBaseDelayMs = 500;
const reconnectMaxDelayMs = 5000;

export function liveReconnectDelayMs(attempt: number): number {
  const normalizedAttempt = Math.max(1, Math.floor(Number.isFinite(attempt) ? attempt : 1));
  return Math.min(reconnectMaxDelayMs, reconnectBaseDelayMs * 2 ** Math.min(normalizedAttempt - 1, 4));
}
