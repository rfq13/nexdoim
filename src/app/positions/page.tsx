"use client";
import { useEffect, useState } from "react";

export default function PositionsPage() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch("/api/positions").then((r) => r.json()).then(setData);
  }, []);

  if (!data) return <div className="text-[var(--muted)]">Loading positions...</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Positions ({data.total_positions})</h1>
      <p className="text-sm text-[var(--muted)]">Wallet: {data.wallet}</p>

      {data.positions?.length === 0 && <p className="text-[var(--muted)]">No open positions.</p>}

      <div className="space-y-3">
        {data.positions?.map((p: any) => (
          <div key={p.position} className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-4">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-bold text-lg">{p.pair}</div>
                <div className="text-xs text-[var(--muted)] mt-1 font-mono">{p.position}</div>
              </div>
              <div className="text-right">
                <div className={`text-lg font-bold ${p.pnl_usd >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                  {p.pnl_usd >= 0 ? "+" : ""}${p.pnl_usd} ({p.pnl_pct}%)
                </div>
                <div className="text-sm text-[var(--muted)]">Value: ${p.total_value_usd}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
              <div><span className="text-[var(--muted)]">Status: </span>{p.in_range ? <span className="text-[var(--green)]">In Range</span> : <span className="text-[var(--red)]">OOR ({p.minutes_out_of_range}m)</span>}</div>
              <div><span className="text-[var(--muted)]">Fees: </span>${p.unclaimed_fees_usd}</div>
              <div><span className="text-[var(--muted)]">Age: </span>{p.age_minutes}m</div>
              <div><span className="text-[var(--muted)]">Bins: </span>{p.lower_bin} - {p.upper_bin} (active: {p.active_bin})</div>
            </div>
            {p.instruction && <div className="mt-2 text-sm text-[var(--yellow)]">Instruction: {p.instruction}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
