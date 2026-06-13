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
    if (req.metadata?.tomorrowedgeTask === "user_reply") {
      return {
        id: "mock-user-reply",
        model: req.model,
        content: createMockUserReply(last),
        usage: {
          inputTokens: estimateTokens(req.messages.map((m) => stringifyContent(m.content)).join("\n")),
          outputTokens: 96
        }
      };
    }
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
    if (req.metadata?.tomorrowedgeTask === "scenario_profile") {
      return {
        id: "mock-scenario-profile",
        model: req.model,
        content: JSON.stringify(createMockScenarioProfile(last)),
        usage: {
          inputTokens: estimateTokens(req.messages.map((m) => stringifyContent(m.content)).join("\n")),
          outputTokens: 88
        }
      };
    }
    if (req.metadata?.tomorrowedgeTask === "task_governance") {
      return {
        id: "mock-task-governance",
        model: req.model,
        content: JSON.stringify(classifyMockTaskGovernance(last)),
        usage: {
          inputTokens: estimateTokens(req.messages.map((m) => stringifyContent(m.content)).join("\n")),
          outputTokens: 54
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

function classifyMockTaskGovernance(text: string) {
  const lower = text.toLowerCase();
  const correctnessCritical = /\b(prove|proof|theorem|lemma|logic|mathematical|correctness-critical|formal argument|counterexample)\b|\u8bc1\u660e|\u5b9a\u7406|\u5f15\u7406|\u53cd\u4f8b|\u6570\u5b66|\u903b\u8f91/.test(lower);
  const risky = /\b(security|auth|credential|irreversible|production|benchmark|research claim|medical|legal|financial)\b/i.test(lower);
  if (correctnessCritical || risky) {
    return {
      reasoningSensitivity: correctnessCritical ? "high" : "medium",
      requiresReviewer: true,
      requiresJudge: correctnessCritical,
      confidence: 0.82,
      reason: "Mock governance model classified the request as requiring independent correctness review."
    };
  }
  return {
    reasoningSensitivity: "low",
    requiresReviewer: false,
    requiresJudge: false,
    confidence: 0.74,
    reason: "Mock governance model found no need for an extra decision gate."
  };
}

function createMockPlannerPlan(text: string) {
  const lower = text.toLowerCase();
  const readOnly = hasInspectSignal(lower) || (containsCjk(text) && !hasMutationSignal(lower));
  const highRisk = /\b(auth|oauth|payment|billing|secret|credential|database|schema|delete|security|rewrite|rebuild|migration|rust)\b/.test(lower);
  const feature = /\b(add|feature|implement|create|build|support)\b/.test(lower);
  const refactor = /\b(refactor|rewrite|rebuild|migrate|migration|cleanup|rename)\b/.test(lower);
  const docs = /\b(doc|readme|changelog)\b/.test(lower);
  const bugfix = /\b(fix|bug|repair|failing|failure|broken|crash)\b/.test(lower);
  const taskType = readOnly ? "analysis" : docs ? "docs" : refactor ? "refactor" : bugfix ? "bugfix" : feature ? "feature" : lower.includes("test") ? "test" : "unknown";
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
    constraints: extractMockConstraints(text),
    steps,
    verificationCommands: readOnly || docs ? [] : ["npm test"],
    debateRecommended: highRisk,
    reasonForDebate: highRisk ? "Mock planner detected high-risk workflow signals." : undefined
  };
}

function classifyMockWorkflowIntent(text: string) {
  const lower = text.toLowerCase();
  const visionPatch = hasVisionImplementationSignal(lower);
  const explicitMutation = hasPositiveMutationSignal(lower);
  const mutation = hasMutationSignal(lower);
  const inspect = hasInspectSignal(lower) || (containsCjk(text) && !mutation);
  if (visionPatch || explicitMutation || (mutation && !inspect)) {
    return {
      intent: "patch",
      requiresPatchWorkflow: true,
      workflowKind: visionPatch ? "vision_patch" : "patch",
      confidence: 0.82,
      reason: "Mock intent model identified a file-changing command."
    };
  }
  if (inspect) {
    return {
      intent: "inspect",
      requiresPatchWorkflow: false,
      workflowKind: "read_only",
      confidence: 0.86,
      reason: "Mock intent model identified a read-only inspection command."
    };
  }
  return {
    intent: "ask_user",
    requiresPatchWorkflow: false,
    workflowKind: "ask_user",
    confidence: 0.4,
    reason: "Mock intent model found the command ambiguous."
  };
}

function createMockScenarioProfile(text: string) {
  const lower = text.toLowerCase();
  const intentPatch = lower.includes('"requirespatchworkflow": true');
  const intentReadOnly = lower.includes('"workflowkind": "read_only"') || lower.includes('"intent": "inspect"');
  const highRisk = /\b(auth|security|credential|secret|permission|payment|database|migration|rewrite|rebuild|rust|production|delete|prove|theorem|correctness|formal)\b|\u8bc1\u660e|\u5b9a\u7406|\u5bc6\u7801|\u6743\u9650|\u5b89\u5168/.test(lower);
  const scenarioType = intentReadOnly
    ? "analysis"
    : /\b(fix|bug|failing|repair|debug|error)\b/.test(lower)
      ? "debugging"
      : /\b(refactor|rewrite|migrate|migration|cleanup)\b/.test(lower)
        ? "refactor"
        : /\b(doc|readme|changelog|markdown)\b/.test(lower)
          ? "document"
          : intentPatch
            ? "coding"
            : "unknown";
  const likelyWorkflowKind = hasVisionImplementationSignal(lower)
    ? "vision_patch"
    : intentReadOnly
      ? "read_only"
      : intentPatch
        ? "patch"
        : "ask_user";
  const riskSignals = [
    ...(highRisk ? ["correctness_critical"] : []),
    ...(lower.includes('"accessmode": "full"') ? ["full_access"] : [])
  ];
  const readLike = likelyWorkflowKind === "read_only" || likelyWorkflowKind === "ask_user";
  return {
    scenarioType,
    userIntent: `${scenarioType} request classified by mock semantic model`,
    expectedDeliverable: readLike ? "read-only answer with evidence" : "patch, review, judge, verification evidence, and final summary",
    ambiguityLevel: likelyWorkflowKind === "ask_user" ? "high" : highRisk ? "medium" : "low",
    likelyWorkflowKind,
    riskSignals,
    evidenceNeeds: readLike
      ? ["event ledger", "inspected context"]
      : ["event ledger", "candidate patch diff", "review decision", "judge decision", "verification result"],
    suggestedRoles: readLike
      ? ["planner", "explorer", "summarizer"]
      : ["planner", "explorer", "coder_a", "reviewer", "judge", "runner", "summarizer"]
  };
}

function extractMockConstraints(text: string): string[] {
  const constraints: string[] = [];
  for (const match of text.matchAll(/without ([^.\n]+)/gi)) {
    constraints.push(`Without ${match[1].trim()}`);
  }
  for (const match of text.matchAll(/do not ([^.\n]+)/gi)) {
    constraints.push(`Do not ${match[1].trim()}`);
  }
  return constraints;
}

function createMockUserReply(prompt: string): string {
  const request = extractUserRequest(prompt);
  return [
    "Mock provider response.",
    "",
    "This offline provider proves that TomorrowEdge invoked the model route, but it does not contain domain knowledge or task-specific reasoning. Configure DeepSeek, OpenRouter, Kimi, MiMo, Ollama, or another OpenAI-compatible provider for a real semantic answer.",
    "",
    `Request received: ${request || "the request"}`
  ].join("\n");
}

function hasInspectSignal(text: string): boolean {
  return /\b(read|list|show|inspect|scan|describe|summarize|summary|tree|structure|directory|folder|review architecture|suggest improvements)\b|\u8bfb\u53d6|\u67e5\u770b|\u5217\u51fa|\u8f93\u51fa|\u6587\u4ef6\u7ed3\u6784|\u76ee\u5f55\u7ed3\u6784|\u603b\u7ed3|\u5206\u6790|\u5efa\u8bae|\u4e0d\u8981\u4fee\u6539|\u4e0d\u4fee\u6539|\u53ea\u8bfb/.test(text);
}

function hasMutationSignal(text: string): boolean {
  return /\b(fix|update|change|modify|add|delete|remove|refactor|rewrite|rebuild|migrate|migration|redesign|implement|write|create|patch|restore|build|generate|save|repair)\b|\u4fee\u590d|\u4fee\u6539|\u66f4\u65b0|\u65b0\u589e|\u5220\u9664|\u91cd\u6784|\u5b9e\u73b0|\u5199\u5165|\u521b\u5efa|\u65b0\u5efa|\u8fd8\u539f|\u751f\u6210|\u4fdd\u5b58/.test(text);
}

function hasPositiveMutationSignal(text: string): boolean {
  return /\b(fix|update|add|delete|remove|refactor|rewrite|rebuild|migrate|migration|redesign|implement|write|create|patch|restore|build|generate|save|repair)\b|\u4fee\u590d|\u66f4\u65b0|\u65b0\u589e|\u5220\u9664|\u91cd\u6784|\u5b9e\u73b0|\u5199\u5165|\u521b\u5efa|\u65b0\u5efa|\u8fd8\u539f|\u751f\u6210|\u4fdd\u5b58/.test(text);
}

function hasVisionImplementationSignal(text: string): boolean {
  return /\b(image|screenshot|design|layout|ui)\b/.test(text)
    && /\b(generate|create|build|implement|restore)\b/.test(text);
}

function containsCjk(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function extractUserRequest(prompt: string): string {
  const match = /User request:\s*\n([\s\S]*?)(?:\n\nWorkflow kind:|\nWorkflow kind:|$)/i.exec(prompt);
  return (match?.[1] ?? prompt).trim();
}

function stringifyContent(content: ChatRequest["messages"][number]["content"]): string {
  if (typeof content === "string") return content;
  return content.map((part) => (part.type === "text" ? part.text : `[image:${part.image_url.url.slice(0, 32)}]`)).join("\n");
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
