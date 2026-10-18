import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { FixtureProvider } from "../../src/providers/fixtureProvider.js";
import { createProviderRegistry } from "../../src/providers/registry.js";
import { chatWithProviderFallback } from "../../src/core/model/providerFallback.js";
import { ModelRouter } from "../../src/core/routing/router.js";

const roots: string[] = [];
const request = { model: "fixture-scripted", messages: [] };
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function workspace(summary: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tedge-provider-cwd-"));
  roots.push(root);
  const dir = path.join(root, "tests", "fixtures", "provider-responses");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "default.json"), JSON.stringify({ summary }));
  await writeFile(path.join(dir, "named.json"), JSON.stringify({ summary: `${summary}-named` }));
  return root;
}

describe("fixture provider workspace", () => {
  it("reads default and named fixtures from the registry workspace, not the launch directory", async () => {
    const cwd = await workspace("target workspace");
    expect(cwd).not.toBe(process.cwd());
    const provider = createProviderRegistry(defaultConfig, cwd).get("fixture")!;
    expect(JSON.parse((await provider.chat(request)).content).summary).toBe("target workspace");
    expect(JSON.parse((await provider.chat({ ...request, metadata: { fixture: "named" } })).content).summary).toBe("target workspace-named");
  });

  it("isolates cached registries for the same config across workspaces", async () => {
    const first = await workspace("first workspace");
    const second = await workspace("second workspace");
    for (const cwd of [first, second, first]) {
      const result = await chatWithProviderFallback({
        cwd, config: defaultConfig, router: new ModelRouter(defaultConfig), role: "planner",
        provider: "fixture", model: request.model, buildRequest: () => request
      });
      expect(JSON.parse(result.response!.content).summary).toBe(cwd === first ? "first workspace" : "second workspace");
    }
  });

  it("does not fall back to launch-directory fixtures when the target has none", async () => {
    const cwd = await workspace("target");
    await rm(path.join(cwd, "tests", "fixtures", "provider-responses"), { recursive: true });
    const provider = createProviderRegistry(defaultConfig, cwd).get("fixture")!;
    expect(JSON.parse((await provider.chat(request)).content).summary).toBe("No fixture found; using empty scripted response.");
  });

  it("preserves the default launch-directory behavior and explicit fixture directory override", async () => {
    expect(JSON.parse((await new FixtureProvider().chat(request)).content).summary).toBe("fixture response");
    expect(JSON.parse((await createProviderRegistry(defaultConfig).get("fixture")!.chat(request)).content).summary).toBe("fixture response");
    const cwd = await workspace("explicit directory");
    const provider = new FixtureProvider(path.join(cwd, "tests", "fixtures", "provider-responses"));
    expect(JSON.parse((await provider.chat(request)).content).summary).toBe("explicit directory");
    expect(JSON.parse((await provider.chat({ ...request, metadata: { fixture: "missing" } })).content).summary).toContain("No fixture found");
  });
});
