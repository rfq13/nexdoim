/**
 * Parser for the structured DECISION_JSON block that the SCREENER agent
 * appends to its report. The backend (runScreeningCycle) reads this block
 * as the source of truth for auto-execution — the LLM is not trusted to
 * call deploy_position directly because models can silently skip tool
 * invocation when reasoning in prose.
 */

export interface ScreeningDecision {
  action: "DEPLOY" | "SKIP";
  pool_address?: string;
  pool_name?: string;
  bins_below?: number;
  bins_above?: number;
  strategy?: "bid_ask" | "spot";
  reason?: string;
  risks?: string[];
}

/**
 * Extract a DECISION_JSON block from the agent's report.
 *
 * Accepts either:
 *   DECISION_JSON: {"action": "DEPLOY", ...}
 *   DECISION_JSON:
 *   ```json
 *   {"action": "DEPLOY", ...}
 *   ```
 *
 * Returns the parsed decision, or null if no valid block found. Malformed
 * JSON inside a found block yields null (caller logs and skips deploy).
 */
export function parseDecisionJson(text: string): ScreeningDecision | null {
  if (!text) return null;

  // Locate the last DECISION_JSON: marker (in case LLM accidentally repeats).
  const markerIdx = text.lastIndexOf("DECISION_JSON:");
  if (markerIdx === -1) return null;

  const tail = text.slice(markerIdx + "DECISION_JSON:".length);

  // Find the opening brace that starts the JSON object, allowing for
  // whitespace and optional ```json fence between marker and brace.
  const braceIdx = tail.indexOf("{");
  if (braceIdx === -1) return null;

  // Walk forward to find the matching closing brace, respecting string
  // escapes so braces inside strings don't confuse the scan.
  let depth = 0;
  let end = -1;
  let inString = false;
  let escape = false;
  for (let i = braceIdx; i < tail.length; i++) {
    const c = tail[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }

  if (end === -1) return null;

  const jsonStr = tail.slice(braceIdx, end + 1);
  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.action !== "DEPLOY" && parsed.action !== "SKIP") return null;
    return parsed as ScreeningDecision;
  } catch {
    return null;
  }
}

export interface DecisionValidation {
  valid: boolean;
  reason?: string;
}

/**
 * Validate a parsed DEPLOY decision against the candidate list that was
 * given to the LLM. Rejects hallucinated pool addresses before they reach
 * the on-chain executor.
 */
export function validateDecision(
  decision: ScreeningDecision,
  candidates: Array<{ pool: string; name?: string }>
): DecisionValidation {
  if (decision.action === "SKIP") return { valid: true };
  if (decision.action !== "DEPLOY") return { valid: false, reason: "unknown action" };
  if (!decision.pool_address) return { valid: false, reason: "missing pool_address" };

  const match = candidates.find((c) => c.pool === decision.pool_address);
  if (!match) {
    return {
      valid: false,
      reason: `pool_address ${decision.pool_address.slice(0, 12)}... not in candidate list`,
    };
  }

  if (decision.strategy && decision.strategy !== "bid_ask" && decision.strategy !== "spot") {
    return { valid: false, reason: `invalid strategy: ${decision.strategy}` };
  }

  if (decision.bins_below != null && (decision.bins_below < 0 || decision.bins_below > 200)) {
    return { valid: false, reason: `bins_below out of range: ${decision.bins_below}` };
  }

  if (decision.bins_above != null && (decision.bins_above < 0 || decision.bins_above > 200)) {
    return { valid: false, reason: `bins_above out of range: ${decision.bins_above}` };
  }

  return { valid: true };
}

// ─── Management Decisions ─────────────────────────────────────

export interface ManagementDecision {
  action: "CLOSE" | "STAY" | "REBALANCE";
  position_address: string;
  pair?: string;
  reason?: string;
  risks?: string[];
}

export interface ManagementDecisions {
  decisions: ManagementDecision[];
}

/**
 * Extract MANAGEMENT_JSON block from the manager agent's report.
 * Format: MANAGEMENT_JSON: [{"action":"CLOSE","position_address":"...","reason":"..."}, ...]
 */
export function parseManagementJson(text: string): ManagementDecisions | null {
  if (!text) return null;

  const markerIdx = text.lastIndexOf("MANAGEMENT_JSON:");
  if (markerIdx === -1) return null;

  const tail = text.slice(markerIdx + "MANAGEMENT_JSON:".length);
  const bracketIdx = tail.indexOf("[");
  if (bracketIdx === -1) return null;

  let depth = 0;
  let end = -1;
  let inString = false;
  let escape = false;
  for (let i = bracketIdx; i < tail.length; i++) {
    const c = tail[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }

  if (end === -1) return null;
  const jsonStr = tail.slice(bracketIdx, end + 1);
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return null;
    const decisions = parsed.filter(
      (d: any) => d && typeof d === "object" && ["CLOSE", "STAY", "REBALANCE"].includes(d.action),
    );
    return { decisions };
  } catch {
    return null;
  }
}

/**
 * Validate management decisions against the list of open positions.
 * Returns only valid CLOSE decisions with matching position_address.
 */
export function validateManagementDecisions(
  decisions: ManagementDecision[],
  positions: Array<{ position: string; pair?: string }>,
): { valid: ManagementDecision[]; invalid: Array<{ decision: ManagementDecision; reason: string }> } {
  const posMap = new Map(positions.map((p) => [p.position, p]));
  const valid: ManagementDecision[] = [];
  const invalid: Array<{ decision: ManagementDecision; reason: string }> = [];

  for (const d of decisions) {
    if (d.action !== "CLOSE") continue; // Only CLOSE needs execution; STAY/REBALANCE are informational
    if (!d.position_address) {
      invalid.push({ decision: d, reason: "missing position_address" });
      continue;
    }
    if (!posMap.has(d.position_address)) {
      invalid.push({ decision: d, reason: `position ${d.position_address.slice(0, 12)}... not in open positions` });
      continue;
    }
    valid.push({ ...d, pair: d.pair ?? posMap.get(d.position_address)?.pair });
  }
  return { valid, invalid };
}
