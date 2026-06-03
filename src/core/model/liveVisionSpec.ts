import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { ModelNote } from "../../schemas/modelNote.js";
import type { StructuredVisualSpec, VisualComponent, VisualSource } from "../../schemas/visualSpec.js";
import { makeId } from "../../utils/ids.js";
import type { ModelRouter } from "../routing/router.js";
import { estimateCostUsd, estimateMessageContentTokens } from "./costAccounting.js";
import { chatWithProviderFallback } from "./providerFallback.js";
import type { EventLedger } from "../events/eventLedger.js";

const maxVisionCompletionTokens = 1200;

export type LiveVisionInput = {
  goal: string;
  imagePaths: string[];
  config: TomorrowEdgeConfig;
  router: ModelRouter;
  ledger?: EventLedger;
};

export type LiveVisionResult = {
  spec?: StructuredVisualSpec;
  note: ModelNote;
};

export async function runLiveVisionSpec(input: LiveVisionInput): Promise<LiveVisionResult> {
  const assignment = input.router.assignmentFor("vision");
  const noteBase: ModelNote = {
    id: makeId("note_vision"),
    role: "vision",
    provider: assignment.provider,
    model: assignment.model,
    kind: "vision_spec",
    content: ""
  };

  const sources = await Promise.all(input.imagePaths.map(toVisualSource));
  const missingSources = sources.filter((source) => !source.exists);
  if (missingSources.length) {
    return {
      note: {
        ...noteBase,
        error: `Image input unavailable: ${missingSources.map((source) => source.path).join(", ")}`
      }
    };
  }
  const imageParts = await Promise.all(input.imagePaths.map(toImagePart));
  const prompt = buildVisionPrompt(input.goal, sources);

  const result = await chatWithProviderFallback({
    config: input.config,
    router: input.router,
    role: "vision",
    provider: assignment.provider,
    model: assignment.model,
    ledger: input.ledger,
    buildRequest: (model) => ({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are the Vision Agent in a multi-model coding cockpit. Convert images into a structured visual spec for downstream coding agents. Return ONLY JSON, no markdown."
        },
        {
          role: "user",
          content: [{ type: "text", text: prompt }, ...imageParts]
        }
      ],
      temperature: 0.1,
      maxCompletionTokens: maxVisionCompletionTokens
    })
  });

  if (!result.response) {
    return {
      note: {
        ...noteBase,
        error: result.error,
        fallbackReason: result.fallbackReason
      }
    };
  }

  try {
    const parsed = parseVisionJson(result.response.content);
    assertVisionShape(parsed);
    const spec = normalizeVisualSpec(parsed, sources);
    return {
      spec,
      note: {
        ...noteBase,
        provider: result.provider,
        model: result.model,
        content: spec.summary,
        usage: result.response.usage,
        estimatedCostUsd: estimateCostUsd(result.provider, result.response.usage),
        fallbackUsed: result.fallbackUsed,
        fallbackFrom: result.fallbackFrom,
        fallbackReason: result.fallbackReason
      }
    };
  } catch (error) {
    return {
      note: {
        ...noteBase,
        provider: result.provider,
        model: result.model,
        usage: result.response.usage,
        estimatedCostUsd: estimateCostUsd(result.provider, result.response.usage),
        fallbackUsed: result.fallbackUsed,
        fallbackFrom: result.fallbackFrom,
        fallbackReason: result.fallbackReason,
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

export function buildVisionCostPrompt(goal: string, imagePaths: string[]): string {
  return [buildVisionPrompt(goal, imagePaths.map((imagePath) => ({ path: imagePath, exists: true }))), ...imagePaths.map((imagePath) => `[image:${imagePath}]`)].join("\n");
}

export function estimateVisionInputTokens(goal: string, imagePaths: string[]): number {
  const prompt = buildVisionPrompt(goal, imagePaths.map((imagePath) => ({ path: imagePath, exists: true })));
  return estimateMessageContentTokens([
    { type: "text", text: prompt },
    ...imagePaths.map((imagePath) => ({ type: "image_url" as const, image_url: { url: imagePath, detail: "auto" as const } }))
  ]);
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

async function toImagePart(imagePath: string): Promise<{ type: "image_url"; image_url: { url: string; detail: "auto" } }> {
  const buffer = await readFile(imagePath);
  const mime = mimeFromPath(imagePath);
  return {
    type: "image_url",
    image_url: {
      url: `data:${mime};base64,${buffer.toString("base64")}`,
      detail: "auto"
    }
  };
}

function buildVisionPrompt(goal: string, sources: VisualSource[]): string {
  return [
    `Task: ${goal}`,
    "Extract a coding-ready visual spec from the attached image(s).",
    "Return JSON with keys: pageType, summary, components, layout, colors, behavior, risks.",
    "pageType must be one of ui_screen, error_screenshot, diagram, dashboard, unknown.",
    "components must be an array of { name, evidence, implementationHint }.",
    "Do not invent exact text unless visible. Mark uncertain observations as risks.",
    "Sources:",
    ...sources.map((source) => `- ${source.path} exists=${source.exists} bytes=${source.bytes ?? "unknown"}`)
  ].join("\n");
}

function parseVisionJson(raw: string): Partial<StructuredVisualSpec> {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Vision response was not JSON.");
  return JSON.parse(text.slice(start, end + 1)) as Partial<StructuredVisualSpec>;
}

function assertVisionShape(parsed: Partial<StructuredVisualSpec>): void {
  if (parsed.pageType || parsed.components || parsed.layout || parsed.colors || parsed.behavior || parsed.risks) return;
  throw new Error("Vision response JSON did not contain visual spec fields.");
}

function normalizeVisualSpec(parsed: Partial<StructuredVisualSpec>, sources: VisualSource[]): StructuredVisualSpec {
  const pageType = ["ui_screen", "error_screenshot", "diagram", "dashboard", "unknown"].includes(parsed.pageType ?? "")
    ? parsed.pageType!
    : "unknown";
  const components = normalizeComponents(parsed.components);
  const layout = normalizeList(parsed.layout);
  const colors = normalizeList(parsed.colors);
  const behavior = normalizeList(parsed.behavior);
  const risks = normalizeList(parsed.risks);
  const summary = parsed.summary?.trim() || `Vision Agent extracted a ${pageType} visual spec.`;
  return {
    id: parsed.id || makeId("visual_spec"),
    sourceImages: sources,
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

function normalizeComponents(value: unknown): VisualComponent[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return undefined;
      const candidate = item as Partial<VisualComponent>;
      return {
        name: candidate.name?.trim() || "unnamed component",
        evidence: candidate.evidence?.trim() || "visual observation",
        implementationHint: candidate.implementationHint?.trim() || "preserve visible behavior in implementation"
      };
    })
    .filter((item): item is VisualComponent => Boolean(item));
}

function normalizeList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function renderHandoffPrompt(input: Omit<StructuredVisualSpec, "id" | "sourceImages" | "handoffPrompt">): string {
  return [
    `Visual Spec (${input.pageType})`,
    input.summary,
    "Components:",
    ...(input.components.length ? input.components.map((component) => `- ${component.name}: ${component.implementationHint}`) : ["- none extracted"]),
    "Layout:",
    ...(input.layout.length ? input.layout.map((item) => `- ${item}`) : ["- unspecified"]),
    "Colors:",
    ...(input.colors.length ? input.colors.map((item) => `- ${item}`) : ["- unspecified"]),
    "Behavior:",
    ...(input.behavior.length ? input.behavior.map((item) => `- ${item}`) : ["- unspecified"]),
    "Risks:",
    ...(input.risks.length ? input.risks.map((item) => `- ${item}`) : ["- none"])
  ].join("\n");
}

function mimeFromPath(imagePath: string): string {
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  return "image/png";
}
