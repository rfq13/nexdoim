/**
 * Decision logging for agent self-reflection.
 *
 * Every deploy, close, or skip is logged with the reason and risks
 * identified. The agent can call get_recent_decisions to introspect
 * past actions and avoid repeating mistakes.
 */

import { supabase } from "./db";

export interface DecisionEntry {
  type: "deploy" | "skip" | "close" | "rebalance" | "note";
  actor?: "SCREENER" | "MANAGER" | "GENERAL";
  pool?: string;
  pool_name?: string;
  position?: string;
  summary?: string;
  reason?: string;
  risks?: string[];
  metrics?: Record<string, unknown>;
  rejected?: string[];
}

function sanitize(value: string | null | undefined, maxLen = 280): string | null {
  if (value == null) return null;
  return String(value).replace(/\s+/g, " ").trim().slice(0, maxLen) || null;
}

export async function appendDecision(entry: DecisionEntry): Promise<{ id: number }> {
  const { data, error } = await supabase
    .from("decision_log")
    .insert({
      type:      entry.type || "note",
      actor:     entry.actor || "GENERAL",
      pool:      entry.pool || null,
      pool_name: sanitize(entry.pool_name || entry.pool, 120),
      position:  entry.position || null,
      summary:   sanitize(entry.summary),
      reason:    sanitize(entry.reason, 500),
      risks:     Array.isArray(entry.risks)
        ? entry.risks.map((r) => sanitize(r, 140)).filter(Boolean).slice(0, 6)
        : [],
      metrics:   entry.metrics || {},
      rejected:  Array.isArray(entry.rejected)
        ? entry.rejected.map((r) => sanitize(r, 180)).filter(Boolean).slice(0, 8)
        : [],
    })
    .select("id")
    .single();

  if (error) throw error;
  return { id: data.id };
}

export async function getRecentDecisions(limit = 10): Promise<any[]> {
  const { data, error } = await supabase
    .from("decision_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function getDecisionSummary(limit = 6): Promise<string> {
  const decisions = await getRecentDecisions(limit);
  if (!decisions.length) return "No recent structured decisions yet.";

  return decisions.map((d, i) => {
    const bits = [
      `${i + 1}. [${d.actor}] ${d.type.toUpperCase()} ${d.pool_name || d.pool || "unknown"}`,
      d.summary ? `summary: ${d.summary}` : null,
      d.reason  ? `reason: ${d.reason}`   : null,
      d.risks?.length   ? `risks: ${d.risks.join(", ")}`     : null,
      d.rejected?.length ? `rejected: ${d.rejected.join(" | ")}` : null,
    ].filter(Boolean);
    return bits.join(" | ");
  }).join("\n");
}
