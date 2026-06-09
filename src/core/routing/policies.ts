import type { RoutingMode } from "../../config/schema.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import type { Plan } from "../../schemas/plan.js";
import { isExternalProvider } from "../externalAgents/externalAgentRouter.js";
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
  reason?: string;
};

export type AgentRouteOverrides = Partial<Record<AgentRole, AgentRouteOverride>>;

export type PostPlanRoutingContext = {
  hasImageInputs?: boolean;
};

export type RoutingPlanChange = {
  role: AgentRole;
  from: RouteAssignment;
  to: RouteAssignment;
  reason: string;
};

export function buildRoutingPlan(mode: RoutingMode, profiles: ModelProfile[] = editableDefaultProfiles, overrides: AgentRouteOverrides = {}): RoutingPlan {
  const roles: AgentRole[] = coreRoleRequested(overrides) ? ["core", ...defaultRoutingRoles()] : defaultRoutingRoles();
  const assignments = roles.map((role) => applyOverride(assignRole(role, mode, profiles), mode, profiles, overrides[role]));
  return {
    mode,
    privacyLocked: mode === "privacy" || mode === "local",
    assignments,
    fallbacks: assignments.filter((assignment) => assignment.provider !== "mock").map((assignment) => ({ ...assignment, provider: "mock", model: "mock-balanced", reason: "offline fallback" }))
  };
}

export function rerouteRoutingPlanForPlan(
  current: RoutingPlan,
  plan: Plan,
  mode: RoutingMode,
  profiles: ModelProfile[] = editableDefaultProfiles,
  overrides: AgentRouteOverrides = {},
  context: PostPlanRoutingContext = {}
): { plan: RoutingPlan; changes: RoutingPlanChange[] } {
  if (current.privacyLocked) return { plan: current, changes: [] };
  const highRisk = plan.riskLevel === "high" || plan.debateRecommended;
  const analysisOnly = plan.taskType === "analysis";
  const docsOnly = plan.taskType === "docs";
  const changes: RoutingPlanChange[] = [];
  const assignments = current.assignments.map((assignment) => {
    if (assignment.provider === "local_tool" || hasExplicitOverride(overrides[assignment.role])) return assignment;
    let next = assignment;
    if (context.hasImageInputs && assignment.role === "vision") {
      next = pick(assignment.role, profiles, ["vision", "ocr", "perception"], "post-plan reroute: image input requires a perception-capable model");
    } else if (highRisk && (assignment.role === "reviewer" || assignment.role === "judge")) {
      next = pick(assignment.role, profiles, ["reasoning", "review"], `post-plan reroute: ${plan.riskLevel}-risk ${plan.taskType} task reserves stronger review/judgment`);
    } else if (highRisk && assignment.role === "coder_b") {
      next = pick(assignment.role, profiles, ["coding", "reasoning"], "post-plan reroute: high-risk task keeps an alternate reasoning-capable implementation path");
    } else if ((analysisOnly || docsOnly) && (assignment.role === "coder_a" || assignment.role === "coder_b" || assignment.role === "repairer")) {
      next = pick(assignment.role, profiles, ["cheap", "fast"], `post-plan reroute: ${plan.taskType} task can use cost-efficient execution roles`);
    } else if (plan.taskType === "feature" && assignment.role === "coder_a") {
      next = pick(assignment.role, profiles, ["coding", "long_context"], "post-plan reroute: feature work prefers coding plus enough context");
    } else if (plan.taskType === "refactor" && (assignment.role === "explorer" || assignment.role === "coder_a")) {
      next = pick(assignment.role, profiles, ["long_context", "coding"], "post-plan reroute: refactor work prefers dependency context and coding strength");
    }
    if (next.provider !== assignment.provider || next.model !== assignment.model || next.reason !== assignment.reason) {
      changes.push({ role: assignment.role, from: assignment, to: next, reason: next.reason });
    }
    return next;
  });
  const nextPlan = {
    ...current,
    assignments,
    fallbacks: assignments.filter((assignment) => assignment.provider !== "mock" && !assignment.provider.startsWith("external:")).map((assignment) => ({ ...assignment, provider: "mock", model: "mock-balanced", reason: "offline fallback" }))
  };
  return { plan: nextPlan, changes };
}

function assignRole(role: AgentRole, mode: RoutingMode, profiles: ModelProfile[]): RouteAssignment {
  if (role === "core") {
    return pick(role, profiles, ["reasoning", "planning", "review"], "optional core role prefers high-level reasoning and supervision");
  }
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
  if (isPrivacyLockedMode(mode) && !isLocalProvider(provider, profiles) && !isExternalProvider(provider)) {
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
    reason: `${override.reason ?? "user-configured agent route override"}${matchingProfile ? "" : " (provider/model profile not pre-registered)"}`
  };
}

function normalizeOverride(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized !== "auto" ? normalized : undefined;
}

function hasExplicitOverride(override?: AgentRouteOverride): boolean {
  return Boolean(normalizeOverride(override?.provider) || normalizeOverride(override?.model));
}

function isPrivacyLockedMode(mode: RoutingMode): boolean {
  return mode === "privacy" || mode === "local";
}

function isLocalProvider(provider: string, profiles: ModelProfile[]): boolean {
  if (["mock", "fixture", "ollama", "local_tool"].includes(provider)) return true;
  const profile = profiles.find((candidate) => candidate.provider === provider);
  return Boolean(profile?.strengths.includes("local") || profile?.strengths.includes("privacy"));
}

function defaultRoutingRoles(): AgentRole[] {
  return ["vision", "planner", "explorer", "coder_a", "coder_b", "reviewer", "judge", "runner", "repairer", "summarizer"];
}

function coreRoleRequested(overrides: AgentRouteOverrides): boolean {
  const core = overrides.core;
  return Boolean(core && ((core.provider && core.provider !== "auto") || (core.model && core.model !== "auto")));
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
