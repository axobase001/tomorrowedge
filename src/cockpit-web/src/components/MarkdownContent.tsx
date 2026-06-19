import type { ReactNode } from "react";
import type { Translator } from "../i18n.js";

type MarkdownBlock =
  | { type: "code"; language: string; content: string }
  | { type: "heading"; level: 3 | 4; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "paragraph"; text: string };

export function MarkdownContent({ content, className = "", t }: { content: string; className?: string; t: Translator }) {
  return (
    <div className={`te-markdown ${className}`.trim()} data-testid="markdown-content">
      {parseMarkdown(stripAnsi(content)).map((block, index) => renderBlock(block, index, t))}
    </div>
  );
}

function renderBlock(block: MarkdownBlock, index: number, t: Translator): ReactNode {
  if (block.type === "code") {
    return (
      <figure className="te-code-block" data-testid="markdown-code-block" key={index}>
        <figcaption>
          <span>{block.language || "code"}</span>
          <button type="button" className="te-code-copy" data-testid="markdown-copy-code" onClick={() => copyCode(block.content)}>{t("markdown.copy")}</button>
        </figcaption>
        <pre><code>{block.content}</code></pre>
      </figure>
    );
  }
  if (block.type === "heading") {
    const children = renderInline(block.text);
    return block.level === 3 ? <h3 key={index}>{children}</h3> : <h4 key={index}>{children}</h4>;
  }
  if (block.type === "list") {
    const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>);
    return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
  }
  return <p key={index}>{renderInline(block.text)}</p>;
}

function parseMarkdown(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }
    const fence = /^```([A-Za-z0-9_-]*)\s*$/.exec(trimmed);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language: fence[1] ?? "", content: code.join("\n") });
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length >= 3 ? 4 : 3, text: heading[2] });
      index += 1;
      continue;
    }
    if (isListLine(trimmed)) {
      const ordered = isOrderedListLine(trimmed);
      const items: string[] = [];
      while (index < lines.length && isListLine(lines[index].trim()) && isOrderedListLine(lines[index].trim()) === ordered) {
        items.push(lines[index].trim().replace(ordered ? /^\d+[.)]\s+/ : /^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (!current || /^```/.test(current) || /^(#{1,4})\s+/.test(current) || isListLine(current)) break;
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
  }
  return blocks.length ? blocks : [{ type: "paragraph", text: "" }];
}

function renderInline(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) nodes.push(...renderTextWithBreaks(value.slice(lastIndex, match.index), nodes.length));
    const markdownSpan = match[0];
    if (markdownSpan.startsWith("`")) {
      nodes.push(<code key={`inline-${nodes.length}`}>{markdownSpan.slice(1, -1)}</code>);
    } else if (markdownSpan.startsWith("**")) {
      nodes.push(<strong key={`bold-${nodes.length}`}>{renderTextWithBreaks(markdownSpan.slice(2, -2), nodes.length)}</strong>);
    } else {
      const link = /^\[([^\]]+)\((https?:\/\/[^)\s]+)\)$/.exec(markdownSpan);
      if (link) nodes.push(<a key={`link-${nodes.length}`} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>);
    }
    lastIndex = match.index + markdownSpan.length;
  }
  if (lastIndex < value.length) nodes.push(...renderTextWithBreaks(value.slice(lastIndex), nodes.length));
  return nodes;
}

function renderTextWithBreaks(value: string, keySeed: number): ReactNode[] {
  return value.split("\n").flatMap((line, index, list) => {
    const itemKey = `text-${keySeed}-${index}`;
    return index === list.length - 1 ? [<span key={itemKey}>{line}</span>] : [<span key={itemKey}>{line}</span>, <br key={`br-${keySeed}-${index}`} />];
  });
}

function isListLine(value: string): boolean {
  return /^[-*]\s+/.test(value) || isOrderedListLine(value);
}

function isOrderedListLine(value: string): boolean {
  return /^\d+[.)]\s+/.test(value);
}

function copyCode(content: string): void {
  void globalThis.navigator?.clipboard?.writeText(content);
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}
