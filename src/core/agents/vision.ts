import { stat } from "node:fs/promises";
import path from "node:path";
import type { StructuredVisualSpec, VisualSource } from "../../schemas/visualSpec.js";
import { makeId } from "../../utils/ids.js";
import { BaseAgent } from "./baseAgent.js";

export class VisionAgent extends BaseAgent<{ goal: string; imagePaths: string[] }, StructuredVisualSpec> {
  readonly role = "vision";

  async run(input: { goal: string; imagePaths: string[] }): Promise<StructuredVisualSpec> {
    const sourceImages = await Promise.all(input.imagePaths.map(toVisualSource));
    const pageType = inferPageType(input.goal, sourceImages);
    const components = inferComponents(input.goal, pageType);
    const layout = inferLayout(input.goal, pageType);
    const colors = inferColors(input.goal, pageType);
    const behavior = inferBehavior(input.goal, pageType);
    const risks = [
      "Offline visual spec is a structured handoff placeholder until a live multimodal provider is used.",
      "Reviewer should compare generated code against the original image before approval."
    ];
    const summary = `Vision Agent prepared a ${pageType} visual spec from ${sourceImages.length} image input(s).`;
    return {
      id: makeId("visual_spec"),
      sourceImages,
      pageType,
      summary,
      components,
      layout,
      colors,
      behavior,
      risks,
      handoffPrompt: renderHandoffPrompt({ pageType, summary, components, layout, colors, behavior, risks })
    };
  }
}

async function toVisualSource(imagePath: string): Promise<VisualSource> {
  const fileStat = await stat(imagePath).catch(() => undefined);
  return {
    path: imagePath,
    exists: Boolean(fileStat?.isFile()),
    extension: path.extname(imagePath).toLowerCase() || undefined,
    bytes: fileStat?.isFile() ? fileStat.size : undefined
  };
}

function inferPageType(goal: string, sources: VisualSource[]): StructuredVisualSpec["pageType"] {
  const text = `${goal} ${sources.map((source) => source.path).join(" ")}`.toLowerCase();
  if (/error|stack|trace|exception|报错|错误/.test(text)) return "error_screenshot";
  if (/flow|diagram|chart|state|流程图|状态机/.test(text)) return "diagram";
  if (/dashboard|monitor|metric|alert|监控|面板/.test(text)) return "dashboard";
  if (/ui|page|screen|react|flutter|tauri|component|截图|设计稿|页面/.test(text)) return "ui_screen";
  return "unknown";
}

function inferComponents(goal: string, pageType: StructuredVisualSpec["pageType"]) {
  if (pageType === "error_screenshot") {
    return [
      { name: "error message", evidence: "task includes error screenshot input", implementationHint: "extract failing condition and map it to likely source/test files" },
      { name: "stack trace", evidence: "visual input may contain trace lines", implementationHint: "preserve file names, line numbers, and exact error text in reviewer evidence" }
    ];
  }
  if (pageType === "diagram") {
    return [
      { name: "nodes", evidence: "diagram-style visual input", implementationHint: "map nodes to states, handlers, or modules" },
      { name: "edges", evidence: "diagram-style visual input", implementationHint: "map arrows to transitions, API calls, or control flow" }
    ];
  }
  if (pageType === "dashboard") {
    return [
      { name: "metric panels", evidence: "dashboard/monitoring visual input", implementationHint: "model metrics as typed data sources before alert logic" },
      { name: "threshold indicators", evidence: "dashboard/monitoring visual input", implementationHint: "make alert rules explicit and testable" }
    ];
  }
  const loginHint = /login|sign in|登录/.test(goal.toLowerCase());
  return [
    { name: loginHint ? "login form" : "primary content region", evidence: "UI screenshot/design input", implementationHint: "implement with stable responsive layout constraints" },
    { name: "primary action", evidence: "UI screenshot/design input", implementationHint: "wire disabled/loading/error states instead of static markup" },
    { name: "supporting text", evidence: "UI screenshot/design input", implementationHint: "keep copy concise and localized when needed" }
  ];
}

function inferLayout(goal: string, pageType: StructuredVisualSpec["pageType"]): string[] {
  if (pageType === "diagram") return ["Preserve top-to-bottom or left-to-right state order.", "Represent transitions explicitly before implementation."];
  if (pageType === "dashboard") return ["Use dense scan-friendly panels.", "Keep labels and values aligned for repeated monitoring use."];
  if (/mobile|phone|移动/.test(goal.toLowerCase())) return ["Mobile-first single column.", "Use fixed spacing tokens so elements do not jump across states."];
  return ["Constrained content width.", "Clear vertical hierarchy.", "Stable component dimensions across hover/loading/error states."];
}

function inferColors(goal: string, pageType: StructuredVisualSpec["pageType"]): string[] {
  if (pageType === "error_screenshot") return ["Preserve severity colors from screenshot when visible.", "Use high-contrast error/warning states."];
  if (/dark|terminal|深色/.test(goal.toLowerCase())) return ["dark background", "muted text", "single accent color"];
  return ["neutral background", "readable body text", "one restrained accent color"];
}

function inferBehavior(goal: string, pageType: StructuredVisualSpec["pageType"]): string[] {
  if (pageType === "error_screenshot") return ["Reproduce the failure locally before patching when possible.", "Add regression coverage for the visual error condition."];
  if (pageType === "diagram") return ["Each visual transition should become an explicit branch or test case."];
  if (/form|login|登录/.test(goal.toLowerCase())) return ["Submit disabled until required fields are valid.", "Show explicit error and loading states."];
  return ["Implement visible states, empty states, and verification hooks implied by the visual input."];
}

function renderHandoffPrompt(input: Omit<StructuredVisualSpec, "id" | "sourceImages" | "handoffPrompt">): string {
  return [
    `Visual Spec (${input.pageType})`,
    input.summary,
    "Components:",
    ...input.components.map((component) => `- ${component.name}: ${component.implementationHint}`),
    "Layout:",
    ...input.layout.map((item) => `- ${item}`),
    "Colors:",
    ...input.colors.map((item) => `- ${item}`),
    "Behavior:",
    ...input.behavior.map((item) => `- ${item}`),
    "Risks:",
    ...input.risks.map((item) => `- ${item}`)
  ].join("\n");
}
