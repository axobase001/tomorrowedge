import test from "node:test";
import assert from "node:assert/strict";
import { createTinyCharModel } from "../src/model.js";

test("tiny char model reports small local parameter metadata", () => {
  const model = createTinyCharModel("abc abc abd", 3);
  const info = model.info();
  assert.equal(info.cloudApi, false);
  assert.equal(info.type, "char-level n-gram");
  assert.ok(info.parameterCount > 0);
  assert.ok(info.parameterCount < 1000);
});

test("tiny char model generates bounded text from a prompt", () => {
  const model = createTinyCharModel("TomorrowEdge TomorrowEdge routes models.", 3);
  const result = model.generate("Tomorrow", { maxTokens: 24, temperature: 0.7, seed: "unit" });
  assert.equal(result.prompt, "Tomorrow");
  assert.ok(result.generated.length <= 24);
  assert.ok(result.text.startsWith("Tomorrow"));
});
