"use client";
import { useCallback, useEffect, useState } from "react";
import { DecisionDiscussionModal } from "@/components/DecisionDiscussionModal";

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

type TabFilter = "pending" | "resolved" | "all";

const STATUS_STYLES: Record<string, { dot: string; bg: string; label: string }> = {
  pending:  { dot: "bg-yellow-400", bg: "border-yellow-500/30", label: "Pending" },
  approved: { dot: "bg-blue-400",   bg: "border-blue-500/30",   label: "Approved" },
  executed: { dot: "bg-green-400",  bg: "border-green-500/30",  label: "Executed" },
  rejected: { dot: "bg-red-400",    bg: "border-red-500/30",    label: "Rejected" },
  failed:   { dot: "bg-red-500",    bg: "border-red-500/40",    label: "Failed" },
  expired:  { dot: "bg-(--muted)",  bg: "border-(--border)",    label: "Expired" },
};

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function formatAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s lalu`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}j lalu`;
  return `${Math.floor(hrs / 24)}h lalu`;
}

function formatRemaining(expiresAt: string): string {
  const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
  if (diff <= 0) return "expired";
  const mins = Math.floor(diff / 60);
  const secs = diff % 60;
  if (mins < 1) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

export default function PendingPage() {
  const [tab, setTab] = useState<TabFilter>("pending");
  const [decisions, setDecisions] = useState<PendingDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<number, string>>({});
  const [discussingId, setDiscussingId] = useState<number | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const statusParam = tab === "pending" ? "pending" : tab === "resolved" ? "" : "";
      const limit = tab === "pending" ? 50 : 100;
      const res = await fetch(`/api/pending-decisions?status=${statusParam}&limit=${limit}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      let rows: PendingDecision[] = data.decisions ?? [];
      if (tab === "resolved") {
        rows = rows.filter((d) => d.status !== "pending");
      }
      setDecisions(rows);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => {
    const interval = setInterval(load, tab === "pending" ? 5000 : 15000);
    return () => clearInterval(interval);
  }, [load, tab]);
  useEffect(() => {
    const tick = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  const approve = async (id: number) => {
    if (busy[id]) return;
    setBusy((prev) => ({ ...prev, [id]: "approving" }));
    try {
      await fetch(`/api/pending-decisions/${id}/approve`, { method: "POST" });
      pollUntilResolved(id);
    } catch (e: any) {
      alert(`Approve gagal: ${e.message}`);
      setBusy((prev) => { const c = { ...prev }; delete c[id]; return c; });
    }
  };

  const reject = async (id: number) => {
    if (busy[id]) return;
    const reason = window.prompt("Alasan reject (opsional):") ?? undefined;
    setBusy((prev) => ({ ...prev, [id]: "rejecting" }));
    try {
      await fetch(`/api/pending-decisions/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      load();
    } catch (e: any) {
      alert(`Reject gagal: ${e.message}`);
    } finally {
      setBusy((prev) => { const c = { ...prev }; delete c[id]; return c; });
    }
  };

  const pollUntilResolved = (id: number) => {
    const start = Date.now();
    const interval = setInterval(async () => {
      if (Date.now() - start > 3 * 60_000) { clearInterval(interval); return; }
      try {
        const res = await fetch(`/api/pending-decisions/${id}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (data.decision?.status && data.decision.status !== "pending" && data.decision.status !== "approved") {
          clearInterval(interval);
          setBusy((prev) => { const c = { ...prev }; delete c[id]; return c; });
          load();
        }
      } catch { /* keep polling */ }
    }, 2000);
  };

  const pendingCount = decisions.filter((d) => d.status === "pending" && new Date(d.expires_at).getTime() > Date.now()).length;
  const tabs: Array<{ key: TabFilter; label: string; count?: number }> = [
    { key: "pending",  label: "Pending",  count: pendingCount },
    { key: "resolved", label: "Resolved" },
    { key: "all",      label: "Semua" },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Pending Decisions</h1>
          <p className="text-xs text-(--muted) mt-1">
            Rekomendasi agent yang menunggu konfirmasi manual, atau riwayat keputusan sebelumnya
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); load(); }}
          className="text-xs px-3 py-1.5 rounded-lg border border-(--border) hover:border-(--accent) hover:text-(--accent) transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-(--border)">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-xs font-medium transition-colors relative ${
              tab === t.key
                ? "text-(--accent) border-b-2 border-(--accent)"
                : "text-(--muted) hover:text-(--text)"
            }`}
          >
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-yellow-400/20 text-yellow-300 text-[10px] font-bold">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {loading && <div className="text-sm text-(--muted) py-8 text-center">Memuat...</div>}

      {!loading && decisions.length === 0 && (
        <div className="text-sm text-(--muted) py-12 text-center border border-dashed border-(--border) rounded-xl">
          {tab === "pending" ? "Tidak ada keputusan yang menunggu konfirmasi" : "Belum ada riwayat keputusan"}
        </div>
      )}

      {!loading && (
        <div className="space-y-2">
          {decisions.map((d) => {
            const s = STATUS_STYLES[d.status] ?? STATUS_STYLES.expired;
            const state = busy[d.id];
            const args = d.args ?? {};
            const isPending = d.status === "pending";
            const isActive = isPending && new Date(d.expires_at).getTime() > Date.now();
            const reasoning = d.error ?? d.reason ?? null;

            return (
              <div key={d.id} className={`bg-(--card) border rounded-xl overflow-hidden ${s.bg}`}>
                <div className="p-3 sm:p-4">
                  {/* Row 1: status + pool + meta */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot} ${isPending && isActive ? "animate-pulse" : ""}`} />
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold bg-black/20 text-inherit uppercase">
                        {s.label}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold bg-white/5 text-(--muted) uppercase">
                        {d.action}
                      </span>
                      <span className="text-sm font-semibold truncate">{d.pool_name ?? d.pool_address?.slice(0, 12) ?? "?"}</span>
                      <span className="text-[10px] text-(--muted) font-mono">#{d.id}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-(--muted) font-mono shrink-0">
                      {d.resolved_by && <span>via {d.resolved_by}</span>}
                      {isPending && isActive && (
                        <span className="text-yellow-400/80 tabular-nums">{formatRemaining(d.expires_at)}</span>
                      )}
                      {isPending && !isActive && (
                        <span className="text-red-400/60">expired</span>
                      )}
                      <span>{formatAgo(d.created_at)}</span>
                    </div>
                  </div>

                  {/* Row 2: compact metrics */}
                  {d.action === "deploy" && (
                    <div className="flex gap-4 mt-2 text-[11px] text-(--muted) font-mono flex-wrap pl-4">
                      <span>{args.amount_y ?? "?"} SOL</span>
                      <span>{args.strategy ?? "?"}</span>
                      <span>{args.bins_below ?? "?"}↓ {args.bins_above ?? 0}↑</span>
                      {args.fee_tvl_ratio != null && <span>fee/TVL: {(args.fee_tvl_ratio * 100).toFixed(2)}%</span>}
                      {args.organic_score != null && <span>organic: {args.organic_score}</span>}
                    </div>
                  )}

                  {/* Reasoning (always visible for resolved) */}
                  {reasoning && (
                    <div className={`mt-2 text-xs pl-4 leading-relaxed ${
                      d.status === "rejected" || d.status === "failed"
                        ? "text-red-300/80"
                        : d.status === "executed"
                          ? "text-green-300/80"
                          : "text-(--muted)"
                    }`}>
                      {reasoning}
                    </div>
                  )}

                  {/* Risks */}
                  {isPending && d.risks && d.risks.length > 0 && (
                    <div className="mt-2 pl-4 text-[11px] text-red-300/70">
                      Risks: {d.risks.join(" · ")}
                    </div>
                  )}

                  {/* Actions (only for active pending) */}
                  {isActive && (
                    <div className="mt-3 pl-4 flex gap-1.5 flex-wrap">
                      <button
                        onClick={() => approve(d.id)}
                        disabled={!!state}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-500/15 text-green-300 border border-green-500/40 hover:bg-green-500/25 disabled:opacity-40 transition-colors inline-flex items-center gap-1.5"
                      >
                        {state === "approving" ? (
                          <><span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />Executing...</>
                        ) : (
                          <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>Approve</>
                        )}
                      </button>
                      <button
                        onClick={() => reject(d.id)}
                        disabled={!!state}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-300 border border-red-500/30 hover:bg-red-500/20 disabled:opacity-40 transition-colors inline-flex items-center gap-1.5"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>Reject
                      </button>
                      <button
                        onClick={() => setDiscussingId(d.id)}
                        disabled={!!state}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-(--accent)/15 text-(--accent) border border-(--accent)/40 hover:bg-(--accent)/25 disabled:opacity-40 transition-colors inline-flex items-center gap-1.5"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>Diskusi
                      </button>
                    </div>
                  )}

                  {/* Execution result preview for executed/failed */}
                  {(d.status === "executed" || d.status === "failed") && d.result && (
                    <details className="mt-2 pl-4">
                      <summary className="text-[10px] text-(--muted) cursor-pointer hover:text-(--text) transition-colors">
                        Detail eksekusi
                      </summary>
                      <pre className="mt-1 text-[10px] font-mono text-(--muted) bg-black/20 rounded-md p-2 overflow-x-auto max-h-32 overflow-y-auto">
                        {JSON.stringify(d.result, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {discussingId != null && (
        <DecisionDiscussionModal
          decisionId={discussingId}
          onClose={() => setDiscussingId(null)}
          onResolved={() => { setDiscussingId(null); load(); }}
        />
      )}
    </div>
  );
}
