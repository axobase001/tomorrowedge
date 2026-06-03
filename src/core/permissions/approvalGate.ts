import type { PermissionDecision, PermissionRequest } from "./permissionModel.js";

export class ApprovalGate {
  constructor(private readonly safeMode = true) {}

  requireApproval(request: PermissionRequest): PermissionDecision {
    if (!this.safeMode && request.risk === "low") {
      return { approved: true, reason: "Safe mode disabled for low-risk request." };
    }
    return { approved: false, reason: `Approval required for ${request.kind}: ${request.summary}` };
  }
}
