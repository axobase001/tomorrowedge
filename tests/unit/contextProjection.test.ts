import { describe, expect, it } from "vitest";
import { runtimeArtifactFromText } from "../../src/core/contextProjection/artifactView.js";
import { projectRuntimeArtifact } from "../../src/core/contextProjection/providerView.js";
import { buildPatchEvidence } from "../../src/core/evidence/patchEvidence.js";

describe("context projection and evidence packets", () => {
  it("preserves artifact refs while projecting compact provider views", () => {
    const artifact = runtimeArtifactFromText("artifacts/stdout/run.txt", "stdout", `${"line\n".repeat(1200)}final failure`);
    const view = projectRuntimeArtifact(artifact);

    expect(view.artifactRef).toBe("artifacts/stdout/run.txt");
    expect(view.handle).toContain("stdout:");
    expect(view.policy).toBe("tail");
    expect(view.preview).toContain("final failure");
    expect(view.omittedBytes).toBeGreaterThan(0);
    expect(view.tokenEstimate).toBeGreaterThan(0);
  });

  it("builds model-visible patch evidence without requiring raw diff transfer", () => {
    const packet = buildPatchEvidence({
      candidateId: "candidate_a",
      agentId: "coder_a",
      approach: "minimal_patch",
      summary: "Fix off-by-one.",
      filesChanged: ["index.js"],
      unifiedDiff: "diff --git a/index.js b/index.js\n",
      testPlan: ["node test.js"],
      knownTradeoffs: [],
      estimatedRisk: "low"
    }, "artifacts/diffs/patch.diff");

    expect(packet.phase).toBe("patch");
    expect(packet.supportingArtifacts).toEqual(["artifacts/diffs/patch.diff"]);
    expect(packet.modelVisibleText).toContain("Evidence Packet: patch");
    expect(packet.modelVisibleText).toContain("node test.js");
  });
});
