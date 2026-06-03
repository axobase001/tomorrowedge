import type { Plan, TaskType } from "../../schemas/plan.js";

export function parseGoalToPlan(goal: string): Plan {
  const lower = goal.toLowerCase();
  const taskType: TaskType = lower.includes("test")
    ? "test"
    : lower.includes("bug") || lower.includes("fix")
      ? "bugfix"
      : lower.includes("doc")
        ? "docs"
        : lower.includes("refactor")
          ? "refactor"
          : lower.includes("add") || lower.includes("feature")
            ? "feature"
            : "unknown";
  const constraints = extractConstraints(goal);
  const highRisk = /auth|payment|delete|credential|secret|database|schema/i.test(goal);
  return {
    goal,
    constraints,
    riskLevel: highRisk ? "high" : constraints.length > 0 ? "medium" : "low",
    taskType,
    steps: [
      { id: "understand", title: "Understand task", detail: "Extract constraints and risks.", status: "done" },
      { id: "explore", title: "Explore repository", detail: "Find the smallest relevant context.", status: "pending" },
      { id: "propose", title: "Propose candidate patch", detail: "Generate one or more patch candidates.", status: "pending" },
      { id: "verify", title: "Verify", detail: "Run approved checks and gather evidence.", status: "pending" }
    ],
    verificationCommands: ["npm test"],
    debateRecommended: highRisk,
    reasonForDebate: highRisk ? "Task appears to touch high-risk behavior." : undefined
  };
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
