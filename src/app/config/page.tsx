"use client";
import { useEffect, useState } from "react";

export default function ConfigPage() {
  const [config, setConfig] = useState<any>(null);

  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then(setConfig);
  }, []);

  if (!config) return <div className="text-[var(--muted)]">Loading config...</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Configuration</h1>
      {Object.entries(config).map(([section, values]) => (
        <div key={section} className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-3 capitalize">{section}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            {Object.entries(values as Record<string, unknown>).map(([key, val]) => (
              <div key={key} className="flex justify-between py-1 border-b border-[var(--border)] last:border-0">
                <span className="text-[var(--muted)]">{key}</span>
                <span className="font-mono">{JSON.stringify(val)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
