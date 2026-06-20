from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from harbor.agents.base import BaseAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


ROOT = Path(__file__).resolve().parents[2]
PACKAGE = ROOT / ".tomorrowedge" / "tbench" / "packages" / "axobase001-tomorrowedge-1.6.3.tgz"
CONFIG = ROOT / ".tomorrowedge" / "tbench" / "tomorrowedge-tbench-config.yaml"
DOTENV = ROOT / ".env"


class TomorrowEdgeHarborAgent(BaseAgent):
    def __init__(self, *args, extra_env: dict[str, str] | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        self.extra_env = extra_env or {}

    @staticmethod
    def name() -> str:
        return "tomorrowedge-canopus"

    def version(self) -> str | None:
        return "1.6.3-harbor"

    async def setup(self, environment: BaseEnvironment) -> None:
        await environment.exec(
            "if ! command -v python3 >/dev/null 2>&1; then "
            "if command -v apt-get >/dev/null 2>&1; then apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y python3; "
            "elif command -v apk >/dev/null 2>&1; then apk add --no-cache python3; "
            "elif command -v dnf >/dev/null 2>&1; then dnf install -y python3; "
            "else echo 'python3 unavailable and no supported package manager found' >&2; exit 127; fi; fi; "
            "python3 --version",
            user="root",
            timeout_sec=300,
        )

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        env = load_env(self.extra_env)
        result = await run_terminal_agent(instruction, environment, env, context)
        update_context(context, result)
        if result["input_tokens"] is not None:
            context.n_input_tokens = result["input_tokens"]
        if result["output_tokens"] is not None:
            context.n_output_tokens = result["output_tokens"]
        if result["cost_usd"] is not None:
            context.cost_usd = result["cost_usd"]


def load_env(extra_env: dict[str, str] | None = None) -> dict[str, str]:
    keys = {
        "OPENROUTER_API_KEY",
        "DEEPSEEK_API_KEY",
        "MIMO_API_KEY",
        "OPENROUTER_MODEL",
        "DEEPSEEK_MODEL",
        "MIMO_MODEL",
        "TBENCH_PRIMARY_MODEL",
        "TBENCH_ADVISOR_MODEL",
        "TBENCH_STRONG_MODEL",
        "TBENCH_MAX_STEPS",
        "TBENCH_ESCALATION_AFTER",
        "TBENCH_MAX_STRONG_INTERVENTIONS",
        "TBENCH_STRONG_MAX_TOKENS",
        "TBENCH_STRONG_MAX_OUTPUT",
        "TBENCH_COMMAND_TIMEOUT",
        "TBENCH_MODEL_TIMEOUT",
        "TBENCH_REQUIRE_STRONG",
        "OLLAMA_BASE_URL",
    }
    values = {key: os.environ[key] for key in keys if os.environ.get(key)}
    for key, value in (extra_env or {}).items():
        if key in keys and value:
            values[key] = value
    if DOTENV.exists():
        for line in DOTENV.read_text(encoding="utf-8").splitlines():
            if "=" not in line or line.strip().startswith("#"):
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key in keys and key not in values:
                values[key] = value.strip().strip('"').strip("'")
    values.setdefault("PYTHONIOENCODING", "utf-8")
    values.setdefault("NO_COLOR", "1")
    return values


async def run_terminal_agent(instruction: str, environment: BaseEnvironment, env: dict[str, str], context: AgentContext) -> dict[str, object]:
    openrouter_credential = env.get("OPENROUTER_API_KEY")
    if not openrouter_credential:
        raise RuntimeError("OPENROUTER_API_KEY is required for the TomorrowEdge Terminal-Bench agent.")
    primary_model = env.get("TBENCH_PRIMARY_MODEL") or "deepseek/deepseek-chat-v3.1"
    advisor_model = env.get("TBENCH_ADVISOR_MODEL") or env.get("OPENROUTER_MODEL") or "moonshotai/kimi-k2.7-code"
    strong_model = env.get("TBENCH_STRONG_MODEL") or advisor_model
    max_steps = int(env.get("TBENCH_MAX_STEPS", "20"))
    escalation_after = int(env.get("TBENCH_ESCALATION_AFTER", "3"))
    max_strong_interventions = int(env.get("TBENCH_MAX_STRONG_INTERVENTIONS", "3"))
    strong_max_tokens = parse_int_env(env.get("TBENCH_STRONG_MAX_OUTPUT") or env.get("TBENCH_STRONG_MAX_TOKENS"), 4000)
    command_timeout = parse_int_env(env.get("TBENCH_COMMAND_TIMEOUT"), 90)
    model_timeout = parse_int_env(env.get("TBENCH_MODEL_TIMEOUT"), 180)
    require_strong = env.get("TBENCH_REQUIRE_STRONG") == "1"
    transcript: list[str] = []
    trace_events: list[dict[str, object]] = []
    consecutive_hard_gate_failures = 0
    consecutive_action_failures = 0
    strong_interventions = 0
    accepted_strong_interventions = 0
    next_override: dict[str, object] | None = None
    usage = {"input_tokens": 0, "output_tokens": 0, "cost_usd": None}
    trace_events.append({
        "type": "terminal_runtime_config",
        "primaryModel": primary_model,
        "advisorModel": advisor_model,
        "strongModel": strong_model,
        "maxSteps": max_steps,
        "escalationAfter": escalation_after,
        "maxStrongInterventions": max_strong_interventions,
        "commandTimeoutSec": command_timeout,
        "modelTimeoutSec": model_timeout,
        "coreMode": "guided_council",
        "coreConstraint": "core asks for derivation, evidence, and hard-gate contracts; implementation must come from routed models",
    })

    tool_probe = await environment.exec(
        "for tool in python3 gcc g++ make rustc cargo node npm sh bash tar gzip sed awk grep cmp wc timeout; do "
        "command -v \"$tool\" >/dev/null 2>&1 && echo \"$tool=present\" || echo \"$tool=missing\"; done",
        cwd="/app",
        timeout_sec=30,
    )
    transcript.append(format_observation("tool_probe", tool_probe.stdout, tool_probe.stderr, 0))
    trace_events.append({"type": "terminal_tool_probe", "available": available_tools_from_probe(tool_probe.stdout or "")})
    update_context(context, partial_result(transcript, "", "", 0, primary_model, advisor_model, usage, trace_events))

    snapshot = await environment.exec(
        "pwd; ls -la; echo '--- files ---'; find . -maxdepth 3 -type f -not -path './.git/*' -not -path './.tomorrowedge/*' -printf '%p %s bytes\\n' | sort | head -300; "
        "echo '--- small text file previews ---'; "
        "for f in $(find . -maxdepth 2 -type f \\( -name '*.c' -o -name '*.h' -o -name '*.py' -o -name '*.txt' -o -name '*.md' -o -name '*.json' -o -name '*.toml' -o -name '*.yaml' -o -name '*.yml' -o -name '*.sh' \\) -size -30000c -not -path './.git/*' | sort | head -20); do "
        "if grep -Iq . \"$f\"; then echo \"### $f\"; sed -n '1,220p' \"$f\" 2>/dev/null | head -220; fi; done",
        cwd="/app",
        timeout_sec=60,
    )
    transcript.append(format_observation("initial_snapshot", snapshot.stdout, snapshot.stderr, 0))
    update_context(context, partial_result(transcript, "", "", 0, primary_model, advisor_model, usage, trace_events))

    advice = call_openrouter_json(
        credential=openrouter_credential,
        model=advisor_model,
        system=(
            "You are the TomorrowEdge Terminal-Bench council reviewer, not the executor. "
            "Identify the task class, the evidence the executor must collect, the minimum experiments, "
            "and the hard-gate contract. Do not give a complete solution or full code. "
            "Return JSON only with keys: task_profile, strategy_protocol, guiding_questions, "
            "evidence_to_collect, risks, first_commands. "
            "If the task asks for an encoder/compressor/input that must match a provided decoder/decompressor, "
            "set task_profile to reverse_engineer_matching_decoder and strategy_protocol to translate_verify_reverse. "
            "For that profile, first_commands must be bounded evidence commands only; later execution should "
            "translate the decoder 1:1, verify the translation against the original, then reverse the state machine. "
        ),
        user=f"Task:\n{instruction}\n\nWorkspace snapshot:\n{transcript[-1][-5000:]}",
        max_tokens=500,
        temperature=0.1,
        timeout_sec=model_timeout,
    )
    add_usage(usage, advice)
    advisor_json = advice.get("json") if isinstance(advice.get("json"), dict) else {}
    if not advisor_json:
        advisor_json = recover_advisor_semantic_tags(str(advice.get("content") or advice.get("reasoning") or ""))
    strategy_hint = task_strategy_hint(instruction, advisor_json)
    trace_events.append({
        "type": "terminal_strategy_profile",
        "taskProfile": str(advisor_json.get("task_profile") or "unspecified")[:120],
        "strategyProtocol": str(advisor_json.get("strategy_protocol") or "unspecified")[:120],
        "strategyHint": strategy_hint[:1000],
    })
    advisor_text = json.dumps(advisor_json or {"raw": advice.get("content", "")[:1200]}, ensure_ascii=False)
    transcript.append(f"advisor({advisor_model}): {advisor_text[:2500]}")
    if strategy_hint:
        transcript.append(f"core_strategy: {strategy_hint}")
    update_context(context, partial_result(transcript, "", "", 0, primary_model, advisor_model, usage, trace_events))

    stdout_tail = ""
    stderr_tail = ""
    seen_commands: set[str] = set()
    for step in range(1, max_steps + 1):
        if next_override is not None:
            payload = next_override
            next_override = None
        else:
            decision = call_openrouter_json(
                credential=openrouter_credential,
                model=primary_model,
                system=terminal_agent_system_prompt(),
                user=terminal_agent_user_prompt(instruction, transcript, step, max_steps, strategy_hint),
                max_tokens=4000,
                temperature=0.15,
                timeout_sec=model_timeout,
            )
            add_usage(usage, decision)
            payload = normalize_terminal_decision(decision.get("json"), decision.get("content", ""))
            if decision.get("raw_excerpt"):
                payload["raw_excerpt"] = str(decision.get("raw_excerpt") or "")[:700]
            if not has_executable_terminal_action(payload) and not payload.get("done"):
                try:
                    primary_repair = call_openrouter_json(
                        credential=openrouter_credential,
                        model=primary_model,
                        system=strong_json_repair_system_prompt(),
                        user=strong_json_repair_user_prompt(
                            instruction=instruction,
                            strategy_hint=strategy_hint,
                            verification_status="primary_protocol_failure",
                            previous_output=str(decision.get("raw_excerpt") or decision.get("content") or "")[:1200],
                            transcript=transcript,
                        ),
                        max_tokens=min(strong_max_tokens, 4000),
                        temperature=0.0,
                        timeout_sec=model_timeout,
                    )
                    add_usage(usage, primary_repair)
                    repaired_payload = normalize_terminal_decision(primary_repair.get("json"), primary_repair.get("content", ""))
                    if has_executable_terminal_action(repaired_payload):
                        payload = repaired_payload
                        payload["primary_repair"] = True
                        payload["raw_excerpt"] = str(primary_repair.get("raw_excerpt") or primary_repair.get("content") or "")[:700]
                except Exception as error:
                    payload["primary_repair_error"] = str(error)[:700]
                    payload["raw_excerpt"] = str(payload.get("raw_excerpt") or "")[:350] + f"\nprimary repair failed: {str(error)[:350]}"
        thought = str(payload.get("thought") or "")[:1200]
        files = [item for item in payload.get("files", []) if isinstance(item, dict)]
        commands = [str(command).strip() for command in payload.get("commands", []) if str(command).strip()]
        verify_requested = bool(payload.get("verify", True))
        done = bool(payload.get("done")) and not commands
        transcript.append(f"step {step} thought: {thought}")
        trace_events.append({
            "type": "terminal_action",
            "step": step,
            "fileCount": len(files),
            "commandCount": len(commands),
            "verify": verify_requested,
            "done": done,
            "primaryRepair": bool(payload.get("primary_repair")),
        })
        update_context(context, partial_result(transcript, stdout_tail, stderr_tail, step, primary_model, advisor_model, usage, trace_events))
        if done:
            break
        uploaded = await upload_generated_files(environment, files)
        if uploaded:
            transcript.append(f"step {step} uploaded files: {', '.join(uploaded)}")
            for path_value in uploaded:
                trace_events.append({"type": "terminal_file_upload", "step": step, "path": path_value})
            update_context(context, partial_result(transcript, stdout_tail, stderr_tail, step, primary_model, advisor_model, usage, trace_events))
        if uploaded and not commands:
            commands = inferred_commands_for_uploaded_files(uploaded)
            if commands:
                transcript.append(f"step {step} inferred commands for uploaded files: {', '.join(commands)}")
        if not commands:
            consecutive_action_failures += 1
            trace_events.append({
                "type": "terminal_protocol_failure",
                "step": step,
                "reason": "no executable commands or files",
                "failureCount": consecutive_action_failures,
                "parseError": bool(payload.get("parse_error")),
                "rawExcerpt": str(payload.get("raw_excerpt") or "")[:700],
            })
            transcript.append(f"step {step} produced no executable action; requesting another action.")
            if (
                consecutive_action_failures >= 2
                and strong_interventions < max_strong_interventions
                and step < max_steps
            ):
                strong_interventions += 1
                try:
                    strong_payload, has_action = request_strong_intervention(
                        credential=openrouter_credential,
                        strong_model=strong_model,
                        strong_max_tokens=strong_max_tokens,
                        instruction=instruction,
                        strategy_hint=strategy_hint,
                        transcript=transcript,
                        step=step,
                        max_steps=max_steps,
                        verification_status="protocol_failure",
                        usage=usage,
                        trace_events=trace_events,
                        model_timeout_sec=model_timeout,
                    )
                    if has_action:
                        accepted_strong_interventions += 1
                        next_override = strong_payload
                    elif require_strong and accepted_strong_interventions == 0:
                        update_context(context, partial_result(transcript, stdout_tail, stderr_tail, step, primary_model, advisor_model, usage, trace_events))
                        raise RuntimeError("Required strong intervention returned no executable action.")
                except Exception as error:
                    trace_events.append({
                        "type": "terminal_strong_intervention",
                        "step": step,
                        "model": strong_model,
                        "accepted": False,
                        "reason": f"strong intervention failed: {str(error)[:300]}",
                    })
                    transcript.append(f"strong_intervention_error({strong_model}): {str(error)[:1000]}")
                    update_context(context, partial_result(transcript, stdout_tail, stderr_tail, step, primary_model, advisor_model, usage, trace_events))
                    if require_strong and accepted_strong_interventions == 0:
                        raise
            continue
        consecutive_action_failures = 0
        for index, command in enumerate(commands[:2], start=1):
            converted = split_heredoc_command(command)
            if converted:
                uploaded_from_heredoc = await upload_generated_files(environment, [{
                    "path": converted["path"],
                    "content": converted["content"],
                }])
                if uploaded_from_heredoc:
                    transcript.append(f"step {step} command {index} converted here-doc to files: {', '.join(uploaded_from_heredoc)}")
                    for path_value in uploaded_from_heredoc:
                        trace_events.append({"type": "terminal_file_upload", "step": step, "path": path_value, "source": "heredoc"})
                    command = converted["remainder"].strip()
                    if not command:
                        inferred = inferred_commands_for_uploaded_files(uploaded_from_heredoc)
                        command = inferred[0] if inferred else ""
                if not command:
                    transcript.append(f"step {step} command {index} only created files; requesting another action.")
                    continue
            if is_disallowed_command(command):
                transcript.append(f"step {step} command {index} rejected: command looked interactive/network/long-running.")
                trace_events.append({
                    "type": "terminal_command",
                    "step": step,
                    "command": command[:500],
                    "allowed": False,
                    "reasons": ["interactive/network/long-running pattern"],
                })
                continue
            if command in seen_commands:
                transcript.append(f"step {step} command {index} warning: repeated command; prefer writing or repairing code next.")
            if len(command) > 1800:
                transcript.append(
                    f"step {step} command {index} rejected: command was {len(command)} chars; use a shorter shell/Python script written in smaller steps."
                )
                trace_events.append({
                    "type": "terminal_command",
                    "step": step,
                    "command": command[:500],
                    "allowed": False,
                    "reasons": ["command too long"],
                })
                continue
            started = time.time()
            seen_commands.add(command)
            trace_events.append({
                "type": "terminal_command",
                "step": step,
                "command": command[:500],
                "allowed": True,
                "reasons": [],
            })
            wrapped_command = f"timeout {command_timeout}s bash -lc {shlex.quote(command)}"
            result = await environment.exec(wrapped_command, cwd="/app", timeout_sec=command_timeout + 15)
            elapsed = time.time() - started
            stdout_tail = (result.stdout or "")[-4000:]
            stderr_tail = (result.stderr or "")[-4000:]
            transcript.append(format_observation(f"step_{step}_cmd_{index}: {command}", result.stdout, result.stderr, elapsed))
            update_context(context, partial_result(transcript, stdout_tail, stderr_tail, step, primary_model, advisor_model, usage, trace_events))
            if len("\n".join(transcript)) > 24000:
                transcript = compact_transcript_for_model(transcript)
        if not verify_requested:
            transcript.append(f"step {step} hard-gate verification skipped because action verify=false.")
            trace_events.append({
                "type": "terminal_verification_skipped",
                "step": step,
                "reason": "action verify=false",
            })
            update_context(context, partial_result(transcript, stdout_tail, stderr_tail, step, primary_model, advisor_model, usage, trace_events))
            continue
        verification = await environment.exec(verification_command(), cwd="/app", timeout_sec=35)
        stdout_tail = (verification.stdout or "")[-4000:]
        stderr_tail = (verification.stderr or "")[-4000:]
        transcript.append(format_observation(f"step_{step}_auto_verify", verification.stdout, verification.stderr, 0))
        verification_status = parse_verification_status(verification.stdout or "", verification.stderr or "")
        trace_events.append({
            "type": "terminal_verification",
            "step": step,
            "status": verification_status,
            "hardGatePassed": verification_status == "pass",
        })
        if verification_status == "pass":
            consecutive_hard_gate_failures = 0
        else:
            consecutive_hard_gate_failures += 1
            if consecutive_hard_gate_failures >= 3:
                trace_events.append({
                    "type": "terminal_escalation",
                    "step": step,
                    "reason": f"hard gate failed {consecutive_hard_gate_failures} consecutive times ({verification_status})",
                    "failureCount": consecutive_hard_gate_failures,
                })
                transcript.append(f"escalation_hint: hard gate failed {consecutive_hard_gate_failures} consecutive times ({verification_status}).")
            if (
                consecutive_hard_gate_failures >= escalation_after
                and strong_interventions < max_strong_interventions
                and step < max_steps
            ):
                strong_interventions += 1
                try:
                    strong_payload, has_action = request_strong_intervention(
                        credential=openrouter_credential,
                        strong_model=strong_model,
                        strong_max_tokens=strong_max_tokens,
                        instruction=instruction,
                        strategy_hint=strategy_hint,
                        transcript=transcript,
                        step=step,
                        max_steps=max_steps,
                        verification_status=verification_status,
                        usage=usage,
                        trace_events=trace_events,
                        model_timeout_sec=model_timeout,
                    )
                    if has_action:
                        accepted_strong_interventions += 1
                        next_override = strong_payload
                    elif require_strong and accepted_strong_interventions == 0:
                        update_context(context, partial_result(transcript, stdout_tail, stderr_tail, step, primary_model, advisor_model, usage, trace_events))
                        raise RuntimeError("Required strong intervention returned no executable action.")
                except Exception as error:
                    trace_events.append({
                        "type": "terminal_strong_intervention",
                        "step": step,
                        "model": strong_model,
                        "accepted": False,
                        "reason": f"strong intervention failed: {str(error)[:300]}",
                    })
                    transcript.append(f"strong_intervention_error({strong_model}): {str(error)[:1000]}")
                    update_context(context, partial_result(transcript, stdout_tail, stderr_tail, step, primary_model, advisor_model, usage, trace_events))
                    if require_strong and accepted_strong_interventions == 0:
                        raise
        update_context(context, partial_result(transcript, stdout_tail, stderr_tail, step, primary_model, advisor_model, usage, trace_events))
        if "TBENCH_VERIFY=PASS" in (verification.stdout or ""):
            break

    final_snapshot = await environment.exec(
        "echo '--- final files ---'; find . -maxdepth 3 -type f -not -path './.git/*' -not -path './.tomorrowedge/*' -printf '%p %s bytes\\n' | sort | head -300",
        cwd="/app",
        timeout_sec=60,
    )
    transcript.append(format_observation("final_snapshot", final_snapshot.stdout, final_snapshot.stderr, 0))
    return partial_result(transcript, stdout_tail, stderr_tail, max_steps, primary_model, advisor_model, usage, trace_events)


def partial_result(
    transcript: list[str],
    stdout_tail: str,
    stderr_tail: str,
    steps: int,
    primary_model: str,
    advisor_model: str,
    usage: dict[str, int | float | None],
    trace_events: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    return {
        "stdout_tail": "\n".join(transcript)[-4000:] or stdout_tail,
        "stderr_tail": stderr_tail,
        "steps": steps,
        "model": primary_model,
        "advisor_model": advisor_model,
        "input_tokens": usage["input_tokens"] or None,
        "output_tokens": usage["output_tokens"] or None,
        "cost_usd": usage["cost_usd"],
        "trace_tail": (trace_events or [])[-12:],
        "runtime_config": next((event for event in (trace_events or []) if event.get("type") == "terminal_runtime_config"), None),
        "strong_interventions": [
            event for event in (trace_events or []) if event.get("type") == "terminal_strong_intervention"
        ],
    }


def update_context(context: AgentContext, result: dict[str, object]) -> None:
    context.metadata = {
        "tomorrowedge": {
            "agent": TomorrowEdgeHarborAgent.name(),
            "version": "1.6.3-harbor",
            "stdout_tail": result["stdout_tail"],
            "stderr_tail": result["stderr_tail"],
            "steps": result["steps"],
            "model": result["model"],
            "advisor_model": result.get("advisor_model"),
            "trace_tail": result.get("trace_tail", []),
            "runtime_config": result.get("runtime_config"),
            "strong_intervention_count": len(result.get("strong_interventions", [])),
            "strong_interventions": result.get("strong_interventions", [])[-6:],
        }
    }
    if result["input_tokens"] is not None:
        context.n_input_tokens = result["input_tokens"]
    if result["output_tokens"] is not None:
        context.n_output_tokens = result["output_tokens"]
    if result["cost_usd"] is not None:
        context.cost_usd = result["cost_usd"]


def terminal_agent_system_prompt() -> str:
    return "\n".join([
        "You are TomorrowEdge's Terminal-Bench execution agent.",
        "River/Core is only the facilitator: it will ask for evidence, contracts, and hard-gate checks, but it will not hand you the solution.",
        "You must derive the implementation from inspected evidence yourself.",
        "You control a Linux shell in /app. Solve the task by issuing shell commands.",
        "Return JSON only: {\"thought\":\"...\", \"commands\":[\"...\"], \"done\":false}.",
        "You may also return files: [{\"path\":\"/app/solve.py\", \"content\":\"...\"}] to create scripts or artifacts; then run them with short commands.",
        "Use commands to inspect files, run tests, write scripts, compile code, and create required artifacts.",
        "Prefer robust shell/Python scripts over prose. Keep commands self-contained.",
        "Keep thought short. Do not put derivations or essays in the final answer; convert your derivation into a file or command.",
        "Commands must be short. Avoid huge here-docs, package installs, servers, sleeps, REPLs, and network calls.",
        "Do not browse the web unless the task explicitly requires external information.",
        "If verification output says size/decompression/cmp failed, repair the generated files before stopping.",
        "Do not ask the user questions. Do not stop until the task is complete or no further progress is possible.",
        "When complete, return {\"thought\":\"brief verification\", \"commands\":[], \"done\":true}.",
    ])


def task_strategy_hint(instruction: str, advisor_json: dict[str, object]) -> str:
    profile = " ".join([
        str(advisor_json.get("task_profile") or ""),
        str(advisor_json.get("strategy_protocol") or ""),
        json.dumps(advisor_json.get("guiding_questions") or "", ensure_ascii=False),
        json.dumps(advisor_json.get("evidence_to_collect") or "", ensure_ascii=False),
    ]).lower()
    decoder_like = any(token in profile for token in [
        "reverse_engineer_matching_decoder",
        "translate_verify_reverse",
        "decoder",
        "decompressor",
        "state machine",
        "arithmetic",
    ])
    if decoder_like:
        return (
            "Strategy protocol: translate_verify_reverse. Treat this as a matching-decoder reverse-engineering task, "
            "not a from-scratch encoder task. First translate the provided decoder/decompressor into a tiny reference "
            "decoder/probe in the easiest language available, preserving state updates exactly. Verify that reference "
            "against the original decoder on small generated inputs before trusting it. Then derive the encoder by "
            "mirroring the decoder state machine and test after each change with the hard gate. Avoid independent "
            "standard arithmetic-coder implementations unless they are proven byte-for-byte compatible with the decoder. "
            "If a generator exists but data.comp fails, repair the state synchronization, normalization, off-by-one, "
            "or tokenization path before adding new architecture."
        )
    return ""


def recover_advisor_semantic_tags(raw_text: str) -> dict[str, object]:
    normalized = raw_text.lower()
    recovered: dict[str, object] = {}
    if "reverse_engineer_matching_decoder" in normalized:
        recovered["task_profile"] = "reverse_engineer_matching_decoder"
    if "translate_verify_reverse" in normalized:
        recovered["strategy_protocol"] = "translate_verify_reverse"
    if recovered:
        recovered["recovered_from_partial_advisor_output"] = True
    return recovered


def compact_transcript_for_model(transcript: list[str]) -> list[str]:
    anchors: list[str] = []
    for item in transcript:
        if item.startswith("advisor(") or item.startswith("core_strategy:"):
            anchors.append(item[-3000:])
    recent = transcript[-8:]
    compacted: list[str] = []
    for item in anchors + recent:
        if item not in compacted:
            compacted.append(item)
    return compacted


def terminal_agent_user_prompt(instruction: str, transcript: list[str], step: int, max_steps: int, strategy_hint: str = "") -> str:
    recent = "\n\n".join(transcript[-12:])
    stage_rule = (
        "Core instruction for this late stage: stop explaining the algorithm. Write or repair the smallest executable script/artifact that tests your derived hypothesis now."
        if step >= max(4, max_steps // 2)
        else "Core instruction for this early stage: collect only evidence that changes the implementation, then turn it into an executable experiment."
    )
    return "\n".join([
        f"Task:\n{instruction}",
        "",
        f"Step {step}/{max_steps}. Recent observations:",
        recent[-18000:],
        "",
        f"Core strategy hint: {strategy_hint}" if strategy_hint else "Core strategy hint: follow the advisor's evidence-first protocol.",
        "",
        stage_rule,
        "Choose the next shell commands. If creating files, write them directly under /app as requested.",
        "Use at most two short commands. Never start interactive programs or long-running services.",
        "For nontrivial code, return it as files instead of a here-doc command.",
        "Do not repeat inspection commands after you already saw the relevant file; write or repair code instead.",
        "If you have enough evidence to describe an encoder/solver in prose, you must instead submit it as files[] plus a command.",
        "If an encoder/compressor script already exists but /app/data.comp is missing, run or repair that script before any further inspection.",
        "Return valid JSON only.",
    ])


def strong_intervention_system_prompt() -> str:
    return "\n".join([
        "You are the TomorrowEdge council reviewer/judge for Terminal-Bench rescue.",
        "Core does not hand over the answer; you must turn existing trace evidence into the next executable action contract.",
        "Return executable JSON action only, using the same schema:",
        "{\"thought\":\"diagnosis\", \"files\":[{\"path\":\"/app/fix.py\", \"content\":\"...\"}], \"commands\":[\"python3 /app/fix.py\"], \"verify\":true, \"done\":false}",
        "Do not return prose. Do not ask questions. Do not install packages or use the network.",
        "Prefer a concrete repair file plus a short command. If previous scripts are wrong, replace them.",
        "If the trace already contains the relevant source/data, do not inspect again; force an executable probe, encoder, or repair script.",
        "If a generated encoder script exists and the hard gate is no_file, run or repair the script instead of reading decomp.c again.",
        "After the halfway point, inspection-only actions are invalid unless the trace lacks the task source file.",
        "The hard gate is authoritative; model confidence cannot override test/decompression failure.",
    ])


def strong_intervention_user_prompt(
    *,
    instruction: str,
    strategy_hint: str,
    transcript: list[str],
    step: int,
    max_steps: int,
    verification_status: str,
) -> str:
    recent = "\n\n".join(transcript[-14:])
    late_stage_rule = (
        "Late-stage rule: this is the second half of the step budget. Do not return inspection-only commands; "
        "write or repair the required artifact now with files[] plus a short command. "
        "If the execution model wrote a derivation in prose, compile that derivation into an executable script/action instead of repeating the derivation."
        if step >= max(3, max_steps // 2)
        else "Early-stage rule: inspection is allowed only if the necessary source/data evidence is not already in the trace."
    )
    return "\n".join([
        f"Task:\n{instruction}",
        "",
        f"Rescue point: after step {step}/{max_steps}, hard gate status is {verification_status}.",
        f"Core strategy hint: {strategy_hint}" if strategy_hint else "Core strategy hint: preserve evidence-first repair and hard-gate alignment.",
        late_stage_rule,
        "Recent execution trace and evidence:",
        recent[-22000:],
        "",
        "Give the next rescue action. Return JSON only.",
        "If the task involves generating a required artifact, write a complete script or artifact via files[].",
        "If the previous failure is no_file, size_fail, crash, timeout, or output_mismatch, explicitly repair that failure mode.",
        "If the status is protocol_failure, the primary model failed to emit executable JSON; you must provide the executable next action.",
        "For crash, size_fail, or output_mismatch after an artifact already exists, prefer replacing the generator or artifact over more inspection.",
        "For compressor tasks, a valid late-stage action usually creates or repairs an encoder/probe script and then runs it; do not merely read decomp.c again after it is present in the trace.",
        "If the recent trace mentions enc.py, encoder.py, compress.py, or solve.py but data.comp is missing, execute or repair that file now.",
        "Use verify=false only for pure evidence-gathering commands; use verify=true for any repair that should be judged by the hard gate.",
        "Use at most two commands. Avoid filler commands such as echo separators.",
    ])


def request_strong_intervention(
    *,
    credential: str,
    strong_model: str,
    strong_max_tokens: int,
    instruction: str,
    strategy_hint: str,
    transcript: list[str],
    step: int,
    max_steps: int,
    verification_status: str,
    usage: dict[str, int | float | None],
    trace_events: list[dict[str, object]],
    model_timeout_sec: int,
) -> tuple[dict[str, object], bool]:
    strong = call_openrouter_json(
        credential=credential,
        model=strong_model,
        system=strong_intervention_system_prompt(),
        user=strong_intervention_user_prompt(
            instruction=instruction,
            strategy_hint=strategy_hint,
            transcript=transcript,
            step=step,
            max_steps=max_steps,
            verification_status=verification_status,
        ),
        max_tokens=strong_max_tokens,
        temperature=0.05,
        timeout_sec=model_timeout_sec,
    )
    add_usage(usage, strong)
    strong_payload = normalize_terminal_decision(strong.get("json"), strong.get("content", ""))
    has_action = has_executable_terminal_action(strong_payload)
    retry_count = 0
    raw_excerpt = str(strong.get("raw_excerpt") or strong.get("content") or "")[:700]
    repair_raw_excerpt = ""
    if not has_action:
        retry_count = 1
        repair = call_openrouter_json(
            credential=credential,
            model=strong_model,
            system=strong_json_repair_system_prompt(),
            user=strong_json_repair_user_prompt(
                instruction=instruction,
                strategy_hint=strategy_hint,
                verification_status=verification_status,
                previous_output=raw_excerpt,
                transcript=transcript,
            ),
            max_tokens=strong_max_tokens,
            temperature=0.0,
            timeout_sec=model_timeout_sec,
        )
        add_usage(usage, repair)
        repaired_payload = normalize_terminal_decision(repair.get("json"), repair.get("content", ""))
        repair_raw_excerpt = str(repair.get("raw_excerpt") or repair.get("content") or "")[:700]
        if has_executable_terminal_action(repaired_payload):
            strong_payload = repaired_payload
            has_action = True
            raw_excerpt = repair_raw_excerpt
    trace_events.append({
        "type": "terminal_strong_intervention",
        "step": step,
        "model": strong_model,
        "accepted": has_action,
        "reason": f"status {verification_status}",
        "retryCount": retry_count,
        "rawExcerpt": raw_excerpt,
        "repairRawExcerpt": repair_raw_excerpt,
    })
    transcript.append(
        f"strong_intervention({strong_model}): "
        f"{json.dumps(redact_action_for_transcript(strong_payload), ensure_ascii=False)[:2500]}"
    )
    return strong_payload, has_action


def strong_json_repair_system_prompt() -> str:
    return "\n".join([
        "You are the strict JSON repair pass for TomorrowEdge Terminal-Bench strong rescue.",
        "Your previous answer was not an executable terminal action.",
        "Return exactly one JSON object. Start with { and end with }.",
        "No markdown, no prose, no analysis, no code fences.",
        "The object must contain at least one non-empty commands[] entry or one files[] entry.",
        "Schema: {\"thought\":\"brief diagnosis\", \"files\":[{\"path\":\"/app/fix.py\", \"content\":\"...\"}], \"commands\":[\"python3 /app/fix.py\"], \"verify\":true, \"done\":false}.",
        "If there is not enough evidence to repair, return an inspection command with verify=false, not prose.",
    ])


def strong_json_repair_user_prompt(
    *,
    instruction: str,
    strategy_hint: str,
    verification_status: str,
    previous_output: str,
    transcript: list[str],
) -> str:
    recent = "\n\n".join(transcript[-5:])
    return "\n".join([
        "Compile this failed rescue into one executable JSON action.",
        f"Task summary: {instruction[:1000]}",
        f"Core strategy hint: {strategy_hint[:1600]}" if strategy_hint else "Core strategy hint: preserve the evidence-first hard-gate repair path.",
        f"Hard-gate status: {verification_status}.",
        f"Invalid previous output excerpt: {(previous_output or '[empty]')[:2400]}",
        f"Recent evidence excerpt: {recent[-6500:]}",
        "Return only JSON. It must include commands[] or files[].",
        "If the excerpt contains a derivation or implementation plan, turn it into files[] and commands[] now.",
        "If the trace already includes source/data, do not choose more source inspection as the only action.",
        "If the trace includes a generated encoder script and the failure is no_file, the repaired action must run or repair that script.",
        "For inspection-only commands set verify=false. For repair commands/files set verify=true.",
    ])


def redact_action_for_transcript(action: dict[str, object]) -> dict[str, object]:
    redacted = dict(action)
    files = []
    for item in redacted.get("files", []) if isinstance(redacted.get("files"), list) else []:
        if isinstance(item, dict):
            files.append({
                "path": item.get("path"),
                "contentPreview": str(item.get("content", ""))[:240],
                "contentBytes": len(str(item.get("content", "")).encode("utf-8")),
            })
    redacted["files"] = files
    return redacted


def has_executable_terminal_action(action: dict[str, object]) -> bool:
    commands = action.get("commands")
    files = action.get("files")
    return (isinstance(commands, list) and any(str(command).strip() for command in commands)) or (
        isinstance(files, list) and any(isinstance(item, dict) and item.get("path") and item.get("content") is not None for item in files)
    )


def call_openrouter_json(
    *,
    credential: str,
    model: str,
    system: str,
    user: str,
    max_tokens: int,
    temperature: float,
    timeout_sec: int,
) -> dict[str, object]:
    body: dict[str, object] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }
    lower_model = model.lower()
    if "glm-5" in lower_model or "z-ai/glm" in lower_model:
        body["reasoning"] = {"effort": "none", "exclude": True}
        body["reasoning_effort"] = "none"
    elif "kimi-k2.7" in lower_model:
        body["reasoning"] = {"effort": "none", "exclude": True}
        body["reasoning_effort"] = "none"
    raw = post_openrouter_with_deadline(credential=credential, body=body, timeout_sec=timeout_sec)
    payload = json.loads(raw)
    choice = (payload.get("choices") or [{}])[0]
    message = (choice.get("message") or {})
    content = normalize_message_content(message.get("content"))
    reasoning = normalize_message_content(message.get("reasoning") or message.get("reasoning_content"))
    parse_source = content or reasoning
    parsed = extract_json_object(parse_source)
    usage = payload.get("usage") or {}
    return {
        "content": content,
        "reasoning": reasoning,
        "raw_excerpt": (content or reasoning)[:1200],
        "json": parsed,
        "finish_reason": choice.get("finish_reason"),
        "input_tokens": usage.get("prompt_tokens"),
        "output_tokens": usage.get("completion_tokens"),
    }


def post_openrouter_with_deadline(*, credential: str, body: dict[str, object], timeout_sec: int) -> str:
    payload = json.dumps(body).encode("utf-8")
    curl = shutil.which("curl.exe") or shutil.which("curl")
    if curl:
        body_path = ""
        config_path = ""
        try:
            with tempfile.NamedTemporaryFile("wb", delete=False) as body_file:
                body_file.write(payload)
                body_path = body_file.name
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as config_file:
                curl_body_path = body_path.replace("\\", "/")
                config_file.write("\n".join([
                    'url = "https://openrouter.ai/api/v1/chat/completions"',
                    'silent',
                    'show-error',
                    f"max-time = {timeout_sec}",
                    'header = "Content-Type: application/json"',
                    f'header = "Authorization: Bearer {credential}"',
                    'header = "HTTP-Referer: https://github.com/axobase001/tomorrowedge"',
                    'header = "X-Title: TomorrowEdge Terminal-Bench Agent"',
                    f'data-binary = "@{curl_body_path}"',
                    "",
                ]))
                config_path = config_file.name
            result = subprocess.run(
                [curl, "--config", config_path],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=timeout_sec + 10,
                check=False,
            )
            stdout = result.stdout.decode("utf-8", errors="replace")
            stderr = result.stderr.decode("utf-8", errors="replace")
            if result.returncode == 0 and stdout.strip():
                return stdout
            if result.returncode == 28 and stdout.strip():
                return stdout
            raise RuntimeError(f"OpenRouter curl request failed rc={result.returncode}: {stderr[:800] or stdout[:800]}")
        finally:
            for path_value in [body_path, config_path]:
                if path_value:
                    try:
                        os.unlink(path_value)
                    except OSError:
                        pass
    request = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=payload,
        headers={
            "Authorization": f"Bearer {credential}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/axobase001/tomorrowedge",
            "X-Title": "TomorrowEdge Terminal-Bench Agent",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_sec) as response:
            return response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        raw_error = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenRouter request failed: {error.code} {raw_error[:1000]}") from error


def normalize_message_content(value: object) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        chunks: list[str] = []
        for item in value:
            if isinstance(item, dict):
                text = item.get("text") or item.get("content")
                if isinstance(text, str):
                    chunks.append(text)
            elif isinstance(item, str):
                chunks.append(item)
        return "\n".join(chunks).strip()
    return ""


def extract_json_object(content: str) -> object | None:
    try:
        direct = json.loads(content)
        if isinstance(direct, str) and direct != content:
            nested = extract_json_object(direct)
            if nested is not None:
                return nested
        return direct
    except Exception:
        pass
    start = content.find("{")
    if start < 0:
        return None
    in_string = False
    escaped = False
    depth = 0
    for index in range(start, len(content)):
        char = content[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(content[start:index + 1])
                except Exception:
                    return None
    return None


def normalize_terminal_decision(parsed: object, content: str) -> dict[str, object]:
    if isinstance(parsed, dict):
        source = parsed
        for key in ["action", "next_action", "terminal_action", "rescue_action"]:
            nested = parsed.get(key)
            if isinstance(nested, dict):
                source = nested
                break
        commands = source.get("commands")
        if commands is None:
            commands = source.get("command") or source.get("shell_command") or source.get("shell")
        if isinstance(commands, str):
            commands = [commands]
        if not isinstance(commands, list):
            commands = []
        files = source.get("files")
        if files is None and isinstance(source.get("file"), dict):
            files = [source.get("file")]
        if files is None:
            files = source.get("write_files") or source.get("artifacts")
        return {
            "thought": source.get("thought") or source.get("reason") or source.get("summary") or parsed.get("thought") or parsed.get("summary") or "",
            "commands": commands,
            "files": files if isinstance(files, list) else [],
            "verify": bool(source.get("verify", parsed.get("verify", True))),
            "done": bool(source.get("done") or source.get("finished") or parsed.get("done") or parsed.get("finished")),
        }
    return {
        "thought": "Model returned non-JSON output; no shell command executed.",
        "commands": [],
        "files": [],
        "verify": True,
        "done": False,
        "parse_error": True,
    }


async def upload_generated_files(environment: BaseEnvironment, files: list[dict[str, object]]) -> list[str]:
    uploaded: list[str] = []
    for item in files[:4]:
        path_value = item.get("path")
        content_value = item.get("content")
        if not isinstance(path_value, str) or not isinstance(content_value, str):
            continue
        destination = normalize_container_path(path_value)
        if not destination:
            continue
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="", delete=False) as handle:
            handle.write(content_value)
            temp_path = Path(handle.name)
        try:
            await environment.upload_file(temp_path, destination)
            uploaded.append(destination)
        finally:
            try:
                temp_path.unlink()
            except OSError:
                pass
    return uploaded


def normalize_container_path(path_value: str) -> str | None:
    normalized = path_value.strip().replace("\\", "/")
    if not normalized:
        return None
    if normalized.startswith("/app/"):
        return normalized
    if normalized.startswith("./"):
        normalized = normalized[2:]
    if normalized.startswith("/") or ".." in normalized.split("/"):
        return None
    return f"/app/{normalized}"


def split_heredoc_command(command: str) -> dict[str, str] | None:
    match = re.search(r"cat\s+>\s+([^\s]+)\s+<<['\"]?([A-Za-z0-9_.-]+)['\"]?\r?\n", command)
    if not match:
        return None
    path_value = match.group(1)
    delimiter = match.group(2)
    content_start = match.end()
    delimiter_match = re.search(rf"\n{re.escape(delimiter)}(?:\r?\n|$)", command[content_start:])
    if not delimiter_match:
        return None
    content_end = content_start + delimiter_match.start()
    remainder_start = content_start + delimiter_match.end()
    return {
        "path": path_value,
        "content": command[content_start:content_end],
        "remainder": command[remainder_start:].strip(),
    }


def inferred_commands_for_uploaded_files(paths: list[str]) -> list[str]:
    commands: list[str] = []
    for path_value in paths:
        name = Path(path_value).name.lower()
        if name in {"solve.py", "compress.py", "main.py", "encoder.py", "enc.py"} or (
            name.endswith(".py") and any(prefix in name for prefix in ["solve", "compress", "encoder", "enc"])
        ):
            commands.append(f"python3 {shlex.quote(path_value)} > /app/data.comp")
        elif name in {"solve.sh", "run.sh"}:
            commands.append(f"sh {shlex.quote(path_value)}")
        elif name in {"solve.c", "compress.c", "main.c", "encoder.c"}:
            binary = f"/tmp/{Path(path_value).stem}"
            commands.append(f"gcc -O2 {shlex.quote(path_value)} -o {shlex.quote(binary)} && {shlex.quote(binary)} > /app/data.comp")
    return commands[:1]


def is_disallowed_command(command: str) -> bool:
    lowered = command.lower()
    blocked_patterns = [
        "apt-get ",
        "apk add",
        "dnf install",
        "yum install",
        "pip install",
        "npm install",
        "curl ",
        "wget ",
        "sleep ",
        "tail -f",
        "while true",
        "python -i",
        "node -i",
        "bash -i",
        "sh -i",
    ]
    return any(pattern in lowered for pattern in blocked_patterns)


def verification_command() -> str:
    return (
        "if [ ! -f /app/data.comp ]; then echo 'TBENCH_VERIFY=NO_FILE'; exit 0; fi; "
        "echo DATA_COMP_SIZE=$(wc -c < /app/data.comp); "
        "if [ $(wc -c < /app/data.comp) -gt 2500 ]; then echo 'TBENCH_VERIFY=SIZE_FAIL'; fi; "
        "timeout 10s /app/decomp < /app/data.comp > /tmp/tbench.out 2>/tmp/tbench.err; rc=$?; "
        "echo DECOMP_RC=$rc; "
        "if [ -s /tmp/tbench.err ]; then echo DECOMP_STDERR_START; cat /tmp/tbench.err; echo DECOMP_STDERR_END; fi; "
        "if [ $rc -eq 0 ] && cmp -s /tmp/tbench.out /app/data.txt && [ $(wc -c < /app/data.comp) -le 2500 ]; then "
        "echo 'TBENCH_VERIFY=PASS'; else echo 'TBENCH_VERIFY=FAIL'; "
        "echo OUT_SIZE=$(wc -c < /tmp/tbench.out 2>/dev/null || echo 0); "
        "cmp -l /tmp/tbench.out /app/data.txt 2>/dev/null | head -20 || true; fi"
    )


def available_tools_from_probe(stdout: str) -> list[str]:
    available: list[str] = []
    for line in stdout.splitlines():
        if line.endswith("=present"):
            available.append(line.split("=", 1)[0])
    return available


def parse_verification_status(stdout: str, stderr: str) -> str:
    combined = f"{stdout}\n{stderr}"
    if "TBENCH_VERIFY=PASS" in combined:
        return "pass"
    if "TBENCH_VERIFY=NO_FILE" in combined:
        return "no_file"
    if "TBENCH_VERIFY=SIZE_FAIL" in combined:
        return "size_fail"
    exit_code = extract_number(combined, "DECOMP_RC=")
    if exit_code is not None and exit_code != 0:
        return "crash"
    if "timed out" in combined.lower() or "timeout" in combined.lower():
        return "timeout"
    if "TBENCH_VERIFY=FAIL" in combined:
        return "output_mismatch"
    return "unknown"


def extract_number(text: str, prefix: str) -> int | None:
    for line in text.splitlines():
        if not line.startswith(prefix):
            continue
        try:
            return int(line.removeprefix(prefix).strip())
        except ValueError:
            return None
    return None


def format_observation(label: str, stdout: str | None, stderr: str | None, elapsed: float) -> str:
    return "\n".join([
        f"## {label} ({elapsed:.1f}s)",
        "# stdout",
        (stdout or "")[-6000:],
        "# stderr",
        (stderr or "")[-3000:],
    ])


def add_usage(total: dict[str, int | float | None], response: dict[str, object]) -> None:
    input_tokens = response.get("input_tokens")
    output_tokens = response.get("output_tokens")
    if isinstance(input_tokens, int):
        total["input_tokens"] = int(total.get("input_tokens") or 0) + input_tokens
    if isinstance(output_tokens, int):
        total["output_tokens"] = int(total.get("output_tokens") or 0) + output_tokens


def parse_int_env(value: str | None, default: int) -> int:
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def extract_usage(stdout: str) -> dict[str, int | float] | None:
    start = stdout.find("{")
    end = stdout.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        payload = json.loads(stdout[start:end + 1])
    except Exception:
        return None
    telemetry = payload.get("telemetry") or payload.get("cost") or {}
    input_tokens = telemetry.get("inputTokens") or telemetry.get("input_tokens")
    output_tokens = telemetry.get("outputTokens") or telemetry.get("output_tokens")
    cost = telemetry.get("costUsd") or telemetry.get("cost_usd")
    result: dict[str, int | float] = {}
    if isinstance(input_tokens, int):
        result["inputTokens"] = input_tokens
    if isinstance(output_tokens, int):
        result["outputTokens"] = output_tokens
    if isinstance(cost, (int, float)):
        result["costUsd"] = float(cost)
    return result or None
