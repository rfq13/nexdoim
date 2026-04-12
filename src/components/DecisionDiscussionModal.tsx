"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";

interface PendingDecision {
  id: number;
  created_at: string;
  expires_at: string;
  status: string;
  action: "deploy" | "close";
  pool_address: string | null;
  pool_name: string | null;
  args: Record<string, any>;
  reason: string | null;
  risks: string[] | null;
  resolved_at: string | null;
  resolved_by: string | null;
  result: any;
  error: string | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  decisionId: number;
  onClose: () => void;
  onResolved: () => void;
}

const SUGGESTED_PROMPTS = [
  "Verifikasi smart wallets di pool ini",
  "Cek top holders token base-nya",
  "Bandingkan dengan pool alternatif mcap serupa",
  "Apa narrative terkini token ini?",
  "Apakah ada rival pool dengan TVL lebih tinggi?",
];

export function DecisionDiscussionModal({ decisionId, onClose, onResolved }: Props) {
  const [decision, setDecision] = useState<PendingDecision | null>(null);
  const [loadingDecision, setLoadingDecision] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [acting, setActing] = useState<"approve" | "reject" | null>(null);
  const [contextOpen, setContextOpen] = useState(true);
  const [, setTick] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Fetch decision detail ─────────────────────────────────────
  const loadDecision = useCallback(async () => {
    try {
      const res = await fetch(`/api/pending-decisions/${decisionId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDecision(data.decision);
    } catch {
      setDecision(null);
    } finally {
      setLoadingDecision(false);
    }
  }, [decisionId]);

  useEffect(() => { loadDecision(); }, [loadDecision]);

  // Poll decision status while acting
  useEffect(() => {
    if (!acting) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/pending-decisions/${decisionId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        setDecision(data.decision);
        if (data.decision?.status && data.decision.status !== "pending" && data.decision.status !== "approved") {
          setActing(null);
          clearInterval(interval);
          setTimeout(() => onResolved(), 800);
        }
      } catch { /* keep polling */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [acting, decisionId, onResolved]);

  // Countdown ticker
  useEffect(() => {
    const tick = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !sending && !acting) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, sending, acting]);

  // Auto-scroll on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  // Focus input when decision is loaded
  useEffect(() => {
    if (decision && !loadingDecision) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [decision, loadingDecision]);

  // ── Send message ──────────────────────────────────────────────
  const send = async (prefill?: string) => {
    const text = (prefill ?? input).trim();
    if (!text || sending) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setSending(true);

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          role: "GENERAL",
          conversation_id: conversationId,
          pending_decision_id: conversationId ? null : decisionId,
        }),
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const data = JSON.parse(part.slice(6));
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: data.content || data.error || "No response" },
          ]);
          if (data.conversation_id && !conversationId) {
            setConversationId(data.conversation_id);
          }
        }
      }
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${e.message || "request failed"}` }]);
    } finally {
      setSending(false);
      // Refresh decision in case agent modified config or anything else
      loadDecision();
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  // ── Approve / Reject ──────────────────────────────────────────
  const approve = async () => {
    if (acting || !decision) return;
    setActing("approve");
    try {
      const res = await fetch(`/api/pending-decisions/${decisionId}/approve`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e: any) {
      alert(`Approve gagal: ${e.message}`);
      setActing(null);
    }
  };

  const reject = async () => {
    if (acting || !decision) return;
    const reason = window.prompt("Alasan reject (opsional):") ?? undefined;
    setActing("reject");
    try {
      const res = await fetch(`/api/pending-decisions/${decisionId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTimeout(() => onResolved(), 500);
    } catch (e: any) {
      alert(`Reject gagal: ${e.message}`);
      setActing(null);
    }
  };

  const statusColor = decision?.status === "pending"
    ? "bg-yellow-500/15 text-yellow-300 border-yellow-500/40"
    : decision?.status === "approved"
      ? "bg-blue-500/15 text-blue-300 border-blue-500/40"
      : decision?.status === "executed"
        ? "bg-green-500/15 text-green-300 border-green-500/40"
        : decision?.status === "rejected"
          ? "bg-red-500/10 text-red-300 border-red-500/30"
          : decision?.status === "failed"
            ? "bg-red-500/15 text-red-300 border-red-500/40"
            : "bg-white/5 text-(--muted) border-(--border)";

  const args = decision?.args ?? {};

  const remainingMs = decision ? new Date(decision.expires_at).getTime() - Date.now() : 0;
  const remainingLabel = remainingMs > 0
    ? `${Math.floor(remainingMs / 60000)}m ${Math.floor((remainingMs % 60000) / 1000)}s`
    : "expired";

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-stretch sm:items-center justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-(--bg) border-0 sm:border border-(--border) sm:rounded-2xl w-full sm:max-w-4xl h-full sm:max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ───────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3 px-4 sm:px-5 py-3 border-b border-(--border) bg-(--card)/60 backdrop-blur">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold bg-(--accent)/15 text-(--accent)">
                DISKUSI
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold border ${statusColor}`}>
                {decision?.status?.toUpperCase() ?? "..."}
              </span>
              <span className="text-[10px] text-(--muted) font-mono">#{decisionId}</span>
              {decision?.status === "pending" && (
                <span className="text-[10px] text-yellow-400/70 font-mono">⏱ {remainingLabel}</span>
              )}
            </div>
            <h2 className="text-base sm:text-lg font-semibold mt-1 truncate">
              {decision?.action === "deploy" ? "Deploy" : "Close"}{" "}
              <span className="text-(--accent)">{decision?.pool_name ?? decision?.pool_address?.slice(0, 12) ?? "Loading..."}</span>
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={sending || !!acting}
            className="text-(--muted) hover:text-(--text) disabled:opacity-40 transition-colors p-1.5 rounded-lg hover:bg-white/5 flex-shrink-0"
            title="Tutup (Esc)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Decision context card (collapsible) ─────────────── */}
        <div className="border-b border-(--border) bg-(--card)/30">
          <button
            onClick={() => setContextOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 sm:px-5 py-2 text-xs text-(--muted) hover:text-(--text) transition-colors"
          >
            <span className="font-semibold uppercase tracking-wider">Konteks Keputusan</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${contextOpen ? "rotate-180" : ""}`}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {contextOpen && decision && (
            <div className="px-4 sm:px-5 pb-3 space-y-2.5">
              {decision.action === "deploy" && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <ContextField label="Amount" value={`${args.amount_y ?? "?"} SOL`} />
                  <ContextField label="Strategy" value={args.strategy ?? "bid_ask"} />
                  <ContextField label="Bins" value={`${args.bins_below ?? "?"}↓ / ${args.bins_above ?? "?"}↑`} />
                  <ContextField label="Value" value={args.initial_value_usd ? `$${Math.round(args.initial_value_usd)}` : "—"} />
                  {args.bin_step != null && <ContextField label="Bin Step" value={String(args.bin_step)} />}
                  {args.volatility != null && <ContextField label="Volatility" value={Number(args.volatility).toFixed(2)} />}
                  {args.fee_tvl_ratio != null && <ContextField label="fee/TVL" value={`${(args.fee_tvl_ratio * 100).toFixed(2)}%`} />}
                  {args.organic_score != null && <ContextField label="Organic" value={Number(args.organic_score).toFixed(0)} />}
                </div>
              )}
              {decision.pool_address && (
                <div className="text-[10px] text-(--muted) font-mono break-all">{decision.pool_address}</div>
              )}
              {decision.reason && (
                <div className="text-xs">
                  <span className="text-(--muted)">Alasan agent:</span>{" "}
                  <span className="text-(--text)">{decision.reason}</span>
                </div>
              )}
              {decision.risks && decision.risks.length > 0 && (
                <div className="text-xs">
                  <div className="text-(--muted) mb-1">Risks:</div>
                  <ul className="list-disc list-inside space-y-0.5 text-red-300/90 pl-1">
                    {decision.risks.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
              {(decision.status === "failed" || decision.status === "rejected") && decision.error && (
                <div className="text-xs text-red-300 border border-red-500/30 bg-red-500/5 rounded-md px-2.5 py-1.5 font-mono">
                  {decision.error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Messages area ────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4">
          {/* Initial info banner */}
          <div className="flex gap-3 items-start">
            <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold bg-(--accent)/15 text-(--accent) border border-(--accent)/30">
              ◈
            </div>
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-3 bg-(--accent)/5 border border-(--accent)/20 text-sm text-(--text)">
              Konteks keputusan ini sudah saya baca. Saya bisa bantu verifikasi data — cek pool alternatif, holder, smart wallets, narrative, bahkan ubah config kalau kamu setuju. Mau mulai dari mana?
            </div>
          </div>

          {messages.length === 0 && !sending && (
            <div className="pt-2">
              <div className="text-[10px] text-(--muted) uppercase tracking-wider mb-2 pl-10">Saran pertanyaan</div>
              <div className="flex flex-wrap gap-1.5 pl-10">
                {SUGGESTED_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => send(p)}
                    disabled={sending}
                    className="text-xs border border-(--border) rounded-full px-3 py-1.5 hover:border-(--accent) hover:text-(--accent) transition-colors disabled:opacity-40"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex gap-3 items-start ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold ${
                m.role === "user"
                  ? "bg-(--accent)/20 text-(--accent)"
                  : "bg-(--card) border border-(--border) text-(--muted)"
              }`}>
                {m.role === "user" ? "U" : "◈"}
              </div>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                m.role === "user"
                  ? "bg-(--accent)/15 rounded-tr-sm text-(--text)"
                  : "bg-(--card) border border-(--border) rounded-tl-sm text-(--text)"
              }`}>
                {m.role === "user"
                  ? <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                  : <Markdown text={m.content} />
                }
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex gap-3 items-start">
              <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold bg-(--card) border border-(--border) text-(--muted)">
                ◈
              </div>
              <div className="bg-(--card) border border-(--border) rounded-2xl rounded-tl-sm px-4 py-3">
                <div className="flex gap-1 items-center h-5">
                  <span className="w-1.5 h-1.5 bg-(--muted) rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 bg-(--muted) rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 bg-(--muted) rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* ── Input area ───────────────────────────────────────── */}
        <div className="border-t border-(--border) px-4 sm:px-5 py-3 bg-(--card)/40 space-y-3">
          <div className="flex gap-2 items-end bg-(--card) border border-(--border) rounded-2xl px-4 py-3 focus-within:border-(--accent) transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onKeyDown={handleKey}
              placeholder="Tanya, verifikasi, atau minta ubah config..."
              rows={1}
              disabled={sending || !!acting}
              className="flex-1 bg-transparent text-sm resize-none outline-none placeholder:text-(--muted) max-h-[120px] disabled:opacity-50"
              style={{ height: "24px" }}
            />
            <button
              onClick={() => send()}
              disabled={sending || !!acting || !input.trim()}
              className="w-8 h-8 flex-shrink-0 rounded-full bg-(--accent) flex items-center justify-center disabled:opacity-30 transition-opacity hover:opacity-80"
              title="Kirim (Enter)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                <path d="M2 21l21-9L2 3v7l15 2-15 2z" />
              </svg>
            </button>
          </div>

          {/* Approve / Reject footer — sticky at bottom */}
          {decision?.status === "pending" && (
            <div className="flex gap-2 flex-wrap items-center">
              <div className="text-[10px] text-(--muted) flex-1 min-w-0">
                Setelah yakin, konfirmasi keputusan ini:
              </div>
              <button
                onClick={approve}
                disabled={sending || !!acting}
                className="flex-1 sm:flex-initial px-4 py-2 rounded-lg text-sm font-semibold bg-green-500/15 text-green-300 border border-green-500/40 hover:bg-green-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
              >
                {acting === "approve" ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    Executing...
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    Approve & Execute
                  </>
                )}
              </button>
              <button
                onClick={reject}
                disabled={sending || !!acting}
                className="flex-1 sm:flex-initial px-4 py-2 rounded-lg text-sm font-semibold bg-red-500/10 text-red-300 border border-red-500/30 hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
                Reject
              </button>
            </div>
          )}

          {decision?.status && decision.status !== "pending" && (
            <div className={`text-xs px-3 py-2 rounded-lg border ${statusColor}`}>
              Keputusan ini sudah <strong className="uppercase">{decision.status}</strong>
              {decision.resolved_by ? ` via ${decision.resolved_by}` : ""}. Modal akan tertutup otomatis...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ContextField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-(--muted) text-[10px] uppercase tracking-wider mb-0.5">{label}</div>
      <div className="font-mono text-(--text)">{value}</div>
    </div>
  );
}
