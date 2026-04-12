"use client";
import { useCallback, useEffect, useState } from "react";
import { DecisionDiscussionModal } from "./DecisionDiscussionModal";

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
  source_run_id: number | null;
  resolved_at: string | null;
  resolved_by: string | null;
  result: any;
  error: string | null;
}

function formatAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s lalu`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m lalu`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}j lalu`;
}

function formatRemaining(expiresAt: string): string {
  const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
  if (diff <= 0) return "expired";
  const mins = Math.floor(diff / 60);
  const secs = diff % 60;
  if (mins < 1) return `${secs}s tersisa`;
  return `${mins}m ${secs}s tersisa`;
}

export function PendingDecisions() {
  const [decisions, setDecisions] = useState<PendingDecision[]>([]);
  const [recentResolved, setRecentResolved] = useState<PendingDecision[]>([]);
  const [busy, setBusy] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [discussingId, setDiscussingId] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    try {
      const [pendingRes, recentRes] = await Promise.all([
        fetch("/api/pending-decisions?status=pending", { cache: "no-store" }),
        fetch("/api/pending-decisions?status=&limit=10", { cache: "no-store" }),
      ]);
      if (pendingRes.ok) {
        const data = await pendingRes.json();
        setDecisions(data.decisions ?? []);
      }
      if (recentRes.ok) {
        const data = await recentRes.json();
        setRecentResolved((data.decisions ?? []).filter((d: PendingDecision) => d.status !== "pending"));
      }
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  // Poll every 5s for new pending decisions
  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  // Local ticker for countdowns
  useEffect(() => {
    const tick = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  const approve = async (id: number) => {
    if (busy[id]) return;
    setBusy((prev) => ({ ...prev, [id]: "approving" }));
    try {
      const res = await fetch(`/api/pending-decisions/${id}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      // Poll until status is no longer pending
      pollUntilResolved(id);
    } catch (e: any) {
      alert(`Approve gagal: ${e.message}`);
      setBusy((prev) => { const copy = { ...prev }; delete copy[id]; return copy; });
    }
  };

  const reject = async (id: number) => {
    if (busy[id]) return;
    const reason = window.prompt("Alasan reject (opsional):") ?? undefined;
    setBusy((prev) => ({ ...prev, [id]: "rejecting" }));
    try {
      const res = await fetch(`/api/pending-decisions/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      load();
    } catch (e: any) {
      alert(`Reject gagal: ${e.message}`);
    } finally {
      setBusy((prev) => { const copy = { ...prev }; delete copy[id]; return copy; });
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
        const status = data.decision?.status;
        if (status && status !== "pending" && status !== "approved") {
          clearInterval(interval);
          setBusy((prev) => { const copy = { ...prev }; delete copy[id]; return copy; });
          load();
        }
      } catch { /* keep polling */ }
    }, 2000);
  };

  const discuss = (id: number) => {
    setDiscussingId(id);
  };

  const closeDiscussion = () => setDiscussingId(null);

  const onDiscussionResolved = () => {
    setDiscussingId(null);
    load();
  };

  if (decisions.length === 0 && recentResolved.length === 0 && !error && !discussingId) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
        <h2 className="text-sm font-semibold text-yellow-300 uppercase tracking-wider">
          Menunggu Konfirmasi ({decisions.length})
        </h2>
      </div>

      {error && (
        <div className="text-xs text-red-300 border border-red-500/30 rounded-lg px-3 py-2">
          Gagal load pending decisions: {error}
        </div>
      )}

      <div className="space-y-3">
        {decisions.map((d) => {
          const state = busy[d.id];
          const args = d.args || {};
          return (
            <div key={d.id} className="bg-(--card) border border-yellow-500/30 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold bg-yellow-500/15 text-yellow-400">
                      {d.action.toUpperCase()}
                    </span>
                    <h3 className="font-semibold text-sm">{d.pool_name ?? d.pool_address?.slice(0, 12)}</h3>
                    <span className="text-[10px] text-(--muted) font-mono">#{d.id}</span>
                  </div>
                  {d.pool_address && (
                    <div className="text-[10px] text-(--muted) font-mono mt-0.5 truncate">
                      {d.pool_address}
                    </div>
                  )}
                </div>
                <div className="text-right text-[10px] text-(--muted) flex-shrink-0">
                  <div>{formatAgo(d.created_at)}</div>
                  <div className="text-yellow-400/70">{formatRemaining(d.expires_at)}</div>
                </div>
              </div>

              {/* Metrics grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
                {d.action === "deploy" && (
                  <>
                    <div>
                      <div className="text-(--muted) text-[10px] uppercase tracking-wider mb-0.5">Amount</div>
                      <div className="font-mono">{args.amount_y?.toFixed?.(3) ?? args.amount_y ?? "?"} SOL</div>
                    </div>
                    <div>
                      <div className="text-(--muted) text-[10px] uppercase tracking-wider mb-0.5">Strategy</div>
                      <div className="font-mono">{args.strategy ?? "bid_ask"}</div>
                    </div>
                    <div>
                      <div className="text-(--muted) text-[10px] uppercase tracking-wider mb-0.5">Bins</div>
                      <div className="font-mono">{args.bins_below}↓ / {args.bins_above}↑</div>
                    </div>
                    <div>
                      <div className="text-(--muted) text-[10px] uppercase tracking-wider mb-0.5">Value</div>
                      <div className="font-mono">{args.initial_value_usd ? `$${Math.round(args.initial_value_usd)}` : "—"}</div>
                    </div>
                  </>
                )}
              </div>

              {/* Reason */}
              {d.reason && (
                <div className="mt-3 text-xs text-(--text)">
                  <span className="text-(--muted)">Alasan:</span> {d.reason}
                </div>
              )}

              {/* Risks */}
              {d.risks && d.risks.length > 0 && (
                <div className="mt-2 text-xs">
                  <div className="text-(--muted) mb-1">Risks:</div>
                  <ul className="list-disc list-inside space-y-0.5 text-red-300/90">
                    {d.risks.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}

              {/* Actions */}
              <div className="mt-4 flex gap-2 flex-wrap">
                <button
                  onClick={() => approve(d.id)}
                  disabled={!!state}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-green-500/15 text-green-300 border border-green-500/40 hover:bg-green-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
                >
                  {state === "approving" ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                      Executing...
                    </>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      Approve
                    </>
                  )}
                </button>
                <button
                  onClick={() => reject(d.id)}
                  disabled={!!state}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-300 border border-red-500/30 hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                  Reject
                </button>
                <button
                  onClick={() => discuss(d.id)}
                  disabled={!!state}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-(--accent)/15 text-(--accent) border border-(--accent)/40 hover:bg-(--accent)/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                  </svg>
                  Diskusi
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Recent resolved decisions with reasoning ─────────── */}
      {recentResolved.length > 0 && (
        <div className="pt-2">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-2 text-xs text-(--muted) hover:text-(--text) transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${showHistory ? "rotate-180" : ""}`}>
              <path d="M6 9l6 6 6-6" />
            </svg>
            <span className="font-semibold uppercase tracking-wider">
              Riwayat Keputusan ({recentResolved.length})
            </span>
          </button>

          {showHistory && (
            <div className="mt-2 space-y-1.5">
              {recentResolved.map((d) => {
                const statusStyles: Record<string, string> = {
                  executed: "bg-green-500/10 text-green-400 border-green-500/30",
                  approved: "bg-blue-500/10 text-blue-400 border-blue-500/30",
                  rejected: "bg-red-500/10 text-red-300 border-red-500/30",
                  failed:   "bg-red-500/15 text-red-400 border-red-500/40",
                  expired:  "bg-white/5 text-(--muted) border-(--border)",
                };
                const style = statusStyles[d.status] ?? "bg-white/5 text-(--muted) border-(--border)";
                const resolvedVia = d.resolved_by ?? "?";
                const reasoning = d.error ?? d.reason ?? "";

                return (
                  <div key={d.id} className={`border rounded-lg px-3 py-2.5 ${style}`}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold uppercase bg-black/20">
                          {d.status}
                        </span>
                        <span className="text-xs font-medium truncate">
                          {d.action.toUpperCase()} {d.pool_name ?? d.pool_address?.slice(0, 12) ?? "?"}
                        </span>
                        <span className="text-[10px] font-mono text-(--muted)">#{d.id}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-(--muted) flex-shrink-0">
                        <span>via {resolvedVia}</span>
                        <span>{d.resolved_at ? formatAgo(d.resolved_at) : ""}</span>
                      </div>
                    </div>
                    {reasoning && (
                      <div className="mt-1.5 text-xs opacity-80 leading-relaxed">
                        {reasoning}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Inline discussion modal — rendered at root of this component so it
          overlays the whole dashboard regardless of scroll position */}
      {discussingId != null && (
        <DecisionDiscussionModal
          decisionId={discussingId}
          onClose={closeDiscussion}
          onResolved={onDiscussionResolved}
        />
      )}
    </div>
  );
}
