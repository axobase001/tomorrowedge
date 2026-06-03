import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { createProviderRegistry } from "../../src/providers/registry.js";

describe("provider registry", () => {
  it("registers offline providers without API keys", async () => {
    const registry = createProviderRegistry(defaultConfig);
    expect(registry.get("mock")).toBeTruthy();
    expect(registry.get("fixture")).toBeTruthy();
    const response = await registry.get("mock")!.chat({
      model: "mock-balanced",
      messages: [{ role: "user", content: "hello" }]
    });
    expect(response.content).toContain("Deterministic offline response");
  });
});
