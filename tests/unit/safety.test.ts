import { describe, expect, it } from "vitest";
import { canSendToCloud } from "../../src/safety/privacyGuard.js";
import { scanSecrets } from "../../src/safety/secretScanner.js";

describe("safety", () => {
  it("detects secret-like assignments", () => {
    expect(scanSecrets("OPENAI_API_KEY=sk-test").length).toBe(1);
  });

  it("blocks raw cloud context in privacy mode", () => {
    const decision = canSendToCloud("normal code", "privacy");
    expect(decision.allowed).toBe(false);
  });
});
