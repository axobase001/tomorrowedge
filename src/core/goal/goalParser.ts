import type { Plan, TaskType } from "../../schemas/plan.js";

export function parseGoalToPlan(goal: string): Plan {
  const lower = goal.toLowerCase();
  const taskType = inferTaskType(lower);
  const constraints = extractConstraints(goal);
  const riskSignals = inferRiskSignals(goal);
  const highRisk = riskSignals.length > 0;
  const steps = buildPlanSteps(taskType, highRisk, goal);
  return {
    goal,
    constraints,
    riskLevel: highRisk ? "high" : constraints.length > 0 ? "medium" : "low",
    taskType,
    steps,
    verificationCommands: verificationCommandsFor(goal, taskType),
    debateRecommended: highRisk,
    reasonForDebate: highRisk ? `Task appears to touch high-risk behavior: ${riskSignals.join(", ")}.` : undefined
  };
}

function inferTaskType(lower: string): TaskType {
  if (/\b(read|list|show|inspect|scan|describe|summarize|explain|analy[sz]e|tree|structure)\b|读取|查看|列出|输出|总结|分析/.test(lower)) return "analysis";
  if (/\b(test|spec|regression|coverage)\b|测试|回归/.test(lower)) return "test";
  if (/\b(bug|fix|repair|broken|failing|failure|crash)\b|修复|报错|失败|错误/.test(lower)) return "bugfix";
  if (/\b(doc|readme|documentation|changelog)\b|文档|说明/.test(lower)) return "docs";
  if (/\b(refactor|cleanup|rename|migrate|migration)\b|重构|迁移|清理/.test(lower)) return "refactor";
  if (/\b(add|feature|implement|create|build|support|enable)\b|新增|实现|创建|支持/.test(lower)) return "feature";
  return "unknown";
}

function inferRiskSignals(goal: string): string[] {
  const signals: string[] = [];
  const checks: Array<[RegExp, string]> = [
    [/auth|oauth|login|permission|rbac|token/i, "auth"],
    [/payment|billing|invoice|checkout/i, "payment"],
    [/delete|drop|remove|destructive|wipe/i, "destructive_change"],
    [/credential|secret|api[_ -]?key|password/i, "secret_boundary"],
    [/database|schema|migration|sql/i, "data_schema"],
    [/security|crypto|encrypt|decrypt|signature/i, "security_sensitive"],
    [/production|deploy|release/i, "release_boundary"]
  ];
  for (const [pattern, signal] of checks) {
    if (pattern.test(goal)) signals.push(signal);
  }
  return signals;
}

function buildPlanSteps(taskType: TaskType, highRisk: boolean, goal: string): Plan["steps"] {
  const steps: Plan["steps"] = [
    { id: "understand", title: "Understand task", detail: "Extract goal, constraints, risk signals, and expected deliverable.", status: "done" }
  ];
  if (taskType === "analysis") {
    steps.push(
      { id: "inspect", title: "Inspect context", detail: "Read only the relevant files, directories, or trace artifacts.", status: "pending" },
      { id: "summarize", title: "Summarize findings", detail: "Return evidence and caveats without entering a patch workflow.", status: "pending" }
    );
    return steps;
  }
  steps.push({ id: "explore", title: "Explore repository", detail: "Find the smallest relevant context and identify likely edit boundaries.", status: "pending" });
  if (highRisk) {
    steps.push({ id: "risk-map", title: "Map risk boundary", detail: "Identify auth, data, secret, destructive, or release-sensitive behavior before coding.", status: "pending" });
  }
  if (taskType === "feature") {
    steps.push(
      { id: "design", title: "Design implementation path", detail: "Choose interfaces, state changes, and verification strategy before editing.", status: "pending" },
      { id: "implement", title: "Implement feature", detail: "Generate a scoped patch with tests or fixtures where practical.", status: "pending" }
    );
  } else if (taskType === "refactor") {
    steps.push(
      { id: "dependency-map", title: "Map dependencies", detail: "Find callers and compatibility boundaries before moving code.", status: "pending" },
      { id: "refactor", title: "Refactor safely", detail: "Preserve behavior while reducing duplication or moving responsibility.", status: "pending" }
    );
  } else if (taskType === "docs") {
    steps.push({ id: "edit-docs", title: "Update documentation", detail: "Patch only documentation or examples needed by the request.", status: "pending" });
  } else if (taskType === "test") {
    steps.push({ id: "add-test", title: "Add or repair tests", detail: "Create focused regression coverage before or alongside the fix.", status: "pending" });
  } else {
    steps.push({ id: "propose", title: "Propose candidate patch", detail: "Generate one or more patch candidates.", status: "pending" });
  }
  if (/ui|frontend|react|vue|css|layout|页面|界面/i.test(goal)) {
    steps.push({ id: "ui-check", title: "Check UI behavior", detail: "Verify layout, responsive behavior, and visible copy when applicable.", status: "pending" });
  }
  steps.push({ id: "review", title: "Review candidate", detail: "Evaluate patch risk and evidence before judge selection.", status: "pending" });
  steps.push({ id: "verify", title: "Verify", detail: "Run approved checks and gather evidence.", status: "pending" });
  return steps;
}

function verificationCommandsFor(goal: string, taskType: TaskType): string[] {
  if (taskType === "analysis") return [];
  if (/cargo|rust/i.test(goal)) return ["cargo test"];
  if (/go test|golang|\bgo\b/i.test(goal)) return ["go test ./..."];
  if (/pytest|python/i.test(goal)) return ["pytest"];
  if (/docs?|readme|changelog/i.test(goal) && taskType === "docs") return [];
  return ["npm test"];
}

function extractConstraints(goal: string): string[] {
  const constraints: string[] = [];
  for (const match of goal.matchAll(/do not ([^.。]+)/gi)) {
    constraints.push(`Do not ${match[1].trim()}`);
  }
  for (const match of goal.matchAll(/without ([^.。]+)/gi)) {
    constraints.push(`Without ${match[1].trim()}`);
  }
  for (const match of goal.matchAll(/不要([^。]+)/g)) {
    constraints.push(`不要${match[1].trim()}`);
  }
  return constraints;
}
