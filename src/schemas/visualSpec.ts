import { z } from "zod";

export const visualSourceSchema = z.object({
  path: z.string(),
  exists: z.boolean(),
  extension: z.string().optional(),
  bytes: z.number().optional()
});

export const visualComponentSchema = z.object({
  name: z.string(),
  evidence: z.string(),
  implementationHint: z.string()
});

export const visualPageTypeSchema = z.enum(["ui_screen", "error_screenshot", "diagram", "dashboard", "unknown"]);

export const structuredVisualSpecSchema = z.object({
  id: z.string(),
  sourceImages: z.array(visualSourceSchema),
  pageType: visualPageTypeSchema,
  summary: z.string(),
  components: z.array(visualComponentSchema),
  layout: z.array(z.string()),
  colors: z.array(z.string()),
  behavior: z.array(z.string()),
  risks: z.array(z.string()),
  handoffPrompt: z.string()
});

export const liveVisualSpecResponseSchema = z.object({
  id: z.string().optional(),
  pageType: visualPageTypeSchema.optional(),
  summary: z.string().optional(),
  components: z.array(visualComponentSchema.partial()).optional(),
  layout: z.array(z.string()).optional(),
  colors: z.array(z.string()).optional(),
  behavior: z.array(z.string()).optional(),
  risks: z.array(z.string()).optional()
});

export type VisualSource = {
  path: string;
  exists: boolean;
  extension?: string;
  bytes?: number;
};

export type VisualComponent = {
  name: string;
  evidence: string;
  implementationHint: string;
};

export type StructuredVisualSpec = {
  id: string;
  sourceImages: VisualSource[];
  pageType: "ui_screen" | "error_screenshot" | "diagram" | "dashboard" | "unknown";
  summary: string;
  components: VisualComponent[];
  layout: string[];
  colors: string[];
  behavior: string[];
  risks: string[];
  handoffPrompt: string;
};
