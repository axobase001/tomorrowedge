import type { CockpitRunMode, CockpitRunRequest } from "../../cockpit/contracts.js";
import type { AccessMode } from "../../config/schema.js";

export type CockpitRunRequestInput = {
  goal: string;
  accessMode: AccessMode;
  setupReady: boolean;
  runMode?: CockpitRunMode;
  target?: string;
  testCommand?: string;
  repairOnFail?: boolean;
  fixtureFailingPatch?: boolean;
  fullAutonomyConfirmed?: boolean;
};

export type CockpitRunPreview = {
  effectiveMode: "fixture" | "offline" | "live" | "council";
  usesLiveModels: boolean;
  fixtureMode: boolean;
  label: string;
  detail: string;
};

export function buildCockpitRunRequest({
  goal,
  accessMode,
  setupReady,
  runMode = "auto",
  target = "core",
  testCommand,
  repairOnFail,
  fixtureFailingPatch,
  fullAutonomyConfirmed
}: CockpitRunRequestInput): CockpitRunRequest {
  const trimmedGoal = goal.trim();
  if (!trimmedGoal) throw new Error("goal_required");
  const preview = describeCockpitRunPreview({ accessMode, setupReady, runMode });
  const fullAutonomy = accessMode === "full";
  const resolvedRepairOnFail = repairOnFail ?? fullAutonomy;
  const trimmedTestCommand = testCommand?.trim();
  return {
    goal: trimmedGoal,
    accessMode,
    runMode: normalizeRunMode(runMode),
    fixtureMode: preview.fixtureMode,
    livePatch: preview.usesLiveModels,
    liveAdvisory: preview.usesLiveModels,
    liveVision: false,
    repairOnFail: resolvedRepairOnFail,
    approveRepair: fullAutonomy && resolvedRepairOnFail,
    fullAutonomyConfirmed: fullAutonomy ? Boolean(fullAutonomyConfirmed) : undefined,
    testCommand: trimmedTestCommand || undefined,
    fixtureFailingPatch: Boolean(fixtureFailingPatch),
    to: target.trim() || "core"
  };
}

export function describeCockpitRunPreview(input: Pick<CockpitRunRequestInput, "accessMode" | "setupReady" | "runMode">): CockpitRunPreview {
  const effectiveRunMode = normalizeRunMode(input.runMode ?? "auto");
  const usesLiveModels = effectiveRunMode === "live"
    || (effectiveRunMode === "auto" && input.setupReady && input.accessMode !== "restricted");
  const fixtureMode = effectiveRunMode === "fixture"
    || (effectiveRunMode === "auto" && !usesLiveModels);
  const effectiveMode = effectiveRunMode === "council"
    ? "council"
    : usesLiveModels
      ? "live"
      : fixtureMode
        ? "fixture"
        : "offline";
  return {
    effectiveMode,
    usesLiveModels,
    fixtureMode,
    label: effectiveRunMode === "auto" ? `auto -> ${effectiveMode}` : effectiveMode,
    detail: usesLiveModels
      ? "live provider calls may run"
      : fixtureMode
        ? "sample fixture workspace"
        : effectiveMode === "council"
          ? "council governance runtime"
          : "local/offline runtime"
  };
}

function normalizeRunMode(value: CockpitRunMode): CockpitRunMode {
  return value === "fixture" || value === "offline" || value === "live" || value === "council" ? value : "auto";
}
