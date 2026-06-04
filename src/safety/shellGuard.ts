export type ShellRisk = {
  allowed: boolean;
  reason: string;
  argv?: string[];
};

const blockedExecutables = new Set(["rm", "del", "erase", "rmdir", "shutdown", "reboot", "format", "mkfs", "curl", "wget", "powershell", "pwsh", "cmd", "bash", "sh"]);
const defaultAllowedExecutables = ["npm", "node", "npx", "pnpm", "yarn", "python", "python3", "pytest", "tsx", "tsc", "vitest", "jest", "cargo", "rustc", "make", "cmake", "go", "uv", "pip", "bun", "deno"];
const shellMetacharacters = /[;&|`<>]|\$\(|\r|\n/;

export function assessShellCommand(command: string, allowedExecutables = defaultAllowedExecutables): ShellRisk {
  const trimmed = command.trim();
  if (!trimmed) return { allowed: false, reason: "empty shell command" };
  if (shellMetacharacters.test(trimmed)) {
    return { allowed: false, reason: "shell metacharacters are blocked in TomorrowEdge full/partial execution" };
  }

  let argv: string[];
  try {
    argv = splitCommand(trimmed);
  } catch (error) {
    return { allowed: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (!argv.length) return { allowed: false, reason: "empty shell command" };
  const executable = normalizeExecutable(argv[0]);
  if (blockedExecutables.has(executable)) {
    return { allowed: false, reason: `dangerous executable blocked: ${argv[0]}` };
  }
  if (!new Set(allowedExecutables.map(normalizeExecutable)).has(executable)) {
    return { allowed: false, reason: `executable is not in the safe verification allowlist: ${argv[0]}` };
  }
  return { allowed: true, reason: "safe verification command", argv };
}

export function parseShellCommand(command: string): ShellRisk {
  const trimmed = command.trim();
  if (!trimmed) return { allowed: false, reason: "empty shell command" };
  if (shellMetacharacters.test(trimmed)) {
    return { allowed: false, reason: "shell metacharacters are blocked; pass a single executable plus arguments" };
  }
  try {
    const argv = splitCommand(trimmed);
    return argv.length ? { allowed: true, reason: "parsed command", argv } : { allowed: false, reason: "empty shell command" };
  } catch (error) {
    return { allowed: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function splitCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (char === "\\") {
      const next = command[index + 1];
      if (next !== undefined && (/\s/.test(next) || next === "\\" || next === "'" || next === "\"")) {
        current += next;
        index += 1;
      } else {
        current += char;
      }
      continue;
    }
    if ((char === "'" || char === "\"") && !quote) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = undefined;
      continue;
    }
    if (/\s/.test(char) && !quote) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (quote) throw new Error("Unclosed quote in shell command.");
  if (current) tokens.push(current);
  return tokens;
}

function normalizeExecutable(executable: string): string {
  return executable.toLowerCase().replace(/\.(cmd|exe|bat|ps1)$/i, "");
}
