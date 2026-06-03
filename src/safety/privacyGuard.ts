import { scanSecrets, type SecretFinding } from "./secretScanner.js";

export type PrivacyDecision = {
  allowed: boolean;
  reason: string;
  findings: SecretFinding[];
};

export function canSendToCloud(content: string, privacyMode: "normal" | "privacy" | "local"): PrivacyDecision {
  const findings = scanSecrets(content);
  if (privacyMode !== "normal") {
    return { allowed: false, reason: "Privacy/local mode blocks raw repo file upload to cloud providers.", findings };
  }
  if (findings.length) {
    return { allowed: false, reason: "Secret-like content detected.", findings };
  }
  return { allowed: true, reason: "No privacy blocker detected.", findings };
}
