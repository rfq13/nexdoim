"use client";
import { useEffect, useState } from "react";

type AgentRole = "GENERAL" | "MANAGER" | "SCREENER";

export default function ChatPage() {
  const [messages, setMessages] = useState<
    Array<{ role: string; content: string }>
  >([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState<AgentRole>("GENERAL");
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((data) => {
        const list: string[] = Array.isArray(data?.models) ? data.models : [];
        setModels(list);
        const activeGeneral = data?.active?.generalModel;
        setSelectedModel(activeGeneral || data?.defaultModel || list[0] || "");
      })
      .catch(() => {
        setModels([]);
      });
  }, []);

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
        body: JSON.stringify({
          message: userMsg,
          role,
          model: selectedModel || null,
        }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.content || data.error || "No response",
        },
      ]);
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${e.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      <h1 className="text-2xl font-bold mb-4">Agent Chat</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
        <label className="text-sm flex flex-col gap-1">
          <span className="text-[var(--muted)]">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as AgentRole)}
            className="bg-[var(--card)] border border-[var(--border)] rounded-lg px-3 py-2"
          >
            <option value="GENERAL">GENERAL</option>
            <option value="MANAGER">MANAGER</option>
            <option value="SCREENER">SCREENER</option>
          </select>
        </label>
        <label className="text-sm flex flex-col gap-1">
          <span className="text-[var(--muted)]">Model (Ollama)</span>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="bg-[var(--card)] border border-[var(--border)] rounded-lg px-3 py-2"
          >
            {models.length === 0 && <option value="">No model detected</option>}
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 mb-4">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`p-3 rounded-lg ${m.role === "user" ? "bg-[var(--accent)]/10 ml-12" : "bg-[var(--card)] border border-[var(--border)] mr-12"}`}
          >
            <div className="text-xs text-[var(--muted)] mb-1">
              {m.role === "user" ? "You" : "Agent"}
            </div>
            <div className="text-sm whitespace-pre-wrap">{m.content}</div>
          </div>
        ))}
        {loading && (
          <div className="text-[var(--muted)] text-sm">
            Agent is thinking...
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask the agent anything..."
          className="flex-1 bg-[var(--card)] border border-[var(--border)] rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
        />
        <button
          onClick={send}
          disabled={loading}
          className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 text-sm"
        >
          Send
        </button>
      </div>
    </div>
  );
}
