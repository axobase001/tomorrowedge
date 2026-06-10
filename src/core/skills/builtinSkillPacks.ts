import type { AccessMode } from "../../config/schema.js";
import type { RiskLevel } from "../../schemas/plan.js";
import { listWorkflowRecipes } from "../recipes/recipeLoader.js";
import type { WorkflowRecipe } from "../recipes/recipeTypes.js";
import type { ScenarioType } from "../scenarios/scenarioTypes.js";
import type { SkillManifestV1, SkillPackManifestV1, SkillPermissionIntent } from "./skillTypes.js";

type SkillInput = {
  skillId: string;
  name: string;
  description: string;
  tags?: string[];
  scenarios?: ScenarioType[];
  userStories?: string[];
  inputs?: string[];
  outputs?: string[];
  requiredArtifacts?: string[];
  verificationCommands?: string[];
  requiredTools?: string[];
  intents?: SkillPermissionIntent[];
  allowedTools?: string[];
  allowedAccessModes?: AccessMode[];
  riskLevel?: RiskLevel;
  lifecycle?: SkillManifestV1["lifecycle"];
  provenance?: SkillManifestV1["provenance"];
  sourceRecipeId?: string;
  shellCommands?: string[];
  networkHosts?: string[];
  githubRead?: boolean;
  githubWrite?: boolean;
  fsRead?: boolean;
  fsWrite?: boolean;
};

export function builtinSkillPacks(): SkillPackManifestV1[] {
  return [
    workflowRecipeSkillPack(),
    workspaceFileSystemToolPack(),
    codeIntelligenceToolPack(),
    gitGithubToolPack(),
    webResearchToolPack(),
    documentKnowledgeToolPack(),
    dataDatabaseToolPack(),
    apiIntegrationToolPack()
  ];
}

export function workflowRecipeSkillPack(): SkillPackManifestV1 {
  return {
    schemaVersion: "skill-pack/v1",
    packId: "workflow_recipes",
    version: "1.0.0",
    name: "Workflow recipes",
    description: "Human-seeded workflow starting points represented as governed skills.",
    kind: "skill_pack",
    domainTags: ["coding", "review", "release"],
    userStories: ["review current work", "fix failing tests", "audit risky changes"],
    enabledByDefault: true,
    skills: listWorkflowRecipes().map(recipeToSkill)
  };
}

export function workspaceFileSystemToolPack(): SkillPackManifestV1 {
  return {
    schemaVersion: "skill-pack/v1",
    packId: "workspace_fs",
    version: "1.0.0",
    name: "Workspace file system",
    description: "Permission-aware workspace file, search, diff, patch, and artifact operations.",
    kind: "tool_pack",
    domainTags: ["workspace", "filesystem", "patch"],
    userStories: ["inspect repository safely", "review changed files", "apply approved patches"],
    enabledByDefault: true,
    skills: [
      skill({ skillId: "workspace.list_tree", name: "List workspace tree", description: "List bounded workspace structure.", scenarios: ["analysis", "debugging", "coding", "refactor"], requiredTools: ["repo_index"], intents: ["read"], allowedTools: ["repo_index"], fsRead: true, outputs: ["bounded tree summary"] }),
      skill({ skillId: "workspace.read_file", name: "Read workspace file", description: "Read a path-safe file inside the workspace.", scenarios: ["analysis", "debugging", "coding", "refactor"], requiredTools: ["file_read"], intents: ["read"], allowedTools: ["file_read"], fsRead: true, outputs: ["file content artifact or compact preview"] }),
      skill({ skillId: "workspace.read_many", name: "Read selected files", description: "Read multiple selected safe files with bounded output.", scenarios: ["analysis", "debugging", "coding", "refactor"], requiredTools: ["file_read"], intents: ["read"], allowedTools: ["file_read"], fsRead: true, outputs: ["file bundle artifact"] }),
      skill({ skillId: "workspace.search_text", name: "Search workspace text", description: "Search indexed safe files with result limits.", scenarios: ["analysis", "debugging", "coding", "refactor"], requiredTools: ["grep"], intents: ["read"], allowedTools: ["grep"], fsRead: true, outputs: ["path and line hits"] }),
      skill({ skillId: "workspace.summarize_structure", name: "Summarize workspace structure", description: "Summarize project structure and likely entry points.", scenarios: ["analysis", "planning", "debugging"], requiredTools: ["repo_index"], intents: ["read"], allowedTools: ["repo_index"], fsRead: true, outputs: ["structure summary"] }),
      skill({ skillId: "workspace.diff_worktree", name: "Diff worktree", description: "Summarize current worktree diff without applying changes.", scenarios: ["debugging", "refactor", "coding"], requiredTools: ["git_status"], intents: ["read"], allowedTools: ["git_status"], fsRead: true, outputs: ["diff summary artifact"] }),
      skill({ skillId: "workspace.propose_patch", name: "Propose patch", description: "Produce a candidate patch for review without applying it.", scenarios: ["debugging", "coding", "refactor"], requiredTools: ["patch_candidate"], intents: ["write"], allowedTools: ["patch_candidate"], allowedAccessModes: ["partial", "full"], fsRead: true, fsWrite: false, outputs: ["patch candidate", "diff artifact"], riskLevel: "medium" }),
      skill({ skillId: "workspace.apply_patch", name: "Apply approved patch", description: "Apply an approved patch through Objective Contract and access-mode gates.", scenarios: ["debugging", "coding", "refactor"], requiredTools: ["patch_apply"], intents: ["write"], allowedTools: ["patch_apply"], allowedAccessModes: ["partial", "full"], fsRead: true, fsWrite: true, outputs: ["changed files", "undo snapshot"], riskLevel: "medium" }),
      skill({ skillId: "workspace.undo_patch", name: "Undo patch", description: "Undo the latest tracked patch where supported.", scenarios: ["debugging", "coding", "refactor"], requiredTools: ["undo"], intents: ["write"], allowedTools: ["undo"], allowedAccessModes: ["partial", "full"], fsRead: true, fsWrite: true, outputs: ["rollback result"], riskLevel: "medium" }),
      skill({ skillId: "workspace.write_artifact", name: "Write artifact", description: "Write non-source evidence artifacts into the session artifact store.", scenarios: ["analysis", "debugging", "coding", "planning"], requiredTools: ["event_ledger"], intents: ["write"], allowedTools: ["event_ledger"], allowedAccessModes: ["restricted", "partial", "full"], outputs: ["artifact ref"] })
    ]
  };
}

export function codeIntelligenceToolPack(): SkillPackManifestV1 {
  return {
    schemaVersion: "skill-pack/v1",
    packId: "code_intelligence",
    version: "1.0.0",
    name: "Code intelligence",
    description: "Language-agnostic code search, script discovery, verification, and error localization tools.",
    kind: "tool_pack",
    domainTags: ["code", "tests", "diagnostics"],
    userStories: ["find affected code", "discover tests", "localize verification failures"],
    enabledByDefault: true,
    skills: [
      skill({ skillId: "code.index_workspace", name: "Index workspace", description: "Build a bounded repository file index.", scenarios: ["coding", "debugging", "refactor", "analysis"], requiredTools: ["repo_index"], intents: ["read"], allowedTools: ["repo_index"], fsRead: true }),
      skill({ skillId: "code.search_symbols", name: "Search symbols", description: "Find likely symbol definitions with heuristic text search.", scenarios: ["coding", "debugging", "refactor"], requiredTools: ["grep"], intents: ["read"], allowedTools: ["grep"], fsRead: true }),
      skill({ skillId: "code.find_references", name: "Find references", description: "Find likely references for a symbol or file.", scenarios: ["coding", "debugging", "refactor"], requiredTools: ["grep"], intents: ["read"], allowedTools: ["grep"], fsRead: true }),
      skill({ skillId: "code.find_tests", name: "Find tests", description: "Find likely related tests for touched files.", scenarios: ["debugging", "coding", "refactor"], requiredTools: ["repo_index"], intents: ["read"], allowedTools: ["repo_index"], fsRead: true }),
      skill({ skillId: "code.discover_scripts", name: "Discover scripts", description: "Discover package/build/test scripts without inventing commands.", scenarios: ["debugging", "coding", "refactor"], requiredTools: ["file_read"], intents: ["read"], allowedTools: ["file_read"], fsRead: true }),
      skill({ skillId: "code.run_lint", name: "Run lint", description: "Run a discovered lint command through shell policy.", scenarios: ["coding", "refactor"], requiredTools: ["shell"], intents: ["shell"], allowedTools: ["shell"], allowedAccessModes: ["partial", "full"], verificationCommands: ["npm run lint"], shellCommands: ["npm run lint"], riskLevel: "medium" }),
      skill({ skillId: "code.run_typecheck", name: "Run typecheck", description: "Run a discovered typecheck command through shell policy.", scenarios: ["coding", "refactor"], requiredTools: ["shell"], intents: ["shell"], allowedTools: ["shell"], allowedAccessModes: ["partial", "full"], verificationCommands: ["npm run typecheck"], shellCommands: ["npm run typecheck"], riskLevel: "medium" }),
      skill({ skillId: "code.run_tests", name: "Run tests", description: "Run a discovered test command through shell policy.", scenarios: ["debugging", "coding", "refactor"], requiredTools: ["shell"], intents: ["shell"], allowedTools: ["shell"], allowedAccessModes: ["partial", "full"], verificationCommands: ["npm test"], shellCommands: ["npm test"], riskLevel: "medium" }),
      skill({ skillId: "code.localize_error", name: "Localize error", description: "Parse bounded command output into file/line diagnostic candidates.", scenarios: ["debugging", "coding"], requiredTools: ["shell"], intents: ["read"], allowedTools: ["shell"], fsRead: true, outputs: ["diagnostic candidates"] }),
      skill({ skillId: "code.map_patch_to_tests", name: "Map patch to tests", description: "Map changed files to likely test commands and files.", scenarios: ["debugging", "coding", "refactor"], requiredTools: ["repo_index", "grep"], intents: ["read"], allowedTools: ["repo_index", "grep"], fsRead: true, outputs: ["test suggestions"] })
    ]
  };
}

export function gitGithubToolPack(): SkillPackManifestV1 {
  return {
    schemaVersion: "skill-pack/v1",
    packId: "git_github",
    version: "1.0.0",
    name: "Git and GitHub",
    description: "Permission-aware local git and GitHub collaboration evidence tools.",
    kind: "tool_pack",
    domainTags: ["git", "github", "review", "release"],
    userStories: ["inspect branch state", "summarize PR evidence", "draft release notes"],
    enabledByDefault: true,
    skills: [
      skill({ skillId: "git.status", name: "Git status", description: "Read local git branch and status.", scenarios: ["debugging", "coding", "refactor", "planning"], requiredTools: ["git_status"], intents: ["read"], allowedTools: ["git_status"], fsRead: true }),
      skill({ skillId: "git.diff", name: "Git diff", description: "Read bounded local diff evidence.", scenarios: ["debugging", "coding", "refactor"], requiredTools: ["git_status"], intents: ["read"], allowedTools: ["git_status"], fsRead: true }),
      skill({ skillId: "git.branch_info", name: "Branch info", description: "Summarize branch and upstream state.", scenarios: ["planning", "debugging"], requiredTools: ["git_status"], intents: ["read"], allowedTools: ["git_status"], fsRead: true }),
      skill({ skillId: "git.commit_summary", name: "Commit summary", description: "Summarize recent commits without mutation.", scenarios: ["planning", "analysis"], requiredTools: ["git_status"], intents: ["read"], allowedTools: ["git_status"], fsRead: true }),
      skill({ skillId: "github.issue_list", name: "List GitHub issues", description: "Read bounded issue metadata.", scenarios: ["planning", "ops"], requiredTools: ["github"], intents: ["read"], allowedTools: ["github"], githubRead: true }),
      skill({ skillId: "github.pr_get", name: "Get GitHub PR", description: "Read PR metadata and files as bounded evidence.", scenarios: ["analysis", "planning"], requiredTools: ["github"], intents: ["read"], allowedTools: ["github"], githubRead: true }),
      skill({ skillId: "github.ci_status", name: "Get CI status", description: "Read CI status and bounded logs.", scenarios: ["debugging", "analysis"], requiredTools: ["github"], intents: ["read"], allowedTools: ["github"], githubRead: true }),
      skill({ skillId: "github.review_comment_draft", name: "Draft review comment", description: "Draft a review comment without posting it.", scenarios: ["analysis"], requiredTools: ["github"], intents: ["read"], allowedTools: ["github"], githubRead: true, outputs: ["draft comment"] }),
      skill({ skillId: "github.post_comment", name: "Post approved GitHub comment", description: "Post a prepared comment only after explicit approval.", scenarios: ["analysis", "ops"], requiredTools: ["github"], intents: ["github_write"], allowedTools: ["github"], allowedAccessModes: ["partial", "full"], githubRead: true, githubWrite: true, riskLevel: "medium" }),
      skill({ skillId: "github.release_notes_draft", name: "Draft release notes", description: "Draft release notes from local and GitHub evidence.", scenarios: ["planning", "ops"], requiredTools: ["git_status", "github"], intents: ["read"], allowedTools: ["git_status", "github"], githubRead: true, outputs: ["release note draft"] })
    ]
  };
}

export function webResearchToolPack(): SkillPackManifestV1 {
  return {
    schemaVersion: "skill-pack/v1",
    packId: "web_research",
    version: "1.0.0",
    name: "Web and research",
    description: "Network-bounded search, browsing, citation, recency, and source-quality evidence tools.",
    kind: "tool_pack",
    domainTags: ["web", "research", "citations", "recency"],
    userStories: ["check current documentation", "collect cited evidence", "verify recency-sensitive claims"],
    enabledByDefault: true,
    skills: [
      skill({ skillId: "web.search", name: "Search web", description: "Run a bounded search query and store result metadata as evidence.", scenarios: ["analysis", "planning", "document", "ops"], requiredTools: ["web_search"], intents: ["network"], allowedTools: ["web_search"], networkHosts: ["search"], outputs: ["search result evidence"], riskLevel: "medium", allowedAccessModes: ["partial", "full"] }),
      skill({ skillId: "web.open_page", name: "Open web page", description: "Fetch a bounded web page view with source URL and timestamp.", scenarios: ["analysis", "planning", "document", "debugging"], requiredTools: ["web_open"], intents: ["network"], allowedTools: ["web_open"], networkHosts: ["https"], outputs: ["page evidence artifact"], riskLevel: "medium", allowedAccessModes: ["partial", "full"] }),
      skill({ skillId: "web.extract_citations", name: "Extract citations", description: "Extract compact citation packets from sourced web evidence.", scenarios: ["analysis", "document", "planning"], requiredTools: ["web_open", "event_ledger"], intents: ["network", "read"], allowedTools: ["web_open", "event_ledger"], networkHosts: ["https"], outputs: ["citation packets"], riskLevel: "medium", allowedAccessModes: ["partial", "full"] }),
      skill({ skillId: "web.recency_check", name: "Recency check", description: "Mark claims that need current-source verification and attach dated evidence.", scenarios: ["analysis", "planning", "ops"], requiredTools: ["web_search", "web_open"], intents: ["network"], allowedTools: ["web_search", "web_open"], networkHosts: ["search", "https"], outputs: ["recency report"], riskLevel: "medium", allowedAccessModes: ["partial", "full"] }),
      skill({ skillId: "web.source_quality_check", name: "Source quality check", description: "Rank gathered sources by primary-source, recency, and relevance signals.", scenarios: ["analysis", "document", "planning"], requiredTools: ["event_ledger"], intents: ["read"], allowedTools: ["event_ledger"], outputs: ["source quality summary"] })
    ]
  };
}

export function documentKnowledgeToolPack(): SkillPackManifestV1 {
  return {
    schemaVersion: "skill-pack/v1",
    packId: "document_knowledge",
    version: "1.0.0",
    name: "Document and knowledge",
    description: "PDF, Markdown, table, OCR, and local knowledge-index evidence tools.",
    kind: "tool_pack",
    domainTags: ["documents", "knowledge", "pdf", "markdown", "ocr"],
    userStories: ["summarize project docs", "extract tables from reports", "index local knowledge safely"],
    enabledByDefault: true,
    skills: [
      skill({ skillId: "docs.read_markdown", name: "Read Markdown", description: "Read and summarize Markdown documents inside the workspace.", scenarios: ["document", "analysis", "planning"], requiredTools: ["file_read"], intents: ["read"], allowedTools: ["file_read"], fsRead: true, outputs: ["markdown summary"] }),
      skill({ skillId: "docs.read_pdf", name: "Read PDF", description: "Extract bounded text from local PDF artifacts.", scenarios: ["document", "analysis"], requiredTools: ["document_read"], intents: ["read"], allowedTools: ["document_read"], fsRead: true, outputs: ["pdf text artifact"], riskLevel: "medium" }),
      skill({ skillId: "docs.extract_tables", name: "Extract tables", description: "Extract compact table evidence from local documents or Markdown.", scenarios: ["document", "analysis"], requiredTools: ["document_read"], intents: ["read"], allowedTools: ["document_read"], fsRead: true, outputs: ["table evidence packets"], riskLevel: "medium" }),
      skill({ skillId: "docs.ocr_image", name: "OCR image", description: "Extract text from screenshots or image artifacts through an approved OCR tool.", scenarios: ["document", "analysis", "debugging"], requiredTools: ["ocr"], intents: ["read"], allowedTools: ["ocr"], fsRead: true, outputs: ["ocr artifact"], riskLevel: "medium" }),
      skill({ skillId: "docs.index_knowledge", name: "Index local knowledge", description: "Build a bounded local knowledge index from selected workspace documents.", scenarios: ["document", "analysis", "planning"], requiredTools: ["repo_index", "document_read"], intents: ["read"], allowedTools: ["repo_index", "document_read"], fsRead: true, outputs: ["knowledge index summary"], riskLevel: "medium" })
    ]
  };
}

export function dataDatabaseToolPack(): SkillPackManifestV1 {
  return {
    schemaVersion: "skill-pack/v1",
    packId: "data_database",
    version: "1.0.0",
    name: "Data and database",
    description: "CSV, JSON, SQL, schema inspection, and safe read-only query evidence tools.",
    kind: "tool_pack",
    domainTags: ["data", "database", "sql", "csv", "json"],
    userStories: ["inspect schema safely", "validate data migrations", "sample tabular fixtures"],
    enabledByDefault: true,
    skills: [
      skill({ skillId: "data.read_csv", name: "Read CSV", description: "Read bounded CSV samples and column summaries.", scenarios: ["analysis", "debugging", "document"], requiredTools: ["file_read"], intents: ["read"], allowedTools: ["file_read"], fsRead: true, outputs: ["csv profile"] }),
      skill({ skillId: "data.read_json", name: "Read JSON", description: "Read bounded JSON samples and shape summaries.", scenarios: ["analysis", "debugging", "document"], requiredTools: ["file_read"], intents: ["read"], allowedTools: ["file_read"], fsRead: true, outputs: ["json shape summary"] }),
      skill({ skillId: "data.inspect_schema", name: "Inspect schema", description: "Inspect database or migration schema evidence without mutation.", scenarios: ["analysis", "debugging", "coding"], requiredTools: ["file_read", "grep"], intents: ["read"], allowedTools: ["file_read", "grep"], fsRead: true, outputs: ["schema summary"], riskLevel: "medium" }),
      skill({ skillId: "data.safe_sql_query", name: "Safe SQL query", description: "Run approved read-only SQL queries through database policy gates.", scenarios: ["analysis", "debugging"], requiredTools: ["database_query"], intents: ["database"], allowedTools: ["database_query"], allowedAccessModes: ["partial", "full"], outputs: ["query result artifact"], riskLevel: "high" }),
      skill({ skillId: "data.migration_risk_check", name: "Migration risk check", description: "Check migration files for destructive schema operations before execution.", scenarios: ["coding", "debugging", "refactor"], requiredTools: ["file_read", "grep"], intents: ["read"], allowedTools: ["file_read", "grep"], fsRead: true, outputs: ["migration risk signals"], riskLevel: "high" })
    ]
  };
}

export function apiIntegrationToolPack(): SkillPackManifestV1 {
  return {
    schemaVersion: "skill-pack/v1",
    packId: "api_integration",
    version: "1.0.0",
    name: "API and integration",
    description: "HTTP, OpenAPI, auth-boundary, mock-server, contract, and rate-limit evidence tools.",
    kind: "tool_pack",
    domainTags: ["api", "http", "openapi", "auth", "mocks"],
    userStories: ["review API boundary changes", "smoke test local endpoints", "validate OpenAPI contracts"],
    enabledByDefault: true,
    skills: [
      skill({ skillId: "api.inspect_openapi", name: "Inspect OpenAPI", description: "Read OpenAPI or route specs and summarize endpoints.", scenarios: ["analysis", "coding", "debugging"], requiredTools: ["file_read"], intents: ["read"], allowedTools: ["file_read"], fsRead: true, outputs: ["endpoint summary"] }),
      skill({ skillId: "api.http_smoke", name: "HTTP smoke test", description: "Run approved local HTTP smoke checks through network policy.", scenarios: ["debugging", "coding"], requiredTools: ["http"], intents: ["network"], allowedTools: ["http"], allowedAccessModes: ["partial", "full"], networkHosts: ["localhost", "127.0.0.1"], outputs: ["http smoke evidence"], riskLevel: "medium" }),
      skill({ skillId: "api.auth_boundary_check", name: "Auth boundary check", description: "Review route, middleware, and config changes for auth-boundary risk.", scenarios: ["coding", "debugging", "refactor"], requiredTools: ["grep", "file_read"], intents: ["read"], allowedTools: ["grep", "file_read"], fsRead: true, outputs: ["auth risk signals"], riskLevel: "high" }),
      skill({ skillId: "api.mock_server_check", name: "Mock server check", description: "Validate that mocks and fixtures cover integration paths without hitting production.", scenarios: ["debugging", "coding"], requiredTools: ["file_read", "shell"], intents: ["read", "shell"], allowedTools: ["file_read", "shell"], allowedAccessModes: ["partial", "full"], fsRead: true, shellCommands: ["npm test"], outputs: ["mock coverage evidence"], riskLevel: "medium" }),
      skill({ skillId: "api.rate_limit_check", name: "Rate limit check", description: "Inspect retry, timeout, and rate-limit handling around external API calls.", scenarios: ["coding", "debugging"], requiredTools: ["grep", "file_read"], intents: ["read"], allowedTools: ["grep", "file_read"], fsRead: true, outputs: ["rate limit risk signals"], riskLevel: "medium" })
    ]
  };
}

function recipeToSkill(recipe: WorkflowRecipe): SkillManifestV1 {
  return skill({
    skillId: `recipe.${recipe.id}`,
    name: recipe.name,
    description: recipe.description,
    sourceRecipeId: recipe.id,
    tags: ["recipe", ...recipe.roles],
    scenarios: recipe.id === "security-audit" ? ["coding", "debugging", "refactor"] : recipe.id === "review-only" ? ["analysis", "planning", "debugging", "refactor"] : ["debugging", "coding"],
    userStories: [recipe.defaultGoal],
    requiredTools: recipe.verification.length ? ["repo_index", "file_read", "grep", "patch_candidate", "patch_apply", "shell"] : ["repo_index", "file_read", "grep"],
    intents: recipe.verification.length ? ["read", "write", "shell"] : ["read"],
    allowedTools: recipe.verification.length ? ["repo_index", "file_read", "grep", "patch_candidate", "patch_apply", "shell", "event_ledger"] : ["repo_index", "file_read", "grep", "event_ledger"],
    allowedAccessModes: recipe.accessMode ? [recipe.accessMode] : ["restricted", "partial", "full"],
    verificationCommands: recipe.verification,
    riskLevel: recipe.id === "security-audit" ? "high" : recipe.verification.length ? "medium" : "low",
    lifecycle: "stable",
    provenance: "recipe_derived",
    fsRead: true,
    fsWrite: recipe.verification.length > 0,
    shellCommands: recipe.verification
  });
}

function skill(input: SkillInput): SkillManifestV1 {
  const intents = input.intents ?? ["read"];
  return {
    schemaVersion: "skill-manifest/v1",
    skillId: input.skillId,
    version: "1.0.0",
    name: input.name,
    description: input.description,
    tags: input.tags ?? [],
    scenarios: input.scenarios ?? ["unknown"],
    userStories: input.userStories ?? [],
    inputs: input.inputs ?? ["scenario profile", "objective contract"],
    outputs: input.outputs ?? ["evidence artifact"],
    requiredArtifacts: input.requiredArtifacts ?? [],
    verificationCommands: input.verificationCommands ?? [],
    requiredTools: input.requiredTools ?? input.allowedTools ?? [],
    permissions: {
      intents,
      allowedTools: input.allowedTools ?? input.requiredTools ?? [],
      filesystem: {
        read: input.fsRead ?? intents.includes("read"),
        write: input.fsWrite ?? intents.includes("write"),
        pathScope: input.fsRead === false && input.fsWrite === false ? "none" : "workspace"
      },
      shell: {
        allowed: intents.includes("shell"),
        commands: input.shellCommands ?? []
      },
      network: {
        allowed: intents.includes("network"),
        hosts: input.networkHosts ?? []
      },
      github: {
        read: input.githubRead ?? false,
        write: input.githubWrite ?? false
      }
    },
    allowedAccessModes: input.allowedAccessModes ?? ["restricted", "partial", "full"],
    riskLevel: input.riskLevel ?? "low",
    provenance: input.provenance ?? "tool_pack",
    lifecycle: input.lifecycle ?? "stable",
    owner: "tomorrowedge",
    sourceRecipeId: input.sourceRecipeId,
    fixtures: [],
    sandbox: {
      required: true,
      profile: "fixture"
    },
    lifecycleHistory: [{
      to: input.lifecycle ?? "stable",
      reason: "human-seeded built-in manifest",
      actor: "tomorrowedge",
      evidenceRefs: [],
      at: "2026-06-10T00:00:00.000Z"
    }]
  };
}
