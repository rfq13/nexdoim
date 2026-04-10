"use client";
import { useEffect, useState } from "react";

export default function PositionsPage() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch("/api/positions").then((r) => r.json()).then(setData);
  }, []);

  if (!data) return <div className="text-(--muted)">Loading positions...</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl sm:text-2xl font-bold">Positions ({data.total_positions})</h1>
      {data.wallet && (
        <p className="text-xs text-(--muted) font-mono break-all">Wallet: {data.wallet}</p>
      )}

      {data.positions?.length === 0 && (
        <p className="text-(--muted) text-sm">Tidak ada posisi terbuka.</p>
      )}

      <div className="space-y-3">
        {data.positions?.map((p: any) => (
          <div key={p.position} className="bg-(--card) border border-(--border) rounded-xl p-4">
            {/* Header row */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold text-base sm:text-lg">{p.pair}</div>
                <div className="text-xs text-(--muted) font-mono mt-0.5 truncate max-w-50 sm:max-w-none">
                  {p.position}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className={`text-base sm:text-lg font-bold ${p.pnl_usd >= 0 ? "text-(--green)" : "text-(--red)"}`}>
                  {p.pnl_usd >= 0 ? "+" : ""}${p.pnl_usd} ({p.pnl_pct}%)
                </div>
                <div className="text-xs text-(--muted)">Value: ${p.total_value_usd}</div>
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-sm">
              <div>
                <span className="text-(--muted) text-xs">Status</span>
                <div>{p.in_range
                  ? <span className="text-(--green) font-medium">In Range</span>
                  : <span className="text-(--red) font-medium">OOR {p.minutes_out_of_range ? `${p.minutes_out_of_range}m` : ""}</span>}
                </div>
              </div>
              <div>
                <span className="text-(--muted) text-xs">Unclaimed Fees</span>
                <div className="font-medium">${p.unclaimed_fees_usd}</div>
              </div>
              <div>
                <span className="text-(--muted) text-xs">Age</span>
                <div>{p.age_minutes}m</div>
              </div>
              <div>
                <span className="text-(--muted) text-xs">Bin Range</span>
                <div className="font-mono text-xs">{p.lower_bin}–{p.upper_bin}</div>
              </div>
            </div>

            {p.instruction && (
              <div className="mt-2 text-sm text-yellow-400 bg-yellow-900/20 rounded-lg px-3 py-2">
                {p.instruction}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
