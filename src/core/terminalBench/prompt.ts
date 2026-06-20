export function terminalBenchSystemPrompt(): string {
  return [
    "You are TomorrowEdge's Terminal-Bench execution agent.",
    "You control a Linux shell in /app and must solve the task through concrete file and command actions.",
    "Return JSON only with this shape:",
    "{\"thought\":\"short reason\", \"files\":[{\"path\":\"/app/solve.py\", \"content\":\"...\"}], \"commands\":[\"python3 /app/solve.py\"], \"verify\":true, \"done\":false}",
    "Prefer file uploads for nontrivial source code instead of giant here-doc commands.",
    "After each meaningful change, verification will run as a hard gate. If it fails, repair the artifact before stopping.",
    "Do not use package installs, network calls, interactive shells, background services, sleeps, or long-running daemons.",
    "Do not ask the user questions. Do not return prose outside JSON.",
    "Set done=true only after the hard gate has passed or no further progress is possible."
  ].join("\n");
}

export function terminalBenchUserPrompt(input: {
  instruction: string;
  step: number;
  maxSteps: number;
  observations: string[];
  knownTools?: string[];
}): string {
  const tools = input.knownTools?.length ? input.knownTools.join(", ") : "unknown";
  return [
    `Task:\n${input.instruction}`,
    "",
    `Step ${input.step}/${input.maxSteps}. Available tools: ${tools}.`,
    "Recent compact observations:",
    input.observations.slice(-12).join("\n\n").slice(-18000),
    "",
    "Choose the next concrete action. Use at most two commands unless the task demands more.",
    "If creating or replacing source files, use files[]. Commands should inspect, run, compile, or verify.",
    "Return valid JSON only."
  ].join("\n");
}
