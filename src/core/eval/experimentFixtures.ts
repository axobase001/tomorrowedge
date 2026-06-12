import { createHash } from "node:crypto";

export type ExperimentFixtureSplit = "train" | "validation" | "transfer";

export type ExperimentFixtureMetadata = {
  id: string;
  task: string;
  split: ExperimentFixtureSplit;
  taskFamily: string;
  latentFailureType: string;
  language: string;
  surface: "unit" | "ui" | "state_machine" | "flaky";
  modelVisible: {
    prompt: string;
    visibleValidators: string[];
    taxonomy: string[];
  };
  evaluatorOnly: {
    hiddenValidators: string[];
    leakageTokens: string[];
    notes: string;
  };
};

export const experimentFixtureCatalog: ExperimentFixtureMetadata[] = [
  {
    id: "js-off-by-one-train",
    task: "fix the JavaScript boundary test without changing public API",
    split: "train",
    taskFamily: "boundary-index",
    latentFailureType: "off_by_one",
    language: "javascript",
    surface: "unit",
    modelVisible: {
      prompt: "Fix the visible boundary failure in the JavaScript helper.",
      visibleValidators: ["npm test"],
      taxonomy: ["logic", "boundary"]
    },
    evaluatorOnly: {
      hiddenValidators: ["hidden: inclusive upper bound invariant"],
      leakageTokens: ["EXPECTED_RANGE_INCLUSIVE_UPPER_BOUND", "answer:include-end-index"],
      notes: "Exact boundary invariant is evaluator-only."
    }
  },
  {
    id: "js-wrong-api-validation",
    task: "repair the JavaScript helper that calls the wrong public API",
    split: "validation",
    taskFamily: "api-contract",
    latentFailureType: "wrong_api",
    language: "javascript",
    surface: "unit",
    modelVisible: {
      prompt: "Fix the helper so it calls the intended public API without changing the API surface.",
      visibleValidators: ["npm test"],
      taxonomy: ["api", "contract", "wrong_api"]
    },
    evaluatorOnly: {
      hiddenValidators: ["hidden: correct API invocation and call-order invariant"],
      leakageTokens: ["WRONG_API_ORACLE", "answer:call-normalize-input"],
      notes: "Exact target API name and call-order oracle are evaluator-only."
    }
  },
  {
    id: "ts-wrong-file-train",
    task: "fix the TypeScript regression without editing the unrelated module",
    split: "train",
    taskFamily: "file-locality",
    latentFailureType: "wrong_file",
    language: "typescript",
    surface: "unit",
    modelVisible: {
      prompt: "Fix the failing TypeScript regression while keeping unrelated modules untouched.",
      visibleValidators: ["npm test"],
      taxonomy: ["file_locality", "wrong_file", "regression"]
    },
    evaluatorOnly: {
      hiddenValidators: ["hidden: unrelated module diff must remain empty"],
      leakageTokens: ["WRONG_FILE_ORACLE", "answer:edit-parser-not-renderer"],
      notes: "The exact forbidden file and locality oracle are evaluator-only."
    }
  },
  {
    id: "js-hidden-invariant-transfer",
    task: "repair the JavaScript workflow while preserving the hidden invariant",
    split: "transfer",
    taskFamily: "hidden-invariant",
    latentFailureType: "hidden_invariant",
    language: "javascript",
    surface: "unit",
    modelVisible: {
      prompt: "Fix the visible workflow failure without weakening existing behavior.",
      visibleValidators: ["npm test"],
      taxonomy: ["invariant", "transfer", "hidden_validator"]
    },
    evaluatorOnly: {
      hiddenValidators: ["hidden: legacy invariant remains true after the visible fix"],
      leakageTokens: ["HIDDEN_INVARIANT_ORACLE", "answer:preserve-legacy-normalization"],
      notes: "The invariant name and oracle are evaluator-only."
    }
  },
  {
    id: "python-off-by-one-transfer",
    task: "repair the Python range aggregation transfer task",
    split: "transfer",
    taskFamily: "boundary-index",
    latentFailureType: "off_by_one",
    language: "python",
    surface: "unit",
    modelVisible: {
      prompt: "Fix a Python aggregation failure with similar structure but different names.",
      visibleValidators: ["pytest"],
      taxonomy: ["logic", "boundary", "cross_language"]
    },
    evaluatorOnly: {
      hiddenValidators: ["hidden: same latent boundary invariant, different API"],
      leakageTokens: ["PY_RANGE_TRANSFER_ORACLE", "answer:python-inclusive-bound"],
      notes: "Transfer oracle is not model-visible."
    }
  },
  {
    id: "react-async-ui-transfer",
    task: "fix the React async loading and accessibility transfer task",
    split: "transfer",
    taskFamily: "ui-state",
    latentFailureType: "async_state_transition",
    language: "typescript-react",
    surface: "ui",
    modelVisible: {
      prompt: "Fix a UI state transition without causing responsive overflow.",
      visibleValidators: ["npm test"],
      taxonomy: ["ui", "async", "accessibility", "responsive"]
    },
    evaluatorOnly: {
      hiddenValidators: ["hidden: loading state eventually clears", "hidden: no horizontal overflow"],
      leakageTokens: ["UI_ASYNC_TRANSFER_ORACLE", "answer:aria-busy-clears"],
      notes: "DOM and responsive invariants remain evaluator-only."
    }
  },
  {
    id: "state-machine-transfer",
    task: "repair the state machine transition invariant transfer task",
    split: "transfer",
    taskFamily: "state-machine",
    latentFailureType: "invalid_terminal_transition",
    language: "javascript",
    surface: "state_machine",
    modelVisible: {
      prompt: "Fix invalid transitions while preserving terminal-state behavior.",
      visibleValidators: ["npm test"],
      taxonomy: ["state_machine", "invariant"]
    },
    evaluatorOnly: {
      hiddenValidators: ["hidden: terminal states reject all outgoing transitions"],
      leakageTokens: ["TERMINAL_STATE_ORACLE", "answer:no-transition-after-terminal"],
      notes: "Terminal invariant details are evaluator-only."
    }
  },
  {
    id: "flaky-validator-validation",
    task: "classify a flaky validator failure without storing a confident lesson",
    split: "validation",
    taskFamily: "validator-uncertainty",
    latentFailureType: "flaky_result",
    language: "javascript",
    surface: "flaky",
    modelVisible: {
      prompt: "Handle an intermittent validator result conservatively.",
      visibleValidators: ["npm test -- --retry"],
      taxonomy: ["flaky", "environment"]
    },
    evaluatorOnly: {
      hiddenValidators: ["hidden: transient failure simulation"],
      leakageTokens: ["FLAKY_VALIDATOR_ORACLE", "answer:quarantine-not-memory"],
      notes: "Randomness seed and oracle are evaluator-only."
    }
  }
];

export function resolveExperimentFixture(taskOrId: string): ExperimentFixtureMetadata {
  const normalized = taskOrId.trim().toLowerCase();
  return experimentFixtureCatalog.find((fixture) => fixture.id === normalized)
    ?? experimentFixtureCatalog.find((fixture) => fixture.task.toLowerCase() === normalized)
    ?? inferFixtureMetadata(taskOrId);
}

export function defaultExperimentTasks(): string[] {
  return experimentFixtureCatalog.map((fixture) => fixture.id);
}

export function fixtureCatalogHash(fixtures: ExperimentFixtureMetadata[] = experimentFixtureCatalog): string {
  return createHash("sha256").update(JSON.stringify(fixtures.map((fixture) => ({
    id: fixture.id,
    split: fixture.split,
    taskFamily: fixture.taskFamily,
    latentFailureType: fixture.latentFailureType,
    language: fixture.language,
    surface: fixture.surface,
    modelVisible: fixture.modelVisible,
    hiddenValidatorCount: fixture.evaluatorOnly.hiddenValidators.length
  })))).digest("hex");
}

function inferFixtureMetadata(task: string): ExperimentFixtureMetadata {
  const lower = task.toLowerCase();
  const taskFamily = /react|ui|dom|layout/.test(lower)
    ? "ui-state"
    : /state|transition|workflow/.test(lower)
      ? "state-machine"
      : /flaky|intermittent|transient/.test(lower)
        ? "validator-uncertainty"
        : "generic-error-loop";
  const latentFailureType = /off.by.one|boundary|range/.test(lower)
    ? "off_by_one"
    : /api|method|call/.test(lower)
      ? "wrong_api"
      : /wrong file|unrelated/.test(lower)
        ? "wrong_file"
        : /flaky|intermittent|transient/.test(lower)
          ? "flaky_result"
          : "validation_failed";
  const split: ExperimentFixtureSplit = /transfer|cross-language|cross language/.test(lower) ? "transfer" : "train";
  return {
    id: `ad-hoc-${createHash("sha1").update(task).digest("hex").slice(0, 10)}`,
    task,
    split,
    taskFamily,
    latentFailureType,
    language: /python|pytest|\.py/.test(lower) ? "python" : /rust|cargo/.test(lower) ? "rust" : "javascript",
    surface: taskFamily === "ui-state" ? "ui" : taskFamily === "state-machine" ? "state_machine" : taskFamily === "validator-uncertainty" ? "flaky" : "unit",
    modelVisible: {
      prompt: task,
      visibleValidators: /python|pytest/.test(lower) ? ["pytest"] : ["npm test"],
      taxonomy: [taskFamily, latentFailureType]
    },
    evaluatorOnly: {
      hiddenValidators: [],
      leakageTokens: [],
      notes: "Ad-hoc task has no evaluator-only oracle metadata."
    }
  };
}
