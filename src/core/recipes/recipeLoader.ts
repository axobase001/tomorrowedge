import type { WorkflowRecipe } from "./recipeTypes.js";

const builtinRecipes: WorkflowRecipe[] = [
  {
    id: "review-only",
    name: "Review only",
    description: "Inspect the current repository or diff without applying patches.",
    defaultGoal: "Review the current repository state and current diff. Do not apply patches; produce risks, evidence, and recommended next steps.",
    accessMode: "restricted",
    options: { liveAdvisory: true },
    roles: ["planner", "explorer", "reviewer", "judge"],
    verification: []
  },
  {
    id: "bugfix-sprint",
    name: "Bugfix sprint",
    description: "Generate candidate patches, review them, run tests, and enable the repair loop.",
    defaultGoal: "Fix the failing test with a minimal patch. Prefer focused changes, run verification, and repair once if verification fails.",
    accessMode: "partial",
    options: { repairOnFail: true },
    roles: ["planner", "explorer", "coder_a", "coder_b", "reviewer", "judge", "runner", "repairer"],
    verification: ["npm test"]
  },
  {
    id: "security-audit",
    name: "Security audit",
    description: "Run a conservative review path for security-sensitive changes.",
    defaultGoal: "Audit the current change for security, privacy, secret-handling, and authorization risks. Prefer review evidence over broad edits.",
    accessMode: "partial",
    options: { redTeamReview: true, liveAdvisory: true },
    roles: ["planner", "explorer", "reviewer", "judge"],
    verification: ["npm test"]
  }
];

export function listWorkflowRecipes(): WorkflowRecipe[] {
  return builtinRecipes.map((recipe) => ({ ...recipe, options: { ...(recipe.options ?? {}) }, roles: [...recipe.roles], verification: [...recipe.verification] }));
}

export function getWorkflowRecipe(id: string): WorkflowRecipe | undefined {
  return listWorkflowRecipes().find((recipe) => recipe.id === id);
}

export function materializeRecipeGoal(recipe: WorkflowRecipe, task: string): string {
  const trimmed = task.trim();
  if (!trimmed) return recipe.defaultGoal;
  return `${recipe.defaultGoal}\n\nUser task:\n${trimmed}`;
}
