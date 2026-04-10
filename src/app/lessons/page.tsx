"use client";
import { useEffect, useState } from "react";

export default function LessonsPage() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch("/api/lessons").then((r) => r.json()).then(setData);
  }, []);

  if (!data) return <div className="text-(--muted)">Loading lessons...</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl sm:text-2xl font-bold">Lessons & Performance</h1>

      {data.performance && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard title="Closed" value={data.performance.total_positions_closed} />
          <StatCard title="Total PnL" value={`$${data.performance.total_pnl_usd}`}
            color={data.performance.total_pnl_usd >= 0 ? "green" : "red"} />
          <StatCard title="Win Rate" value={`${data.performance.win_rate_pct}%`} />
          <StatCard title="Avg PnL" value={`${data.performance.avg_pnl_pct}%`} />
        </div>
      )}

      <div className="bg-(--card) border border-(--border) rounded-xl p-4">
        <h2 className="text-base font-semibold mb-3">Lessons ({data.total})</h2>
        <div className="space-y-2">
          {data.lessons?.map((l: any) => (
            <div key={l.id} className="py-2.5 border-b border-(--border) last:border-0">
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                {l.pinned && (
                  <span className="text-xs bg-yellow-900/30 text-yellow-400 px-1.5 py-0.5 rounded">PINNED</span>
                )}
                {l.outcome && (
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    l.outcome === "good" ? "bg-green-900/30 text-(--green)" :
                    l.outcome === "bad"  ? "bg-red-900/30 text-(--red)" :
                    "bg-gray-800 text-(--muted)"
                  }`}>{l.outcome.toUpperCase()}</span>
                )}
                {l.tags?.map((t: string) => (
                  <span key={t} className="text-xs bg-(--border) text-(--muted) px-1.5 py-0.5 rounded">{t}</span>
                ))}
              </div>
              <p className="text-sm leading-relaxed">{l.rule}</p>
            </div>
          ))}
          {(!data.lessons || data.lessons.length === 0) && (
            <p className="text-sm text-(--muted)">Belum ada lessons. Agent akan belajar seiring posisi dibuka dan ditutup.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, color }: { title: string; value: string | number; color?: string }) {
  const colorClass = color === "green" ? "text-(--green)" : color === "red" ? "text-(--red)" : "";
  return (
    <div className="bg-(--card) border border-(--border) rounded-xl p-3 sm:p-4">
      <div className="text-xs text-(--muted) uppercase">{title}</div>
      <div className={`text-lg font-bold mt-1 ${colorClass}`}>{value}</div>
    </div>
  );
}
