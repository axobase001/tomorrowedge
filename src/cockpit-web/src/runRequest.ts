import type { CockpitRunMode, CockpitRunRequest } from "../../cockpit/contracts.js";
import type { AccessMode } from "../../config/schema.js";

export type CockpitRunRequestInput = {
  goal: string;
  accessMode: AccessMode;
  setupReady: boolean;
  runMode?: CockpitRunMode;
  target?: string;
};

export function buildCockpitRunRequest({ goal, accessMode, setupReady, runMode = "auto", target = "core" }: CockpitRunRequestInput): CockpitRunRequest {
  const trimmedGoal = goal.trim();
  if (!trimmedGoal) throw new Error("goal_required");
  const effectiveRunMode = normalizeRunMode(runMode);
  const useLiveModels = effectiveRunMode === "live"
    || (effectiveRunMode === "auto" && setupReady && accessMode !== "restricted");
  const useFixture = effectiveRunMode === "fixture"
    || (effectiveRunMode === "auto" && !useLiveModels);
  const fullAutonomy = accessMode === "full";
  return {
    goal: trimmedGoal,
    accessMode,
    runMode: effectiveRunMode,
    fixtureMode: useFixture,
    livePatch: useLiveModels,
    liveAdvisory: useLiveModels,
    liveVision: false,
    repairOnFail: fullAutonomy,
    approveRepair: fullAutonomy,
    to: target.trim() || "core"
  };
}

function normalizeRunMode(value: CockpitRunMode): CockpitRunMode {
  return value === "fixture" || value === "offline" || value === "live" || value === "council" ? value : "auto";
}
