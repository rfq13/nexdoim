"use client";
import type { ReactNode } from "react";

/** Lightweight markdown renderer — no external deps. Handles headings,
 *  code blocks, inline code, bold/italic, tables, lists, hr, paragraphs. */
export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={i} className="bg-black/40 border border-(--border) rounded-lg p-3 my-2 overflow-x-auto text-xs font-mono text-green-300">
          {lang && <div className="text-(--muted) text-xs mb-1">{lang}</div>}
          {codeLines.join("\n")}
        </pre>
      );
      i++;
      continue;
    }

    if (/^#{1,3} /.test(line)) {
      const level = line.match(/^(#+)/)?.[1].length ?? 1;
      const content = line.replace(/^#+\s/, "");
      const cls = level === 1 ? "text-lg font-bold mt-3 mb-1" : level === 2 ? "font-semibold mt-2 mb-1" : "font-medium mt-1";
      elements.push(<div key={i} className={cls}>{renderInline(content)}</div>);
      i++;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={i} className="border-(--border) my-2" />);
      i++;
      continue;
    }

    if (/^\|/.test(line)) {
      const tableLines: string[] = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      const rows = tableLines.filter((l) => !/^\|[\s|:-]+\|$/.test(l.trim()));
      const [headerRow, ...bodyRows] = rows;
      const parseRow = (row: string) =>
        row.split("|").map((c) => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      const headers = parseRow(headerRow);
      elements.push(
        <div key={i} className="overflow-x-auto my-2">
          <table className="text-xs w-full border-collapse">
            <thead>
              <tr>
                {headers.map((h, j) => (
                  <th key={j} className="border border-(--border) px-2 py-1 text-left font-semibold bg-black/30 whitespace-nowrap">
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri} className="even:bg-black/20">
                  {parseRow(row).map((cell, ci) => (
                    <td key={ci} className="border border-(--border) px-2 py-1 font-mono">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(lines[i].replace(/^[-*] /, ""));
        i++;
      }
      elements.push(
        <ul key={i} className="list-disc list-inside space-y-0.5 my-1 pl-2">
          {items.map((item, j) => <li key={j} className="text-sm">{renderInline(item)}</li>)}
        </ul>
      );
      continue;
    }

    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ""));
        i++;
      }
      elements.push(
        <ol key={i} className="list-decimal list-inside space-y-0.5 my-1 pl-2">
          {items.map((item, j) => <li key={j} className="text-sm">{renderInline(item)}</li>)}
        </ol>
      );
      continue;
    }

    if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
      i++;
      continue;
    }

    elements.push(<p key={i} className="text-sm leading-relaxed">{renderInline(line)}</p>);
    i++;
  }

  return <div className="space-y-0.5">{elements}</div>;
}

function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(part)) return <em key={i} className="italic">{part.slice(1, -1)}</em>;
    if (/^`[^`]+`$/.test(part)) return <code key={i} className="bg-black/40 text-green-300 px-1 py-0.5 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
    return part;
  });
}
