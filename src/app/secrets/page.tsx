"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Secret {
  id: string;
  key: string;
  value: string;
}

const EXPECTED_KEYS = [
  "OLLAMA_HOST",
  "OLLAMA_MODEL",
  "OLLAMA_FALLBACK_MODEL",
  "OLLAMA_API_KEY",
  "LLM_API_KEY",
  "OPENROUTER_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "RPC_URL",
  "WALLET_PRIVATE_KEY",
  "HELIUS_API_KEY",
  "DRY_RUN"
];

export default function SecretsPage() {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSecrets();
  }, []);

  async function fetchSecrets() {
    setLoading(true);
    try {
      const res = await fetch("/api/secrets");
      const data = await res.json();
      const existing = Array.isArray(data) ? data : [];
      
      const merged = EXPECTED_KEYS.map((k) => {
        const found = existing.find((s: Secret) => s.key === k);
        return found || { id: k, key: k, value: "" };
      });
      existing.forEach((s: Secret) => {
        if (!EXPECTED_KEYS.includes(s.key)) merged.push(s);
      });
      
      setSecrets(merged);
    } catch (e) {
      console.error("Failed to fetch secrets", e);
    } finally {
      setLoading(false);
    }
  }

  async function saveSecret() {
    if (!editingKey || !editValue) return;
    setSaving(true);
    try {
      await fetch("/api/secrets", {
        method: "POST",
        body: JSON.stringify({ key: editingKey, value: editValue }),
      });
      setEditingKey(null);
      setEditValue("");
      await fetchSecrets();
    } catch (e) {
      console.error("Failed to save secret", e);
    } finally {
      setSaving(false);
    }
  }

  async function addNewSecret() {
    if (!newKey || !newValue) return;
    setSaving(true);
    try {
      await fetch("/api/secrets", {
        method: "POST",
        body: JSON.stringify({ key: newKey, value: newValue }),
      });
      setNewKey("");
      setNewValue("");
      await fetchSecrets();
    } catch (e) {
      console.error("Failed to add secret", e);
    } finally {
      setSaving(false);
    }
  }

  async function deleteSecret(key: string) {
    if (!confirm(`Delete ${key}?`)) return;
    try {
      await fetch(`/api/secrets?key=${key}`, { method: "DELETE" });
      await fetchSecrets();
    } catch (e) {
      console.error("Failed to delete secret", e);
    }
  }

  if (loading) return <div className="p-8 text-center">Loading secrets...</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">API Keys & Secrets</h1>

      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow mb-8 border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold mb-4">Add New Secret</h2>
        <div className="flex gap-4">
          <input
            className="flex-1 p-2 border rounded dark:bg-gray-900 dark:border-gray-600"
            placeholder="KEY_NAME (e.g. RPC_URL)"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
          />
          <input
            className="flex-1 p-2 border rounded dark:bg-gray-900 dark:border-gray-600"
            placeholder="Value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
          />
          <button
            onClick={addNewSecret}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Add"}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold mb-2">Existing Secrets</h2>
        {secrets.length === 0 ? (
          <p className="text-gray-500">No secrets configured.</p>
        ) : (
          secrets.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm"
            >
              <div className="flex-1">
                <span className="font-mono font-bold text-sm text-gray-700 dark:text-gray-300">
                  {s.key}
                </span>
                {editingKey === s.key ? (
                  <input
                    className="ml-4 p-1 border rounded dark:bg-gray-900 dark:border-gray-600 w-full max-w-xs"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    autoFocus
                  />
                ) : (
                  <span className={`ml-4 font-mono text-sm ${s.value ? "text-gray-500" : "text-red-500 font-bold"}`}>
                    {s.value ? s.value : "[NOT CONFIGURED]"}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                {editingKey === s.key ? (
                  <>
                    <button
                      onClick={saveSecret}
                      className="px-3 py-1 bg-green-600 text-white rounded text-sm"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingKey(null)}
                      className="px-3 py-1 bg-gray-500 text-white rounded text-sm"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setEditingKey(s.key);
                        setEditValue("");
                      }}
                      className="px-3 py-1 bg-blue-600 text-white rounded text-sm"
                    >
                      {s.value ? "Edit" : "Set Value"}
                    </button>
                    {s.value && (
                      <button
                        onClick={() => deleteSecret(s.key)}
                        className="px-3 py-1 bg-red-600 text-white rounded text-sm"
                      >
                        Delete
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
