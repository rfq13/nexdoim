"use client";
import { useEffect, useState } from "react";

interface SignalWeightsData {
  weights: Record<string, number>;
  last_recalc_at: string | null;
  recalc_count: number;
  history: any[];
}

export default function SignalWeightsPage() {
  const [data, setData] = useState<SignalWeightsData | null>(null);
  const [recalcLoading, setRecalcLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch("/api/signal-weights").then((r) => r.json()).then(setData);
  }, []);

  async function triggerRecalc() {
    setRecalcLoading(true);
    try {
      await fetch("/api/signal-weights", { method: "POST" });
      const updated = await fetch("/api/signal-weights").then((r) => r.json());
      setData(updated);
    } finally {
      setRecalcLoading(false);
    }
  }

  if (!data) return <div className="text-(--muted)">Loading signal weights...</div>;

  const sorted = Object.entries(data.weights).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold">Signal Weights</h1>
        <button
          onClick={triggerRecalc}
          disabled={recalcLoading}
          className="text-sm px-3 py-1.5 bg-(--accent) text-black rounded font-medium disabled:opacity-50 shrink-0"
        >
          {recalcLoading ? "Calculating..." : "Recalculate"}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard title="Total Recalculations" value={data.recalc_count} />
        <StatCard title="History Entries" value={data.history?.length ?? 0} />
        <StatCard
          title="Last Recalculated"
          value={data.last_recalc_at ? new Date(data.last_recalc_at).toLocaleDateString("id-ID") : "Never"}
        />
      </div>

      {!data.last_recalc_at && (
        <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-xl p-3 text-sm text-yellow-300">
          Menggunakan bobot default (1.0). Butuh 10+ posisi tertutup untuk mulai Darwinian learning.
        </div>
      )}

      <div className="bg-(--card) border border-(--border) rounded-xl p-4">
        <h2 className="text-base font-semibold mb-3">Current Signal Weights</h2>
        <div className="space-y-2.5">
          {sorted.map(([signal, weight]) => {
            const barPct = Math.max(0, Math.min(100, ((weight - 0.3) / (2.5 - 0.3)) * 100));
            const barColor = weight >= 1.8 ? "var(--green)" : weight >= 1.2 ? "#86efac" : weight >= 0.8 ? "var(--accent)" : weight >= 0.5 ? "#fbbf24" : "var(--red)";
            const badge = weight >= 1.8 ? "STRONG" : weight >= 1.2 ? "above" : weight >= 0.8 ? "neutral" : weight >= 0.5 ? "below" : "weak";
            const badgeCls = weight >= 1.8 ? "bg-green-900/30 text-(--green)" : weight >= 1.2 ? "bg-green-900/20 text-green-400" : weight >= 0.8 ? "bg-gray-800 text-(--muted)" : weight >= 0.5 ? "bg-yellow-900/20 text-yellow-400" : "bg-red-900/20 text-(--red)";
            return (
              <div key={signal} className="flex items-center gap-2">
                <div className="w-24 sm:w-32 text-xs font-mono text-(--muted) truncate shrink-0">{signal.replace(/_/g, " ")}</div>
                <div className="flex-1 h-2 bg-(--border) rounded-full overflow-hidden min-w-0">
                  <div className="h-full rounded-full transition-all" style={{ width: `${barPct}%`, backgroundColor: barColor }} />
                </div>
                <div className="w-10 text-right font-mono text-xs shrink-0">{weight.toFixed(2)}</div>
                <div className={`text-xs px-1.5 py-0.5 rounded w-14 text-center shrink-0 hidden sm:block ${badgeCls}`}>{badge}</div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-(--muted) mt-3">Hijau = kuat · Merah = lemah · Abu = netral</p>
      </div>

      {(data.history?.length ?? 0) > 0 && (
        <div className="bg-(--card) border border-(--border) rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">Recalculation History</h2>
            <button onClick={() => setExpanded(!expanded)} className="text-sm text-(--muted)">
              {expanded ? "Collapse" : "Expand"}
            </button>
          </div>
          <div className="space-y-3">
            {[...(data.history ?? [])].reverse().slice(0, expanded ? undefined : 3).map((entry: any, i) => (
              <div key={i} className="border border-(--border) rounded-lg p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-(--muted) text-xs">{new Date(entry.timestamp).toLocaleString("id-ID")}</span>
                  <span className="text-xs bg-(--border) px-1.5 py-0.5 rounded">{entry.window_size} records</span>
                  <span className="text-xs text-(--green)">{entry.win_count}W</span>
                  <span className="text-xs text-(--red)">{entry.loss_count}L</span>
                </div>
                {entry.changes?.length > 0 ? (
                  <div className="space-y-1 overflow-x-auto">
                    {entry.changes.map((c: any, j: number) => (
                      <div key={j} className="flex items-center gap-2 font-mono text-xs whitespace-nowrap">
                        <span className="w-24 text-(--muted) shrink-0">{c.signal}</span>
                        <span>{c.from.toFixed(3)}</span>
                        <span className="text-(--muted)">→</span>
                        <span className={c.action === "boosted" ? "text-(--green)" : "text-(--red)"}>{c.to.toFixed(3)}</span>
                        <span className="text-(--muted) hidden sm:inline">({c.action})</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-(--muted) text-xs">No changes needed</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="bg-(--card) border border-(--border) rounded-xl p-3 sm:p-4">
      <div className="text-xs text-(--muted) uppercase leading-tight">{title}</div>
      <div className="text-base sm:text-lg font-bold mt-1 break-all">{value}</div>
    </div>
  );
}
