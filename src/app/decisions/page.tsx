"use client";
import { useEffect, useState } from "react";

interface Decision {
  id: number;
  created_at: string;
  type: string;
  actor: string;
  pool: string | null;
  pool_name: string | null;
  position: string | null;
  summary: string | null;
  reason: string | null;
  risks: string[] | null;
  metrics: Record<string, any> | null;
  rejected: string[] | null;
}

const TYPE_STYLES: Record<string, string> = {
  deploy:    "bg-green-900/30 text-[var(--green)]",
  close:     "bg-red-900/30 text-[var(--red)]",
  skip:      "bg-yellow-900/20 text-yellow-400",
  rebalance: "bg-blue-900/20 text-blue-400",
  note:      "bg-gray-800 text-[var(--muted)]",
};

export default function DecisionsPage() {
  const [data, setData] = useState<{ total: number; decisions: Decision[] } | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/decisions?limit=50").then((r) => r.json()).then(setData);
  }, []);

  if (!data) return <div className="text-[var(--muted)]">Loading decisions...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Agent Decision Log</h1>
        <span className="text-sm text-[var(--muted)]">{data.total} decisions</span>
      </div>

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
        {data.decisions.map((d) => (
          <div key={d.id} className="p-3">
            <div
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => setExpanded(expanded === d.id ? null : d.id)}
            >
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${TYPE_STYLES[d.type] ?? TYPE_STYLES.note}`}>
                {d.type.toUpperCase()}
              </span>
              <span className="text-xs bg-[var(--border)] text-[var(--muted)] px-1.5 py-0.5 rounded">
                {d.actor}
              </span>
              <span className="text-sm font-medium flex-1 truncate">
                {d.pool_name || d.pool?.slice(0, 16) || d.position?.slice(0, 16) || "—"}
              </span>
              {d.summary && (
                <span className="text-xs text-[var(--muted)] truncate max-w-xs hidden md:block">{d.summary}</span>
              )}
              <span className="text-xs text-[var(--muted)]">
                {new Date(d.created_at).toLocaleString()}
              </span>
            </div>

            {expanded === d.id && (
              <div className="mt-2 pl-2 space-y-1 text-sm border-l-2 border-[var(--border)]">
                {d.summary  && <p><span className="text-[var(--muted)]">Summary:</span> {d.summary}</p>}
                {d.reason   && <p><span className="text-[var(--muted)]">Reason:</span> {d.reason}</p>}
                {d.risks?.length ? (
                  <p><span className="text-[var(--muted)]">Risks:</span> {d.risks.join(", ")}</p>
                ) : null}
                {d.rejected?.length ? (
                  <p><span className="text-[var(--muted)]">Rejected:</span> {d.rejected.join(", ")}</p>
                ) : null}
                {d.metrics && Object.keys(d.metrics).length > 0 && (
                  <details className="text-xs">
                    <summary className="text-[var(--muted)] cursor-pointer">Metrics</summary>
                    <pre className="mt-1 bg-[var(--border)]/20 rounded p-2 overflow-x-auto">
                      {JSON.stringify(d.metrics, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        ))}

        {data.decisions.length === 0 && (
          <div className="p-6 text-center text-[var(--muted)]">
            No decisions logged yet. Decisions are recorded when the agent deploys or closes positions.
          </div>
        )}
      </div>
    </div>
  );
}
