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

  if (!data) return <div className="text-[var(--muted)]">Loading signal weights...</div>;

  const sorted = Object.entries(data.weights).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Signal Weights</h1>
        <button
          onClick={triggerRecalc}
          disabled={recalcLoading}
          className="text-sm px-3 py-1.5 bg-[var(--accent)] text-black rounded font-medium disabled:opacity-50"
        >
          {recalcLoading ? "Recalculating..." : "Recalculate Now"}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard title="Total Recalculations" value={data.recalc_count} />
        <StatCard title="History Entries" value={data.history?.length ?? 0} />
        <StatCard
          title="Last Recalculated"
          value={data.last_recalc_at ? new Date(data.last_recalc_at).toLocaleString() : "Never"}
        />
      </div>

      {!data.last_recalc_at && (
        <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-lg p-3 text-sm text-yellow-300">
          Using default weights (1.0 for all signals). Need 10+ closed positions to begin Darwinian learning.
        </div>
      )}

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-3">Current Signal Weights</h2>
        <div className="space-y-2">
          {sorted.map(([signal, weight]) => (
            <div key={signal} className="flex items-center gap-3">
              <div className="w-36 text-sm font-mono text-[var(--muted)]">{signal}</div>
              <div className="flex-1 h-2 bg-[var(--border)] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.max(0, Math.min(100, ((weight - 0.3) / (2.5 - 0.3)) * 100))}%`,
                    backgroundColor: weight >= 1.8 ? "var(--green)" : weight >= 1.2 ? "#86efac" : weight >= 0.8 ? "var(--accent)" : weight >= 0.5 ? "#fbbf24" : "var(--red)",
                  }}
                />
              </div>
              <div className="w-12 text-right font-mono text-sm">{weight.toFixed(3)}</div>
              <div className={`text-xs px-1.5 py-0.5 rounded w-24 text-center ${
                weight >= 1.8 ? "bg-green-900/30 text-[var(--green)]" :
                weight >= 1.2 ? "bg-green-900/20 text-green-400" :
                weight >= 0.8 ? "bg-gray-800 text-[var(--muted)]" :
                weight >= 0.5 ? "bg-yellow-900/20 text-yellow-400" :
                "bg-red-900/20 text-[var(--red)]"
              }`}>
                {weight >= 1.8 ? "STRONG" : weight >= 1.2 ? "above avg" : weight >= 0.8 ? "neutral" : weight >= 0.5 ? "below avg" : "weak"}
              </div>
            </div>
          ))}
        </div>
      </div>

      {(data.history?.length ?? 0) > 0 && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Recalculation History</h2>
            <button onClick={() => setExpanded(!expanded)} className="text-sm text-[var(--muted)]">
              {expanded ? "Collapse" : "Expand all"}
            </button>
          </div>
          <div className="space-y-3">
            {[...(data.history ?? [])].reverse().slice(0, expanded ? undefined : 5).map((entry: any, i) => (
              <div key={i} className="border border-[var(--border)] rounded p-3 text-sm">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[var(--muted)]">{new Date(entry.timestamp).toLocaleString()}</span>
                  <span className="text-xs bg-[var(--border)] px-1.5 py-0.5 rounded">{entry.window_size} records</span>
                  <span className="text-xs text-[var(--green)]">{entry.win_count}W</span>
                  <span className="text-xs text-[var(--red)]">{entry.loss_count}L</span>
                </div>
                {entry.changes?.length > 0 ? (
                  <div className="space-y-1">
                    {entry.changes.map((c: any, j: number) => (
                      <div key={j} className="flex items-center gap-2 font-mono text-xs">
                        <span className="w-28 text-[var(--muted)]">{c.signal}</span>
                        <span>{c.from.toFixed(3)}</span>
                        <span className="text-[var(--muted)]">→</span>
                        <span className={c.action === "boosted" ? "text-[var(--green)]" : "text-[var(--red)]"}>{c.to.toFixed(3)}</span>
                        <span className="text-[var(--muted)]">({c.action}, lift={c.lift.toFixed(3)})</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-[var(--muted)] text-xs">No changes needed</span>
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
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-4">
      <div className="text-xs text-[var(--muted)] uppercase">{title}</div>
      <div className="text-lg font-bold mt-1">{value}</div>
    </div>
  );
}
