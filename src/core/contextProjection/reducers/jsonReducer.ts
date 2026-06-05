export function reduceJson(text: string, maxChars = 3600): string {
  try {
    const parsed = JSON.parse(text);
    const compact = JSON.stringify(parsed, null, 2);
    if (compact.length <= maxChars) return compact;
    return `${compact.slice(0, maxChars)}\n[json preview omitted ${compact.length - maxChars} chars]`;
  } catch {
    return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n[text preview omitted ${text.length - maxChars} chars]`;
  }
}
