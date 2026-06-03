import path from "node:path";
import type { CapabilityRoute } from "../../schemas/capabilityRoute.js";
import type { StructuredVisualSpec } from "../../schemas/visualSpec.js";
import { makeId } from "../../utils/ids.js";
import type { ModelRouter } from "../routing/router.js";

export function buildCapabilityRoute(input: {
  goal: string;
  imagePaths: string[];
  router: ModelRouter;
  visualSpec?: StructuredVisualSpec;
}): CapabilityRoute | undefined {
  if (!input.imagePaths.length) return undefined;
  const vision = input.router.assignmentFor("vision");
  const planner = input.router.assignmentFor("planner");
  const coder = input.router.assignmentFor("coder_a");
  const reviewer = input.router.assignmentFor("reviewer");
  return {
    id: makeId("caproute"),
    trigger: "image_input",
    inputTypes: [...new Set(input.imagePaths.map((imagePath) => imageInputType(imagePath)))],
    steps: [
      {
        role: "vision",
        capability: "vision",
        provider: vision.provider,
        model: vision.model,
        status: input.visualSpec ? "success" : "planned",
        summary: input.visualSpec ? "extracted structured visual spec" : "translate images into structured visual spec"
      },
      {
        role: "planner",
        capability: "planning",
        provider: planner.provider,
        model: planner.model,
        status: "planned",
        summary: "combine visual spec with repo task and acceptance criteria"
      },
      {
        role: "coder_a",
        capability: "coding",
        provider: coder.provider,
        model: coder.model,
        status: "planned",
        summary: "generate patch/component/test from structured spec"
      },
      {
        role: "reviewer",
        capability: "review",
        provider: reviewer.provider,
        model: reviewer.model,
        status: "planned",
        summary: "review implementation against the visual handoff"
      }
    ],
    handoffs: [
      { from: "vision", to: "planner", artifact: "StructuredVisualSpec", summary: "perception output becomes planning context" },
      { from: "planner", to: "coder_a", artifact: "Plan + StructuredVisualSpec", summary: "planner preserves visual acceptance criteria for implementation" },
      { from: "coder_a", to: "reviewer", artifact: "PatchCandidate", summary: "reviewer checks code against the visual spec" }
    ],
    summary: `Capability stitching route: image input -> vision/perception -> structured spec -> planning/coding/review for "${input.goal}".`
  };
}

function imageInputType(imagePath: string): string {
  const ext = path.extname(imagePath).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)) return "screenshot/image";
  if ([".svg"].includes(ext)) return "diagram/vector";
  return "visual";
}
