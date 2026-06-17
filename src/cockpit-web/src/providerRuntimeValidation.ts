export type ProviderRuntimeDraft = {
  requestTimeoutMs: string;
  maxRetries: string;
};

export type ProviderRuntimeErrors = {
  requestTimeoutMs?: "positive_integer";
  maxRetries?: "non_negative_integer";
};

export function providerRuntimeErrors(input: ProviderRuntimeDraft): ProviderRuntimeErrors {
  const errors: ProviderRuntimeErrors = {};
  if (!isOptionalInteger(input.requestTimeoutMs, (value) => value > 0)) {
    errors.requestTimeoutMs = "positive_integer";
  }
  if (!isOptionalInteger(input.maxRetries, (value) => value >= 0)) {
    errors.maxRetries = "non_negative_integer";
  }
  return errors;
}

export function hasProviderRuntimeErrors(errors: ProviderRuntimeErrors): boolean {
  return Boolean(errors.requestTimeoutMs || errors.maxRetries);
}

export function numericDraft(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function isOptionalInteger(value: string, valid: (value: number) => boolean): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && valid(parsed);
}
