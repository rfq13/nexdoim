"use client";
import { useEffect, useRef, useState } from "react";

type AgentRole = "GENERAL" | "MANAGER" | "SCREENER";

// Simple markdown renderer — no external deps needed
function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={i} className="bg-black/40 border border-[var(--border)] rounded-lg p-3 my-2 overflow-x-auto text-xs font-mono text-green-300">
          {lang && <div className="text-[var(--muted)] text-xs mb-1">{lang}</div>}
          {codeLines.join("\n")}
        </pre>
      );
      i++;
      continue;
    }

    // Heading
    if (/^#{1,3} /.test(line)) {
      const level = line.match(/^(#+)/)?.[1].length ?? 1;
      const content = line.replace(/^#+\s/, "");
      const cls = level === 1 ? "text-lg font-bold mt-3 mb-1" : level === 2 ? "font-semibold mt-2 mb-1" : "font-medium mt-1";
      elements.push(<div key={i} className={cls}>{renderInline(content)}</div>);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={i} className="border-[var(--border)] my-2" />);
      i++;
      continue;
    }

    // Table
    if (/^\|/.test(line)) {
      const tableLines: string[] = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      // Filter out separator rows (---|---)
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
                  <th key={j} className="border border-[var(--border)] px-2 py-1 text-left font-semibold bg-black/30 whitespace-nowrap">
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri} className="even:bg-black/20">
                  {parseRow(row).map((cell, ci) => (
                    <td key={ci} className="border border-[var(--border)] px-2 py-1 font-mono">
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

    // Bullet list
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

    // Numbered list
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

    // Empty line
    if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
      i++;
      continue;
    }

    // Normal paragraph
    elements.push(<p key={i} className="text-sm leading-relaxed">{renderInline(line)}</p>);
    i++;
  }

  return <div className="space-y-0.5">{elements}</div>;
}

function renderInline(text: string): React.ReactNode {
  // Split on bold (**), italic (*), inline code (`)
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(part)) return <em key={i} className="italic">{part.slice(1, -1)}</em>;
    if (/^`[^`]+`$/.test(part)) return <code key={i} className="bg-black/40 text-green-300 px-1 py-0.5 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
    return part;
  });
}

const ROLE_COLORS: Record<AgentRole, string> = {
  GENERAL: "text-purple-400 bg-purple-900/20",
  MANAGER: "text-blue-400 bg-blue-900/20",
  SCREENER: "text-green-400 bg-green-900/20",
};

const ROLE_DESCRIPTIONS: Record<AgentRole, string> = {
  GENERAL: "Akses semua tools",
  MANAGER: "Kelola posisi terbuka",
  SCREENER: "Cari pool untuk deploy",
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState<AgentRole>("GENERAL");
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((data) => {
        const list: string[] = Array.isArray(data?.models) ? data.models : [];
        setModels(list);
        setSelectedModel(data?.active?.generalModel || data?.defaultModel || list[0] || "");
      })
      .catch(() => setModels([]));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg, role, model: selectedModel || null }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.content || data.error || "No response" }]);
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[var(--border)] mb-3">
        <h1 className="text-xl font-bold">Agent Chat</h1>
        <div className="flex items-center gap-2">
          {/* Role selector */}
          <div className="flex gap-1">
            {(["GENERAL", "MANAGER", "SCREENER"] as AgentRole[]).map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={`text-xs px-2.5 py-1 rounded-full font-medium transition-all ${role === r ? ROLE_COLORS[r] + " ring-1 ring-current" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
                title={ROLE_DESCRIPTIONS[r]}
              >
                {r}
              </button>
            ))}
          </div>
          {/* Model selector */}
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="bg-[var(--card)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs max-w-[180px]"
          >
            {models.length === 0 && <option value="">No model</option>}
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--muted)]">
            <div className="text-4xl">◈</div>
            <div className="text-sm">Tanya apapun tentang posisi, pool, atau strategi</div>
            <div className="flex gap-2 flex-wrap justify-center">
              {["Tampilkan 5 pool terbaik", "Cek kesehatan posisi saya", "Apa pelajaran dari posisi terakhir?"].map((s) => (
                <button key={s} onClick={() => { setInput(s); inputRef.current?.focus(); }}
                  className="text-xs border border-[var(--border)] rounded-full px-3 py-1.5 hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            {/* Avatar */}
            <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold mt-0.5 ${
              m.role === "user" ? "bg-[var(--accent)]/20 text-[var(--accent)]" : "bg-[var(--card)] border border-[var(--border)] text-[var(--muted)]"
            }`}>
              {m.role === "user" ? "U" : "◈"}
            </div>

            {/* Bubble */}
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
              m.role === "user"
                ? "bg-[var(--accent)]/15 rounded-tr-sm"
                : "bg-[var(--card)] border border-[var(--border)] rounded-tl-sm"
            }`}>
              {m.role === "user"
                ? <p className="text-sm">{m.content}</p>
                : <Markdown text={m.content} />
              }
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold bg-[var(--card)] border border-[var(--border)] text-[var(--muted)]">◈</div>
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1 items-center h-5">
                <span className="w-1.5 h-1.5 bg-[var(--muted)] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 bg-[var(--muted)] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 bg-[var(--muted)] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="pt-3 border-t border-[var(--border)] mt-3">
        <div className="flex gap-2 items-end bg-[var(--card)] border border-[var(--border)] rounded-2xl px-4 py-3 focus-within:border-[var(--accent)] transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }}
            onKeyDown={handleKey}
            placeholder="Tanya agent... (Enter kirim, Shift+Enter baris baru)"
            rows={1}
            className="flex-1 bg-transparent text-sm resize-none outline-none placeholder:text-[var(--muted)] max-h-[120px]"
            style={{ height: "24px" }}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="w-8 h-8 flex-shrink-0 rounded-full bg-[var(--accent)] flex items-center justify-center disabled:opacity-30 transition-opacity hover:opacity-80"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
              <path d="M2 21l21-9L2 3v7l15 2-15 2z" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-[var(--muted)] mt-1.5 pl-1">
          Role: <span className={`font-medium ${ROLE_COLORS[role].split(" ")[0]}`}>{role}</span>
          <span className="mx-1.5">·</span>{ROLE_DESCRIPTIONS[role]}
        </p>
      </div>
    </div>
  );
}
