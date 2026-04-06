"use client";
import { useEffect, useState } from "react";

export default function LessonsPage() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch("/api/lessons").then((r) => r.json()).then(setData);
  }, []);

  if (!data) return <div className="text-[var(--muted)]">Loading lessons...</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Lessons & Performance</h1>

      {data.performance && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard title="Closed Positions" value={data.performance.total_positions_closed} />
          <StatCard title="Total PnL" value={`$${data.performance.total_pnl_usd}`} color={data.performance.total_pnl_usd >= 0 ? "green" : "red"} />
          <StatCard title="Win Rate" value={`${data.performance.win_rate_pct}%`} />
          <StatCard title="Avg PnL" value={`${data.performance.avg_pnl_pct}%`} />
        </div>
      )}

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-3">Lessons ({data.total})</h2>
        <div className="space-y-2">
          {data.lessons?.map((l: any) => (
            <div key={l.id} className="py-2 border-b border-[var(--border)] last:border-0">
              <div className="flex items-center gap-2">
                {l.pinned && <span className="text-xs bg-yellow-900/30 text-[var(--yellow)] px-1.5 py-0.5 rounded">PINNED</span>}
                {l.outcome && <span className={`text-xs px-1.5 py-0.5 rounded ${l.outcome === "good" ? "bg-green-900/30 text-[var(--green)]" : l.outcome === "bad" ? "bg-red-900/30 text-[var(--red)]" : "bg-gray-800 text-[var(--muted)]"}`}>{l.outcome.toUpperCase()}</span>}
                {l.tags?.map((t: string) => <span key={t} className="text-xs bg-[var(--border)] text-[var(--muted)] px-1.5 py-0.5 rounded">{t}</span>)}
              </div>
              <p className="text-sm mt-1">{l.rule}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, color }: { title: string; value: string | number; color?: string }) {
  const colorClass = color === "green" ? "text-[var(--green)]" : color === "red" ? "text-[var(--red)]" : "";
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-4">
      <div className="text-xs text-[var(--muted)] uppercase">{title}</div>
      <div className={`text-xl font-bold mt-1 ${colorClass}`}>{value}</div>
    </div>
  );
}
