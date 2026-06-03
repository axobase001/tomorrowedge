export function makeId(prefix: string): string {
  const suffix = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${suffix}`;
}
