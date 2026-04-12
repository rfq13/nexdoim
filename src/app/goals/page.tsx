"use client";
import { useCallback, useEffect, useState } from "react";

interface GoalProgress {
  goal: {
    id: number;
    title: string;
    target_pnl: number;
    start_date: string;
    end_date: string;
    status: string;
    current_pnl: number;
    notes: string | null;
  };
  days_total: number;
  days_elapsed: number;
  days_remaining: number;
  pct_time_elapsed: number;
  pct_pnl_achieved: number;
  daily_rate_needed: number;
  daily_rate_actual: number;
  on_track: boolean;
  pace_label: "ahead" | "on_track" | "behind" | "critical";
  gap_usd: number;
  projected_pnl: number;
  proposed_adjustments: {
    reason: string;
    changes: Record<string, Record<string, any>>;
    risk_note: string;
  } | null;
}

const PACE_STYLES: Record<string, { bg: string; text: string; label: string; dot: string }> = {
  ahead:    { bg: "bg-green-500/10 border-green-500/30",  text: "text-green-400",  label: "Ahead of Target", dot: "bg-green-400" },
  on_track: { bg: "bg-blue-500/10 border-blue-500/30",    text: "text-blue-400",   label: "On Track",        dot: "bg-blue-400" },
  behind:   { bg: "bg-yellow-500/10 border-yellow-500/30", text: "text-yellow-400", label: "Behind Target",   dot: "bg-yellow-400" },
  critical: { bg: "bg-red-500/10 border-red-500/30",      text: "text-red-400",    label: "Critical Gap",    dot: "bg-red-400 animate-pulse" },
};

export default function GoalsPage() {
  const [goals, setGoals] = useState<GoalProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", target_pnl: "", end_date: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/goals?status=active&progress=true", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setGoals(data.goals ?? []);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  const createGoal = async () => {
    if (!form.title || !form.target_pnl || !form.end_date) return;
    setSaving(true);
    try {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          target_pnl: parseFloat(form.target_pnl),
          end_date: form.end_date,
          notes: form.notes || undefined,
        }),
      });
      if (res.ok) {
        setShowForm(false);
        setForm({ title: "", target_pnl: "", end_date: "", notes: "" });
        load();
      }
    } finally { setSaving(false); }
  };

  const applyAdjustments = async (goalId: number) => {
    setApplying(goalId);
    try {
      const res = await fetch(`/api/goals/${goalId}/apply-adjustments`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.pending_id) {
        alert(`Pending decision #${data.pending_id} dibuat — approve/reject di halaman Pending.`);
      } else {
        alert(data.error || "Failed");
      }
    } finally { setApplying(null); }
  };

  const cancelGoal = async (goalId: number) => {
    if (!confirm("Cancel goal ini?")) return;
    await fetch(`/api/goals/${goalId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    load();
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Goals & Targets</h1>
          <p className="text-xs text-(--muted) mt-1">
            Set target PnL dengan deadline. Sistem otomatis analisa progress dan rekomendasikan penyesuaian strategi.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="text-xs px-3 py-1.5 rounded-lg bg-(--accent)/15 text-(--accent) border border-(--accent)/40 hover:bg-(--accent)/25 transition-colors inline-flex items-center gap-1.5"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          {showForm ? "Tutup Form" : "Buat Goal Baru"}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-(--card) border border-(--border) rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-(--muted) uppercase tracking-wider">Nama Goal</label>
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Target 10K USD Fees"
                className="mt-1 w-full bg-(--bg) border border-(--border) rounded-lg px-3 py-2 text-sm focus:border-(--accent) outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] text-(--muted) uppercase tracking-wider">Target PnL (USD)</label>
              <input
                type="number"
                value={form.target_pnl}
                onChange={(e) => setForm((f) => ({ ...f, target_pnl: e.target.value }))}
                placeholder="10000"
                className="mt-1 w-full bg-(--bg) border border-(--border) rounded-lg px-3 py-2 text-sm focus:border-(--accent) outline-none font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-(--muted) uppercase tracking-wider">Deadline</label>
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                className="mt-1 w-full bg-(--bg) border border-(--border) rounded-lg px-3 py-2 text-sm focus:border-(--accent) outline-none font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-(--muted) uppercase tracking-wider">Catatan (opsional)</label>
              <input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Target agresif, siap risiko tinggi..."
                className="mt-1 w-full bg-(--bg) border border-(--border) rounded-lg px-3 py-2 text-sm focus:border-(--accent) outline-none"
              />
            </div>
          </div>
          <button
            onClick={createGoal}
            disabled={saving || !form.title || !form.target_pnl || !form.end_date}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-(--accent) text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {saving ? "Membuat..." : "Buat Goal"}
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && <div className="text-sm text-(--muted) py-8 text-center">Memuat goals...</div>}

      {/* Empty state */}
      {!loading && goals.length === 0 && (
        <div className="border border-dashed border-(--border) rounded-xl p-12 text-center space-y-2">
          <div className="text-3xl">🎯</div>
          <div className="text-sm text-(--muted)">Belum ada goal aktif</div>
          <div className="text-xs text-(--muted)">Buat goal pertama kamu untuk mulai tracking progress dan mendapat rekomendasi strategi otomatis.</div>
        </div>
      )}

      {/* Goal cards */}
      {goals.map((gp) => {
        const ps = PACE_STYLES[gp.pace_label] ?? PACE_STYLES.on_track;
        const adj = gp.proposed_adjustments;
        return (
          <div key={gp.goal.id} className={`border rounded-xl overflow-hidden ${ps.bg}`}>
            {/* Header */}
            <div className="p-4 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`w-2 h-2 rounded-full ${ps.dot}`} />
                    <h2 className="font-bold text-base sm:text-lg">{gp.goal.title}</h2>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${ps.text} bg-black/20`}>
                      {ps.label}
                    </span>
                  </div>
                  <div className="text-xs text-(--muted) mt-1 font-mono">
                    {gp.goal.start_date} → {gp.goal.end_date} · {gp.days_remaining} hari tersisa
                  </div>
                </div>
                <button
                  onClick={() => cancelGoal(gp.goal.id)}
                  className="text-[10px] text-(--muted) hover:text-red-400 transition-colors px-2 py-1 rounded"
                >
                  Cancel
                </button>
              </div>

              {/* Progress bars */}
              <div className="mt-4 space-y-3">
                {/* PnL progress */}
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-(--muted)">PnL Progress</span>
                    <span className="font-mono">
                      <span className={gp.goal.current_pnl >= 0 ? "text-green-400" : "text-red-400"}>
                        ${gp.goal.current_pnl.toFixed(2)}
                      </span>
                      <span className="text-(--muted)"> / ${gp.goal.target_pnl.toLocaleString()}</span>
                    </span>
                  </div>
                  <div className="h-3 bg-(--border) rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        gp.pct_pnl_achieved >= 100 ? "bg-green-500" : gp.on_track ? "bg-blue-500" : "bg-yellow-500"
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, gp.pct_pnl_achieved))}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-(--muted) mt-0.5 text-right">{gp.pct_pnl_achieved}%</div>
                </div>

                {/* Time progress */}
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-(--muted)">Time Elapsed</span>
                    <span className="font-mono text-(--muted)">{gp.days_elapsed} / {gp.days_total} hari</span>
                  </div>
                  <div className="h-1.5 bg-(--border) rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-white/20 transition-all" style={{ width: `${gp.pct_time_elapsed}%` }} />
                  </div>
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
                <div>
                  <div className="text-(--muted) text-[10px] uppercase tracking-wider mb-0.5">Rate Aktual</div>
                  <div className="font-mono text-sm">${gp.daily_rate_actual}/hari</div>
                </div>
                <div>
                  <div className="text-(--muted) text-[10px] uppercase tracking-wider mb-0.5">Rate Dibutuhkan</div>
                  <div className={`font-mono text-sm ${!gp.on_track ? "text-yellow-400" : ""}`}>${gp.daily_rate_needed}/hari</div>
                </div>
                <div>
                  <div className="text-(--muted) text-[10px] uppercase tracking-wider mb-0.5">Gap</div>
                  <div className={`font-mono text-sm ${gp.gap_usd > 0 ? "text-yellow-400" : "text-green-400"}`}>
                    {gp.gap_usd > 0 ? `-$${gp.gap_usd.toLocaleString()}` : "✅ Tercapai"}
                  </div>
                </div>
                <div>
                  <div className="text-(--muted) text-[10px] uppercase tracking-wider mb-0.5">Proyeksi</div>
                  <div className={`font-mono text-sm ${gp.projected_pnl >= gp.goal.target_pnl ? "text-green-400" : "text-(--muted)"}`}>
                    ${gp.projected_pnl.toLocaleString()}
                  </div>
                </div>
              </div>

              {gp.goal.notes && (
                <div className="mt-3 text-xs text-(--muted) italic">{gp.goal.notes}</div>
              )}
            </div>

            {/* Strategy adjustment recommendation */}
            {adj && (
              <div className="border-t border-(--border) bg-black/15 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-yellow-400">
                    <path d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-xs font-semibold text-yellow-300">Rekomendasi Penyesuaian Strategi</span>
                </div>
                <div className="text-xs text-(--muted) leading-relaxed">{adj.reason}</div>

                {/* Proposed changes table */}
                <div className="space-y-1">
                  {Object.entries(adj.changes).map(([section, changes]) => (
                    <div key={section} className="text-xs">
                      <span className="text-(--muted) font-mono">{section}:</span>{" "}
                      {Object.entries(changes as Record<string, any>).map(([k, v]) => (
                        <span key={k} className="inline-flex items-center gap-1 mr-3">
                          <span className="text-(--text)">{k}</span>
                          <span className="text-(--accent) font-mono">→ {typeof v === "number" ? v.toLocaleString() : String(v)}</span>
                        </span>
                      ))}
                    </div>
                  ))}
                </div>

                <div className="text-[10px] text-red-300/80 bg-red-500/5 border border-red-500/20 rounded-md px-2.5 py-1.5">
                  ⚠️ {adj.risk_note}
                </div>

                <button
                  onClick={() => applyAdjustments(gp.goal.id)}
                  disabled={applying === gp.goal.id}
                  className="px-4 py-2 rounded-lg text-xs font-medium bg-yellow-500/15 text-yellow-300 border border-yellow-500/40 hover:bg-yellow-500/25 disabled:opacity-40 transition-colors inline-flex items-center gap-1.5"
                >
                  {applying === gp.goal.id ? (
                    <><span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />Membuat pending...</>
                  ) : (
                    <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>Ajukan Penyesuaian (HITL)</>
                  )}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
