import type { CockpitRunRequest } from "../../cockpit/contracts.js";
import type { AccessMode } from "../../config/schema.js";

export type CockpitRunRequestInput = {
  goal: string;
  accessMode: AccessMode;
  setupReady: boolean;
};

export function buildCockpitRunRequest({ goal, accessMode, setupReady }: CockpitRunRequestInput): CockpitRunRequest {
  const useLiveModels = setupReady && accessMode !== "restricted";
  const fullAutonomy = accessMode === "full";
  return {
    goal: goal.trim() || "fix failing test",
    accessMode,
    fixtureMode: !useLiveModels,
    livePatch: useLiveModels,
    liveAdvisory: useLiveModels,
    liveVision: false,
    repairOnFail: fullAutonomy,
    approveRepair: fullAutonomy,
    to: "core"
  };
}
