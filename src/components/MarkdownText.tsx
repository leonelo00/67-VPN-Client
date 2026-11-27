import React from "react";

function renderInline(text: string): React.ReactNode[] {
  const tokens: React.ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    const raw = match[0];
    if (raw.startsWith("`") && raw.endsWith("`")) {
      tokens.push(
        <code
          key={key++}
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 4,
            padding: "1px 5px",
            fontFamily: "monospace",
            fontSize: "0.92em",
            color: "#e2e8f0",
          }}
        >
          {raw.slice(1, -1)}
        </code>
      );
    } else if (raw.startsWith("**") && raw.endsWith("**")) {
      tokens.push(
        <strong key={key++} style={{ color: "var(--text-primary)", fontWeight: 600 }}>
          {raw.slice(2, -2)}
        </strong>
      );
    } else if (raw.startsWith("*") && raw.endsWith("*")) {
      tokens.push(<em key={key++}>{raw.slice(1, -1)}</em>);
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }
  return tokens;
}

export function MarkdownText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, lineHeight: 1.5 }}>
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={idx} style={{ height: 4 }} />;
        }

        const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const fontSize = level <= 2 ? 14.5 : level === 3 ? 13.5 : 12.5;
          return (
            <div
              key={idx}
              style={{
                fontWeight: 700,
                fontSize,
                color: "var(--text-primary)",
                marginTop: idx === 0 ? 0 : 4,
              }}
            >
              {renderInline(headingMatch[2])}
            </div>
          );
        }

        if (trimmed.startsWith("> ")) {
          return (
            <div
              key={idx}
              style={{
                borderLeft: "2px solid var(--accent)",
                paddingLeft: 8,
                color: "var(--text-secondary)",
              }}
            >
              {renderInline(trimmed.slice(2))}
            </div>
          );
        }

        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return (
            <div key={idx} style={{ display: "flex", gap: 6, paddingLeft: 4 }}>
              <span style={{ color: "var(--accent)", flexShrink: 0 }}>•</span>
              <span>{renderInline(trimmed.slice(2))}</span>
            </div>
          );
        }

        return <div key={idx}>{renderInline(trimmed)}</div>;
      })}
    </div>
  );
}
