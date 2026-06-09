import { listWorkflowRecipes } from "../../core/recipes/recipeLoader.js";

export function recipesCommand(): void {
  const recipes = listWorkflowRecipes();
  process.stdout.write("Workflow recipes\n");
  for (const recipe of recipes) {
    const flags = [
      recipe.accessMode ? `access=${recipe.accessMode}` : undefined,
      recipe.options?.repairOnFail ? "repair" : undefined,
      recipe.options?.redTeamReview ? "red-team" : undefined,
      recipe.options?.liveAdvisory ? "advisory" : undefined
    ].filter(Boolean).join(", ");
    process.stdout.write(`- ${recipe.id}: ${recipe.name}${flags ? ` (${flags})` : ""}\n  ${recipe.description}\n`);
  }
}
