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
