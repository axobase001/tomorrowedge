import type { ShellPolicy } from "../config/schema.js";
import { classifyFileRisk, isBinaryLikePath, type FileRisk } from "./fileRisk.js";
import { explainShellCommand } from "./shellGuard.js";
import { parseUnifiedDiff } from "../core/patch/patchParser.js";
import { validateUnifiedDiff } from "../core/patch/patchValidator.js";

export type ActionRiskLevel = "low" | "medium" | "high";

export type AffectedFileRisk = {
  path: string;
  risk: FileRisk;
  change: "create" | "delete" | "modify" | "rename" | "binary";
};

export type ActionRiskAssessment = {
  action: "patch" | "shell";
  riskLevel: ActionRiskLevel;
  affectedFiles: AffectedFileRisk[];
  explanation: string;
  policy: string[];
  blocked: boolean;
};

export function assessPatchAction(cwd: string, unifiedDiff: string): ActionRiskAssessment {
  const parsedFiles = parseUnifiedDiff(unifiedDiff);
  const validation = validateUnifiedDiff(cwd, unifiedDiff);
  const affectedFiles = parsedFiles.map((file): AffectedFileRisk => {
    const target = file.newFileName || file.oldFileName;
    const change = file.isBinary ? "binary" : file.isRename ? "rename" : file.isCreate ? "create" : file.isDelete ? "delete" : "modify";
    return {
      path: target,
      risk: file.isBinary || isBinaryLikePath(target) ? "binary" : classifyFileRisk(target, 0),
      change
    };
  });
  const blocked = !validation.ok;
  const sensitive = affectedFiles.filter((file) => file.risk === "sensitive").map((file) => file.path);
  const binary = affectedFiles.filter((file) => file.risk === "binary").map((file) => file.path);
  const destructive = affectedFiles.filter((file) => file.change === "delete" || file.change === "rename").map((file) => file.path);
  const riskLevel: ActionRiskLevel = blocked || sensitive.length || binary.length || destructive.length ? "high" : affectedFiles.length > 3 ? "medium" : "low";
  const policy = [
    "patches must stay inside the project root",
    "ignored, sensitive, binary, and rename targets require manual handling",
    "secret-like files such as .env, *.pem, *.key, token, password, and credential paths are blocked"
  ];
  const issueText = validation.issues.map((issue) => `${issue.path}: ${issue.reason}`);
  const explanation = [
    `Patch touches ${affectedFiles.length} file(s): ${affectedFiles.map((file) => `${file.path} (${file.change}/${file.risk})`).join(", ") || "none"}.`,
    blocked ? `Blocked by policy: ${issueText.join("; ")}.` : "No blocking patch policy violations detected.",
    destructive.length ? `Destructive targets: ${destructive.join(", ")}.` : "",
    sensitive.length ? `Sensitive targets: ${sensitive.join(", ")}.` : "",
    binary.length ? `Binary targets: ${binary.join(", ")}.` : ""
  ].filter(Boolean).join(" ");
  return { action: "patch", riskLevel, affectedFiles, explanation, policy, blocked };
}

export function assessShellAction(command: string, options: { policy?: ShellPolicy; verificationAllowlist?: string[] } = {}): ActionRiskAssessment {
  const enforceAllowlist = options.policy !== "unrestricted";
  const shell = explainShellCommand(command, options.verificationAllowlist, enforceAllowlist);
  const affectedFiles = shell.pathArguments.map((argument): AffectedFileRisk => ({
    path: argument,
    risk: classifyFileRisk(argument, 0),
    change: "modify"
  }));
  const riskLevel: ActionRiskLevel = !shell.allowed || shell.dangerous ? "high" : affectedFiles.some((file) => file.risk === "sensitive" || file.risk === "binary") ? "medium" : "low";
  const policy = [
    "shell runs use argv execution with shell=false",
    "shell metacharacters and command chaining are blocked",
    "dangerous executables such as rm, rmdir, curl, wget, bash, sh, powershell, and shutdown are blocked",
    "verification commands should stay in the configured allowlist unless shell.policy is unrestricted"
  ];
  return {
    action: "shell",
    riskLevel,
    affectedFiles,
    explanation: shell.explanation,
    policy,
    blocked: !shell.allowed
  };
}

export function affectedFilePaths(files: AffectedFileRisk[]): string[] {
  return [...new Set(files.map((file) => normalizeFilePath(file.path)).filter(Boolean))];
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}
