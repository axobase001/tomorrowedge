import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { getConfigPath, loadConfig, loadConfigWithSource, writeConfig, writeDefaultConfig } from "../../src/config/configLoader.js";
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
    expect(config.providers.deepseek.base_url).toBe("https://api.deepseek.com");
    expect(config.providers.mimo.base_url).toBe("https://token-plan-sgp.xiaomimimo.com/v1");
    expect(config.providers.openai_compatible.base_url).toBe("https://api.openai.com/v1");
    expect(config.providers.kimi.base_url).toBe("https://api.moonshot.ai/v1");
    expect(config.providers.kimi.model).toBe("kimi-k2.6");
    expect(config.strategy_memory.policy).toBe("balanced");
  });

  it("accepts failure-memory retrieval policy configuration", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-config-memory-policy-"));
    try {
      await writeDefaultConfig(cwd);
      await writeFile(
        getConfigPath(cwd),
        [
          "strategy_memory:",
          "  enabled: true",
          "  policy: explore_alternative"
        ].join("\n"),
        "utf8"
      );

      const config = loadConfig(cwd);

      expect(config.strategy_memory.enabled).toBe(true);
      expect(config.strategy_memory.policy).toBe("explore_alternative");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("fills known provider base URLs for older configs with blank endpoints", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-config-provider-defaults-"));
    try {
      await writeDefaultConfig(cwd);
      await writeFile(
        getConfigPath(cwd),
        [
          "providers:",
          "  deepseek:",
          "    enabled: true",
          "    api_key_env: DEEPSEEK_API_KEY",
          "    base_url: \"\"",
          "    model: deepseek-v4-pro",
          "  mimo:",
          "    enabled: true",
          "    api_key_env: MIMO_API_KEY",
          "    base_url: \"\"",
          "    model: mimo-v2.5-pro",
          "  openai_compatible:",
          "    enabled: true",
          "    api_key_env: OPENAI_API_KEY",
          "    base_url: \"\"",
          "    model: gpt-4o-mini"
        ].join("\n"),
        "utf8"
      );

      const config = loadConfig(cwd);

      expect(config.providers.deepseek.enabled).toBe(true);
      expect(config.providers.deepseek.base_url).toBe("https://api.deepseek.com");
      expect(config.providers.mimo.base_url).toBe("https://token-plan-sgp.xiaomimimo.com/v1");
      expect(config.providers.openai_compatible.base_url).toBe("https://api.openai.com/v1");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
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
    const originalExitCode = process.exitCode;
    try {
      delete process.env.OPENROUTER_API_KEY;
      await captureStdout(() => initCommand(cwd, { provider: "openrouter" }));
      const output = await captureStdout(() => doctorCommand(cwd, { json: true }));
      const parsed = JSON.parse(output) as { providerDiagnostics: Array<{ id: string; status: string; fix?: string }> };
      const mock = parsed.providerDiagnostics.find((item) => item.id === "mock");
      const fixture = parsed.providerDiagnostics.find((item) => item.id === "fixture");
      const openrouter = parsed.providerDiagnostics.find((item) => item.id === "openrouter");

      expect(mock?.status).toBe("ready");
      expect(fixture?.status).toBe("ready");
      expect(openrouter?.status).toBe("error");
      expect(openrouter?.fix).toContain("OPENROUTER_API_KEY");

      process.exitCode = undefined;
      await captureStdout(() => doctorCommand(cwd, { json: true, strict: true }));
      expect(process.exitCode).toBe(1);
    } finally {
      if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
      process.exitCode = originalExitCode;
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

  it("warns that Ollama readiness still needs a local HTTP connection test", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-doctor-ollama-"));
    try {
      const config = loadConfig(cwd);
      await writeConfig(cwd, {
        ...config,
        providers: {
          ...config.providers,
          ollama: {
            ...config.providers.ollama,
            enabled: true,
            model: "llama3",
            base_url: "http://127.0.0.1:11434/v1"
          }
        }
      });
      const output = await captureStdout(() => doctorCommand(cwd, { json: true }));
      const parsed = JSON.parse(output) as { providerDiagnostics: Array<{ id: string; status: string; fix?: string }> };
      const ollama = parsed.providerDiagnostics.find((item) => item.id === "ollama");

      expect(ollama?.status).toBe("warning");
      expect(ollama?.fix).toContain("connection-test");
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

  it("rejects agent provider references that do not exist", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-config-provider-ref-"));
    try {
      await writeDefaultConfig(cwd);
      await writeFile(
        getConfigPath(cwd),
        [
          "agents:",
          "  reviewer:",
          "    provider: missing_provider",
          "    model: auto"
        ].join("\n"),
        "utf8"
      );

      expect(() => loadConfig(cwd)).toThrow('Agent "reviewer" references unknown provider "missing_provider".');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("accepts agent references to custom OpenAI-compatible providers", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-config-custom-provider-ref-"));
    try {
      await writeDefaultConfig(cwd);
      await writeFile(
        getConfigPath(cwd),
        [
          "providers:",
          "  oneapi_gateway:",
          "    enabled: true",
          "    api_key_env: ONEAPI_GATEWAY_KEY",
          "    base_url: https://oneapi.example/v1",
          "    model: gpt-4o-mini",
          "agents:",
          "  planner:",
          "    provider: oneapi_gateway",
          "    model: gpt-4o-mini"
        ].join("\n"),
        "utf8"
      );

      const config = loadConfig(cwd);

      expect(config.providers.oneapi_gateway.base_url).toBe("https://oneapi.example/v1");
      expect(config.agents.planner).toMatchObject({ provider: "oneapi_gateway", model: "gpt-4o-mini" });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("accepts external agent provider references when the profile exists", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-config-external-ref-"));
    try {
      await writeDefaultConfig(cwd);
      await writeFile(
        getConfigPath(cwd),
        [
          "external_agents:",
          "  codex:",
          "    enabled: true",
          "    roles: [reviewer]",
          "agents:",
          "  reviewer:",
          "    provider: external:codex",
          "    model: auto"
        ].join("\n"),
        "utf8"
      );

      const config = loadConfig(cwd);
      expect(config.agents.reviewer.provider).toBe("external:codex");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects external agent provider references when the profile is missing", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-config-external-missing-"));
    try {
      await writeDefaultConfig(cwd);
      await writeFile(
        getConfigPath(cwd),
        [
          "agents:",
          "  reviewer:",
          "    provider: external:not_registered",
          "    model: auto"
        ].join("\n"),
        "utf8"
      );

      expect(() => loadConfig(cwd)).toThrow('Agent "reviewer" references unknown external agent "not_registered".');
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

  it("redacts provider identifiers from models smoke errors", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-model-smoke-redact-"));
    const originalFetch = globalThis.fetch;
    try {
      const config = loadConfig(cwd);
      await writeConfig(cwd, {
        ...config,
        providers: {
          ...config.providers,
          openai_compatible: {
            ...config.providers.openai_compatible,
            enabled: true,
            api_key_env: "",
            base_url: "http://provider.test/v1",
            model: "free-test-model",
            auth_header: "none"
          }
        }
      });
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "temporarily rate-limited upstream",
              metadata: { provider_name: "Crucible" }
            },
            user_id: "user_3EfqcfPXAjQTwahh8KSxAxJJYP9",
            accountId: "acct_live_123"
          }),
          { status: 429, headers: { "Content-Type": "application/json" } }
        )) as typeof fetch;

      const output = await captureStdout(() => modelsCommand(cwd, { smokeSuite: true, provider: "openai_compatible" }));

      expect(output).toContain("smoke:text: failed");
      expect(output).toContain("smoke:json: skipped");
      expect(output).toContain("smoke:vision: skipped");
      expect(output).toContain("[redacted]");
      expect(output).not.toContain("user_3EfqcfPXAjQTwahh8KSxAxJJYP9");
      expect(output).not.toContain("acct_live_123");
    } finally {
      globalThis.fetch = originalFetch;
      await rm(cwd, { recursive: true, force: true });
    }
  }, 20_000);

  it("filters normal model listing by provider", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-model-provider-filter-"));
    try {
      const config = loadConfig(cwd);
      await writeConfig(cwd, {
        ...config,
        providers: {
          ...config.providers,
          openai_compatible: {
            ...config.providers.openai_compatible,
            enabled: true,
            api_key_env: "",
            base_url: "http://provider.test/v1",
            model: "free-test-model",
            auth_header: "none"
          }
        }
      });

      const output = await captureStdout(() => modelsCommand(cwd, { provider: "openai_compatible" }));

      expect(output).toContain("openai_compatible [cloud]");
      expect(output).not.toContain("mock [mock]");
      expect(output).not.toContain("fixture [mock]");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("marks configured cloud providers as static readiness until live smoke passes", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-doctor-cloud-static-"));
    try {
      const config = loadConfig(cwd);
      await writeConfig(cwd, {
        ...config,
        providers: {
          ...config.providers,
          openai_compatible: {
            ...config.providers.openai_compatible,
            enabled: true,
            api_key_env: "",
            base_url: "http://provider.test/v1",
            model: "free-test-model",
            auth_header: "none"
          }
        }
      });

      const output = await captureStdout(() => doctorCommand(cwd, { json: true }));
      const parsed = JSON.parse(output) as { providerDiagnostics: Array<{ id: string; status: string; checks: string[]; fix?: string }> };
      const provider = parsed.providerDiagnostics.find((item) => item.id === "openai_compatible");

      expect(provider?.status).toBe("warning");
      expect(provider?.checks.join("\n")).toContain("static configuration only");
      expect(provider?.fix).toContain("smoke-suite");
    } finally {
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

  it("loads an explicit config instead of the project config", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-config-explicit-project-"));
    const explicitDir = await mkdtemp(path.join(os.tmpdir(), "tedge-config-explicit-file-"));
    try {
      await writeDefaultConfig(cwd);
      await writeFile(
        getConfigPath(cwd),
        [
          "project:",
          "  access_mode: restricted"
        ].join("\n"),
        "utf8"
      );
      const explicitPath = path.join(explicitDir, "explicit.yaml");
      await writeFile(
        explicitPath,
        [
          "project:",
          "  access_mode: full"
        ].join("\n"),
        "utf8"
      );

      const projectConfig = loadConfigWithSource(cwd);
      const explicitConfig = loadConfigWithSource(cwd, { configPath: explicitPath });

      expect(projectConfig.source).toBe("project");
      expect(projectConfig.config.project.access_mode).toBe("restricted");
      expect(explicitConfig.source).toBe("explicit");
      expect(explicitConfig.path).toBe(explicitPath);
      expect(explicitConfig.config.project.access_mode).toBe("full");
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(explicitDir, { recursive: true, force: true });
    }
  });

  it("fails clearly when an explicit config is missing", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-config-explicit-missing-"));
    try {
      expect(() => loadConfigWithSource(cwd, { configPath: "missing.yaml" })).toThrow(/Explicit config not found:/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("resolves packaged Sirius mock command paths from an outside cwd", async () => {
    const outsideCwd = await mkdtemp(path.join(os.tmpdir(), "tedge-config-outside-cwd-"));
    try {
      const exampleConfigPath = path.join(process.cwd(), "examples", "configs", "sirius-codex-deepseek-mimo.mock.yaml");
      const loaded = loadConfigWithSource(outsideCwd, { configPath: exampleConfigPath });
      const expectedMockAgent = path.join(process.cwd(), "examples", "agent-council-rust-rewrite", "mock-command-agent.mjs");

      expect(loaded.source).toBe("explicit");
      expect(loaded.path).toBe(exampleConfigPath);
      expect(loaded.config.external_agents.codex.args).toContain(expectedMockAgent);
      expect(loaded.config.external_agents.deepseek.args).toContain(expectedMockAgent);
      expect(loaded.config.external_agents.mimo.args).toContain(expectedMockAgent);
      expect(existsSync(expectedMockAgent)).toBe(true);
    } finally {
      await rm(outsideCwd, { recursive: true, force: true });
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
