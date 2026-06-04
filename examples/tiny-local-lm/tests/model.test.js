import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createTinyCharModel } from "../src/model.js";

test("default bilingual local model reports 50M-60M local parameters", () => {
  const model = createTinyCharModel();
  const info = model.info();
  assert.equal(info.cloudApi, false);
  assert.equal(info.type, "bilingual hashed neural n-gram");
  assert.ok(info.parameterCount >= 50_000_000, `parameterCount=${info.parameterCount}`);
  assert.ok(info.parameterCount <= 60_000_000, `parameterCount=${info.parameterCount}`);
  assert.deepEqual(info.languages, ["zh-CN", "en"]);
});

test("package metadata matches the current bilingual hashed model", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(packageJson.description, /bilingual hashed neural n-gram/);
  assert.doesNotMatch(packageJson.description, /character-level/);
});

test("bilingual local model generates bounded English text from a prompt", () => {
  const model = createTinyCharModel("TomorrowEdge TomorrowEdge routes models.", { contextBuckets: 512, embeddingSize: 16, order: 3 });
  const result = model.generate("Tomorrow", { maxTokens: 24, temperature: 0.7, seed: "unit" });
  assert.equal(result.prompt, "Tomorrow");
  assert.ok(result.generated.length <= 24);
  assert.ok(result.text.startsWith("Tomorrow"));
});

test("bilingual local model can continue a Chinese prompt", () => {
  const model = createTinyCharModel(undefined, { contextBuckets: 512, embeddingSize: 16, order: 3 });
  const result = model.generate("明日边缘", { maxTokens: 32, temperature: 0.6, seed: "zh-unit" });
  assert.equal(result.prompt, "明日边缘");
  assert.ok(result.generated.length <= 32);
  assert.match(result.generated, /[\u4e00-\u9fff]/);
});
