import test from "node:test";
import assert from "node:assert/strict";
import { createTinyLmServer } from "../src/server.js";

test("API exposes health, model info, and generation endpoints", async () => {
  const server = createTinyLmServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
    assert.equal(health.ok, true);

    const info = await fetch(`${baseUrl}/model-info`).then((response) => response.json());
    assert.equal(info.cloudApi, false);

    const generated = await fetch(`${baseUrl}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Local", temperature: 0.8, maxTokens: 16, seed: "api" })
    }).then((response) => response.json());
    assert.ok(generated.text.startsWith("Local"));
    assert.ok(generated.generated.length <= 16);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
