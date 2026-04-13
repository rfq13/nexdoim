"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Markdown } from "@/components/Markdown";

export type AgentRole = "GENERAL" | "MANAGER" | "SCREENER";

export interface Message {
  role: string;
  content: string;
}

export interface Conversation {
  id: string;
  title: string | null;
  role: string;
  model: string | null;
  created_at: string;
  updated_at: string;
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

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "baru saja";
  if (mins < 60) return `${mins}m lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}j lalu`;
  return `${Math.floor(hrs / 24)}h lalu`;
}

interface DecisionBanner {
  id: number;
  action: "deploy" | "close";
  pool_name: string | null;
  pool_address: string | null;
  status: string;
}

interface DecisionJsonPayload {
  action: "DEPLOY" | "SKIP";
  pool_address?: string;
  pool_name?: string;
  bins_below?: number;
  bins_above?: number;
  strategy?: string;
  reason?: string;
  risks?: string[];
  amount_y?: number;
  bin_step?: number;
  volatility?: number;
}

type ToastTone = "success" | "error" | "info";

interface RejectDialogTarget {
  type: "banner" | "pending";
  pendingId?: number;
}

function parseDecisionJsonFromText(text: string): DecisionJsonPayload | null {
  if (!text) return null;
  const markerIdx = text.lastIndexOf("DECISION_JSON:");
  if (markerIdx === -1) return null;
  const tail = text.slice(markerIdx + "DECISION_JSON:".length);
  const braceIdx = tail.indexOf("{");
  if (braceIdx === -1) return null;

  let depth = 0;
  let end = -1;
  let inString = false;
  let escape = false;
  for (let i = braceIdx; i < tail.length; i++) {
    const c = tail[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;

  try {
    const parsed = JSON.parse(tail.slice(braceIdx, end + 1));
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.action !== "DEPLOY" && parsed.action !== "SKIP") return null;
    return parsed as DecisionJsonPayload;
  } catch {
    return null;
  }
}

export function ChatInner({
  initialMessage,
  initialRole,
  onClose,
}: {
  initialMessage?: string;
  initialRole?: AgentRole;
  onClose?: () => void;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const decisionIdParam = searchParams.get("decisionId");
  const pendingDecisionId = decisionIdParam ? Number(decisionIdParam) : null;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState(initialMessage || "");
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [role, setRole] = useState<AgentRole>(initialRole || "GENERAL");
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [decisionBanner, setDecisionBanner] = useState<DecisionBanner | null>(
    null,
  );
  const [actingOnDecision, setActingOnDecision] = useState<
    "approve" | "reject" | null
  >(null);
  const [creatingFromMsg, setCreatingFromMsg] = useState<number | null>(null);
  const [createdPendingByMsg, setCreatedPendingByMsg] = useState<
    Record<number, number>
  >({});
  const [actingPendingId, setActingPendingId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ tone: ToastTone; text: string } | null>(
    null,
  );
  const [rejectDialog, setRejectDialog] = useState<RejectDialogTarget | null>(
    null,
  );
  const [rejectReasonInput, setRejectReasonInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasSentInitialMsg = useRef(false);

  const showToast = useCallback((tone: ToastTone, text: string) => {
    setToast({ tone, text });
    window.setTimeout(() => setToast(null), 2400);
  }, []);

  // Load decision context when ?decisionId= is present
  useEffect(() => {
    if (!pendingDecisionId) {
      setDecisionBanner(null);
      return;
    }
    fetch(`/api/pending-decisions/${pendingDecisionId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.decision) {
          setDecisionBanner({
            id: data.decision.id,
            action: data.decision.action,
            pool_name: data.decision.pool_name,
            pool_address: data.decision.pool_address,
            status: data.decision.status,
          });
        }
      })
      .catch(() => setDecisionBanner(null));
  }, [pendingDecisionId]);

  const approveFromChat = async () => {
    if (!decisionBanner || actingOnDecision) return;
    setActingOnDecision("approve");
    try {
      const res = await fetch(
        `/api/pending-decisions/${decisionBanner.id}/approve`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast("success", `Pending #${decisionBanner.id} di-approve.`);
      // Bounce back to dashboard to see execution result
      setTimeout(() => router.push("/"), 800);
    } catch (e: any) {
      showToast("error", `Approve gagal: ${e.message}`);
      setActingOnDecision(null);
    }
  };

  const rejectFromChat = async (reason?: string) => {
    if (!decisionBanner || actingOnDecision) return;
    setActingOnDecision("reject");
    try {
      const res = await fetch(
        `/api/pending-decisions/${decisionBanner.id}/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast("success", `Pending #${decisionBanner.id} di-reject.`);
      setTimeout(() => router.push("/"), 500);
    } catch (e: any) {
      showToast("error", `Reject gagal: ${e.message}`);
      setActingOnDecision(null);
    }
  };

  const createPendingFromDecision = async (
    msgIndex: number,
    decision: DecisionJsonPayload,
  ) => {
    if (creatingFromMsg !== null || createdPendingByMsg[msgIndex]) return;
    setCreatingFromMsg(msgIndex);
    try {
      const res = await fetch("/api/pending-decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (!data?.pending_id) throw new Error("pending_id missing");
      setCreatedPendingByMsg((prev) => ({
        ...prev,
        [msgIndex]: data.pending_id,
      }));
      loadConversations();
      showToast("success", `Pending #${data.pending_id} berhasil dibuat.`);
    } catch (e: any) {
      showToast("error", `Gagal membuat pending: ${e.message}`);
    } finally {
      setCreatingFromMsg(null);
    }
  };

  const approvePendingById = async (id: number) => {
    if (actingPendingId) return;
    setActingPendingId(id);
    try {
      const res = await fetch(`/api/pending-decisions/${id}/approve`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast("success", `Pending #${id} di-approve dan dieksekusi.`);
    } catch (e: any) {
      showToast("error", `Approve gagal: ${e.message}`);
    } finally {
      setActingPendingId(null);
    }
  };

  const rejectPendingById = async (id: number, reason?: string) => {
    if (actingPendingId) return;
    setActingPendingId(id);
    try {
      const res = await fetch(`/api/pending-decisions/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast("success", `Pending #${id} di-reject.`);
    } catch (e: any) {
      showToast("error", `Reject gagal: ${e.message}`);
    } finally {
      setActingPendingId(null);
    }
  };

  const openRejectDialog = (target: RejectDialogTarget) => {
    setRejectReasonInput("");
    setRejectDialog(target);
  };

  const submitRejectDialog = async () => {
    if (!rejectDialog) return;
    const reason = rejectReasonInput.trim() || undefined;
    const target = rejectDialog;
    setRejectDialog(null);
    if (target.type === "banner") {
      await rejectFromChat(reason);
      return;
    }
    if (typeof target.pendingId === "number") {
      await rejectPendingById(target.pendingId, reason);
    }
  };

  // Load models
  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((data) => {
        const list: string[] = Array.isArray(data?.models) ? data.models : [];
        setModels(list);
        setSelectedModel(
          data?.active?.generalModel || data?.defaultModel || list[0] || "",
        );
      })
      .catch(() => setModels([]));
  }, []);

  // Load conversation list
  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/agent/conversations").catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setConversations(data.conversations ?? []);
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Load messages when switching conversations
  useEffect(() => {
    if (!activeConvId) return;
    setLoadingHistory(true);
    fetch(`/api/agent/conversations/${activeConvId}`)
      .then((r) => r.json())
      .then((data) => {
        setMessages(data.messages ?? []);
        // Sync role/model from conversation
        if (data.conversation) {
          setRole((data.conversation.role as AgentRole) || "GENERAL");
          if (data.conversation.model)
            setSelectedModel(data.conversation.model);
        }
      })
      .catch(() => setMessages([]))
      .finally(() => setLoadingHistory(false));
  }, [activeConvId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const startNewChat = () => {
    setActiveConvId(null);
    setMessages([]);
    setInput("");
  };

  const selectConversation = (id: string) => {
    if (id === activeConvId) return;
    setActiveConvId(id);
    setMessages([]);
  };

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(id);
    await fetch(`/api/agent/conversations/${id}`, { method: "DELETE" }).catch(
      () => {},
    );
    setDeletingId(null);
    if (activeConvId === id) startNewChat();
    setConversations((prev) => prev.filter((c) => c.id !== id));
  };

  const sendMsg = async (textToSubmit: string) => {
    if (!textToSubmit.trim() || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: textToSubmit }]);
    setLoading(true);

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: textToSubmit,
          role,
          model: selectedModel || null,
          conversation_id: activeConvId,
          // Only send on the FIRST message of a discussion — after the conversation
          // exists, session history already includes the injected decision context.
          pending_decision_id:
            activeConvId || !pendingDecisionId ? null : pendingDecisionId,
        }),
      });

      const reader = res.body!.getReader();
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
            {
              role: "assistant",
              content: data.content || data.error || "No response",
            },
          ]);

          // Set conversation id from response (for new conversations)
          if (data.conversation_id && !activeConvId) {
            setActiveConvId(data.conversation_id);
          }
        }
      }

      // Refresh sidebar list after each message
      loadConversations();
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${e.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const send = () => sendMsg(input);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMsg(input);
    }
  };

  useEffect(() => {
    if (initialMessage && !hasSentInitialMsg.current) {
      hasSentInitialMsg.current = true;
      setInput(initialMessage);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.style.height = "auto";
          inputRef.current.style.height =
            Math.min(inputRef.current.scrollHeight, 120) + "px";
        }
      }, 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage]);

  return (
    <div className="flex h-full min-h-125 gap-0 relative">
      {/* ── Sidebar overlay (mobile) ──────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <div
        className={`
        flex flex-col border-r border-(--border) bg-(--bg) transition-all duration-200
        ${
          sidebarOpen
            ? "fixed inset-y-0 left-0 w-64 z-40 pt-12 md:relative md:pt-0 md:w-56 md:z-auto"
            : "w-0 overflow-hidden"
        }
      `}
      >
        <div className="flex items-center justify-between px-3 pt-3 pb-2 shrink-0">
          <span className="text-xs font-semibold text-(--muted) uppercase tracking-wider">
            Percakapan
          </span>
          <div className="flex gap-1">
            <button
              onClick={startNewChat}
              className="text-(--muted) hover:text-(--accent) transition-colors p-1 rounded"
              title="Chat baru"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <button
              onClick={() => setSidebarOpen(false)}
              className="text-(--muted) hover:text-(--text) transition-colors p-1 rounded md:hidden"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {conversations.length === 0 && (
            <div className="text-xs text-(--muted) px-2 py-4 text-center">
              Belum ada percakapan
            </div>
          )}
          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => {
                selectConversation(conv.id);
                setSidebarOpen(false);
              }}
              className={`group flex items-start gap-1.5 px-2 py-2 rounded-lg cursor-pointer transition-colors text-xs ${
                activeConvId === conv.id
                  ? "bg-(--accent)/15 text-(--text)"
                  : "hover:bg-(--card) text-(--muted) hover:text-(--text)"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium leading-snug">
                  {conv.title || "Chat tanpa judul"}
                </div>
                <div className="text-[10px] text-(--muted) mt-0.5">
                  {formatRelativeTime(conv.updated_at)}
                </div>
              </div>
              <button
                onClick={(e) => deleteConversation(conv.id, e)}
                disabled={deletingId === conv.id}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-(--muted) hover:text-red-400 shrink-0 mt-0.5"
                title="Hapus"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Chat Area ────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 max-w-4xl mx-auto px-3 sm:px-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 sm:pb-3 border-b border-(--border) mb-2 sm:mb-3 pt-0.5 gap-2">
          <div className="flex items-center gap-2 shrink-0">
            {onClose && (
              <button
                onClick={onClose}
                className="text-(--muted) hover:text-(--text) transition-colors p-1 rounded"
                title="Kembali"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
            )}
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="text-(--muted) hover:text-(--text) transition-colors p-1 rounded md:hidden"
              title="Toggle sidebar"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M3 12h18M3 6h18M3 18h18" />
              </svg>
            </button>
            <h1 className="text-base sm:text-xl font-bold">Chat</h1>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {/* Role selector — compact on mobile */}
            <div className="flex gap-0.5 sm:gap-1">
              {(["GENERAL", "MANAGER", "SCREENER"] as AgentRole[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={`text-[10px] sm:text-xs px-1.5 sm:px-2.5 py-1 rounded-full font-medium transition-all whitespace-nowrap ${
                    role === r
                      ? ROLE_COLORS[r] + " ring-1 ring-current"
                      : "text-(--muted) hover:text-(--text)"
                  }`}
                  title={ROLE_DESCRIPTIONS[r]}
                >
                  {r}
                </button>
              ))}
            </div>
            {/* Model selector — hidden on very small screens */}
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="hidden sm:block bg-(--card) border border-(--border) rounded-lg px-2 py-1 text-xs max-w-40"
            >
              {models.length === 0 && <option value="">No model</option>}
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Decision discussion banner */}
        {decisionBanner && (
          <div className="bg-yellow-500/10 border border-yellow-500/40 rounded-xl p-3 mb-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold bg-yellow-500/20 text-yellow-300">
                    DISKUSI #{decisionBanner.id}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-medium bg-white/5 text-(--muted)">
                    {decisionBanner.status.toUpperCase()}
                  </span>
                  <span className="text-sm font-semibold text-yellow-200">
                    {decisionBanner.action.toUpperCase()}{" "}
                    {decisionBanner.pool_name ??
                      decisionBanner.pool_address?.slice(0, 12)}
                  </span>
                </div>
                <p className="text-[11px] text-(--muted) mt-1">
                  Diskusikan dan verifikasi keputusan ini sebelum
                  approve/reject. Agent bisa search pool, cek holders, ubah
                  config via <code className="font-mono">update_config</code>.
                </p>
              </div>
              {decisionBanner.status === "pending" && (
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={approveFromChat}
                    disabled={!!actingOnDecision}
                    className="text-xs px-2.5 py-1 rounded-md bg-green-500/15 text-green-300 border border-green-500/40 hover:bg-green-500/25 disabled:opacity-40 transition-colors"
                  >
                    {actingOnDecision === "approve" ? "..." : "Approve"}
                  </button>
                  <button
                    onClick={() => openRejectDialog({ type: "banner" })}
                    disabled={!!actingOnDecision}
                    className="text-xs px-2.5 py-1 rounded-md bg-red-500/10 text-red-300 border border-red-500/30 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {loadingHistory && (
            <div className="flex justify-center py-8 text-(--muted) text-sm">
              Memuat riwayat...
            </div>
          )}

          {!loadingHistory && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-(--muted)">
              <div className="text-4xl">◈</div>
              <div className="text-sm">
                Tanya apapun tentang posisi, pool, atau strategi
              </div>
              <div className="flex gap-2 flex-wrap justify-center">
                {[
                  "Tampilkan 5 pool terbaik",
                  "Cek kesehatan posisi saya",
                  "Apa pelajaran dari posisi terakhir?",
                ].map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setInput(s);
                      inputRef.current?.focus();
                    }}
                    className="text-xs border border-(--border) rounded-full px-3 py-1.5 hover:border-(--accent) hover:text-(--accent) transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!loadingHistory &&
            messages.map((m, i) => (
              <div
                key={i}
                className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}
              >
                <div
                  className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold mt-0.5 ${
                    m.role === "user"
                      ? "bg-(--accent)/20 text-(--accent)"
                      : "bg-(--card) border border-(--border) text-(--muted)"
                  }`}
                >
                  {m.role === "user" ? "U" : "◈"}
                </div>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    m.role === "user"
                      ? "bg-(--accent)/15 rounded-tr-sm"
                      : "bg-(--card) border border-(--border) rounded-tl-sm"
                  }`}
                >
                  {m.role === "user" ? (
                    <p className="text-sm">{m.content}</p>
                  ) : (
                    <Markdown text={m.content} />
                  )}
                  {m.role !== "user" &&
                    (() => {
                      const decision = parseDecisionJsonFromText(m.content);
                      if (!decision) return null;

                      const pendingId = createdPendingByMsg[i] ?? null;
                      return (
                        <div className="mt-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="px-2 py-0.5 rounded-full font-mono bg-yellow-500/20 text-yellow-300">
                              DECISION_JSON
                            </span>
                            <span className="px-2 py-0.5 rounded-full font-mono bg-white/5 text-(--muted)">
                              {decision.action}
                            </span>
                            {decision.pool_name && (
                              <span className="font-semibold text-(--text)">
                                {decision.pool_name}
                              </span>
                            )}
                          </div>

                          {decision.reason && (
                            <div className="mt-1 text-(--muted)">
                              {decision.reason}
                            </div>
                          )}

                          {decision.action === "DEPLOY" && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {!pendingId ? (
                                <button
                                  onClick={() =>
                                    createPendingFromDecision(i, decision)
                                  }
                                  disabled={creatingFromMsg === i}
                                  className="text-xs px-2.5 py-1 rounded-md bg-green-500/15 text-green-300 border border-green-500/40 hover:bg-green-500/25 disabled:opacity-40 transition-colors"
                                >
                                  {creatingFromMsg === i
                                    ? "Membuat pending..."
                                    : "Buat Pending Decision"}
                                </button>
                              ) : (
                                <>
                                  <a
                                    href={`/pending?highlight=${pendingId}`}
                                    className="text-xs px-2.5 py-1 rounded-md bg-white/5 border border-(--border) hover:border-(--accent) transition-colors"
                                  >
                                    Buka Pending #{pendingId}
                                  </a>
                                  <button
                                    onClick={() =>
                                      approvePendingById(pendingId)
                                    }
                                    disabled={actingPendingId === pendingId}
                                    className="text-xs px-2.5 py-1 rounded-md bg-green-500/15 text-green-300 border border-green-500/40 hover:bg-green-500/25 disabled:opacity-40 transition-colors"
                                  >
                                    {actingPendingId === pendingId
                                      ? "..."
                                      : "Approve"}
                                  </button>
                                  <button
                                    onClick={() =>
                                      openRejectDialog({
                                        type: "pending",
                                        pendingId,
                                      })
                                    }
                                    disabled={actingPendingId === pendingId}
                                    className="text-xs px-2.5 py-1 rounded-md bg-red-500/10 text-red-300 border border-red-500/30 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
                                  >
                                    Reject
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                </div>
              </div>
            ))}

          {loading && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold bg-(--card) border border-(--border) text-(--muted)">
                ◈
              </div>
              <div className="bg-(--card) border border-(--border) rounded-2xl rounded-tl-sm px-4 py-3">
                <div className="flex gap-1 items-center h-5">
                  <span
                    className="w-1.5 h-1.5 bg-(--muted) rounded-full animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-(--muted) rounded-full animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-(--muted) rounded-full animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="pt-3 border-t border-(--border) mt-3">
          <div className="flex gap-2 items-end bg-(--card) border border-(--border) rounded-2xl px-4 py-3 focus-within:border-(--accent) transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height =
                  Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onKeyDown={handleKey}
              placeholder="Tanya agent... (Enter kirim, Shift+Enter baris baru)"
              rows={1}
              className="flex-1 bg-transparent text-sm resize-none outline-none placeholder:text-(--muted) max-h-30"
              style={{ height: "24px" }}
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              className="w-8 h-8 shrink-0 rounded-full bg-(--accent) flex items-center justify-center disabled:opacity-30 transition-opacity hover:opacity-80"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                <path d="M2 21l21-9L2 3v7l15 2-15 2z" />
              </svg>
            </button>
          </div>
          <p className="text-xs text-(--muted) mt-1.5 pl-1">
            Role:{" "}
            <span className={`font-medium ${ROLE_COLORS[role].split(" ")[0]}`}>
              {role}
            </span>
            <span className="mx-1.5">·</span>
            {ROLE_DESCRIPTIONS[role]}
            {activeConvId && (
              <span className="mx-1.5 text-(--muted)/50">
                · Percakapan tersimpan
              </span>
            )}
          </p>
        </div>
      </div>

      {toast && (
        <div className="fixed right-4 bottom-4 z-50">
          <div
            className={`rounded-lg border px-3 py-2 text-xs shadow-lg ${
              toast.tone === "success"
                ? "bg-green-500/15 text-green-300 border-green-500/40"
                : toast.tone === "error"
                  ? "bg-red-500/15 text-red-300 border-red-500/40"
                  : "bg-(--card) text-(--text) border-(--border)"
            }`}
          >
            {toast.text}
          </div>
        </div>
      )}

      {rejectDialog && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-(--border) bg-(--bg) p-4">
            <h3 className="text-sm font-semibold">Reject Pending Decision</h3>
            <p className="mt-1 text-xs text-(--muted)">
              Isi alasan reject (opsional), lalu konfirmasi.
            </p>
            <textarea
              value={rejectReasonInput}
              onChange={(e) => setRejectReasonInput(e.target.value)}
              rows={3}
              className="mt-3 w-full rounded-lg border border-(--border) bg-(--card) px-3 py-2 text-sm outline-none focus:border-(--accent)"
              placeholder="Alasan reject (opsional)"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setRejectDialog(null)}
                className="text-xs px-2.5 py-1 rounded-md border border-(--border) hover:border-(--accent) transition-colors"
              >
                Batal
              </button>
              <button
                onClick={submitRejectDialog}
                className="text-xs px-2.5 py-1 rounded-md bg-red-500/15 text-red-300 border border-red-500/40 hover:bg-red-500/25 transition-colors"
              >
                Konfirmasi Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
