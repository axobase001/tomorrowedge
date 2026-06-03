export type SecretFinding = {
  kind: string;
  line: number;
  preview: string;
};

const patterns: Array<[string, RegExp]> = [
  ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/],
  ["api_key_assignment", /\b[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)\b\s*=\s*['"]?[^'"\s]+/i],
  ["bearer_token", /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/],
  ["connection_string", /\b(?:postgres|mysql|mongodb|redis):\/\/[^/\s:]+:[^@\s]+@/i]
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

export function redact(value: string): string {
  if (value.length <= 12) return "[redacted]";
  return `${value.slice(0, 6)}...[redacted]`;
}
