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
  resolved_at: string | null;
  resolved_by: string | null;
  result: any;
  error: string | null;
}

function formatRemaining(expiresAt: string): string {
  const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
  if (diff <= 0) return "expired";
  const mins = Math.floor(diff / 60);
  const secs = diff % 60;
  if (mins < 1) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function isExpired(d: PendingDecision): boolean {
  return new Date(d.expires_at).getTime() < Date.now();
}

/**
 * Compact dashboard widget — only shows active (non-expired) pending decisions.
 * Full history + filters live at /pending.
 */
export function PendingDecisions() {
  const [decisions, setDecisions] = useState<PendingDecision[]>([]);
  const [busy, setBusy] = useState<Record<number, string>>({});
  const [, setTick] = useState(0);
  const [discussingId, setDiscussingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pending-decisions?status=pending", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setDecisions((data.decisions ?? []).filter((d: PendingDecision) => !isExpired(d)));
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    const tick = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  const approve = async (id: number) => {
    if (busy[id]) return;
    setBusy((prev) => ({ ...prev, [id]: "approving" }));
    try {
      const res = await fetch(`/api/pending-decisions/${id}/approve`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
      await fetch(`/api/pending-decisions/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
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
        if (data.decision?.status && data.decision.status !== "pending" && data.decision.status !== "approved") {
          clearInterval(interval);
          setBusy((prev) => { const copy = { ...prev }; delete copy[id]; return copy; });
          load();
        }
      } catch { /* keep polling */ }
    }, 2000);
  };

  if (decisions.length === 0 && !discussingId) return null;

  return (
    <div className="space-y-2">
      {decisions.map((d) => {
        const state = busy[d.id];
        const args = d.args || {};
        const remaining = formatRemaining(d.expires_at);
        return (
          <div key={d.id} className="bg-(--card) border border-yellow-500/30 rounded-xl p-3 sm:p-4">
            {/* Top row: badge + name + timer */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold bg-yellow-500/15 text-yellow-300">
                  {d.action.toUpperCase()}
                </span>
                <span className="font-semibold text-sm truncate">{d.pool_name ?? d.pool_address?.slice(0, 12)}</span>
                <span className="text-[10px] text-(--muted) font-mono">#{d.id}</span>
              </div>
              <span className="text-[10px] text-yellow-400/80 font-mono tabular-nums shrink-0">
                {remaining}
              </span>
            </div>

            {/* Compact metrics row */}
            {d.action === "deploy" && (
              <div className="flex gap-4 mt-2 text-[11px] text-(--muted) font-mono flex-wrap">
                <span>{args.amount_y ?? "?"} SOL</span>
                <span>{args.strategy ?? "bid_ask"}</span>
                <span>{args.bins_below ?? "?"}↓ {args.bins_above ?? 0}↑</span>
                {args.initial_value_usd ? <span>≈${Math.round(args.initial_value_usd)}</span> : null}
              </div>
            )}

            {/* Reason (single line) */}
            {d.reason && (
              <div className="mt-1.5 text-xs text-(--muted) truncate" title={d.reason}>
                {d.reason}
              </div>
            )}

            {/* Action buttons */}
            <div className="mt-3 flex gap-1.5 flex-wrap">
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
          </div>
        );
      })}

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
