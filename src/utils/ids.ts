import { randomUUID } from "node:crypto";

export function makeId(prefix: string): string {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}_${suffix}`;
}
