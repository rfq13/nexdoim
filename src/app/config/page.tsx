"use client";
import { useEffect, useState } from "react";

// ─── Field metadata ────────────────────────────────────────────────────────

type FieldDef =
  | { type: "number"; label: string; min?: number; max?: number; step?: number; description?: string }
  | { type: "boolean"; label: string; description?: string }
  | { type: "text"; label: string; description?: string }
  | { type: "select"; label: string; options: string[]; description?: string };

const SECTION_FIELDS: Record<string, Record<string, FieldDef>> = {
  screening: {
    minFeeActiveTvlRatio: { type: "number", label: "Min Fee/Active TVL Ratio", step: 0.01, min: 0, description: "Rasio minimum fee terhadap TVL aktif (misal: 0.02 = 2%)" },
    minTvl:               { type: "number", label: "Min TVL ($)", min: 0, step: 1000, description: "Total value locked minimum dalam pool" },
    maxTvl:               { type: "number", label: "Max TVL ($)", min: 0, step: 10000, description: "Batasan atas TVL — pool terlalu besar sering sudah jenuh" },
    minVolume:            { type: "number", label: "Min Volume ($)", min: 0, step: 100, description: "Volume trading minimum 24h" },
    minOrganic:           { type: "number", label: "Min Organic Score (%)", min: 0, max: 100, step: 5, description: "Persentase volume organik (bukan wash trade)" },
    minHolders:           { type: "number", label: "Min Token Holders", min: 0, step: 50, description: "Jumlah minimum holder token base" },
    minMcap:              { type: "number", label: "Min Market Cap ($)", min: 0, step: 10000, description: "Market cap minimum token base" },
    maxMcap:              { type: "number", label: "Max Market Cap ($)", min: 0, step: 100000, description: "Market cap maksimum — batasi ke token kecil/menengah" },
    minBinStep:           { type: "number", label: "Min Bin Step", min: 1, step: 5, description: "Bin step minimum pool DLMM (bps). 20 = 0.2% per bin" },
    maxBinStep:           { type: "number", label: "Max Bin Step", min: 1, step: 5, description: "Bin step maksimum. Terlalu tinggi = volatilitas ekstrem" },
    minTokenFeesSol:      { type: "number", label: "Min Total Fees (SOL)", min: 0, step: 1, description: "Total fee yang sudah dihasilkan token ini (proxy popularitas)" },
    maxBundlersPct:       { type: "number", label: "Max Bundlers (%)", min: 0, max: 100, step: 5, description: "Batas maksimal persentase supply dari bundler (bot sniper)" },
    maxTop10Pct:          { type: "number", label: "Max Top 10 Holders (%)", min: 0, max: 100, step: 5, description: "Konsentrasi supply top 10 holder — tinggi = risiko dump" },
    timeframe:            { type: "select", label: "Timeframe API", options: ["1m", "5m", "15m", "1h", "4h"], description: "Timeframe data dari API Meteora" },
    category:             { type: "select", label: "Category", options: ["trending", "new", "stable", "all"], description: "Kategori pool yang di-scan" },
    avoidPvpSymbols:      { type: "boolean", label: "Avoid PVP Symbols", description: "Tandai pool yang bersaing dengan pool token sama (tapi tetap tampil)" },
    blockPvpSymbols:      { type: "boolean", label: "Block PVP Symbols", description: "Filter ketat: buang pool PVP dari kandidat sama sekali" },
  },
  management: {
    deployAmountSol:         { type: "number", label: "Deploy Amount (SOL)", min: 0, step: 0.05, description: "Jumlah SOL minimum per deploy posisi" },
    positionSizePct:         { type: "number", label: "Position Size (%)", min: 0, max: 1, step: 0.05, description: "Proporsi dari saldo deployable untuk tiap posisi (0.35 = 35%)" },
    minSolToOpen:            { type: "number", label: "Min SOL to Open", min: 0, step: 0.05, description: "Saldo SOL minimum sebelum boleh buka posisi baru" },
    gasReserve:              { type: "number", label: "Gas Reserve (SOL)", min: 0, step: 0.05, description: "SOL yang selalu dipesan untuk gas transaksi" },
    minClaimAmount:          { type: "number", label: "Min Claim Amount ($)", min: 0, step: 1, description: "Minimum fee (USD) sebelum di-claim otomatis" },
    autoSwapAfterClaim:      { type: "boolean", label: "Auto Swap After Claim", description: "Swap token ke SOL otomatis setelah claim fee" },
    outOfRangeBinsToClose:   { type: "number", label: "Out-of-Range Bins to Close", min: 0, step: 1, description: "Jumlah bin di luar range sebelum posisi ditutup" },
    outOfRangeWaitMinutes:   { type: "number", label: "Out-of-Range Wait (min)", min: 0, step: 5, description: "Tunggu X menit sebelum tutup posisi yang keluar range" },
    minVolumeToRebalance:    { type: "number", label: "Min Volume to Rebalance ($)", min: 0, step: 100, description: "Volume minimum agar rebalancing layak dilakukan" },
    emergencyPriceDropPct:   { type: "number", label: "Emergency Close Drop (%)", max: 0, step: -5, description: "Tutup darurat jika harga turun X% (negatif, misal: -50)" },
    takeProfitFeePct:        { type: "number", label: "Take Profit Fee (%)", min: 0, step: 1, description: "Tutup posisi jika fee earned mencapai X% dari nilai posisi" },
    minFeePerTvl24h:         { type: "number", label: "Min Fee/TVL 24h (%)", min: 0, step: 1, description: "Fee yield minimum per hari agar posisi dipertahankan" },
  },
  risk: {
    maxPositions:    { type: "number", label: "Max Positions", min: 1, step: 1, description: "Jumlah posisi terbuka maksimum bersamaan" },
    maxDeployAmount: { type: "number", label: "Max Deploy Amount (SOL)", min: 0, step: 1, description: "Batas atas SOL per satu deploy posisi" },
  },
  schedule: {
    managementIntervalMin: { type: "number", label: "Management Interval (min)", min: 1, step: 1, description: "Seberapa sering cron management berjalan" },
    screeningIntervalMin:  { type: "number", label: "Screening Interval (min)", min: 1, step: 1, description: "Seberapa sering cron screening berjalan" },
    healthCheckIntervalMin:{ type: "number", label: "Health Check Interval (min)", min: 1, step: 5, description: "Interval pengecekan kesehatan sistem" },
  },
  strategy: {
    strategy:  { type: "select", label: "Strategy", options: ["bid_ask", "spot", "curve"], description: "Strategi distribusi likuiditas DLMM" },
    binsBelow: { type: "number", label: "Bins Below", min: 1, max: 138, step: 1, description: "Jumlah bin di bawah harga aktif untuk posisi bid" },
  },
  darwin: {
    enabled:      { type: "boolean", label: "Darwin Learning Enabled", description: "Aktifkan Darwinian signal weighting (self-learning)" },
    windowDays:   { type: "number", label: "Window (days)", min: 7, step: 7, description: "Berapa hari data historis dipakai untuk recalculate bobot" },
    minSamples:   { type: "number", label: "Min Samples", min: 1, step: 1, description: "Minimum data poin sebelum recalculation dijalankan" },
    boostFactor:  { type: "number", label: "Boost Factor", min: 1, max: 2, step: 0.01, description: "Faktor penguat untuk sinyal yang terbukti prediktif" },
    decayFactor:  { type: "number", label: "Decay Factor", min: 0.5, max: 1, step: 0.01, description: "Faktor pelemah untuk sinyal yang tidak prediktif" },
    weightFloor:  { type: "number", label: "Weight Floor", min: 0.01, step: 0.05, description: "Bobot minimum — sinyal tidak pernah bernilai 0" },
    weightCeiling:{ type: "number", label: "Weight Ceiling", min: 1, step: 0.1, description: "Bobot maksimum — batas atas penguatan sinyal" },
  },
};

const SECTION_TITLES: Record<string, string> = {
  screening:  "Screening & Filter Pool",
  management: "Manajemen Posisi",
  risk:       "Risk Control",
  schedule:   "Jadwal Cron",
  strategy:   "Strategi DLMM",
  darwin:     "Darwin Self-Learning",
};

// ─── Component ────────────────────────────────────────────────────────────

export default function ConfigPage() {
  const [config, setConfig] = useState<any>(null);
  const [drafts, setDrafts] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [models, setModels] = useState<string[]>([]);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ screening: true });

  useEffect(() => {
    Promise.all([
      fetch("/api/config").then((r) => r.json()),
      fetch("/api/models").then((r) => r.json()).catch(() => ({ models: [] })),
    ]).then(([cfg, modelData]) => {
      setConfig(cfg);
      setDrafts(structuredClone(cfg));
      setModels(Array.isArray(modelData?.models) ? modelData.models : []);
    });
  }, []);

  const setField = (section: string, key: string, value: any) => {
    setDrafts((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }));
  };

  const saveSection = async (section: string) => {
    setSaving((s) => ({ ...s, [section]: true }));
    setStatus((s) => ({ ...s, [section]: "" }));
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, data: drafts[section] }),
      });
      const result = await res.json();
      if (!res.ok || result.success === false)
        throw new Error(result.error || "Gagal menyimpan");
      setConfig((prev: any) => ({ ...prev, [section]: drafts[section] }));
      setStatus((s) => ({ ...s, [section]: "Tersimpan ✓" }));
      setTimeout(() => setStatus((s) => ({ ...s, [section]: "" })), 2500);
    } catch (e: any) {
      setStatus((s) => ({ ...s, [section]: `Error: ${e.message}` }));
    } finally {
      setSaving((s) => ({ ...s, [section]: false }));
    }
  };

  const resetSection = (section: string) => {
    setDrafts((prev) => ({ ...prev, [section]: structuredClone(config[section]) }));
    setStatus((s) => ({ ...s, [section]: "" }));
  };

  const isDirty = (section: string) =>
    JSON.stringify(drafts[section]) !== JSON.stringify(config?.[section]);

  if (!config) {
    return <div className="text-(--muted) p-6">Loading config...</div>;
  }

  return (
    <div className="space-y-3 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Configuration</h1>
        <p className="text-xs text-(--muted)">Perubahan disimpan ke database dan langsung aktif</p>
      </div>

      {/* LLM Models — special section */}
      <SectionCard
        title="Model LLM (Ollama / OpenRouter)"
        open={!!openSections["llm"]}
        onToggle={() => setOpenSections((s) => ({ ...s, llm: !s["llm"] }))}
        dirty={isDirty("llm")}
        saving={saving["llm"]}
        status={status["llm"]}
        onSave={() => saveSection("llm")}
        onReset={() => resetSection("llm")}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(["generalModel", "managementModel", "screeningModel"] as const).map((key) => {
            const labelMap = { generalModel: "General Agent", managementModel: "Manager Agent", screeningModel: "Screener Agent" };
            const val = drafts.llm?.[key] ?? "";
            const opts = val && !models.includes(val) ? [val, ...models] : models;
            return (
              <label key={key} className="flex flex-col gap-1 text-sm">
                <span className="text-(--muted)">{labelMap[key]}</span>
                <select
                  value={val}
                  onChange={(e) => setField("llm", key, e.target.value)}
                  className="bg-(--bg) border border-(--border) rounded-lg px-3 py-2 focus:border-(--accent) outline-none"
                >
                  {opts.length === 0 && <option value={val || ""}>{val || "Tidak ada model"}</option>}
                  {opts.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            );
          })}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <NumberField label="Temperature" value={drafts.llm?.temperature} step={0.01} min={0} max={2}
            onChange={(v) => setField("llm", "temperature", v)} description="Kreativitas LLM (0=deterministik, 1=kreatif)" />
          <NumberField label="Max Tokens" value={drafts.llm?.maxTokens} step={256} min={512}
            onChange={(v) => setField("llm", "maxTokens", v)} description="Batas panjang respons LLM" />
          <NumberField label="Max Steps (ReAct)" value={drafts.llm?.maxSteps} step={1} min={3} max={50}
            onChange={(v) => setField("llm", "maxSteps", v)} description="Maksimal iterasi tool-call dalam 1 run" />
        </div>
      </SectionCard>

      {/* All other sections */}
      {Object.entries(SECTION_FIELDS).map(([section, fields]) => (
        <SectionCard
          key={section}
          title={SECTION_TITLES[section] || section}
          open={!!openSections[section]}
          onToggle={() => setOpenSections((s) => ({ ...s, [section]: !s[section] }))}
          dirty={isDirty(section)}
          saving={saving[section]}
          status={status[section]}
          onSave={() => saveSection(section)}
          onReset={() => resetSection(section)}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            {Object.entries(fields).map(([key, def]) => {
              const val = drafts[section]?.[key];
              if (def.type === "boolean") {
                return (
                  <ToggleField
                    key={key}
                    label={def.label}
                    description={def.description}
                    checked={!!val}
                    onChange={(v) => setField(section, key, v)}
                  />
                );
              }
              if (def.type === "select") {
                return (
                  <SelectField
                    key={key}
                    label={def.label}
                    description={def.description}
                    value={String(val ?? "")}
                    options={def.options}
                    onChange={(v) => setField(section, key, v)}
                  />
                );
              }
              return (
                <NumberField
                  key={key}
                  label={def.label}
                  description={def.description}
                  value={val}
                  step={def.type === "number" ? def.step : undefined}
                  min={def.type === "number" ? def.min : undefined}
                  max={def.type === "number" ? def.max : undefined}
                  onChange={(v) => setField(section, key, v)}
                />
              );
            })}
          </div>
        </SectionCard>
      ))}
    </div>
  );
}

// ─── Section Card ─────────────────────────────────────────────────────────

function SectionCard({
  title, open, onToggle, dirty, saving, status, onSave, onReset, children,
}: {
  title: string; open: boolean; onToggle: () => void;
  dirty: boolean; saving: boolean; status: string;
  onSave: () => void; onReset: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-(--card) border border-(--border) rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/5 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{title}</span>
          {dirty && !saving && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400">unsaved</span>
          )}
        </div>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`text-(--muted) transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-(--border)">
          {children}
          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-(--border)">
            <button
              onClick={onSave}
              disabled={saving || !dirty}
              className="px-4 py-2 bg-(--accent) text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              {saving ? "Menyimpan..." : "Simpan"}
            </button>
            {dirty && !saving && (
              <button
                onClick={onReset}
                className="px-4 py-2 text-sm text-(--muted) hover:text-(--text) border border-(--border) rounded-lg transition-colors"
              >
                Reset
              </button>
            )}
            {status && (
              <span className={`text-sm ${status.startsWith("Error") ? "text-red-400" : "text-green-400"}`}>
                {status}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Field primitives ─────────────────────────────────────────────────────

function NumberField({ label, value, step, min, max, description, onChange }: {
  label: string; value: any; step?: number; min?: number; max?: number;
  description?: string; onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {description && <span className="text-xs text-(--muted) leading-tight">{description}</span>}
      <input
        type="number"
        value={value ?? ""}
        step={step ?? 1}
        min={min}
        max={max}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="bg-(--bg) border border-(--border) rounded-lg px-3 py-2 text-sm focus:border-(--accent) outline-none"
      />
    </label>
  );
}

function ToggleField({ label, checked, description, onChange }: {
  label: string; checked: boolean; description?: string; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {description && <span className="text-xs text-(--muted) leading-tight">{description}</span>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-10 h-5.5 mt-0.5 rounded-full transition-colors ${checked ? "bg-(--accent)" : "bg-(--border)"}`}
        style={{ height: "22px", minWidth: "40px" }}
      >
        <span
          className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
          style={{ transform: checked ? "translateX(18px)" : "translateX(0)" }}
        />
      </button>
    </div>
  );
}

function SelectField({ label, value, options, description, onChange }: {
  label: string; value: string; options: string[]; description?: string; onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {description && <span className="text-xs text-(--muted) leading-tight">{description}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-(--bg) border border-(--border) rounded-lg px-3 py-2 text-sm focus:border-(--accent) outline-none"
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
