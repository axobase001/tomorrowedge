import type { Translator } from "../i18n.js";
import { translateKnownValue } from "../i18n.js";

export function StatusChip({ status, t }: { status: string; t?: Translator }) {
  const lowered = status.toLowerCase();
  const tone = lowered.includes("fail") || lowered.includes("reject")
    ? "red"
    : lowered.includes("wait") || lowered.includes("approval") || lowered.includes("not_run")
      ? "amber"
      : lowered.includes("done") || lowered.includes("pass") || lowered.includes("low")
        ? "green"
        : "blue";
  const label = t ? translateKnownValue(t, status) : status;
  return (
    <span className={`te-chip te-chip-${tone} te-status-chip`}>
      <span className="te-chip-signal" aria-hidden="true">{signalForTone(tone)}</span>
      <span>{label}</span>
    </span>
  );
}

function signalForTone(tone: "blue" | "green" | "amber" | "red"): string {
  if (tone === "green") return "OK";
  if (tone === "amber") return "WAIT";
  if (tone === "red") return "ERR";
  return "INFO";
}
