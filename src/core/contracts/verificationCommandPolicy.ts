import type { AccessMode } from "../../config/schema.js";
import { isDocumentOnlyGoal } from "../goal/goalParser.js";

export function shouldUseDefaultNpmTest(goal: string, patchLike: boolean, accessMode: AccessMode): boolean {
  if (!patchLike || accessMode === "restricted" || isDocumentOnlyGoal(goal)) return false;
  if (explicitlyForbidsDefaultNpmTest(goal)) return false;
  return true;
}

export function boundedFileVerificationCommand(goal: string): string | undefined {
  if (!asksForBoundedFileVerification(goal)) return undefined;
  const files = expectedOutputFiles(goal);
  if (!files.length) return undefined;
  const payload = Buffer.from(JSON.stringify({ files }), "utf8").toString("base64url");
  return `node scripts/bounded-file-verifier.mjs ${payload}`;
}

export function isBoundedFileVerificationCommand(command: string): boolean {
  return /^node\s+scripts\/bounded-file-verifier\.mjs\s+[A-Za-z0-9_-]+$/i.test(command.trim().replace(/\\/g, "/"));
}

export function explicitlyForbidsDefaultNpmTest(goal: string): boolean {
  return /(?:do\s+not|don't|never|avoid|skip)\s+(?:run(?:ning)?\s+)?(?:the\s+)?(?:full\s+)?npm\s+test/i.test(goal)
    || /(?:不(?:要|许|用)|禁止|避免|跳过|无需|不要运行|不运行).{0,16}(?:完整|全量)?.{0,8}npm\s+test/i.test(goal)
    || /(?:verification|verify|验证|检查).{0,24}(?:only|只|仅).{0,24}(?:check|检查)/i.test(goal);
}

function asksForBoundedFileVerification(goal: string): boolean {
  return /(?:verify|verification|check|ensure|only check).{0,120}(?:files? exist|existence|html|svg|readable|openable|can be opened)/i.test(goal)
    || /(?:files? exist|html|svg|readable|openable|can be opened).{0,120}(?:verify|verification|check|ensure|only check)/i.test(goal)
    || /(?:验证|检查).{0,80}(?:文件|HTML|SVG|存在|可读|打开)/i.test(goal);
}

function expectedOutputFiles(goal: string): string[] {
  const directory = outputDirectory(goal);
  const optionalPdf = /(?:if\s+(?:the\s+)?environment\s+supports|if\s+supported|optional|if\s+possible).{0,40}\.pdf|\.pdf.{0,40}(?:if\s+(?:the\s+)?environment\s+supports|if\s+supported|optional|if\s+possible)/i.test(goal);
  const matches = [...goal.matchAll(/(?:^|[\s`"'(:])((?:(?:[A-Za-z0-9_.@()[\]-]+[\\/])+)?[A-Za-z0-9_.@()[\]-]+\.(?:md|markdown|html|htm|svg|txt|rst|adoc|json|pdf))(?:$|[\s`"',.;:)])/gi)]
    .map((match) => normalizeExpectedPath(match[1], directory))
    .filter((value): value is string => Boolean(value));
  const filtered = matches.filter((file) => !(optionalPdf && /\.pdf$/i.test(file)));
  return [...new Set(filtered)].slice(0, 24);
}

function outputDirectory(goal: string): string | undefined {
  const match = /\b(?:at|in|under|inside|directory|folder)\s+([A-Za-z0-9_.@()[\]-]+(?:[\\/][A-Za-z0-9_.@()[\]-]+)*[\\/]?)(?:[.:]|\s|$)/i.exec(goal);
  if (!match) return undefined;
  const normalized = normalizeDirectory(match[1]);
  return normalized || undefined;
}

function normalizeDirectory(raw: string): string | undefined {
  const normalized = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/[),.;:]+$/g, "").replace(/\/?\.$/, "").replace(/\/?$/, "/");
  if (!normalized || normalized.includes("..") || /^[/\\]|^[A-Za-z]:/.test(normalized)) return undefined;
  if (/^(?:node_modules|\.git|\.tomorrowedge|dist|coverage)\//.test(normalized)) return undefined;
  return normalized;
}

function normalizeExpectedPath(raw: string, directory?: string): string | undefined {
  const normalized = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/[),.;:]+$/g, "");
  if (!normalized || normalized.includes("..") || /^[/\\]|^[A-Za-z]:/.test(normalized)) return undefined;
  if (/^(?:node_modules|\.git|\.tomorrowedge|dist|coverage)\//.test(normalized)) return undefined;
  if (/(^|\/)\.env(?:\.|$)/.test(normalized)) return undefined;
  if (!normalized.includes("/") && directory) return `${directory}${normalized}`;
  return normalized;
}
