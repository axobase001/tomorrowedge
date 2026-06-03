import type { AgentRole } from "./agentTask.js";

export type CapabilityTag =
  | "vision"
  | "ocr"
  | "perception"
  | "planning"
  | "coding"
  | "long_context"
  | "reasoning"
  | "review"
  | "local"
  | "cheap"
  | "fast";

export type CapabilityRouteStep = {
  role: AgentRole;
  capability: CapabilityTag;
  provider: string;
  model: string;
  status: "planned" | "success" | "skipped" | "blocked";
  summary: string;
};

export type CapabilityHandoff = {
  from: AgentRole;
  to: AgentRole;
  artifact: string;
  summary: string;
};

export type CapabilityRoute = {
  id: string;
  trigger: "image_input" | "text_only";
  inputTypes: string[];
  steps: CapabilityRouteStep[];
  handoffs: CapabilityHandoff[];
  summary: string;
};
