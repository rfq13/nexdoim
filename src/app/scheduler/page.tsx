"use client";
import { useCallback, useEffect, useState } from "react";
import { Markdown } from "@/components/Markdown";

interface JobHealth {
  name: string;
  schedule: string;
  intervalMin: number | null;
  lastRunAt: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  lastSuccess: boolean | null;
  runCount: number;
  errorCount: number;
  busy: boolean;
}

interface CronStatus {
  running: boolean;
  task_count: number;
  process_started_at: number;
  process_uptime_sec: number;
  now: number;
  jobs: JobHealth[];
}

interface RunSummary {
  id: number;
  job_name: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  success: boolean | null;
  error: string | null;
}

interface LogEntry {
  ts: number;
  category: string;
  message: string;
}

interface RunDetail extends RunSummary {
  output: string | null;
  logs: LogEntry[];
}

const JOB_LABELS: Record<string, string> = {
  management: "Management Cycle",
  screening: "Screening Cycle",
  health_check: "Health Check",
  morning_briefing: "Morning Briefing",
  briefing_watchdog: "Briefing Watchdog",
};

const JOB_DESCRIPTIONS: Record<string, string> = {
  management: "Analisa posisi terbuka, PnL, dan close rules",
  screening: "Cari pool baru untuk deploy",
  health_check: "Ringkasan kesehatan portfolio (tiap jam)",
  morning_briefing: "Briefing harian (01:00 UTC)",
  briefing_watchdog: "Cek briefing yang terlewat (tiap 6 jam)",
};

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const mins = Math.floor(sec / 60);
  if (mins < 60) return `${mins}m ${sec % 60}s`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}j ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}h ${hrs % 24}j`;
}

function formatAgo(ts: number | null, now: number): string {
  if (!ts) return "belum pernah";
  const diff = Math.floor((now - ts) / 1000);
  if (diff < 5) return "baru saja";
  if (diff < 60) return `${diff}s lalu`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}j lalu`;
  return `${Math.floor(hrs / 24)}h lalu`;
}

function computeNextRun(job: JobHealth, now: number): number | null {
  if (!job.intervalMin) return null;
  if (!job.lastRunAt) {
    const intervalMs = job.intervalMin * 60_000;
    return Math.ceil(now / intervalMs) * intervalMs;
  }
  return job.lastRunAt + job.intervalMin * 60_000;
}

function formatCountdown(target: number | null, now: number): string {
  if (!target) return "—";
  const diff = Math.floor((target - now) / 1000);
  if (diff <= 0) return "segera";
  if (diff < 60) return `${diff}s`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ${diff % 60}s`;
  return `${Math.floor(mins / 60)}j ${mins % 60}m`;
}

function formatDuration(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function isOverdue(job: JobHealth, now: number): boolean {
  if (!job.intervalMin || !job.lastRunAt) return false;
  return now - job.lastRunAt > job.intervalMin * 60_000 * 2;
}

// ─── Main Page ────────────────────────────────────────────────────
export default function SchedulerPage() {
  const [status, setStatus] = useState<CronStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [historyByJob, setHistoryByJob] = useState<Record<string, RunSummary[]>>({});
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<RunDetail | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/cron/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus((await res.json()) as CronStatus);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to load status");
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    const tick = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  // Load history for a job (refreshed when expanded + periodically while open)
  const loadHistory = useCallback(async (jobName: string) => {
    setLoadingHistory(jobName);
    try {
      const res = await fetch(`/api/cron/runs?job=${jobName}&limit=20`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHistoryByJob((prev) => ({ ...prev, [jobName]: data.runs ?? [] }));
    } catch {
      // silent
    } finally {
      setLoadingHistory(null);
    }
  }, []);

  // Refresh expanded history when status updates (catch new completed runs)
  useEffect(() => {
    if (expandedJob) loadHistory(expandedJob);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.jobs.find((j) => j.name === expandedJob)?.runCount, status?.jobs.find((j) => j.name === expandedJob)?.errorCount]);

  const toggleHistory = (jobName: string) => {
    if (expandedJob === jobName) {
      setExpandedJob(null);
    } else {
      setExpandedJob(jobName);
      if (!historyByJob[jobName]) loadHistory(jobName);
    }
  };

  const openRunDetail = async (runId: number) => {
    setLoadingRun(true);
    setOpenRun(null);
    try {
      const res = await fetch(`/api/cron/runs/${runId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setOpenRun(data.run);
    } catch (e: any) {
      alert(`Gagal load run: ${e.message}`);
    } finally {
      setLoadingRun(false);
    }
  };

  const trigger = async (action: string) => {
    setTriggering(action);
    try {
      await fetch("/api/cron/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      setTimeout(() => {
        load();
        if (expandedJob) loadHistory(expandedJob);
      }, 1500);
    } finally {
      setTimeout(() => setTriggering(null), 1500);
    }
  };

  const now = Date.now();
  const running = status?.running ?? false;

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Scheduler</h1>
          <p className="text-xs text-(--muted) mt-1">
            Status cron jobs yang berjalan di dalam proses Next.js (single-dyno Heroku)
          </p>
        </div>
        <button
          onClick={load}
          className="text-xs px-3 py-1.5 rounded-lg border border-(--border) hover:border-(--accent) hover:text-(--accent) transition-colors"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="border border-red-500/40 bg-red-500/10 text-red-300 rounded-lg p-3 text-sm">
          Gagal load status: {error}. Pastikan proses server berjalan.
        </div>
      )}

      {/* ── Overall Health Card ──────────────────────────────── */}
      <div className="bg-(--card) border border-(--border) rounded-xl p-5">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
              running ? "bg-green-500/20" : "bg-red-500/20"
            }`}>
              <div className={`w-3 h-3 rounded-full ${
                running ? "bg-green-400 animate-pulse" : "bg-red-400"
              }`} />
            </div>
            <div>
              <div className="text-lg font-semibold">
                {running ? "Scheduler Aktif" : "Scheduler Tidak Aktif"}
              </div>
              <div className="text-xs text-(--muted) mt-0.5">
                {running
                  ? `${status?.task_count ?? 0} tasks terdaftar`
                  : "Tidak ada tasks yang berjalan — restart server"}
              </div>
            </div>
          </div>

          <div className="flex gap-6 text-xs">
            <div>
              <div className="text-(--muted) uppercase tracking-wider mb-1">Process Uptime</div>
              <div className="font-mono text-sm">
                {status ? formatUptime(status.process_uptime_sec) : "—"}
              </div>
            </div>
            <div>
              <div className="text-(--muted) uppercase tracking-wider mb-1">Started At</div>
              <div className="font-mono text-sm">
                {status ? new Date(status.process_started_at).toLocaleString() : "—"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Job List ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-(--muted) uppercase tracking-wider">
          Scheduled Jobs
        </h2>

        {!status && <div className="text-sm text-(--muted)">Memuat...</div>}

        {status?.jobs.length === 0 && (
          <div className="text-sm text-(--muted) border border-dashed border-(--border) rounded-lg p-4 text-center">
            Belum ada data job — tunggu beberapa detik setelah server start, atau trigger manual.
          </div>
        )}

        {status?.jobs.map((job) => {
          const nextRun = computeNextRun(job, now);
          const overdue = isOverdue(job, now);
          const statusColor = job.busy
            ? "text-blue-400 bg-blue-500/10"
            : overdue
              ? "text-red-400 bg-red-500/10"
              : job.lastSuccess === false
                ? "text-yellow-400 bg-yellow-500/10"
                : job.lastRunAt
                  ? "text-green-400 bg-green-500/10"
                  : "text-(--muted) bg-white/5";
          const statusLabel = job.busy
            ? "RUNNING"
            : overdue
              ? "OVERDUE"
              : job.lastSuccess === false
                ? "LAST FAILED"
                : job.lastRunAt
                  ? "HEALTHY"
                  : "WAITING";
          const isExpanded = expandedJob === job.name;
          const history = historyByJob[job.name] ?? [];

          return (
            <div key={job.name} className="bg-(--card) border border-(--border) rounded-xl overflow-hidden">
              <div className="p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-sm">
                        {JOB_LABELS[job.name] ?? job.name}
                      </h3>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium ${statusColor}`}>
                        {statusLabel}
                      </span>
                    </div>
                    <p className="text-xs text-(--muted) mt-1">
                      {JOB_DESCRIPTIONS[job.name] ?? ""}
                    </p>
                    <div className="mt-1">
                      <code className="text-[10px] text-(--muted) font-mono">{job.schedule}</code>
                    </div>
                  </div>

                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => toggleHistory(job.name)}
                      className={`text-[10px] px-2.5 py-1 rounded-md border transition-colors whitespace-nowrap ${
                        isExpanded
                          ? "border-(--accent) text-(--accent)"
                          : "border-(--border) hover:border-(--accent) hover:text-(--accent)"
                      }`}
                    >
                      {isExpanded ? "Tutup Riwayat" : "Lihat Riwayat"}
                    </button>
                    {(job.name === "management" || job.name === "screening") && (
                      <button
                        onClick={() => trigger(job.name === "management" ? "run_management" : "run_screening")}
                        disabled={triggering !== null || job.busy}
                        className="text-[10px] px-2.5 py-1 rounded-md border border-(--border) hover:border-(--accent) hover:text-(--accent) disabled:opacity-30 transition-colors whitespace-nowrap"
                      >
                        {triggering === (job.name === "management" ? "run_management" : "run_screening")
                          ? "Triggered"
                          : "Run Now"}
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
                  <div>
                    <div className="text-(--muted) uppercase tracking-wider text-[10px] mb-0.5">Last Run</div>
                    <div className="font-mono">{formatAgo(job.lastRunAt, now)}</div>
                  </div>
                  <div>
                    <div className="text-(--muted) uppercase tracking-wider text-[10px] mb-0.5">Next Run</div>
                    <div className="font-mono">{formatCountdown(nextRun, now)}</div>
                  </div>
                  <div>
                    <div className="text-(--muted) uppercase tracking-wider text-[10px] mb-0.5">Duration</div>
                    <div className="font-mono">{formatDuration(job.lastDurationMs)}</div>
                  </div>
                  <div>
                    <div className="text-(--muted) uppercase tracking-wider text-[10px] mb-0.5">Runs / Errors</div>
                    <div className="font-mono">
                      {job.runCount} / <span className={job.errorCount > 0 ? "text-red-400" : ""}>{job.errorCount}</span>
                    </div>
                  </div>
                </div>

                {job.lastError && (
                  <div className="mt-3 border border-red-500/30 bg-red-500/5 rounded-md px-3 py-2 text-xs text-red-300 font-mono">
                    {job.lastError}
                  </div>
                )}
              </div>

              {/* ── History drawer ──────────────────────────────── */}
              {isExpanded && (
                <div className="border-t border-(--border) bg-black/20">
                  <div className="px-4 py-2.5 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-(--muted) font-semibold">
                      Riwayat Run (20 terakhir)
                    </span>
                    <button
                      onClick={() => loadHistory(job.name)}
                      disabled={loadingHistory === job.name}
                      className="text-[10px] text-(--muted) hover:text-(--accent) transition-colors disabled:opacity-40"
                    >
                      {loadingHistory === job.name ? "Loading..." : "Refresh"}
                    </button>
                  </div>

                  {history.length === 0 && (
                    <div className="px-4 pb-4 text-xs text-(--muted) italic">
                      Belum ada run yang tercatat untuk job ini.
                    </div>
                  )}

                  {history.length > 0 && (
                    <div className="px-2 pb-2 space-y-0.5">
                      {history.map((run) => (
                        <button
                          key={run.id}
                          onClick={() => openRunDetail(run.id)}
                          className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-white/5 transition-colors text-left"
                        >
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                            run.success === null
                              ? "bg-(--muted)"
                              : run.success
                                ? "bg-green-400"
                                : "bg-red-400"
                          }`} />
                          <span className="text-xs font-mono text-(--muted) flex-shrink-0 w-32">
                            {new Date(run.started_at).toLocaleString()}
                          </span>
                          <span className="text-xs font-mono text-(--muted) flex-shrink-0 w-14">
                            {formatDuration(run.duration_ms)}
                          </span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium flex-shrink-0 ${
                            run.success === null
                              ? "bg-white/5 text-(--muted)"
                              : run.success
                                ? "bg-green-500/10 text-green-400"
                                : "bg-red-500/10 text-red-400"
                          }`}>
                            {run.success === null ? "?" : run.success ? "OK" : "FAIL"}
                          </span>
                          {run.error && (
                            <span className="text-xs text-red-300 truncate">{run.error}</span>
                          )}
                          <span className="ml-auto text-[10px] text-(--muted) flex-shrink-0">view →</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Heroku Notes ─────────────────────────────────────── */}
      <div className="bg-(--card) border border-(--border) rounded-xl p-4 text-xs text-(--muted) space-y-1.5">
        <div className="font-semibold text-(--text) mb-2">Catatan Deployment</div>
        <div>• Scheduler jalan dalam proses yang sama dengan web server (<code className="font-mono text-(--text)">server.ts</code>).</div>
        <div>• Di Heroku Eco/Free dyno, dyno tidur setelah 30 menit idle — cron ikut berhenti. Pakai Basic+ atau keep-alive ping.</div>
        <div>• Process uptime pendek = proses baru restart (deploy atau crash). Cek <code className="font-mono text-(--text)">heroku logs --tail</code>.</div>
        <div>• Job status &quot;OVERDUE&quot; = telat lebih dari 2× interval → scheduler mungkin stuck.</div>
      </div>

      {/* ── Run Detail Modal ─────────────────────────────────── */}
      {(loadingRun || openRun) && (
        <RunDetailModal
          run={openRun}
          loading={loadingRun}
          onClose={() => { setOpenRun(null); setLoadingRun(false); }}
        />
      )}
    </div>
  );
}

// ─── Run Detail Modal ─────────────────────────────────────────────
function RunDetailModal({
  run, loading, onClose,
}: { run: RunDetail | null; loading: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"logs" | "output">("logs");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-(--bg) border border-(--border) rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-(--border) bg-(--card)">
          <div className="flex items-center gap-3 min-w-0">
            {loading ? (
              <div className="text-sm">Memuat run...</div>
            ) : run ? (
              <>
                <div className="min-w-0">
                  <div className="font-semibold text-sm">
                    {JOB_LABELS[run.job_name] ?? run.job_name}
                  </div>
                  <div className="text-[11px] text-(--muted) font-mono mt-0.5">
                    {new Date(run.started_at).toLocaleString()} · {formatDuration(run.duration_ms)}
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold flex-shrink-0 ${
                  run.success === null
                    ? "bg-white/5 text-(--muted)"
                    : run.success
                      ? "bg-green-500/15 text-green-400"
                      : "bg-red-500/15 text-red-400"
                }`}>
                  {run.success === null ? "UNKNOWN" : run.success ? "SUCCESS" : "FAILED"}
                </span>
              </>
            ) : null}
          </div>
          <button
            onClick={onClose}
            className="text-(--muted) hover:text-(--text) transition-colors p-1 rounded flex-shrink-0"
            title="Tutup (Esc)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        {run && (
          <div className="flex border-b border-(--border) bg-(--card)/50 flex-shrink-0">
            <button
              onClick={() => setTab("logs")}
              className={`px-4 py-2 text-xs font-medium transition-colors ${
                tab === "logs"
                  ? "text-(--accent) border-b-2 border-(--accent)"
                  : "text-(--muted) hover:text-(--text)"
              }`}
            >
              Logs ({run.logs?.length ?? 0})
            </button>
            <button
              onClick={() => setTab("output")}
              className={`px-4 py-2 text-xs font-medium transition-colors ${
                tab === "output"
                  ? "text-(--accent) border-b-2 border-(--accent)"
                  : "text-(--muted) hover:text-(--text)"
              }`}
            >
              Output
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-8 text-center text-sm text-(--muted)">Memuat...</div>
          )}

          {run && tab === "logs" && (
            <div className="p-0">
              {run.error && (
                <div className="m-4 border border-red-500/30 bg-red-500/5 rounded-md px-3 py-2 text-xs text-red-300 font-mono">
                  <div className="font-semibold text-[10px] uppercase tracking-wider mb-1">Error</div>
                  {run.error}
                </div>
              )}

              {(!run.logs || run.logs.length === 0) && (
                <div className="p-8 text-center text-sm text-(--muted) italic">
                  Tidak ada log untuk run ini.
                </div>
              )}

              {run.logs && run.logs.length > 0 && (
                <div className="font-mono text-[11px] leading-relaxed">
                  {run.logs.map((entry, i) => {
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
              )}
            </div>
          )}

          {run && tab === "output" && (
            <div className="p-5">
              {run.output ? (
                <Markdown text={run.output} />
              ) : (
                <div className="text-sm text-(--muted) italic text-center py-8">
                  Tidak ada output untuk run ini.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
