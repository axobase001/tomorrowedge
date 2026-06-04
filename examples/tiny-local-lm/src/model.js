const DEFAULT_CORPUS = [
  "TomorrowEdge routes capabilities, not just requests.",
  "Strong models plan and judge. Efficient models explore and implement.",
  "Local models protect privacy. Humans authorize the actions that matter.",
  "A tiny local model can draft short text without calling a cloud API.",
  "Trace quality matters: every handoff, review, repair, and judgment is logged.",
  "Engineers need a visible cockpit for multi-model coding workflows."
].join("\n");

export function createTinyCharModel(corpus = DEFAULT_CORPUS, order = 3) {
  const normalizedOrder = Math.max(1, Math.min(5, Math.floor(order)));
  const tables = new Map();
  const global = new Map();
  const text = corpus.replace(/\s+/g, " ").trim();

  for (const char of text) increment(global, char);
  for (let index = 0; index < text.length; index += 1) {
    for (let size = 1; size <= normalizedOrder; size += 1) {
      const start = index - size;
      if (start < 0) continue;
      const key = text.slice(start, index);
      const next = text[index];
      if (!tables.has(key)) tables.set(key, new Map());
      increment(tables.get(key), next);
    }
  }

  const parameterCount = [...tables.values()].reduce((sum, table) => sum + table.size, 0) + global.size;

  return {
    info() {
      return {
        type: "char-level n-gram",
        order: normalizedOrder,
        parameterCount,
        corpusCharacters: text.length,
        vocabularySize: global.size,
        cloudApi: false
      };
    },
    generate(prompt, options = {}) {
      const maxTokens = clampInt(options.maxTokens ?? 80, 1, 500);
      const temperature = clampNumber(options.temperature ?? 0.8, 0.05, 2);
      const random = seededRandom(String(options.seed ?? `${prompt}:${maxTokens}:${temperature}`));
      let output = String(prompt ?? "");

      for (let step = 0; step < maxTokens; step += 1) {
        const distribution = lookupDistribution(output, tables, global, normalizedOrder);
        const next = sample(distribution, temperature, random);
        output += next;
      }
      return {
        text: output,
        generated: output.slice(String(prompt ?? "").length),
        prompt: String(prompt ?? ""),
        parameters: { temperature, maxTokens },
        modelInfo: this.info()
      };
    }
  };
}

function lookupDistribution(output, tables, global, order) {
  for (let size = Math.min(order, output.length); size >= 1; size -= 1) {
    const key = output.slice(-size);
    const table = tables.get(key);
    if (table) return table;
  }
  return global;
}

function sample(distribution, temperature, random) {
  const entries = [...distribution.entries()];
  const weights = entries.map(([, count]) => Math.pow(count, 1 / temperature));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = random() * total;
  for (let index = 0; index < entries.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return entries[index][0];
  }
  return entries[entries.length - 1][0];
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function clampInt(value, min, max) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function clampNumber(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function seededRandom(seedText) {
  let seed = 2166136261;
  for (const char of seedText) {
    seed ^= char.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
