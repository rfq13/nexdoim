"use client";
import { useEffect, useState } from "react";

export default function Dashboard() {
  const [wallet, setWallet] = useState<any>(null);
  const [positions, setPositions] = useState<any>(null);
  const [candidates, setCandidates] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/wallet").then((r) => r.json()),
      fetch("/api/positions").then((r) => r.json()),
      fetch("/api/candidates").then((r) => r.json()),
    ]).then(([w, p, c]) => {
      setWallet(w);
      setPositions(p);
      setCandidates(c);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-[var(--muted)]">Loading dashboard...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* Wallet */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card title="SOL Balance" value={`${wallet?.sol ?? 0} SOL`} sub={`$${wallet?.sol_usd ?? 0}`} />
        <Card title="Total USD" value={`$${wallet?.total_usd ?? 0}`} />
        <Card title="Open Positions" value={String(positions?.total_positions ?? 0)} />
        <Card title="SOL Price" value={`$${wallet?.sol_price ?? 0}`} />
      </div>

      {/* Positions */}
      {positions?.positions?.length > 0 && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-3">Open Positions</h2>
          <div className="space-y-2">
            {positions.positions.map((p: any) => (
              <div key={p.position} className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-0">
                <div>
                  <span className="font-medium">{p.pair}</span>
                  <span className={`ml-2 text-xs px-2 py-0.5 rounded ${p.in_range ? "bg-green-900/30 text-[var(--green)]" : "bg-red-900/30 text-[var(--red)]"}`}>
                    {p.in_range ? "IN RANGE" : "OOR"}
                  </span>
                </div>
                <div className="text-right text-sm">
                  <div className={p.pnl_usd >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}>
                    {p.pnl_usd >= 0 ? "+" : ""}${p.pnl_usd} ({p.pnl_pct}%)
                  </div>
                  <div className="text-[var(--muted)]">Fees: ${p.unclaimed_fees_usd} | {p.age_minutes}m</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Candidates */}
      {candidates?.candidates?.length > 0 && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-3">Top Candidates</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[var(--muted)] text-left">
                  <th className="pb-2">Pool</th>
                  <th className="pb-2">Fee/TVL</th>
                  <th className="pb-2">Volume</th>
                  <th className="pb-2">Organic</th>
                  <th className="pb-2">Volatility</th>
                </tr>
              </thead>
              <tbody>
                {candidates.candidates.map((c: any) => (
                  <tr key={c.pool} className="border-t border-[var(--border)]">
                    <td className="py-2 font-medium">{c.name}</td>
                    <td className="py-2">{c.fee_active_tvl_ratio}%</td>
                    <td className="py-2">${c.volume}</td>
                    <td className="py-2">{c.organic_score}</td>
                    <td className="py-2">{c.volatility}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <ActionButton label="Run Screening" endpoint="/api/agent/screen" />
        <ActionButton label="Run Management" endpoint="/api/agent/manage" />
      </div>
    </div>
  );
}

function Card({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-4">
      <div className="text-xs text-[var(--muted)] uppercase">{title}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
      {sub && <div className="text-sm text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

function ActionButton({ label, endpoint }: { label: string; endpoint: string }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      setResult(data.report || data.error || "Done");
    } catch (e: any) { setResult(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div>
      <button onClick={run} disabled={loading} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
        {loading ? "Running..." : label}
      </button>
      {result && <pre className="mt-2 text-xs text-[var(--muted)] max-w-lg whitespace-pre-wrap">{result}</pre>}
    </div>
  );
}
