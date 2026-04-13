"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { Markdown } from "@/components/Markdown";
import { PendingDecisions } from "@/components/PendingDecisions";
import { ChatInner } from "@/components/ChatInner";

// ─── Types ────────────────────────────────────────────────────────────────

interface Position {
  position: string;
  pair: string;
  pnl_usd: number;
  pnl_pct: number;
  unclaimed_fees_usd: number;
  total_value_usd: number;
  in_range: boolean;
  age_minutes: number;
  minutes_out_of_range: number | null;
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
  const [refreshing, setRefreshing] = useState(false);
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
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 30s for near-realtime position/PnL data
  useEffect(() => {
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const manualRefresh = () => {
    setRefreshing(true);
    load();
  };

  // ── derived values ──
  const sol = wallet?.sol ?? 0;
  const solPrice = wallet?.sol_price ?? 0;
  const walletUsd = wallet?.sol_usd ?? 0; // SOL + tokens in wallet
  const openCount = positions?.total_positions ?? 0;
  const posRows: Position[] = positions?.positions ?? [];

  // Current value of all open positions (total_value_usd from on-chain data)
  const deployedUsd = posRows.reduce((s: number, p: Position) => s + (p.total_value_usd ?? p.deposit_usd ?? 0), 0);
  // Total = wallet liquid + deployed in positions
  const totalUsd = walletUsd + deployedUsd;
  const availableUsd = walletUsd;
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
          <button
            onClick={manualRefresh}
            disabled={refreshing}
            className="text-xs px-3 py-1.5 border border-(--border) rounded-lg hover:border-(--accent) transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {refreshing ? (
              <><span className="w-2 h-2 rounded-full bg-(--accent) animate-pulse" />Memuat...</>
            ) : (
              "Refresh"
            )}
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
        <StatCard label="SOL Balance" value={`${sol.toFixed(3)} SOL`} sub={solPrice > 0 ? `≈ $${walletUsd.toFixed(0)} (@$${solPrice.toFixed(0)})` : "Harga SOL unavailable"} />
        <StatCard label="Total Portfolio" value={`$${totalUsd.toFixed(0)}`} sub={openCount > 0 ? `$${availableUsd.toFixed(0)} liquid + $${deployedUsd.toFixed(0)} deployed` : "Tidak ada posisi"} />
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
                <span className="ml-auto font-mono">${availableUsd.toFixed(0)}</span>
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

        {/* Open positions cards */}
        <ChartCard title="Posisi Terbuka">
          {posRows.length > 0 ? (
            <div className="space-y-3">
              {posRows.map((p) => {
                const pnlColor = p.pnl_usd >= 0 ? "text-green-400" : "text-red-400";
                const feesTotal = (p.unclaimed_fees_usd ?? 0);
                return (
                  <div key={p.position} className="border border-(--border) rounded-lg p-3 bg-black/10 space-y-2">
                    {/* Row 1: pair + status + pnl */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-sm truncate">{p.pair}</span>
                        <Tooltip text={p.in_range
                          ? "In Range — posisi kamu aktif menerima swap & menghasilkan fee"
                          : "Out of Range — posisi idle, tidak menghasilkan fee. Kalau lama, management cycle akan sarankan CLOSE."
                        }>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold cursor-help ${
                            p.in_range ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
                          }`}>
                            {p.in_range ? "IN RANGE" : "OOR"}
                          </span>
                        </Tooltip>
                      </div>
                      <Tooltip text="PnL = perubahan nilai posisi sejak dibuka (termasuk impermanent loss). Positif hijau = untung, merah = rugi.">
                        <span className={`font-bold font-mono text-sm tabular-nums cursor-help ${pnlColor}`}>
                          {p.pnl_usd >= 0 ? "+" : ""}${p.pnl_usd} ({p.pnl_pct}%)
                        </span>
                      </Tooltip>
                    </div>

                    {/* Row 2: key metrics with tooltips */}
                    <div className="flex gap-3 sm:gap-5 text-xs flex-wrap">
                      <Tooltip text="Fee yang sudah dihasilkan tapi belum ditarik ke wallet. Akan otomatis ter-claim saat posisi ditutup. Tidak bisa hangus.">
                        <span className="cursor-help text-(--muted) hover:text-(--text) transition-colors">
                          Fees: <span className="text-(--text) font-mono">${feesTotal.toFixed(2)}</span>
                        </span>
                      </Tooltip>
                      <Tooltip text="Nilai total posisi saat ini (token base + SOL yang dikunci di pool).">
                        <span className="cursor-help text-(--muted) hover:text-(--text) transition-colors">
                          Value: <span className="text-(--text) font-mono">${p.total_value_usd}</span>
                        </span>
                      </Tooltip>
                      <Tooltip text="Berapa lama posisi sudah dibuka. Close rules management baru aktif setelah 60 menit.">
                        <span className="cursor-help text-(--muted) hover:text-(--text) transition-colors">
                          Age: <span className="text-(--text) font-mono">{p.age_minutes ?? "?"}m</span>
                        </span>
                      </Tooltip>
                      {!p.in_range && (p.minutes_out_of_range ?? 0) > 0 && (
                        <Tooltip text={`Sudah di luar range selama ${p.minutes_out_of_range}m. Selama OOR, posisi tidak menghasilkan fee. Management akan sarankan CLOSE setelah ${30}m OOR.`}>
                          <span className="cursor-help text-red-400/80 hover:text-red-300 transition-colors">
                            OOR: <span className="font-mono">{p.minutes_out_of_range}m</span>
                          </span>
                        </Tooltip>
                      )}
                    </div>

                    {/* Row 3: mini PnL bar */}
                    <div className="flex items-center gap-2">
                      <Tooltip text={`PnL bar — hijau = untung, merah = rugi. Saat ini ${p.pnl_usd >= 0 ? "untung" : "rugi"} $${Math.abs(p.pnl_usd).toFixed(2)}.`}>
                        <div className="flex-1 h-1.5 bg-(--border) rounded-full overflow-hidden cursor-help">
                          <div
                            className={`h-full rounded-full transition-all ${p.pnl_usd >= 0 ? "bg-green-500" : "bg-red-500"}`}
                            style={{ width: `${Math.min(100, Math.max(5, Math.abs(p.pnl_pct) * 2))}%` }}
                          />
                        </div>
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
              <a href="/positions" className="text-xs text-(--accent) hover:underline">
                Lihat detail + health gauge →
              </a>
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

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="relative group/tip inline-flex">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 rounded-lg bg-(--bg) border border-(--border) text-[11px] text-(--text) leading-snug whitespace-normal w-52 sm:w-64 shadow-xl opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-30 text-center">
        {text}
      </span>
    </span>
  );
}

function ActionPanel() {
  const [chatModal, setChatModal] = useState<{ action: "screening" | "management" } | null>(null);

  return (
    <div className="pt-1 space-y-3">
      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setChatModal({ action: "screening" })}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-all bg-green-500/15 text-green-300 border border-green-500/30 hover:bg-green-500/25 hover:border-green-500/50 inline-flex items-center gap-2"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          Run Screening
        </button>
        <button
          onClick={() => setChatModal({ action: "management" })}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-all bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25 hover:border-blue-500/50 inline-flex items-center gap-2"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path d="M12 6v6l4 2" />
          </svg>
          Run Management
        </button>
      </div>

      {chatModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 sm:p-6 backdrop-blur-sm">
          <div className="w-full max-w-5xl h-[85vh] bg-(--bg) border border-(--border) rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex-1 overflow-hidden relative">
              <ChatInner 
                initialMessage={
                  chatModal.action === "screening" 
                    ? "Tolong lakukan screening untuk mencari pool terbaik yang bisa di-deploy saat ini." 
                    : "Tolong lakukan management untuk memeriksa status pool dan posisi saat ini."
                } 
                initialRole={chatModal.action === "screening" ? "SCREENER" : "MANAGER"}
                onClose={() => setChatModal(null)} 
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
