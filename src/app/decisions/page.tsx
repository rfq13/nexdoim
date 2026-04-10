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
  deploy:    "bg-green-900/30 text-(--green)",
  close:     "bg-red-900/30 text-(--red)",
  skip:      "bg-yellow-900/20 text-yellow-400",
  rebalance: "bg-blue-900/20 text-blue-400",
  note:      "bg-gray-800 text-(--muted)",
};

export default function DecisionsPage() {
  const [data, setData] = useState<{ total: number; decisions: Decision[] } | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/decisions?limit=50").then((r) => r.json()).then(setData);
  }, []);

  if (!data) return <div className="text-(--muted)">Loading decisions...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold">Agent Decision Log</h1>
        <span className="text-sm text-(--muted)">{data.total} decisions</span>
      </div>

      <div className="bg-(--card) border border-(--border) rounded-xl divide-y divide-(--border)">
        {data.decisions.map((d) => (
          <div key={d.id} className="p-3">
            <div
              className="flex items-start gap-2 cursor-pointer"
              onClick={() => setExpanded(expanded === d.id ? null : d.id)}
            >
              <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${TYPE_STYLES[d.type] ?? TYPE_STYLES.note}`}>
                  {d.type.toUpperCase()}
                </span>
                <span className="text-xs bg-(--border) text-(--muted) px-1.5 py-0.5 rounded hidden sm:inline">
                  {d.actor}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {d.pool_name || d.pool?.slice(0, 16) || d.position?.slice(0, 16) || "—"}
                </div>
                {d.summary && (
                  <div className="text-xs text-(--muted) truncate mt-0.5">{d.summary}</div>
                )}
              </div>
              <div className="text-xs text-(--muted) shrink-0 text-right">
                <div className="hidden sm:block">{new Date(d.created_at).toLocaleString("id-ID")}</div>
                <div className="sm:hidden">{new Date(d.created_at).toLocaleDateString("id-ID")}</div>
              </div>
            </div>

            {expanded === d.id && (
              <div className="mt-3 pl-3 space-y-1.5 text-sm border-l-2 border-(--border)">
                <div className="flex gap-1.5 flex-wrap items-center">
                  <span className="text-xs bg-(--border) text-(--muted) px-1.5 py-0.5 rounded sm:hidden">{d.actor}</span>
                  <span className="text-xs text-(--muted)">{new Date(d.created_at).toLocaleString("id-ID")}</span>
                </div>
                {d.summary  && <p><span className="text-(--muted)">Summary: </span>{d.summary}</p>}
                {d.reason   && <p><span className="text-(--muted)">Reason: </span>{d.reason}</p>}
                {d.risks?.length ? <p><span className="text-(--muted)">Risks: </span>{d.risks.join(", ")}</p> : null}
                {d.rejected?.length ? <p><span className="text-(--muted)">Rejected: </span>{d.rejected.join(", ")}</p> : null}
                {d.metrics && Object.keys(d.metrics).length > 0 && (
                  <details className="text-xs">
                    <summary className="text-(--muted) cursor-pointer">Metrics</summary>
                    <pre className="mt-1 bg-(--border)/20 rounded p-2 overflow-x-auto text-[11px]">
                      {JSON.stringify(d.metrics, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        ))}

        {data.decisions.length === 0 && (
          <div className="p-6 text-center text-(--muted) text-sm">
            Belum ada keputusan. Akan tercatat saat agent deploy atau tutup posisi.
          </div>
        )}
      </div>
    </div>
  );
}
