import type { Plan } from "../../schemas/plan.js";
import { buildTaskGraph } from "../planning/taskGraphBuilder.js";

export function parseGoalToPlan(goal: string): Plan {
  const plan: Plan = {
    goal,
    constraints: extractConstraints(goal),
    riskLevel: "medium",
    taskType: "unknown",
    workflowKind: "ask_user",
    requiresPatchWorkflow: false,
    steps: [
      {
        id: "semantic-route-required",
        title: "Route through model planner",
        detail: "Native parsing no longer performs semantic task classification. Runtime must use model-backed intent, scenario, planner, and governance decisions.",
        status: "pending"
      }
    ],
    verificationCommands: [],
    debateRecommended: false
  };
  return { ...plan, taskGraph: buildTaskGraph({ plan }) };
}

export function isDocumentOnlyGoal(goal: string): boolean {
  const pathLikeMatches = Array.from(goal.matchAll(/(?:^|[\s"'`(\[<])([A-Za-z0-9_.:/\\-]+\.(md|markdown|html|htm|txt|rst|adoc|json|yaml|yml|ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|cpp|cxx|cc|c|h|hpp|cs|php|rb|swift|vue|svelte|css|scss|sql))(?:$|[\s"'`)\]>.,;:])/gi));
  if (!pathLikeMatches.length) return false;
  const docExtensions = new Set(["md", "markdown", "html", "htm", "txt", "rst", "adoc"]);
  const codeExtensions = new Set(["json", "yaml", "yml", "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "java", "kt", "cpp", "cxx", "cc", "c", "h", "hpp", "cs", "php", "rb", "swift", "vue", "svelte", "css", "scss", "sql"]);
  const extensions = pathLikeMatches.map((match) => match[2].toLowerCase());
  return extensions.every((extension) => docExtensions.has(extension)) && !extensions.some((extension) => codeExtensions.has(extension));
}

function extractConstraints(goal: string): string[] {
  const constraints: string[] = [];
  for (const match of goal.matchAll(/do not ([^.\n]+)/gi)) {
    constraints.push(`Do not ${match[1].trim()}`);
  }
  for (const match of goal.matchAll(/without ([^.\n]+)/gi)) {
    constraints.push(`Without ${match[1].trim()}`);
  }
  return constraints;
}
