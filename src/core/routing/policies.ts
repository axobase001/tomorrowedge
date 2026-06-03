import type { RoutingMode } from "../../config/schema.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import { editableDefaultProfiles, type ModelProfile } from "./modelProfiles.js";

export type RouteAssignment = {
  role: AgentRole;
  provider: string;
  model: string;
  reason: string;
};

export type RoutingPlan = {
  mode: RoutingMode;
  privacyLocked: boolean;
  assignments: RouteAssignment[];
  fallbacks: RouteAssignment[];
};

export type AgentRouteOverride = {
  provider?: string;
  model?: string;
};

export type AgentRouteOverrides = Partial<Record<AgentRole, AgentRouteOverride>>;

export function buildRoutingPlan(mode: RoutingMode, profiles: ModelProfile[] = editableDefaultProfiles, overrides: AgentRouteOverrides = {}): RoutingPlan {
  const roles: AgentRole[] = ["vision", "planner", "explorer", "coder_a", "coder_b", "reviewer", "judge", "runner", "repairer", "summarizer"];
  const assignments = roles.map((role) => applyOverride(assignRole(role, mode, profiles), mode, profiles, overrides[role]));
  return {
    mode,
    privacyLocked: mode === "privacy" || mode === "local",
    assignments,
    fallbacks: assignments.filter((assignment) => assignment.provider !== "mock").map((assignment) => ({ ...assignment, provider: "mock", model: "mock-balanced", reason: "offline fallback" }))
  };
}

function assignRole(role: AgentRole, mode: RoutingMode, profiles: ModelProfile[]): RouteAssignment {
  if (role === "runner") {
    return { role, provider: "local_tool", model: "shell", reason: "runner is a local tool, not a model" };
  }
  if (mode === "local" || mode === "privacy") {
    return pick(role, profiles, ["local", "privacy"], "privacy/local mode requires local-first routing");
  }
  if (role === "vision") {
    return pick(role, profiles, ["vision", "ocr", "perception"], "image input requires perception before coding");
  }
  if (mode === "cheap") {
    return pick(role, profiles, ["cheap", "fast"], "cheap mode minimizes cost and latency");
  }
  if (mode === "quality") {
    return pick(role, profiles, ["reasoning", "review", "coding"], "quality mode prefers stronger reasoning and review");
  }
  if (mode === "china") {
    const chinaProvider = profiles.find((profile) => ["mimo", "deepseek", "kimi"].includes(profile.provider));
    if (chinaProvider) return toAssignment(role, chinaProvider, "china mode provider preference");
  }
  return pick(role, profiles, role.includes("coder") ? ["coding", "fast"] : ["reasoning", "planning", "review"], "balanced role-conditioned default");
}

function applyOverride(assignment: RouteAssignment, mode: RoutingMode, profiles: ModelProfile[], override?: AgentRouteOverride): RouteAssignment {
  if (assignment.role === "runner" || !override) return assignment;

  const configuredProvider = normalizeOverride(override.provider);
  const configuredModel = normalizeOverride(override.model);
  if (!configuredProvider && !configuredModel) return assignment;

  const provider = configuredProvider ?? profiles.find((profile) => profile.model === configuredModel)?.provider ?? assignment.provider;
  if (isPrivacyLockedMode(mode) && !isLocalProvider(provider, profiles)) {
    return {
      ...assignment,
      reason: `${assignment.reason}; ignored cloud override ${provider}/${configuredModel ?? assignment.model} in privacy/local mode`
    };
  }

  const matchingProfile = profiles.find((profile) => profile.provider === provider && (!configuredModel || profile.model === configuredModel)) ?? profiles.find((profile) => profile.provider === provider);
  const model = configuredModel ?? matchingProfile?.model ?? assignment.model;
  return {
    role: assignment.role,
    provider,
    model,
    reason: `user-configured agent route override${matchingProfile ? "" : " (provider/model profile not pre-registered)"}`
  };
}

function normalizeOverride(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized !== "auto" ? normalized : undefined;
}

function isPrivacyLockedMode(mode: RoutingMode): boolean {
  return mode === "privacy" || mode === "local";
}

function isLocalProvider(provider: string, profiles: ModelProfile[]): boolean {
  if (["mock", "fixture", "ollama", "local_tool"].includes(provider)) return true;
  const profile = profiles.find((candidate) => candidate.provider === provider);
  return Boolean(profile?.strengths.includes("local") || profile?.strengths.includes("privacy"));
}

function pick(role: AgentRole, profiles: ModelProfile[], strengths: string[], reason: string): RouteAssignment {
  const profile =
    profiles.find((candidate) => candidate.defaultRoles?.includes(role) && strengths.some((strength) => candidate.strengths.includes(strength as never))) ??
    profiles.find((candidate) => strengths.some((strength) => candidate.strengths.includes(strength as never))) ??
    profiles.find((candidate) => candidate.provider === "mock") ??
    profiles[0];
  return toAssignment(role, profile, reason);
}

function toAssignment(role: AgentRole, profile: ModelProfile, reason: string): RouteAssignment {
  return {
    role,
    provider: profile.provider,
    model: profile.model,
    reason
  };
}
