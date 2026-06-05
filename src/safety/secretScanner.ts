export type SecretFinding = {
  kind: string;
  line: number;
  preview: string;
};

const patterns: Array<[string, RegExp]> = [
  ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/],
  ["api_key_assignment", /\b[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)\b\s*=\s*['"]?[^'"\s]+/i],
  ["bearer_token", /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/],
  ["connection_string", /\b(?:postgres|mysql|mongodb|redis):\/\/[^/\s:]+:[^@\s]+@/i],
  ["aws_access_key", /\bAKIA[0-9A-Z]{16}\b/],
  ["github_token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ["npm_token", /\bnpm_[A-Za-z0-9]{30,}\b/],
  ["slack_token", /\bxox[abprs]-[A-Za-z0-9-]{20,}\b/],
  ["openai_like_key", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["provider_user_identifier", /["']?(?:user|account|tenant|organization|org)[_-]?id["']?\s*[:=]\s*["']?[^"',}\s]+["']?/i],
  ["high_entropy_token", /\b(?=[A-Za-z0-9_/-]{48,}\b)(?=[A-Za-z0-9_/-]*[a-z])(?=[A-Za-z0-9_/-]*[A-Z])(?=[A-Za-z0-9_/-]*[0-9])[A-Za-z0-9_/-]{48,}\b/]
];

export function scanSecrets(content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((lineText, index) => {
    for (const [kind, pattern] of patterns) {
      if (pattern.test(lineText)) {
        findings.push({
          kind,
          line: index + 1,
          preview: redact(lineText.trim())
        });
      }
    }
  });
  return findings;
}

export function redact(_value: string): string {
  return "[redacted]";
}

export function redactText(content: string): string {
  let redacted = content;
  for (const [, pattern] of patterns) {
    redacted = redacted.replace(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`), "[redacted]");
  }
  return redacted;
}

export function redactValue<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactValue(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item)])) as T;
  }
  return value;
}
