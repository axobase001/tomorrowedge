export type StaticProviderModel = {
  id: string;
  label?: string;
  tags?: string[];
  isFree?: boolean;
  isLowCost?: boolean;
};

export const staticProviderModels: Record<string, StaticProviderModel[]> = {
  openrouter: [
    { id: "moonshotai/kimi-k2.6:free", label: "Kimi K2.6 free", tags: ["kimi", "free"], isFree: true },
    { id: "qwen/qwen3-coder:free", label: "Qwen3 Coder free", tags: ["qwen", "coding", "free"], isFree: true },
    { id: "deepseek/deepseek-chat-v3-0324:free", label: "DeepSeek V3 free", tags: ["deepseek", "free"], isFree: true }
  ],
  deepseek: [
    { id: "deepseek-chat", label: "DeepSeek Chat", tags: ["deepseek", "coding"] },
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner", tags: ["deepseek", "reasoning"] },
    { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", tags: ["deepseek", "coding"] }
  ],
  kimi: [
    { id: "kimi-k2.6", label: "Kimi K2.6", tags: ["kimi"] },
    { id: "kimi-k2-0711-preview", label: "Kimi K2 preview", tags: ["kimi"] },
    { id: "kimi-latest", label: "Kimi latest", tags: ["kimi"] }
  ],
  mimo: [
    { id: "mimo-v2.5-pro", label: "MiMo V2.5 Pro", tags: ["mimo"] }
  ],
  anthropic: [
    { id: "claude-opus-4.1", label: "Claude Opus 4.1", tags: ["anthropic", "reasoning"] },
    { id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5", tags: ["anthropic", "coding"] }
  ],
  gemini: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", tags: ["gemini", "reasoning"] },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", tags: ["gemini", "fast"] }
  ],
  ollama: [
    { id: "llama3.2", label: "Llama 3.2", tags: ["local"] },
    { id: "qwen2.5-coder", label: "Qwen2.5 Coder", tags: ["local", "coding"] },
    { id: "deepseek-r1", label: "DeepSeek R1", tags: ["local", "reasoning"] }
  ],
  openai_compatible: [
    { id: "gpt-4o-mini", label: "GPT-4o mini", tags: ["openai", "fast"] },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini", tags: ["openai", "coding"] },
    { id: "gpt-5.2", label: "GPT-5.2", tags: ["openai", "reasoning"] }
  ]
};

export const suggestedProviderModels: Record<string, string> = {
  openrouter: "moonshotai/kimi-k2.6:free",
  deepseek: "deepseek-chat",
  kimi: "kimi-k2.6",
  mimo: "mimo-v2.5-pro",
  anthropic: "claude-opus-4.1",
  gemini: "gemini-2.5-pro",
  openai_compatible: "gpt-4o-mini",
  ollama: "llama3.2"
};

export function staticModelsForProvider(providerId: string): StaticProviderModel[] {
  return staticProviderModels[normalizeProviderKey(providerId)] ?? [];
}

export function staticModelIdsForProvider(providerId: string): string[] {
  return staticModelsForProvider(providerId).map((model) => model.id);
}

export function suggestedModelForProvider(providerId: string): string {
  return suggestedProviderModels[normalizeProviderKey(providerId)] ?? "";
}

function normalizeProviderKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_");
}
