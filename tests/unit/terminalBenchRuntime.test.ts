import { execa } from "execa";
import { describe, expect, it } from "vitest";
import {
  actionTraceEvent,
  commandTraceEvent,
  compactTerminalObservation,
  evaluateTerminalCommand,
  fileUploadTraceEvent,
  parseTerminalBenchAction,
  parseTerminalBenchVerification,
  splitHereDocCommand,
  shouldEscalateTerminalBench,
  strongInterventionTraceEvent,
  terminalBenchSystemPrompt,
  terminalBenchUserPrompt,
  terminalBenchVerificationCommand,
  verificationTraceEvent,
  wrapTerminalCommand
} from "../../src/core/terminalBench/index.js";

describe("Terminal-Bench runtime contract", () => {
  it("parses fenced JSON terminal actions with files and commands", () => {
    const result = parseTerminalBenchAction([
      "Here is the action:",
      "```json",
      JSON.stringify({
        thought: "write compressor",
        files: [{ path: "solve.py", content: "print('x')" }],
        commands: "python3 /app/solve.py > /app/data.comp",
        verify: true
      }),
      "```"
    ].join("\n"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action.files).toEqual([{ path: "/app/solve.py", content: "print('x')", encoding: "utf8" }]);
    expect(result.action.commands).toEqual(["python3 /app/solve.py > /app/data.comp"]);
    expect(result.action.done).toBe(false);
  });

  it("rejects non-JSON terminal actions instead of executing prose", () => {
    const result = parseTerminalBenchAction("I would inspect the workspace first.");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("JSON object");
  });

  it("normalizes nested rescue actions with singular command/file fields", () => {
    const result = parseTerminalBenchAction(JSON.stringify({
      rescue_action: {
        thought: "repair",
        file: { path: "fix.py", content: "print(1)" },
        command: "python3 /app/fix.py"
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action.files[0].path).toBe("/app/fix.py");
    expect(result.action.commands).toEqual(["python3 /app/fix.py"]);
  });

  it("blocks installs, network calls, interactive shells, and oversized commands", () => {
    expect(evaluateTerminalCommand("pip install pytest").allowed).toBe(false);
    expect(evaluateTerminalCommand("curl https://example.com").allowed).toBe(false);
    expect(evaluateTerminalCommand("bash -i").allowed).toBe(false);
    expect(evaluateTerminalCommand("x".repeat(1900)).reasons[0]).toContain("1800");
  });

  it("converts model here-doc commands into explicit file upload actions", () => {
    const converted = splitHereDocCommand([
      "cat > /app/compress.py <<'PY'",
      "print('payload')",
      "PY",
      "python3 /app/compress.py > /app/data.comp"
    ].join("\n"));

    expect(converted).toEqual({
      file: { path: "/app/compress.py", content: "print('payload')", encoding: "utf8" },
      remainder: "python3 /app/compress.py > /app/data.comp"
    });
  });

  it("warns repeated commands without denying deterministic shell actions", () => {
    const seen = new Set(["python3 solve.py"]);
    const decision = evaluateTerminalCommand("python3 solve.py", { seenCommands: seen });

    expect(decision.allowed).toBe(true);
    expect(decision.severity).toBe("warn");
    expect(wrapTerminalCommand("python3 solve.py")).toContain("timeout 25s bash -lc");
  });

  it("classifies hard gate verifier output into failure packets", () => {
    expect(parseTerminalBenchVerification("TBENCH_VERIFY=NO_FILE").status).toBe("no_file");
    expect(parseTerminalBenchVerification("DATA_COMP_SIZE=2600\nTBENCH_VERIFY=SIZE_FAIL").status).toBe("size_fail");
    expect(parseTerminalBenchVerification("DATA_COMP_SIZE=120\nDECOMP_RC=139\nTBENCH_VERIFY=FAIL", "segfault").status).toBe("crash");
    expect(parseTerminalBenchVerification(
      "DATA_COMP_SIZE=1\nDECOMP_RC=139\nDECOMP_STDERR_START\ntimeout: the monitored command dumped core\nDECOMP_STDERR_END\nTBENCH_VERIFY=FAIL"
    ).status).toBe("crash");
    expect(parseTerminalBenchVerification("DATA_COMP_SIZE=120\nDECOMP_RC=0\nOUT_SIZE=4\nTBENCH_VERIFY=FAIL").status).toBe("output_mismatch");
    expect(parseTerminalBenchVerification("DATA_COMP_SIZE=120\nDECOMP_RC=0\nTBENCH_VERIFY=PASS").hardGatePassed).toBe(true);
    expect(terminalBenchVerificationCommand()).toContain("/app/decomp");
  });

  it("triggers bounded escalation after repeated hard gate failures", () => {
    expect(shouldEscalateTerminalBench({
      step: 4,
      maxSteps: 16,
      consecutiveHardGateFailures: 3,
      lastStatus: "output_mismatch",
      strongAgentAvailable: true
    })).toMatchObject({ shouldEscalate: true });
    expect(shouldEscalateTerminalBench({
      step: 4,
      maxSteps: 16,
      consecutiveHardGateFailures: 3,
      lastStatus: "output_mismatch",
      strongAgentAvailable: false
    })).toMatchObject({ shouldEscalate: false });
  });

  it("emits compact trace events for action, files, commands, and verification", () => {
    const action = {
      thought: "try compressor",
      files: [{ path: "/app/solve.py", content: "print(1)" }],
      commands: ["python3 /app/solve.py"],
      verify: true,
      done: false
    };
    const command = evaluateTerminalCommand("python3 /app/solve.py");
    const verification = parseTerminalBenchVerification("DATA_COMP_SIZE=12\nDECOMP_RC=0\nTBENCH_VERIFY=PASS");

    expect(actionTraceEvent(1, action)).toMatchObject({ type: "terminal_action", fileCount: 1, commandCount: 1 });
    expect(fileUploadTraceEvent(1, action.files[0])).toMatchObject({ type: "terminal_file_upload", bytes: 8 });
    expect(commandTraceEvent(1, command)).toMatchObject({ type: "terminal_command", allowed: true });
    expect(verificationTraceEvent(1, verification)).toMatchObject({ type: "terminal_verification", hardGatePassed: true });
    expect(strongInterventionTraceEvent(4, "z-ai/glm-5.1", true, "repeated failure")).toMatchObject({
      type: "terminal_strong_intervention",
      accepted: true
    });
  });

  it("builds a Terminal-Bench prompt that forces JSON actions and hard-gate repair", () => {
    expect(terminalBenchSystemPrompt()).toContain("Return JSON only");
    expect(terminalBenchSystemPrompt()).toContain("hard gate");
    expect(terminalBenchUserPrompt({
      instruction: "compress data",
      step: 2,
      maxSteps: 8,
      observations: ["snapshot"],
      knownTools: ["python3", "gcc"]
    })).toContain("Available tools: python3, gcc");
  });

  it("compresses large or binary observations before model handoff", () => {
    const compact = compactTerminalObservation("huge", "a".repeat(20_000), "\u0000\u0001\u0002".repeat(20), 1000);

    expect(compact.length).toBeLessThanOrEqual(1100);
    expect(compact).toContain("omitted");
    expect(compact).toContain("binary output omitted");
  });

  it("exposes a dry-run Harbor smoke command through the CLI", async () => {
    const result = await execa("tsx", [
      "src/cli/index.ts",
      "tbench",
      "smoke",
      "--dry-run",
      "--quiet",
      "--strong-model",
      "z-ai/glm-5.1",
      "--primary-model",
      "deepseek/deepseek-chat-v3.1",
      "--advisor-model",
      "moonshotai/kimi-k2.7-code",
      "--agent-timeout-multiplier",
      "2",
      "--escalation-after",
      "2",
      "--require-strong"
    ], {
      cwd: process.cwd(),
      preferLocal: true,
      timeout: 20_000
    });

    expect(result.stdout).toContain("terminal-bench/terminal-bench-2-1");
    expect(result.stdout).toContain("TBENCH_STRONG_MODEL");
    expect(result.stdout).toContain("TBENCH_PRIMARY_MODEL");
    expect(result.stdout).toContain("TBENCH_ADVISOR_MODEL");
    expect(result.stdout).toContain("z-ai/glm-5.1");
    expect(result.stdout).toContain("--agent-timeout-multiplier 2");
    expect(result.stdout).toContain("TBENCH_REQUIRE_STRONG=1");
    expect(result.stdout).toContain("--agent-import-path scripts.tbench.tomorrowedge_harbor_agent:TomorrowEdgeHarborAgent");
  });
});
