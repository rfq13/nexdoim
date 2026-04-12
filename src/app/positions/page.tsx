"use client";
import { useCallback, useEffect, useState } from "react";

interface Position {
  position: string;
  pool: string;
  pair: string;
  in_range: boolean;
  minutes_out_of_range: number | null;
  active_bin: number | null;
  lower_bin: number | null;
  upper_bin: number | null;
  pnl_usd: number;
  pnl_pct: number;
  unclaimed_fees_usd: number;
  total_value_usd: number;
  collected_fees_usd: number;
  age_minutes: number | null;
  instruction: string | null;
}

interface Thresholds {
  outOfRangeWaitMinutes: number;
  outOfRangeBinsToClose: number;
  emergencyPriceDropPct: number;
  minFeePerTvl24h: number;
}

const DEFAULT_THRESHOLDS: Thresholds = {
  outOfRangeWaitMinutes: 30,
  outOfRangeBinsToClose: 10,
  emergencyPriceDropPct: -50,
  minFeePerTvl24h: 7,
};

function computeBinsAway(pos: Position): number {
  if (pos.in_range || pos.active_bin == null) return 0;
  if (pos.lower_bin != null && pos.active_bin < pos.lower_bin) return pos.lower_bin - pos.active_bin;
  if (pos.upper_bin != null && pos.active_bin > pos.upper_bin) return pos.active_bin - pos.upper_bin;
  return 0;
}

type HealthLevel = "healthy" | "warning" | "danger" | "critical";

function getLevel(pct: number): HealthLevel {
  if (pct >= 90) return "critical";
  if (pct >= 65) return "danger";
  if (pct >= 40) return "warning";
  return "healthy";
}

function overallHealth(indicators: Array<{ pct: number }>): { level: HealthLevel; label: string } {
  const maxPct = Math.max(...indicators.map((i) => i.pct), 0);
  const level = getLevel(maxPct);
  const labels: Record<HealthLevel, string> = {
    healthy: "Sehat",
    warning: "Waspada",
    danger: "Bahaya",
    critical: "Close Imminent",
  };
  return { level, label: labels[level] };
}

const LEVEL_COLORS: Record<HealthLevel, { bar: string; text: string; dot: string }> = {
  healthy:  { bar: "bg-green-500",  text: "text-green-400",  dot: "bg-green-400" },
  warning:  { bar: "bg-yellow-500", text: "text-yellow-400", dot: "bg-yellow-400" },
  danger:   { bar: "bg-orange-500", text: "text-orange-400", dot: "bg-orange-400" },
  critical: { bar: "bg-red-500",    text: "text-red-400",    dot: "bg-red-400" },
};

function HealthBar({ label, value, max, unit, pct }: { label: string; value: string; max: string; unit?: string; pct: number }) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  const level = getLevel(clamped);
  const c = LEVEL_COLORS[level];
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-(--muted) w-24 sm:w-28 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-2 bg-(--border) rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${c.bar}`} style={{ width: `${clamped}%` }} />
      </div>
      <span className={`font-mono text-[11px] w-24 text-right shrink-0 ${c.text}`}>
        {value} / {max}{unit ? ` ${unit}` : ""}
      </span>
    </div>
  );
}

export default function PositionsPage() {
  const [data, setData] = useState<any>(null);
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [refreshing, setRefreshing] = useState(false);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const [posRes, cfgRes] = await Promise.all([
        fetch("/api/positions").then((r) => r.json()).catch(() => null),
        fetch("/api/config").then((r) => r.json()).catch(() => null),
      ]);
      if (posRes) setData(posRes);
      if (cfgRes?.management) {
        setThresholds({
          outOfRangeWaitMinutes: cfgRes.management.outOfRangeWaitMinutes ?? 30,
          outOfRangeBinsToClose: cfgRes.management.outOfRangeBinsToClose ?? 10,
          emergencyPriceDropPct: cfgRes.management.emergencyPriceDropPct ?? -50,
          minFeePerTvl24h: cfgRes.management.minFeePerTvl24h ?? 7,
        });
      }
    } catch { /* silent */ }
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);
  useEffect(() => {
    const tick = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  const manualRefresh = () => { setRefreshing(true); load(); };

  if (!data) return <div className="text-(--muted) text-sm p-4">Loading positions...</div>;

  const positions: Position[] = data.positions ?? [];

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Positions ({data.total_positions})</h1>
          {data.wallet && (
            <p className="text-[10px] text-(--muted) font-mono mt-1 break-all">{data.wallet}</p>
          )}
        </div>
        <button
          onClick={manualRefresh}
          disabled={refreshing}
          className="text-xs px-3 py-1.5 border border-(--border) rounded-lg hover:border-(--accent) transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {refreshing
            ? <><span className="w-2 h-2 rounded-full bg-(--accent) animate-pulse" />Memuat...</>
            : "Refresh"
          }
        </button>
      </div>

      {positions.length === 0 && (
        <div className="text-(--muted) text-sm border border-dashed border-(--border) rounded-xl p-8 text-center">
          Tidak ada posisi terbuka.
        </div>
      )}

      {positions.map((p) => {
        const binsAway = computeBinsAway(p);
        const oorMin = p.minutes_out_of_range ?? 0;
        const age = p.age_minutes ?? 0;

        // Compute health indicators as percentage toward close threshold
        const indicators = [
          {
            label: "OOR Duration",
            value: `${oorMin}m`,
            max: `${thresholds.outOfRangeWaitMinutes}m`,
            pct: p.in_range ? 0 : (oorMin / thresholds.outOfRangeWaitMinutes) * 100,
          },
          {
            label: "Bins Away",
            value: String(binsAway),
            max: String(thresholds.outOfRangeBinsToClose),
            pct: p.in_range ? 0 : (binsAway / thresholds.outOfRangeBinsToClose) * 100,
          },
          {
            label: "PnL vs Emergency",
            value: `${p.pnl_pct >= 0 ? "+" : ""}${p.pnl_pct}%`,
            max: `${thresholds.emergencyPriceDropPct}%`,
            // pct increases as pnl drops toward emergency threshold
            pct: p.pnl_pct >= 0 ? 0 : Math.min(100, (Math.abs(p.pnl_pct) / Math.abs(thresholds.emergencyPriceDropPct)) * 100),
          },
        ];

        const health = overallHealth(indicators);
        const hc = LEVEL_COLORS[health.level];
        const totalFees = (p.unclaimed_fees_usd ?? 0) + (p.collected_fees_usd ?? 0);

        return (
          <div key={p.position} className="bg-(--card) border border-(--border) rounded-xl overflow-hidden">
            {/* ── Header row ──────────────────────────────────────── */}
            <div className="p-4 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-base sm:text-lg">{p.pair}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold ${
                      p.in_range
                        ? "bg-green-500/15 text-green-400"
                        : "bg-red-500/15 text-red-400"
                    }`}>
                      {p.in_range ? "IN RANGE" : "OOR"}
                    </span>
                    {/* Health badge */}
                    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold ${hc.text} bg-black/20`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${hc.dot} ${health.level === "critical" ? "animate-pulse" : ""}`} />
                      {health.label}
                    </span>
                  </div>
                  <div className="text-[10px] text-(--muted) font-mono mt-0.5 truncate">{p.position}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`text-lg font-bold tabular-nums ${p.pnl_usd >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {p.pnl_usd >= 0 ? "+" : ""}${p.pnl_usd} ({p.pnl_pct}%)
                  </div>
                  <div className="text-xs text-(--muted)">Value: ${p.total_value_usd}</div>
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3">
                <Stat label="Unclaimed Fees" value={`$${p.unclaimed_fees_usd}`} />
                <Stat label="Total Fees" value={`$${totalFees.toFixed(2)}`} />
                <Stat label="Age" value={`${age}m`} note={age < 60 ? "close rules belum aktif" : undefined} />
                <Stat label="Bin Range" value={`${p.lower_bin ?? "?"}..${p.upper_bin ?? "?"}`} mono />
                <Stat label="Active Bin" value={String(p.active_bin ?? "?")} mono />
              </div>
            </div>

            {/* ── Health Gauge ─────────────────────────────────────── */}
            <div className="px-4 py-3 border-t border-(--border) bg-black/15 space-y-1.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-(--muted) uppercase tracking-wider font-semibold">Health Gauge</span>
                <span className="text-[10px] text-(--muted)">
                  Threshold close aktif setelah {">"}60m
                </span>
              </div>
              {indicators.map((ind) => (
                <HealthBar key={ind.label} label={ind.label} value={ind.value} max={ind.max} pct={ind.pct} />
              ))}
              {!p.in_range && oorMin > 0 && binsAway > 0 && (
                <div className="text-[10px] text-(--muted) mt-1 pl-26 sm:pl-30">
                  OOR sejak {oorMin}m · {binsAway} bin dari range · {
                    oorMin >= thresholds.outOfRangeWaitMinutes && binsAway >= thresholds.outOfRangeBinsToClose
                      ? "⚠️ Management cycle akan rekomendasikan CLOSE"
                      : oorMin >= thresholds.outOfRangeWaitMinutes
                        ? "Durasi OOR sudah lewat threshold"
                        : binsAway >= thresholds.outOfRangeBinsToClose
                          ? "Bins away sudah lewat threshold"
                          : ""
                  }
                </div>
              )}
            </div>

            {/* Instruction note */}
            {p.instruction && (
              <div className="mx-4 mb-3 text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">
                📝 {p.instruction}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Stat({ label, value, note, mono }: { label: string; value: string; note?: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-(--muted) text-[10px] uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-medium ${mono ? "font-mono text-xs" : ""}`}>{value}</div>
      {note && <div className="text-[9px] text-(--muted)/70 italic">{note}</div>}
    </div>
  );
}
