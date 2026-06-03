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
