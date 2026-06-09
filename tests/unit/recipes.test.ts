import { describe, expect, it } from "vitest";
import { getWorkflowRecipe, listWorkflowRecipes, materializeRecipeGoal } from "../../src/core/recipes/recipeLoader.js";

describe("workflow recipes", () => {
  it("ships the initial coding workflow recipe set", () => {
    const ids = listWorkflowRecipes().map((recipe) => recipe.id);

    expect(ids).toEqual(expect.arrayContaining(["review-only", "bugfix-sprint", "security-audit"]));
    expect(getWorkflowRecipe("bugfix-sprint")?.options?.repairOnFail).toBe(true);
    expect(getWorkflowRecipe("security-audit")?.options?.redTeamReview).toBe(true);
  });

  it("materializes a user task on top of the recipe default goal", () => {
    const recipe = getWorkflowRecipe("review-only")!;

    expect(materializeRecipeGoal(recipe, "inspect auth boundary")).toContain("User task:");
    expect(materializeRecipeGoal(recipe, "")).toBe(recipe.defaultGoal);
  });
});
