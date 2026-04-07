"use client";
import { useEffect, useState } from "react";

export default function ConfigPage() {
  const [config, setConfig] = useState<any>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelDraft, setModelDraft] = useState({
    generalModel: "",
    managementModel: "",
    screeningModel: "",
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    Promise.all([
      fetch("/api/config").then((r) => r.json()),
      fetch("/api/models")
        .then((r) => r.json())
        .catch(() => ({ models: [] })),
    ]).then(([cfg, modelData]) => {
      setConfig(cfg);
      setModels(Array.isArray(modelData?.models) ? modelData.models : []);
      setModelDraft({
        generalModel: cfg?.llm?.generalModel || "",
        managementModel: cfg?.llm?.managementModel || "",
        screeningModel: cfg?.llm?.screeningModel || "",
      });
    });
  }, []);

  const saveModels = async () => {
    setSaving(true);
    setStatus("");
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changes: {
            generalModel: modelDraft.generalModel,
            managementModel: modelDraft.managementModel,
            screeningModel: modelDraft.screeningModel,
          },
          reason: "Manual model selection from config page",
        }),
      });
      const result = await res.json();
      if (!res.ok || result.success === false)
        throw new Error(result.error || "Failed to update model config");
      setConfig((prev: any) => ({
        ...prev,
        llm: {
          ...prev.llm,
          ...modelDraft,
        },
      }));
      setStatus("Model config updated");
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!config)
    return <div className="text-[var(--muted)]">Loading config...</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Configuration</h1>

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-4 space-y-3">
        <h2 className="text-lg font-semibold">Model Selection (Ollama)</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <ModelSelect
            label="General"
            value={modelDraft.generalModel}
            models={models}
            onChange={(value) =>
              setModelDraft((prev) => ({ ...prev, generalModel: value }))
            }
          />
          <ModelSelect
            label="Manager"
            value={modelDraft.managementModel}
            models={models}
            onChange={(value) =>
              setModelDraft((prev) => ({ ...prev, managementModel: value }))
            }
          />
          <ModelSelect
            label="Screener"
            value={modelDraft.screeningModel}
            models={models}
            onChange={(value) =>
              setModelDraft((prev) => ({ ...prev, screeningModel: value }))
            }
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={saveModels}
            disabled={saving}
            className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 text-sm"
          >
            {saving ? "Saving..." : "Save Model Config"}
          </button>
          {status && (
            <span className="text-sm text-[var(--muted)]">{status}</span>
          )}
        </div>
      </div>

      {Object.entries(config).map(([section, values]) => (
        <div
          key={section}
          className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-4"
        >
          <h2 className="text-lg font-semibold mb-3 capitalize">{section}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            {Object.entries(values as Record<string, unknown>).map(
              ([key, val]) => (
                <div
                  key={key}
                  className="flex justify-between py-1 border-b border-[var(--border)] last:border-0"
                >
                  <span className="text-[var(--muted)]">{key}</span>
                  <span className="font-mono">{JSON.stringify(val)}</span>
                </div>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ModelSelect({
  label,
  value,
  models,
  onChange,
}: {
  label: string;
  value: string;
  models: string[];
  onChange: (v: string) => void;
}) {
  const options =
    value && !models.includes(value) ? [value, ...models] : models;

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[var(--muted)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-[var(--card)] border border-[var(--border)] rounded-lg px-3 py-2"
      >
        {options.length === 0 && (
          <option value={value || ""}>{value || "No model detected"}</option>
        )}
        {options.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </label>
  );
}
