const BASE_CORPUS = [
  "TomorrowEdge routes capabilities, not just requests.",
  "Strong models plan and judge. Efficient models explore and implement.",
  "Local models protect privacy. Humans authorize the actions that matter.",
  "Trace quality matters: every handoff, review, repair, and judgment is logged.",
  "Engineers need a visible cockpit for multi-model coding workflows.",
  "明日边缘路由能力，而不只是路由请求。",
  "强模型负责计划与裁决，高性价比模型负责探索与实现。",
  "本地模型保护隐私，人类授权真正重要的动作。",
  "事件账本记录每一次分工、审查、修复和最终裁决。",
  "工程团队需要一个可见、可审计、可回滚的多模型驾驶舱。"
];

const ENGLISH_TOPICS = ["routing", "planning", "review", "repair", "privacy", "testing", "trace", "handoff", "workflow", "budget"];
const CHINESE_TOPICS = ["路由", "计划", "审查", "修复", "隐私", "测试", "追踪", "交接", "流程", "预算"];
const ENGLISH_VERBS = ["checks", "guides", "records", "debates", "verifies", "summarizes", "protects", "coordinates"];
const CHINESE_VERBS = ["检查", "引导", "记录", "辩论", "验证", "总结", "保护", "协调"];

const DEFAULT_CORPUS = buildBilingualCorpus();
const DEFAULT_OPTIONS = {
  order: 5,
  contextBuckets: 131072,
  embeddingSize: 384
};

export function createTinyCharModel(corpus = DEFAULT_CORPUS, orderOrOptions = DEFAULT_OPTIONS.order, maybeOptions = {}) {
  const options = normalizeOptions(orderOrOptions, maybeOptions);
  const text = normalizeCorpus(corpus);
  const vocabulary = buildVocabulary(text);
  const charToIndex = new Map(vocabulary.map((char, index) => [char, index]));
  const transitions = buildTransitions(text, options.order);
  const global = countGlobal(text);
  const contextEmbeddings = createContextEmbeddings(options.contextBuckets, options.embeddingSize, text);
  const outputEmbeddings = createOutputEmbeddings(vocabulary, options.embeddingSize, text);
  const outputBias = createOutputBias(vocabulary, global);
  const denseParameterCount = contextEmbeddings.length + outputEmbeddings.length + outputBias.length;
  const ngramParameterCount = [...transitions.values()].reduce((sum, table) => sum + table.size, 0);
  const parameterCount = denseParameterCount + ngramParameterCount;

  return {
    info() {
      return {
        type: "bilingual hashed neural n-gram",
        order: options.order,
        parameterCount,
        denseParameterCount,
        ngramParameterCount,
        contextBuckets: options.contextBuckets,
        embeddingSize: options.embeddingSize,
        corpusCharacters: text.length,
        vocabularySize: vocabulary.length,
        languages: ["zh-CN", "en"],
        cloudApi: false
      };
    },
    generate(prompt, optionsForGeneration = {}) {
      const maxTokens = clampInt(optionsForGeneration.maxTokens ?? 80, 1, 500);
      const temperature = clampNumber(optionsForGeneration.temperature ?? 0.8, 0.05, 2);
      const random = seededRandom(String(optionsForGeneration.seed ?? `${prompt}:${maxTokens}:${temperature}`));
      let output = String(prompt ?? "");

      for (let step = 0; step < maxTokens; step += 1) {
        const next = sampleNext({
          output,
          temperature,
          random,
          options,
          vocabulary,
          charToIndex,
          transitions,
          global,
          contextEmbeddings,
          outputEmbeddings,
          outputBias
        });
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

export const createBilingualLocalModel = createTinyCharModel;

function buildBilingualCorpus() {
  const lines = [...BASE_CORPUS];
  for (let index = 0; index < 160; index += 1) {
    const englishTopic = ENGLISH_TOPICS[index % ENGLISH_TOPICS.length];
    const chineseTopic = CHINESE_TOPICS[index % CHINESE_TOPICS.length];
    const englishVerb = ENGLISH_VERBS[index % ENGLISH_VERBS.length];
    const chineseVerb = CHINESE_VERBS[index % CHINESE_VERBS.length];
    lines.push(`TomorrowEdge ${englishVerb} ${englishTopic} evidence before the judge accepts a patch.`);
    lines.push(`A local bilingual model keeps ${englishTopic} notes inside the developer machine.`);
    lines.push(`明日边缘在裁决前${chineseVerb}${chineseTopic}证据，并把过程写入事件账本。`);
    lines.push(`本地双语模型把${chineseTopic}记录留在开发者机器上，不调用云端接口。`);
    lines.push(`When ${englishTopic} changes, reviewer and judge compare English notes with 中文说明。`);
  }
  return lines.join("\n");
}

function normalizeOptions(orderOrOptions, maybeOptions) {
  const raw = typeof orderOrOptions === "object" ? orderOrOptions : { ...maybeOptions, order: orderOrOptions };
  return {
    order: clampInt(raw.order ?? DEFAULT_OPTIONS.order, 1, 8),
    contextBuckets: clampInt(raw.contextBuckets ?? DEFAULT_OPTIONS.contextBuckets, 512, 131072),
    embeddingSize: clampInt(raw.embeddingSize ?? DEFAULT_OPTIONS.embeddingSize, 16, 384)
  };
}

function normalizeCorpus(corpus) {
  return String(corpus).replace(/\s+/g, " ").trim();
}

function buildVocabulary(text) {
  return [...new Set(text.split(""))].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function buildTransitions(text, order) {
  const transitions = new Map();
  for (let index = 0; index < text.length; index += 1) {
    for (let size = 1; size <= order; size += 1) {
      const start = index - size;
      if (start < 0) continue;
      const key = text.slice(start, index);
      const next = text[index];
      if (!transitions.has(key)) transitions.set(key, new Map());
      increment(transitions.get(key), next);
    }
  }
  return transitions;
}

function countGlobal(text) {
  const global = new Map();
  for (const char of text) increment(global, char);
  return global;
}

function createContextEmbeddings(bucketCount, embeddingSize, text) {
  const values = new Float32Array(bucketCount * embeddingSize);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = deterministicWeight(`ctx:${index}:${text.length}`);
  }
  return values;
}

function createOutputEmbeddings(vocabulary, embeddingSize, text) {
  const values = new Float32Array(vocabulary.length * embeddingSize);
  for (let charIndex = 0; charIndex < vocabulary.length; charIndex += 1) {
    const char = vocabulary[charIndex];
    for (let dim = 0; dim < embeddingSize; dim += 1) {
      values[charIndex * embeddingSize + dim] = deterministicWeight(`out:${char}:${dim}:${text.length}`);
    }
  }
  return values;
}

function createOutputBias(vocabulary, global) {
  const total = [...global.values()].reduce((sum, count) => sum + count, 0);
  return Float32Array.from(vocabulary.map((char) => Math.log(((global.get(char) ?? 0) + 1) / (total + vocabulary.length))));
}

function sampleNext(input) {
  const bucket = hashContext(input.output, input.options.order, input.options.contextBuckets);
  const transitionTable = lookupTransition(input.output, input.transitions, input.options.order);
  const scores = input.vocabulary.map((char, charIndex) => {
    const denseScore = dotContextOutput(input.contextEmbeddings, bucket, input.outputEmbeddings, charIndex, input.options.embeddingSize);
    const transitionCount = transitionTable ? (transitionTable.get(char) ?? 0.02) : (input.global.get(char) ?? 1);
    const transitionBoost = Math.log(transitionCount + 1) * 4.2;
    return denseScore + transitionBoost + input.outputBias[charIndex] + languageBias(input.output, char);
  });
  return sampleFromScores(input.vocabulary, scores, input.temperature, input.random);
}

function lookupTransition(output, transitions, order) {
  for (let size = Math.min(order, output.length); size >= 1; size -= 1) {
    const table = transitions.get(output.slice(-size));
    if (table) return table;
  }
  return undefined;
}

function dotContextOutput(contextEmbeddings, bucket, outputEmbeddings, charIndex, embeddingSize) {
  let score = 0;
  const contextOffset = bucket * embeddingSize;
  const outputOffset = charIndex * embeddingSize;
  for (let dim = 0; dim < embeddingSize; dim += 1) {
    score += contextEmbeddings[contextOffset + dim] * outputEmbeddings[outputOffset + dim];
  }
  return score / Math.sqrt(embeddingSize);
}

function languageBias(output, char) {
  const recent = output.slice(-24);
  if (!recent) return 0;
  const recentHasChinese = /[\u4e00-\u9fff]/.test(recent);
  const charIsChinese = /[\u4e00-\u9fff]/.test(char);
  if (recentHasChinese && charIsChinese) return 2.2;
  if (recentHasChinese && char === " ") return -2.4;
  if (!recentHasChinese && !charIsChinese) return 0.25;
  return -0.45;
}

function sampleFromScores(vocabulary, scores, temperature, random) {
  const max = Math.max(...scores);
  const weights = scores.map((score) => Math.exp((score - max) / temperature));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = random() * total;
  for (let index = 0; index < vocabulary.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return vocabulary[index];
  }
  return vocabulary[vocabulary.length - 1];
}

function hashContext(output, order, bucketCount) {
  const context = output.slice(-order);
  let hash = 2166136261;
  for (const char of context) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % bucketCount;
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

function deterministicWeight(seedText) {
  const random = seededRandom(seedText);
  return (random() * 2 - 1) * 0.16;
}

function seededRandom(seedText) {
  let seed = 2166136261;
  for (const char of seedText) {
    seed ^= char.codePointAt(0) ?? 0;
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
