import type { ChatRequest, ChatResponse, ModelInfo, ModelProvider } from "./types.js";

export class MockProvider implements ModelProvider {
  id = "mock";
  name = "Mock Provider";
  kind = "mock" as const;

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: "mock-balanced", label: "Mock Balanced Model", contextWindow: 128000 }];
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const last = stringifyContent(req.messages.at(-1)?.content ?? "");
    if (req.metadata?.tomorrowedgeTask === "workflow_intent") {
      return {
        id: "mock-workflow-intent",
        model: req.model,
        content: JSON.stringify(classifyMockWorkflowIntent(last)),
        usage: {
          inputTokens: estimateTokens(req.messages.map((m) => stringifyContent(m.content)).join("\n")),
          outputTokens: 42
        }
      };
    }
    if (req.metadata?.tomorrowedgeTask === "planner_plan") {
      return {
        id: "mock-planner-plan",
        model: req.model,
        content: JSON.stringify(createMockPlannerPlan(last)),
        usage: {
          inputTokens: estimateTokens(req.messages.map((m) => stringifyContent(m.content)).join("\n")),
          outputTokens: 120
        }
      };
    }
    return {
      id: "mock-response",
      model: req.model,
      content: JSON.stringify({
        provider: this.id,
        model: req.model,
        summary: "Deterministic offline response",
        echo: last.slice(0, 240)
      }),
      usage: {
        inputTokens: estimateTokens(req.messages.map((m) => stringifyContent(m.content)).join("\n")),
        outputTokens: 48
      }
    };
  }
}

function createMockPlannerPlan(text: string) {
  const lower = text.toLowerCase();
  const readOnly = /\b(read|list|show|inspect|scan|describe|summarize|tree|structure|directory|folder)\b|璇诲彇|鏌ョ湅|鍒楀嚭|杈撳嚭|鏂囦欢缁撴瀯|鍒嗘瀽/.test(lower);
  const highRisk = /\b(auth|oauth|payment|billing|secret|credential|database|schema|delete|security)\b/.test(lower);
  const feature = /\b(add|feature|implement|create|build|support)\b/.test(lower);
  const refactor = /\b(refactor|migrate|cleanup|rename)\b/.test(lower);
  const docs = /\b(doc|readme|changelog)\b/.test(lower);
  const taskType = readOnly ? "analysis" : docs ? "docs" : refactor ? "refactor" : feature ? "feature" : lower.includes("test") ? "test" : lower.includes("fix") || lower.includes("bug") ? "bugfix" : "unknown";
  const steps = readOnly
    ? [
        { id: "understand", title: "Understand read-only request", detail: "Identify the requested evidence and avoid file mutation." },
        { id: "inspect", title: "Inspect context", detail: "Read the relevant files, folders, or trace artifacts." },
        { id: "summarize", title: "Summarize findings", detail: "Return concise evidence and caveats." }
      ]
    : [
        { id: "understand", title: "Understand task", detail: "Extract scope, constraints, risks, and expected deliverable." },
        { id: "explore", title: "Explore repository", detail: "Select the smallest relevant context for implementation." },
        ...(highRisk ? [{ id: "risk-map", title: "Map risk boundary", detail: "Identify auth, data, secret, destructive, or release-sensitive behavior." }] : []),
        { id: feature ? "design" : refactor ? "dependency-map" : "propose", title: feature ? "Design implementation path" : refactor ? "Map dependencies" : "Propose candidate patch", detail: feature ? "Choose interfaces, state changes, and verification strategy." : refactor ? "Find callers and compatibility boundaries." : "Generate a scoped candidate patch." },
        { id: "review", title: "Review candidate", detail: "Evaluate risk and evidence before judge selection." },
        { id: "verify", title: "Verify", detail: "Run approved checks and gather evidence." }
      ];
  return {
    taskType,
    riskLevel: highRisk ? "high" : "low",
    constraints: [],
    steps,
    verificationCommands: readOnly || docs ? [] : ["npm test"],
    debateRecommended: highRisk,
    reasonForDebate: highRisk ? "Mock planner detected high-risk workflow signals." : undefined
  };
}

function classifyMockWorkflowIntent(text: string) {
  const lower = text.toLowerCase();
  const mutation = /\b(fix|update|change|modify|add|delete|remove|refactor|implement|write|create|patch|restore|build|generate|port)\b|修复|修改|更新|新增|删除|重构|实现|写入|创建|还原|生成/.test(lower);
  const inspect = /\b(read|list|show|inspect|scan|describe|summarize|tree|structure|directory|folder)\b|读取|查看|列出|输出|文件结构|目录结构|文件夹|总结|分析/.test(lower);
  if (mutation) {
    return {
      intent: "patch",
      requiresPatchWorkflow: true,
      confidence: 0.82,
      reason: "Mock intent model identified a file-changing command."
    };
  }
  if (inspect) {
    return {
      intent: "inspect",
      requiresPatchWorkflow: false,
      confidence: 0.86,
      reason: "Mock intent model identified a read-only inspection command."
    };
  }
  return {
    intent: "ask_user",
    requiresPatchWorkflow: false,
    confidence: 0.4,
    reason: "Mock intent model found the command ambiguous."
  };
}

function stringifyContent(content: ChatRequest["messages"][number]["content"]): string {
  if (typeof content === "string") return content;
  return content.map((part) => (part.type === "text" ? part.text : `[image:${part.image_url.url.slice(0, 32)}]`)).join("\n");
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
