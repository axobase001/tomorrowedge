import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { getConfigPath, loadConfig, writeConfig, writeDefaultConfig } from "../../src/config/configLoader.js";
import { initCommand } from "../../src/cli/commands/init.js";
import { doctorCommand } from "../../src/cli/commands/doctor.js";
import { modelsCommand } from "../../src/cli/commands/models.js";

describe("config loader", () => {
  it("loads safe offline defaults without a config file", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-config-"));
    const config = loadConfig(cwd);
    await rm(cwd, { recursive: true, force: true });

    expect(config.project.safe_mode).toBe(true);
    expect(config.project.access_mode).toBe("partial");
    expect(config.project.telemetry).toBe(false);
    expect(config.orchestration.backend).toBe("native");
    expect(config.model_discovery.recommended_provider).toBe("openrouter");
    expect(config.model_discovery.prefer_free_onboarding).toBe(true);
    expect(config.orchestration.langgraph.enabled).toBe(false);
    expect(config.providers.mock.enabled).toBe(true);
    expect(config.providers.openrouter.enabled).toBe(false);
    expect(config.providers.kimi.base_url).toBe("https://api.moonshot.ai/v1");
    expect(config.providers.kimi.model).toBe("kimi-k2.6");
  });

  it("does not overwrite an existing config unless force is explicit", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-config-"));
    try {
      const configPath = getConfigPath(cwd);
      await writeDefaultConfig(cwd);
      await writeFile(configPath, "project:\n  name: custom-project\n", "utf8");

      const skipped = await writeDefaultConfig(cwd);
      expect(skipped).toMatchObject({ created: false, overwritten: false });
      expect(await readFile(configPath, "utf8")).toContain("custom-project");

      const forced = await writeDefaultConfig(cwd, { force: true });
      expect(forced).toMatchObject({ created: false, overwritten: true });
      expect(await readFile(configPath, "utf8")).toContain("tomorrowedge");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("supports first-run init options and prints next steps", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-init-"));
    try {
      const output = await captureStdout(() =>
        initCommand(cwd, {
          accessMode: "restricted",
          routingMode: "privacy",
          testCommand: "npm test",
          allowCloudRepoContext: "false"
        })
      );
      const config = loadConfig(cwd);

      expect(output).toContain("First run next steps");
      expect(output).toContain("Start with OpenRouter");
      expect(config.project.access_mode).toBe("restricted");
      expect(config.routing.mode).toBe("privacy");
      expect(config.privacy.allow_cloud_repo_context).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("prints actionable doctor provider diagnostics as JSON", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-doctor-"));
    const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
    try {
      delete process.env.OPENROUTER_API_KEY;
      await captureStdout(() => initCommand(cwd, { provider: "openrouter" }));
      const output = await captureStdout(() => doctorCommand(cwd, { json: true }));
      const parsed = JSON.parse(output) as { providerDiagnostics: Array<{ id: string; status: string; fix?: string }> };
      const mock = parsed.providerDiagnostics.find((item) => item.id === "mock");
      const fixture = parsed.providerDiagnostics.find((item) => item.id === "fixture");
      const openrouter = parsed.providerDiagnostics.find((item) => item.id === "openrouter");
      const ollama = parsed.providerDiagnostics.find((item) => item.id === "ollama");

      expect(mock?.status).toBe("ready");
      expect(fixture?.status).toBe("ready");
      expect(openrouter?.status).toBe("error");
      expect(openrouter?.fix).toContain("OPENROUTER_API_KEY");
      expect(ollama?.status).toBe("warning");
      expect(ollama?.fix).toContain("connection-test");
    } finally {
      if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("reports placeholder orchestration backends before run time", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-doctor-backend-"));
    try {
      const config = loadConfig(cwd);
      await writeConfig(cwd, {
        ...config,
        orchestration: {
          ...config.orchestration,
          backend: "langgraph"
        }
      });
      const output = await captureStdout(() => doctorCommand(cwd, { json: true }));
      const parsed = JSON.parse(output) as { warnings: string[] };

      expect(parsed.warnings.join("\n")).toContain("not executable");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("loads external MCP proxy port configuration", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-mcp-proxy-"));
    try {
      await writeDefaultConfig(cwd);
      await writeFile(
        getConfigPath(cwd),
        [
          "external_agents:",
          "  codex:",
          "    enabled: true",
          "    transport: mcp",
          "    command: codex",
          "    args: [mcp-server]",
          "    proxyPort: 7890",
          "    roles: [core]",
          "    capabilities: [core]",
          "    trustLevel: high"
        ].join("\n"),
        "utf8"
      );

      const config = loadConfig(cwd);
      expect(config.external_agents.codex.proxyPort).toBe(7890);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("can configure an OpenRouter free onboarding model from the live-catalog command path", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-free-model-"));
    const originalFetch = globalThis.fetch;
    try {
      await writeDefaultConfig(cwd);
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "moonshotai/kimi-k2.6:free",
                name: "MoonshotAI: Kimi K2.6 (free)",
                context_length: 262144,
                pricing: { prompt: "0", completion: "0" }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )) as typeof fetch;

      const output = await captureStdout(() =>
        modelsCommand(cwd, {
          refreshFree: true,
          configureFree: "moonshotai/kimi-k2.6:free",
          freeFirst: true
        })
      );
      const config = loadConfig(cwd);

      expect(output).toContain("Configured OpenRouter onboarding model");
      expect(config.providers.openrouter.enabled).toBe(true);
      expect(config.providers.openrouter.model).toBe("moonshotai/kimi-k2.6:free");
      expect(config.routing.mode).toBe("cheap");
      expect(config.agents.coder_b.provider).toBe("openrouter");
    } finally {
      globalThis.fetch = originalFetch;
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("warns when full mode is configured in a dirty git workspace", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-doctor-full-dirty-"));
    try {
      await execa("git", ["init"], { cwd });
      const config = loadConfig(cwd);
      await writeConfig(cwd, {
        ...config,
        project: {
          ...config.project,
          access_mode: "full"
        }
      });
      await writeFile(path.join(cwd, "dirty.txt"), "pending change\n", "utf8");

      const output = await captureStdout(() => doctorCommand(cwd, { json: true }));
      const parsed = JSON.parse(output) as { git: string; warnings: string[] };

      expect(parsed.git).toMatch(/changed file/);
      expect(parsed.warnings).toContain("full access mode auto-approves patch, shell, and repair actions.");
      expect(parsed.warnings.join("\n")).toContain("full mode is configured while the workspace is");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return output;
}
