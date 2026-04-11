"use client";
import { useCallback, useEffect, useState } from "react";

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
    // Estimate next cron tick for interval-based jobs
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

/** Heuristic: is this interval-based job overdue? */
function isOverdue(job: JobHealth, now: number): boolean {
  if (!job.intervalMin || !job.lastRunAt) return false;
  // Give 2x the interval as grace window
  return now - job.lastRunAt > job.intervalMin * 60_000 * 2;
}

export default function SchedulerPage() {
  const [status, setStatus] = useState<CronStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [, setTick] = useState(0); // force re-render for live countdowns

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/cron/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as CronStatus;
      setStatus(data);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to load status");
    }
  }, []);

  // Initial load + poll every 5s
  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  // Local ticker every 1s for countdowns
  useEffect(() => {
    const tick = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  const trigger = async (action: string) => {
    setTriggering(action);
    try {
      await fetch("/api/cron/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      // Wait a moment then refresh
      setTimeout(load, 1000);
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
          <p className="text-xs text-[var(--muted)] mt-1">
            Status cron jobs yang berjalan di dalam proses Next.js (single-dyno Heroku)
          </p>
        </div>
        <button
          onClick={load}
          className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
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
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
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
              <div className="text-xs text-[var(--muted)] mt-0.5">
                {running
                  ? `${status?.task_count ?? 0} tasks terdaftar`
                  : "Tidak ada tasks yang berjalan — restart server"}
              </div>
            </div>
          </div>

          <div className="flex gap-6 text-xs">
            <div>
              <div className="text-[var(--muted)] uppercase tracking-wider mb-1">Process Uptime</div>
              <div className="font-mono text-sm">
                {status ? formatUptime(status.process_uptime_sec) : "—"}
              </div>
            </div>
            <div>
              <div className="text-[var(--muted)] uppercase tracking-wider mb-1">Started At</div>
              <div className="font-mono text-sm">
                {status ? new Date(status.process_started_at).toLocaleString() : "—"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Job List ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">
          Scheduled Jobs
        </h2>

        {!status && <div className="text-sm text-[var(--muted)]">Memuat...</div>}

        {status?.jobs.length === 0 && (
          <div className="text-sm text-[var(--muted)] border border-dashed border-[var(--border)] rounded-lg p-4 text-center">
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
                  : "text-[var(--muted)] bg-white/5";
          const statusLabel = job.busy
            ? "RUNNING"
            : overdue
              ? "OVERDUE"
              : job.lastSuccess === false
                ? "LAST FAILED"
                : job.lastRunAt
                  ? "HEALTHY"
                  : "WAITING";

          return (
            <div key={job.name} className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
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
                  <p className="text-xs text-[var(--muted)] mt-1">
                    {JOB_DESCRIPTIONS[job.name] ?? ""}
                  </p>
                  <div className="mt-1">
                    <code className="text-[10px] text-[var(--muted)] font-mono">{job.schedule}</code>
                  </div>
                </div>

                {(job.name === "management" || job.name === "screening") && (
                  <button
                    onClick={() => trigger(job.name === "management" ? "run_management" : "run_screening")}
                    disabled={triggering !== null || job.busy}
                    className="text-[10px] px-2.5 py-1 rounded-md border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-30 transition-colors whitespace-nowrap"
                  >
                    {triggering === (job.name === "management" ? "run_management" : "run_screening")
                      ? "Triggered"
                      : "Run Now"}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
                <div>
                  <div className="text-[var(--muted)] uppercase tracking-wider text-[10px] mb-0.5">Last Run</div>
                  <div className="font-mono">{formatAgo(job.lastRunAt, now)}</div>
                </div>
                <div>
                  <div className="text-[var(--muted)] uppercase tracking-wider text-[10px] mb-0.5">Next Run</div>
                  <div className="font-mono">{formatCountdown(nextRun, now)}</div>
                </div>
                <div>
                  <div className="text-[var(--muted)] uppercase tracking-wider text-[10px] mb-0.5">Duration</div>
                  <div className="font-mono">
                    {job.lastDurationMs ? `${(job.lastDurationMs / 1000).toFixed(1)}s` : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--muted)] uppercase tracking-wider text-[10px] mb-0.5">Runs / Errors</div>
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
          );
        })}
      </div>

      {/* ── Heroku Notes ─────────────────────────────────────── */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 text-xs text-[var(--muted)] space-y-1.5">
        <div className="font-semibold text-[var(--text)] mb-2">Catatan Deployment</div>
        <div>• Scheduler jalan dalam proses yang sama dengan web server (<code className="font-mono text-[var(--text)]">server.ts</code>).</div>
        <div>• Di Heroku Eco/Free dyno, dyno tidur setelah 30 menit idle — cron ikut berhenti. Pakai Basic+ atau keep-alive ping.</div>
        <div>• Process uptime pendek = proses baru restart (deploy atau crash). Cek <code className="font-mono text-[var(--text)]">heroku logs --tail</code>.</div>
        <div>• Job status "OVERDUE" = telat lebih dari 2× interval → scheduler mungkin stuck.</div>
      </div>
    </div>
  );
}
