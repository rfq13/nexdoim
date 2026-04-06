const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[LOG_LEVEL] || 1;

export function log(category: string, message: string) {
  const level = category.includes("error") ? "error"
    : category.includes("warn") ? "warn"
    : "info";

  if (LEVELS[level] < currentLevel) return;

  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${category.toUpperCase()}] ${message}`;
  console.log(line);
}

export function logAction(action: {
  tool: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  duration_ms?: number;
  success: boolean;
}) {
  const status = action.success ? "\u2713" : "\u2717";
  const dur = action.duration_ms != null ? ` (${action.duration_ms}ms)` : "";
  console.log(`[${action.tool}] ${status}${dur}`);
}

export function logSnapshot(snapshot: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  console.log(`[SNAPSHOT] ${timestamp}`, JSON.stringify(snapshot));
}
