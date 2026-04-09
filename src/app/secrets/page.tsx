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

const KEY_INSTRUCTIONS: Record<string, string> = {
  OLLAMA_HOST: "URL API Ollama (contoh: http://localhost:11434).",
  OLLAMA_MODEL: "Nama model utama (contoh: llama3).",
  OLLAMA_FALLBACK_MODEL: "Nama model cadangan jika utama gagal.",
  OLLAMA_API_KEY: "Dapatkan dari provider cloud Ollama Anda (kosongkan jika lokal).",
  LLM_API_KEY: "Dapatkan dari layanan kustom jika tidak menggunakan standard (fallback dari OLLAMA_API_KEY).",
  OPENROUTER_API_KEY: "Dapatkan OpenRouter API Key di https://openrouter.ai/keys",
  TELEGRAM_BOT_TOKEN: "Buat bot baru dan dapatkan token via @BotFather di Telegram.",
  RPC_URL: "URL RPC jaringan Solana (dapatkan dari Helius, QuickNode, Alchemy, dll).",
  WALLET_PRIVATE_KEY: "Export private key dari wallet Solana Anda. JANGAN DIBAGIKAN KE SIAPAPUN.",
  HELIUS_API_KEY: "Dapatkan API Key Helius di dashboard mereka (https://dev.helius.xyz/).",
  DRY_RUN: "Isi dengan 'true' untuk mode simulasi tanpa melakukan aksi sungguhan."
};

export default function SecretsPage() {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

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
    setSavingKey(editingKey);
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
      setSavingKey(null);
    }
  }

  async function addNewSecret() {
    if (!newKey || !newValue) return;
    setIsAdding(true);
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
      setIsAdding(false);
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
            disabled={isAdding}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isAdding ? "Saving..." : "Add"}
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
              <div className="flex-1 flex items-center flex-wrap gap-2">
                <span className="font-mono font-bold text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                  {s.key}
                  {KEY_INSTRUCTIONS[s.key] && (
                    <span 
                      className="cursor-help inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300 text-[10px]"
                      title={KEY_INSTRUCTIONS[s.key]}
                    >
                      ?
                    </span>
                  )}
                </span>
                {editingKey === s.key ? (
                  <input
                    className="p-1 border rounded dark:bg-gray-900 dark:border-gray-600 w-full max-w-xs"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    autoFocus
                  />
                ) : (
                  <span className={`font-mono text-sm ${s.value ? "text-gray-500" : "text-red-500 font-bold"}`}>
                    {s.value ? s.value : "[NOT CONFIGURED]"}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                {editingKey === s.key ? (
                  <>
                    <button
                      onClick={saveSecret}
                      disabled={savingKey === s.key}
                      className="px-3 py-1 bg-green-600 text-white rounded text-sm disabled:opacity-50"
                    >
                      {savingKey === s.key ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={() => setEditingKey(null)}
                      disabled={savingKey === s.key}
                      className="px-3 py-1 bg-gray-500 text-white rounded text-sm disabled:opacity-50"
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
