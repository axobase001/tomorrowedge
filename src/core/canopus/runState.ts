export type { DesiredStateDiff, ObservedWorkspaceState, StatusPhase, StatusSpec as RunState } from "../controlPlane/specs.js";
export { StatusStore as RunLedger, readControlPlaneReport as readCanopusReport, readControlPlaneStatus as readCanopusRunState } from "../controlPlane/statusStore.js";
