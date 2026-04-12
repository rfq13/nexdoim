"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { Markdown } from "@/components/Markdown";
import { PendingDecisions } from "@/components/PendingDecisions";

// ─── Types ────────────────────────────────────────────────────────────────

interface Position {
  position: string;
  pair: string;
  pnl_usd: number;
  pnl_pct: number;
  unclaimed_fees_usd: number;
  in_range: boolean;
  age_minutes: number;
  deposit_usd?: number;
}

interface PerfSummary {
  total_positions_closed: number;
  total_pnl_usd: number;
  total_fees_usd: number;
  win_rate_pct: number;
  avg_pnl_pct: number;
  recent_streak: { wins: number; losses: number };
}

interface PerfRow {
  pnl_usd: number;
  pnl_pct: number;
  fees_earned_usd: number;
  recorded_at: string;
  pool_name?: string;
}

// ─── Chart primitives ─────────────────────────────────────────────────────

/** Donut ring: pct 0-1 */
function DonutRing({ pct, color, size = 80, thick = 10, children }: {
  pct: number; color: string; size?: number; thick?: number; children?: React.ReactNode;
}) {
  const r = (size - thick) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(1, pct)) * circ;
  const cx = size / 2;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={cx} cy={cx} r={r} fill="none" strokeWidth={thick} stroke="var(--border)" />
        <circle
          cx={cx} cy={cx} r={r} fill="none" strokeWidth={thick} stroke={color}
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cx})`}
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
      {children && (
        <div className="absolute inset-0 flex items-center justify-center">{children}</div>
      )}
    </div>
  );
}

/** Sparkline: array of numbers → responsive SVG polyline */
function Sparkline({ data, height = 60, color }: {
  data: number[]; height?: number; color?: string;
}) {
  if (data.length < 2) return <div className="text-xs text-(--muted)">Belum ada data</div>;
  const W = 400; // viewBox width — SVG scales to container
  const pad = 6;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (W - pad * 2);
    const y = pad + ((max - v) / range) * (height - pad * 2);
    return `${x},${y}`;
  });
  const area = [`${pad},${height - pad}`, ...pts, `${W - pad},${height - pad}`].join(" ");
  const lineColor = color ?? (data[data.length - 1] >= data[0] ? "var(--green)" : "var(--red)");
  const fillColor = lineColor === "var(--green)" ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)";
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none">
      <polygon points={area} fill={fillColor} />
      <polyline points={pts.join(" ")} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" />
      {min < 0 && max > 0 && (
        <line
          x1={pad} y1={pad + (max / range) * (height - pad * 2)}
          x2={W - pad} y2={pad + (max / range) * (height - pad * 2)}
          stroke="var(--border)" strokeWidth="1" strokeDasharray="4,4"
        />
      )}
    </svg>
  );
}

/** Horizontal bar row */
function HBar({ label, value, max, color, fmt }: {
  label: string; value: number; max: number; color: string; fmt?: (v: number) => string;
}) {
  const pct = max === 0 ? 0 : Math.max(0, Math.min(1, Math.abs(value) / Math.abs(max)));
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-32 text-(--muted) truncate shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-(--border) rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
      <span className="w-16 text-right font-mono text-xs">{fmt ? fmt(value) : value.toFixed(2)}</span>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [wallet, setWallet] = useState<any>(null);
  const [positions, setPositions] = useState<any>(null);
  const [perf, setPerf] = useState<{ summary: PerfSummary | null; history: PerfRow[] }>({ summary: null, history: [] });
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const [w, p, pf, sw] = await Promise.all([
        fetch("/api/wallet").then((r) => r.json()).catch(() => null),
        fetch("/api/positions").then((r) => r.json()).catch(() => null),
        fetch("/api/performance").then((r) => r.json()).catch(() => ({ summary: null, history: [] })),
        fetch("/api/signal-weights").then((r) => r.json()).catch(() => null),
      ]);
      setWallet(w);
      setPositions(p);
      setPerf(pf);
      setWeights(sw?.weights ?? {});
      setLastRefresh(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── derived values ──
  const sol = wallet?.sol ?? 0;
  const solUsd = wallet?.sol_usd ?? 0;
  const totalUsd = wallet?.total_usd ?? 0;
  const openCount = positions?.total_positions ?? 0;
  const posRows: Position[] = positions?.positions ?? [];

  // SOL deployed (estimate from position deposit values)
  const deployedUsd = posRows.reduce((s: number, p: Position) => s + (p.deposit_usd ?? 0), 0);
  const portfolioPct = totalUsd > 0 ? deployedUsd / totalUsd : 0;

  // Cumulative PnL line from closed positions (oldest → newest)
  const histSorted = [...perf.history].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );
  const cumPnl: number[] = [];
  let running = 0;
  for (const r of histSorted) { running += r.pnl_usd ?? 0; cumPnl.push(running); }

  // Signal weights sorted desc
  const weightEntries = Object.entries(weights)
    .filter(([, v]) => typeof v === "number")
    .sort(([, a], [, b]) => b - a);
  const maxWeight = Math.max(...weightEntries.map(([, v]) => v), 1);

  const summary = perf.summary;
  const winRate = summary?.win_rate_pct ?? 0;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-(--muted) text-sm">
        <span className="w-2 h-2 bg-(--accent) rounded-full animate-pulse" />
        Loading dashboard...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-(--muted)">
              Diperbarui {lastRefresh.toLocaleTimeString("id-ID")}
            </span>
          )}
          <button onClick={load} className="text-xs px-3 py-1.5 border border-(--border) rounded-lg hover:border-(--accent) transition-colors">
            Refresh
          </button>
        </div>
      </div>

      {/* Pending HITL decisions — shown prominently at top */}
      <PendingDecisions />

      {/* Wallet error banner */}
      {wallet?.error && (
        <div className="flex items-start gap-3 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">
          <span className="text-base leading-none mt-0.5">⚠</span>
          <div>
            <span className="font-medium">Wallet error: </span>{wallet.error}
            {!wallet.wallet && (
              <span> — Buka <a href="/secrets" className="underline hover:text-red-300">/secrets</a> dan isi WALLET_PRIVATE_KEY</span>
            )}
          </div>
        </div>
      )}

      {/* Wallet address */}
      {wallet?.wallet && (
        <div className="text-xs text-(--muted) font-mono truncate">
          Wallet: {wallet.wallet}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="SOL Balance" value={`${sol.toFixed(3)} SOL`} sub={`≈ $${solUsd.toFixed(0)}`} />
        <StatCard label="Total Portfolio" value={`$${totalUsd.toFixed(0)}`} sub={openCount > 0 ? `${openCount} posisi terbuka` : "Tidak ada posisi"} />
        <StatCard
          label="All-time PnL"
          value={summary ? `$${summary.total_pnl_usd >= 0 ? "+" : ""}${summary.total_pnl_usd.toFixed(2)}` : "—"}
          sub={summary ? `${summary.total_positions_closed} posisi ditutup` : "Belum ada riwayat"}
          valueClass={summary ? (summary.total_pnl_usd >= 0 ? "text-(--green)" : "text-(--red)") : ""}
        />
        <StatCard
          label="Win Rate"
          value={summary ? `${winRate}%` : "—"}
          sub={summary ? `${summary.recent_streak.wins}W ${summary.recent_streak.losses}L (recent)` : ""}
          valueClass={summary ? (winRate >= 50 ? "text-(--green)" : "text-(--red)") : ""}
        />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Portfolio allocation donut */}
        <ChartCard title="Alokasi Portfolio">
          <div className="flex items-center gap-5">
            <DonutRing pct={portfolioPct} color="var(--accent)" size={90} thick={11}>
              <span className="text-xs font-bold">{Math.round(portfolioPct * 100)}%</span>
            </DonutRing>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-(--accent)" />
                <span className="text-(--muted)">Deployed</span>
                <span className="ml-auto font-mono">${deployedUsd.toFixed(0)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-(--border)" />
                <span className="text-(--muted)">Available</span>
                <span className="ml-auto font-mono">${(totalUsd - deployedUsd).toFixed(0)}</span>
              </div>
              <div className="border-t border-(--border) pt-2 flex justify-between">
                <span className="text-(--muted)">Total</span>
                <span className="font-mono">${totalUsd.toFixed(0)}</span>
              </div>
            </div>
          </div>
        </ChartCard>

        {/* Win/Loss donut */}
        <ChartCard title="Win Rate">
          {summary ? (
            <div className="flex items-center gap-5">
              <DonutRing
                pct={winRate / 100}
                color={winRate >= 50 ? "var(--green)" : "var(--red)"}
                size={90} thick={11}
              >
                <span className="text-xs font-bold">{winRate}%</span>
              </DonutRing>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-(--green)" />
                  <span className="text-(--muted)">Winners</span>
                  <span className="ml-auto font-mono">
                    {Math.round(summary.total_positions_closed * winRate / 100)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-(--red)" />
                  <span className="text-(--muted)">Losers</span>
                  <span className="ml-auto font-mono">
                    {summary.total_positions_closed - Math.round(summary.total_positions_closed * winRate / 100)}
                  </span>
                </div>
                <div className="border-t border-(--border) pt-2 flex justify-between">
                  <span className="text-(--muted)">Avg PnL</span>
                  <span className={`font-mono ${summary.avg_pnl_pct >= 0 ? "text-(--green)" : "text-(--red)"}`}>
                    {summary.avg_pnl_pct >= 0 ? "+" : ""}{summary.avg_pnl_pct}%
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState text="Belum ada posisi yang ditutup" />
          )}
        </ChartCard>

        {/* Fees collected */}
        <ChartCard title="Fees Terkumpul">
          {summary ? (
            <div className="flex flex-col justify-between h-full gap-3">
              <div className="text-2xl font-bold text-(--green)">
                +${summary.total_fees_usd.toFixed(2)}
              </div>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-(--muted)">Total PnL</span>
                  <span className={summary.total_pnl_usd >= 0 ? "text-(--green)" : "text-(--red)"}>
                    {summary.total_pnl_usd >= 0 ? "+" : ""}${summary.total_pnl_usd.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-(--muted)">Posisi ditutup</span>
                  <span>{summary.total_positions_closed}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-(--muted)">Recent streak</span>
                  <span className="font-mono">
                    <span className="text-(--green)">{summary.recent_streak.wins}W</span>
                    {" "}<span className="text-(--red)">{summary.recent_streak.losses}L</span>
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState text="Belum ada riwayat" />
          )}
        </ChartCard>
      </div>

      {/* Cumulative PnL sparkline */}
      <ChartCard title={`Kumulatif PnL — ${histSorted.length} posisi terakhir`}>
        {cumPnl.length >= 2 ? (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-(--muted) px-1">
              <span>Posisi #{1}</span>
              <span className={`font-mono font-semibold ${(cumPnl.at(-1) ?? 0) >= 0 ? "text-(--green)" : "text-(--red)"}`}>
                {(cumPnl.at(-1) ?? 0) >= 0 ? "+" : ""}${(cumPnl.at(-1) ?? 0).toFixed(2)}
              </span>
              <span>Posisi #{histSorted.length}</span>
            </div>
            <Sparkline data={cumPnl} height={72} />
            <div className="flex justify-between text-xs text-(--muted) px-1">
              <span>{new Date(histSorted[0]?.recorded_at).toLocaleDateString("id-ID")}</span>
              <span>{new Date(histSorted.at(-1)?.recorded_at ?? "").toLocaleDateString("id-ID")}</span>
            </div>
          </div>
        ) : (
          <EmptyState text="Butuh minimal 2 posisi tertutup untuk menampilkan chart" />
        )}
      </ChartCard>

      {/* Signal weights + open positions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Signal weights */}
        <ChartCard title="Signal Weights (Darwin)">
          {weightEntries.length > 0 ? (
            <div className="space-y-2">
              {weightEntries.map(([key, val]) => {
                const pct = val / maxWeight;
                const color = val >= 1.3 ? "var(--green)" : val <= 0.7 ? "var(--red)" : "var(--accent)";
                return (
                  <HBar
                    key={key}
                    label={key.replace(/_/g, " ")}
                    value={val}
                    max={maxWeight}
                    color={color}
                    fmt={(v) => v.toFixed(3)}
                  />
                );
              })}
              <p className="text-xs text-(--muted) pt-1">
                Hijau = sinyal kuat, merah = sinyal lemah, abu = netral
              </p>
            </div>
          ) : (
            <EmptyState text="Bobot belum tersedia — diperlukan minimal beberapa posisi tertutup" />
          )}
        </ChartCard>

        {/* Open positions PnL bars */}
        <ChartCard title="PnL Posisi Terbuka">
          {posRows.length > 0 ? (
            <div className="space-y-2">
              {posRows.map((p) => {
                const absMax = Math.max(...posRows.map((r) => Math.abs(r.pnl_usd)), 1);
                const color = p.pnl_usd >= 0 ? "var(--green)" : "var(--red)";
                return (
                  <div key={p.position} className="space-y-0.5">
                    <div className="flex justify-between text-xs text-(--muted)">
                      <span className="truncate max-w-40">{p.pair}</span>
                      <span className="flex items-center gap-2">
                        <span className={`px-1.5 rounded text-[10px] ${p.in_range ? "bg-green-900/30 text-(--green)" : "bg-red-900/30 text-(--red)"}`}>
                          {p.in_range ? "IN" : "OOR"}
                        </span>
                        {p.age_minutes}m
                      </span>
                    </div>
                    <HBar
                      label=""
                      value={p.pnl_usd}
                      max={absMax}
                      color={color}
                      fmt={(v) => `$${v >= 0 ? "+" : ""}${v.toFixed(2)}`}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState text="Tidak ada posisi terbuka saat ini" />
          )}
        </ChartCard>
      </div>

      {/* Actions */}
      <ActionPanel />
    </div>
  );
}

// ─── Small components ─────────────────────────────────────────────────────

function StatCard({ label, value, sub, valueClass = "" }: {
  label: string; value: string; sub?: string; valueClass?: string;
}) {
  return (
    <div className="bg-(--card) border border-(--border) rounded-xl p-4">
      <div className="text-xs text-(--muted) uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-xl font-bold ${valueClass}`}>{value}</div>
      {sub && <div className="text-xs text-(--muted) mt-0.5">{sub}</div>}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-(--card) border border-(--border) rounded-xl p-4">
      <div className="text-xs text-(--muted) uppercase tracking-wide mb-3">{title}</div>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center h-16 text-xs text-(--muted) text-center">
      {text}
    </div>
  );
}

type RunStatus = "done" | "skipped" | "error";

interface LogEntry {
  ts: number;
  category: string;
  message: string;
}

interface CronRunSummary {
  id: number;
  job_name: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  success: boolean | null;
  error: string | null;
}

interface CronRunDetail extends CronRunSummary {
  output: string | null;
  logs: LogEntry[];
}

interface RunResult {
  action: "screening" | "management";
  runId: number;
  status: RunStatus;
  output: string;
  logs: LogEntry[];
  durationMs: number | null;
  error: string | null;
  at: number;
}

function classifyOutput(run: CronRunDetail): { status: RunStatus; output: string } {
  if (run.success === false) {
    return { status: "error", output: run.error || run.output || "Run gagal tanpa detail" };
  }
  const text = run.output ?? "";
  if (text.startsWith("SKIPPED:")) return { status: "skipped", output: text.slice(8).trim() };
  if (text.startsWith("ERROR:"))   return { status: "error",   output: text.slice(6).trim() };
  return { status: "done", output: text || "Run selesai — tidak ada output tertulis." };
}

function ActionPanel() {
  const [running, setRunning] = useState<"screening" | "management" | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [polling, setPolling] = useState<{ elapsed: number } | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    setPolling(null);
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const pollForRun = useCallback(
    (action: "screening" | "management", triggeredAt: number) => {
      const start = Date.now();
      const jobName = action;
      // Buffer window: consider any run that started within 10s of the trigger as "ours".
      const windowMs = 10_000;
      const maxWaitMs = 5 * 60_000; // give up after 5 minutes

      const tick = async () => {
        const elapsed = Date.now() - start;
        setPolling({ elapsed });

        if (elapsed > maxWaitMs) {
          stopPolling();
          setRunning(null);
          setResult({
            action,
            runId: 0,
            status: "error",
            output: "Timeout menunggu hasil — cek halaman Scheduler untuk riwayat run.",
            logs: [],
            durationMs: null,
            error: "Polling timeout after 5 minutes",
            at: Date.now(),
          });
          return;
        }

        try {
          const listRes = await fetch(`/api/cron/runs?job=${jobName}&limit=5`, { cache: "no-store" });
          if (!listRes.ok) return;
          const listData = await listRes.json();
          const runs: CronRunSummary[] = listData.runs ?? [];

          // Find a run started at or after trigger time (with small backward buffer)
          const candidate = runs.find((r) => {
            const startedMs = new Date(r.started_at).getTime();
            return startedMs >= triggeredAt - windowMs;
          });

          if (!candidate) return; // still waiting for the run to show up
          if (!candidate.ended_at) return; // run is in progress

          // Fetch full detail with logs + output
          const detailRes = await fetch(`/api/cron/runs/${candidate.id}`, { cache: "no-store" });
          if (!detailRes.ok) return;
          const detailData = await detailRes.json();
          const run: CronRunDetail = detailData.run;

          const { status, output } = classifyOutput(run);
          stopPolling();
          setRunning(null);
          setResult({
            action,
            runId: run.id,
            status,
            output,
            logs: run.logs ?? [],
            durationMs: run.duration_ms,
            error: run.error,
            at: Date.now(),
          });
        } catch {
          // Network blip — keep polling
        }
      };

      // Fire immediately, then every 2s
      tick();
      pollTimer.current = setInterval(tick, 2000);
    },
    [stopPolling]
  );

  const run = async (action: "screening" | "management") => {
    if (running) return;
    setRunning(action);
    setResult(null);
    setShowLogs(false);
    try {
      const endpoint = action === "screening" ? "/api/agent/screen" : "/api/agent/manage";
      const res = await fetch(endpoint, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const triggeredAt = data.triggered_at ?? Date.now();
      pollForRun(action, triggeredAt);
    } catch (e: any) {
      setRunning(null);
      setResult({
        action,
        runId: 0,
        status: "error",
        output: e?.message || "Request gagal",
        logs: [],
        durationMs: null,
        error: e?.message || null,
        at: Date.now(),
      });
    }
  };

  return (
    <div className="pt-1 space-y-3">
      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => run("screening")}
          disabled={running !== null}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-all bg-green-500/15 text-green-300 border border-green-500/30 hover:bg-green-500/25 hover:border-green-500/50 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
        >
          {running === "screening" ? (
            <>
              <span className="w-3 h-3 rounded-full bg-green-400 animate-pulse" />
              Screening berjalan...
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
              </svg>
              Run Screening
            </>
          )}
        </button>
        <button
          onClick={() => run("management")}
          disabled={running !== null}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-all bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25 hover:border-blue-500/50 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
        >
          {running === "management" ? (
            <>
              <span className="w-3 h-3 rounded-full bg-blue-400 animate-pulse" />
              Management berjalan...
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path d="M12 6v6l4 2" />
              </svg>
              Run Management
            </>
          )}
        </button>
        {running && polling && (
          <div className="text-xs text-(--muted) self-center pl-1 flex items-center gap-2">
            <span>Menunggu hasil... ({Math.floor(polling.elapsed / 1000)}s)</span>
            <span className="text-[10px] text-(--muted)/70">· fire-and-forget → polling DB</span>
          </div>
        )}
      </div>

      {/* Result panel */}
      {result && (() => {
        const statusStyles: Record<RunStatus, { border: string; badge: string; label: string }> = {
          done:    { border: "border-(--border)",  badge: "bg-green-500/15 text-green-400",   label: "DONE" },
          skipped: { border: "border-yellow-500/40", badge: "bg-yellow-500/15 text-yellow-400", label: "SKIPPED" },
          error:   { border: "border-red-500/40",  badge: "bg-red-500/15 text-red-400",       label: "ERROR" },
        };
        const s = statusStyles[result.status];
        const durationLabel = result.durationMs != null
          ? (result.durationMs < 1000 ? `${result.durationMs}ms` : `${(result.durationMs / 1000).toFixed(1)}s`)
          : null;

        return (
          <div className={`bg-(--card) border rounded-xl overflow-hidden ${s.border}`}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-(--border) bg-black/20 flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold ${
                  result.action === "screening"
                    ? "bg-green-500/15 text-green-400"
                    : "bg-blue-500/15 text-blue-400"
                }`}>
                  {result.action === "screening" ? "SCREENING" : "MANAGEMENT"}
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold ${s.badge}`}>
                  {s.label}
                </span>
                <span className="text-xs text-(--muted)">
                  {new Date(result.at).toLocaleTimeString()}
                </span>
                {durationLabel && (
                  <span className="text-xs text-(--muted) font-mono">· {durationLabel}</span>
                )}
                {result.runId > 0 && (
                  <span className="text-[10px] text-(--muted)/70 font-mono">#{result.runId}</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {result.logs.length > 0 && (
                  <button
                    onClick={() => setShowLogs((v) => !v)}
                    className={`text-[10px] px-2 py-1 rounded-md border transition-colors ${
                      showLogs
                        ? "border-(--accent) text-(--accent)"
                        : "border-(--border) text-(--muted) hover:text-(--text) hover:border-(--accent)"
                    }`}
                  >
                    {showLogs ? "Sembunyikan Log" : `Lihat Log (${result.logs.length})`}
                  </button>
                )}
                <button
                  onClick={() => { setResult(null); setShowLogs(false); }}
                  className="text-(--muted) hover:text-(--text) transition-colors p-1 rounded"
                  title="Tutup"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Output body */}
            <div className="px-4 py-3 max-h-[500px] overflow-y-auto">
              {result.status === "skipped" ? (
                <div className="flex items-start gap-3 text-sm">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-yellow-400 flex-shrink-0 mt-0.5">
                    <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
                  </svg>
                  <div>
                    <div className="font-medium text-yellow-300 mb-1">Job tidak dijalankan</div>
                    <div className="text-(--muted)">{result.output}</div>
                  </div>
                </div>
              ) : result.status === "error" ? (
                <div className="text-sm text-red-300 font-mono whitespace-pre-wrap">{result.output}</div>
              ) : (
                <Markdown text={result.output} />
              )}
            </div>

            {/* Inline log viewer */}
            {showLogs && result.logs.length > 0 && (
              <div className="border-t border-(--border) bg-black/30 max-h-[400px] overflow-y-auto">
                <div className="font-mono text-[11px] leading-relaxed">
                  {result.logs.map((entry, i) => {
                    const isError = entry.category.includes("error");
                    const isWarn = entry.category.includes("warn");
                    const rowCls = isError
                      ? "bg-red-500/5 text-red-300"
                      : isWarn
                        ? "bg-yellow-500/5 text-yellow-300"
                        : "hover:bg-white/5 text-(--text)";
                    return (
                      <div key={i} className={`px-4 py-1 flex gap-3 border-b border-(--border)/30 ${rowCls}`}>
                        <span className="text-(--muted) flex-shrink-0 w-20">
                          {new Date(entry.ts).toLocaleTimeString()}
                        </span>
                        <span className={`flex-shrink-0 w-24 uppercase text-[10px] ${
                          isError ? "text-red-400" : isWarn ? "text-yellow-400" : "text-blue-400"
                        }`}>
                          {entry.category}
                        </span>
                        <span className="break-all whitespace-pre-wrap flex-1">{entry.message}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
