export type LogLevel = "info" | "warn" | "error";

export function log(level: LogLevel, message: string): void {
  const prefix = level.toUpperCase().padEnd(5);
  process.stderr.write(`[${prefix}] ${message}\n`);
}
